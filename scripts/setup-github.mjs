import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadWorkerSecrets } from './lib/deployment-secrets.mjs';

export const repository = 'alext-avi/ajt-website';
const environment = 'production';
const apiRoot = `repos/${repository}`;
const environmentRoot = `${apiRoot}/environments/${environment}`;
const mediaSecretNames = ['B2_MEDIA_KEY_ID', 'B2_MEDIA_APPLICATION_KEY'];

export function githubCLI(env = process.env) {
  const childEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !/^(CLOUDFLARE_|B2_|AJT_B2)/.test(name),
    ),
  );
  // Debug HTTP logging could expose secret request bodies before encryption.
  delete childEnv.GH_DEBUG;
  delete childEnv.DEBUG;
  childEnv.GH_HOST = 'github.com';
  return (args, { input, interactive = false, allow404 = false } = {}) => {
    const result = spawnSync('gh', args, {
      env: childEnv,
      input,
      encoding: 'utf8',
      stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      maxBuffer: 5_000_000,
    });
    if (allow404 && result.status && /HTTP 404/.test(result.stderr || ''))
      return null;
    if (result.error || result.status !== 0)
      throw new Error(
        `GitHub ${args[0]} ${args[1]} failed; no credential diagnostics were printed.`,
      );
    return result.stdout?.trim() || '';
  };
}

