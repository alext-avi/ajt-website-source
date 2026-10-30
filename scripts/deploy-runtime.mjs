import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadEnv } from 'vite';
import {
  loadWorkerSecrets,
  deploymentEnvironments,
  withWorkerSecrets,
} from './lib/deployment-secrets.mjs';
import { runtimeHash, runtimeConfig } from './lib/remote-release.mjs';
import { waitForStaging, verifyStaging } from './lib/release.mjs';
const { values } = parseArgs({
  options: { 'staging-only': { type: 'boolean' } },
});
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
if (
  env.GITHUB_ACTIONS !== 'true' ||
  env.GITHUB_REPOSITORY !== 'alext-avi/ajt-website' ||
  env.GITHUB_REF !== 'refs/heads/main' ||
  !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
)
  throw new Error(
    'Runtime releases run only in the private main workflow. Content Post never invokes this script.',
  );
const secrets = await loadWorkerSecrets(process.cwd(), env);
const { safeEnv, cloudflareEnv } = deploymentEnvironments(env);
function run(args, cloudflare = false, extra = {}) {
  const p = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...(cloudflare ? cloudflareEnv : safeEnv), ...extra },
  });
  if (p.status !== 0)
    throw new Error('Runtime release stopped; production was not promoted');
}
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this release through npm');
run([npm, 'run', 'verify']);
run([npm, 'run', 'build:runtime']);
await fs.copyFile(
  'dist/media-manifest.json',
  'dist-runtime/client/media-manifest.json',
);
const release = {
  version: 1,
  revision: env.GITHUB_SHA,
  artifactSha256: await runtimeHash(),
};
await fs.writeFile('dist-runtime/client/release.json', JSON.stringify(release));
const staging = await runtimeConfig('staging', release.artifactSha256);
const production = await runtimeConfig('production', release.artifactSha256);
await fs.mkdir('.wrangler/runtime-release', { recursive: true });
for (const [name, config] of [
  ['staging', staging],
  ['production', production],
])
  await fs.writeFile(
    `.wrangler/runtime-release/${name}.json`,
    JSON.stringify(config),
  );
async function currentMain() {
  const response = await fetch(
    'https://api.github.com/repos/alext-avi/ajt-website/git/ref/heads/main',
    {
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error('Cannot confirm current main');
  return (await response.json()).object.sha === env.GITHUB_SHA;
}
if (!(await currentMain())) throw new Error('A newer main revision exists');
await withWorkerSecrets(secrets, async (file) => {
  run(
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--config',
      '.wrangler/runtime-release/staging.json',
      '--secrets-file',
      file,
    ],
    true,
  );
  await waitForStaging(env.STAGING_URL, release);
  run([npm, 'run', 'test:staging'], false, {
    PLAYWRIGHT_STAGING_URL: env.STAGING_URL,
    EXPECTED_RELEASE_ID: release.artifactSha256,
    EXPECTED_SOURCE_REVISION: release.revision,
    EXPECTED_CANONICAL_ORIGIN: env.SITE_URL,
  });
  if ((await runtimeHash()) !== release.artifactSha256)
    throw new Error('Runtime artifact changed after testing');
  await verifyStaging(env.STAGING_URL, release);
  if (values['staging-only']) return;
  if (!(await currentMain())) throw new Error('A newer main revision arrived');
  run(
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--config',
      '.wrangler/runtime-release/production.json',
      '--secrets-file',
      file,
    ],
    true,
  );
  if (env.GITHUB_OUTPUT)
    await fs.appendFile(env.GITHUB_OUTPUT, 'deployed=true\n');
  if (env.GITHUB_STEP_SUMMARY)
    await fs.appendFile(
      env.GITHUB_STEP_SUMMARY,
      `\n### Runtime content deployed\n\nSource: ${release.revision}\n\nArtifact: ${release.artifactSha256}\n\nStaging desktop, mobile and HTTP checks passed. Content Post uses the Worker API directly and never dispatches this workflow.\n`,
    );
});
