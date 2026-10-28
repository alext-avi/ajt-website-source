import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadEnv } from 'vite';
import {
  loadWorkerSecrets,
  deploymentEnvironments,
  withWorkerSecrets,
} from './lib/deployment-secrets.mjs';
import {
  prepareRelease,
  verifyRelease,
  verifyStaging,
  waitForStaging,
} from './lib/release.mjs';

const { values } = parseArgs({
  options: { 'staging-only': { type: 'boolean' } },
});
const root = process.cwd();
const env = {
  ...loadEnv('production', root, ''),
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
};
const stagingURL = new URL(
  env.STAGING_URL ||
    'https://alexander-thomas-staging.alexander-jt.workers.dev',
);
const productionURL = new URL(env.SITE_URL);
if (
  stagingURL.protocol !== 'https:' ||
  stagingURL.pathname !== '/' ||
  stagingURL.search ||
  stagingURL.hash ||
  stagingURL.username ||
  stagingURL.password ||
  stagingURL.origin === productionURL.origin
) {
  throw new Error('STAGING_URL must be a separate HTTPS origin');
}
if (
  env.GITHUB_ACTIONS === 'true' &&
  (env.GITHUB_REPOSITORY !== 'alext-avi/ajt-website' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))
) {
  throw new Error(
    'CI deployment is restricted to production repository main pushes/manual runs',
  );
}
const mediaSecrets = await loadWorkerSecrets(root, env);
const { cloudflareEnv, safeEnv } = deploymentEnvironments(env);

function run(command, args, cloudflare = false, extra = {}) {
  console.log(`\nRunning ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...(cloudflare ? cloudflareEnv : safeEnv), ...extra },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed; publication stopped`);
}
async function currentMain() {
  if (env.GITHUB_ACTIONS !== 'true') return true;
  const response = await fetch(
    'https://api.github.com/repos/alext-avi/ajt-website/git/ref/heads/main',
    {
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Could not verify current main revision (HTTP ${response.status})`,
    );
  const sha = (await response.json()).object?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha || ''))
    throw new Error('Invalid main revision from GitHub');
  return sha === env.GITHUB_SHA;
}
function output(name, value) {
  if (env.GITHUB_OUTPUT)
    fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

run('npm', ['run', 'db:pull', '--', '--remote'], true);
run('npm', ['run', 'verify']);
run(process.execPath, ['scripts/check-deploy.mjs']);
const revision =
  env.GITHUB_SHA ||
  spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const release = await prepareRelease(root, revision);
if (!(await currentMain())) {
  console.log('A newer main revision exists; skipping this outdated release.');
  process.exit(0);
}
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
await withWorkerSecrets(mediaSecrets, async (secretsFile) => {
  run(
    process.execPath,
    [
      wrangler,
      'deploy',
      '--env',
      'staging',
      '--tag',
      revision,
      '--secrets-file',
      secretsFile,
      '--var',
      `RELEASE_ID:${release.artifactSha256}`,
    ],
    true,
  );
  await waitForStaging(stagingURL, release);
  run('npm', ['run', 'test:staging'], false, {
    PLAYWRIGHT_STAGING_URL: stagingURL.origin,
    EXPECTED_RELEASE_ID: release.artifactSha256,
    EXPECTED_SOURCE_REVISION: revision,
    EXPECTED_CANONICAL_ORIGIN: productionURL.origin,
  });
  await verifyRelease(root, release);
  await verifyStaging(stagingURL, release);
  output('staging-tested', 'true');
  if (env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `\n### Staging passed\n\nTarget: ${stagingURL.origin}\n\nSource: ${revision}\n\nArtifact SHA-256: ${release.artifactSha256}\n\nReal desktop Chromium, mobile WebKit, and HTTP checks passed before production promotion.\n`,
    );
  console.log(
    `Staging verified: ${stagingURL.origin}; artifact ${release.artifactSha256}`,
  );
  if (values['staging-only']) return;
  if (!(await currentMain())) {
    console.log(
      'A newer main revision arrived during staging tests; skipping production.',
    );
    return;
  }
  run(process.execPath, ['scripts/check-deploy.mjs']);
  await verifyRelease(root, release);
  run(
    process.execPath,
    [wrangler, 'deploy', '--tag', revision, '--secrets-file', secretsFile],
    true,
  );
  output('deployed', 'true');
});