export async function setupGitHub({
  root,
  env = process.env,
  apply = false,
  promptCloudflare = false,
  interactive = !!process.stdin.isTTY,
  gh = githubCLI(env),
}) {
  if (env.GITHUB_ACTIONS === 'true')
    throw new Error('Run this owner setup locally, never from a CI job.');
  if (promptCloudflare && (!apply || !interactive))
    throw new Error(
      '--prompt-cloudflare-token requires --apply and an interactive terminal.',
    );
  const api = (method, endpoint, body, allow404 = false) => {
    const args = [
      'api',
      '--method',
      method,
      endpoint,
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
    ];
    if (body !== undefined) args.push('--input', '-');
    const output = gh(args, {
      input: body === undefined ? undefined : JSON.stringify(body),
      allow404,
    });
    return output === null ? null : output ? JSON.parse(output) : null;
  };
  const pages = (endpoint, field) =>
    JSON.parse(gh(['api', '--paginate', '--slurp', endpoint])).flatMap(
      (page) => page[field],
    );
  const names = (scope) =>
    new Set(
      JSON.parse(
        gh([
          'secret',
          'list',
          '--repo',
          repository,
          ...(scope ? ['--env', environment] : []),
          '--json',
          'name',
        ]),
      ).map((item) => item.name),
    );
  const repo = api('GET', apiRoot);
  if (
    repo.full_name !== repository ||
    !repo.private ||
    !repo.permissions?.admin
  )
    throw new Error(
      'Setup requires administrator access to the exact private deployment repository.',
    );
  const bindings = await loadWorkerSecrets(root, {});
  const existing = api('GET', environmentRoot, undefined, true);
  if (
    existing &&
    (!existing.deployment_branch_policy?.custom_branch_policies ||
      existing.deployment_branch_policy.protected_branches)
  )
    throw new Error(
      'Existing environment uses another branch policy; review it before changing access.',
    );
  let policies = existing
    ? pages(
        `${environmentRoot}/deployment-branch-policies?per_page=100`,
        'branch_policies',
      )
    : [];
  if (
    policies.some(
      (policy) => policy.name !== 'main' || policy.type !== 'branch',
    ) ||
    policies.length > 1
  )
    throw new Error(
      'Unexpected allowed branches/tags exist; review them before storing credentials.',
    );
  const repoNames = names(false);
  const environmentNames = existing ? names(true) : new Set();
  const cloudflareToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (cloudflareToken && !/^[\x21-\x7e]{20,4096}$/.test(cloudflareToken))
    throw new Error(
      'Invalid Cloudflare token input; its value was not printed.',
    );
  if (
    apply &&
    repoNames.has('CLOUDFLARE_API_TOKEN') &&
    !environmentNames.has('CLOUDFLARE_API_TOKEN') &&
    !cloudflareToken &&
    !promptCloudflare
  )
    throw new Error(
      'GitHub cannot return the repository token. Re-enter it with --prompt-cloudflare-token before migrating it.',
    );

  const summary = {
    repository,
    environment,
    mode: apply ? 'apply' : 'audit',
    allowedRefs: policies.map(({ name, type }) => ({ name, type })),
    repositorySecretNames: [...repoNames].sort(),
    environmentSecretNames: [...environmentNames].sort(),
    cloudflareTokenConfigured: environmentNames.has('CLOUDFLARE_API_TOKEN'),
    plannedChanges: [
      'Allow only branch main',
      'Store read-only B2 delivery secrets in production environment',
      'Set non-secret B2 endpoint/bucket repository variables',
      'Remove repository-wide duplicates after verified environment storage',
    ],
  };
  if (!apply) return summary;

  // Never PUT an existing environment: that could reset reviewer/wait protections.
  if (!existing)
    api('PUT', environmentRoot, {
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    });
  if (!policies.length)
    api('POST', `${environmentRoot}/deployment-branch-policies`, {
      name: 'main',
      type: 'branch',
    });
  const protectedEnvironment = api('GET', environmentRoot);
  policies = pages(
    `${environmentRoot}/deployment-branch-policies?per_page=100`,
    'branch_policies',
  );
  if (
    !protectedEnvironment.deployment_branch_policy?.custom_branch_policies ||
    protectedEnvironment.deployment_branch_policy.protected_branches ||
    policies.length !== 1 ||
    policies[0].name !== 'main' ||
    policies[0].type !== 'branch'
  )
    throw new Error(
      'Main-only environment protection was not confirmed. No secrets were written.',
    );

  for (const name of mediaSecretNames)
    gh(['secret', 'set', name, '--repo', repository, '--env', environment], {
      input: bindings[name],
    });
  for (const name of ['B2_MEDIA_ENDPOINT', 'B2_MEDIA_BUCKET'])
    gh(['variable', 'set', name, '--repo', repository], {
      input: bindings[name],
    });
  if (cloudflareToken || promptCloudflare)
    gh(
      [
        'secret',
        'set',
        'CLOUDFLARE_API_TOKEN',
        '--repo',
        repository,
        '--env',
        environment,
      ],
      cloudflareToken ? { input: cloudflareToken } : { interactive: true },
    );

  const verifiedNames = names(true);
  const expected = [
    ...mediaSecretNames,
    ...(cloudflareToken ||
    promptCloudflare ||
    environmentNames.has('CLOUDFLARE_API_TOKEN')
      ? ['CLOUDFLARE_API_TOKEN']
      : []),
  ];
  if (expected.some((name) => !verifiedNames.has(name)))
    throw new Error(
      'Environment secret storage was not confirmed. Repository copies were retained.',
    );
  for (const name of expected)
    if (repoNames.has(name))
      gh(['secret', 'delete', name, '--repo', repository]);
  const remainingNames = names(false);
  if (expected.some((name) => remainingNames.has(name)))
    throw new Error(
      'A repository-wide duplicate remains; inspect secret names before enabling deployment.',
    );
  return {
    ...summary,
    allowedRefs: policies.map(({ name, type }) => ({ name, type })),
    repositorySecretNames: [...remainingNames].sort(),
    environmentSecretNames: [...verifiedNames].sort(),
    cloudflareTokenConfigured: verifiedNames.has('CLOUDFLARE_API_TOKEN'),
    next: verifiedNames.has('CLOUDFLARE_API_TOKEN')
      ? 'Review/merge the environment-enabled workflow and run the normal staging-gated release.'
      : 'Create the limited Cloudflare CI token, then rerun with --apply --prompt-cloudflare-token. No token was invented or copied from Wrangler OAuth.',
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        apply: { type: 'boolean' },
        'prompt-cloudflare-token': { type: 'boolean' },
      },
    });
    const result = await setupGitHub({
      root: fileURLToPath(new URL('../', import.meta.url)),
      apply: values.apply,
      promptCloudflare: values['prompt-cloudflare-token'],
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
