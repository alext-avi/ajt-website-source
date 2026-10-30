import { readJsonc } from './lib/configuration.mjs';
import { spawnSync } from 'node:child_process';
import { validateB2Config } from '../src/lib/b2.ts';
import {
  deploymentEnvironments,
  withWorkerSecrets,
} from './lib/deployment-secrets.mjs';
const env = process.env;
if (
  env.GITHUB_ACTIONS !== 'true' ||
  env.GITHUB_REPOSITORY !== 'alext-avi/ajt-website' ||
  env.GITHUB_REF !== 'refs/heads/main'
)
  throw new Error('Authoring code releases run only in private-main Actions');
const names = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'B2_MEDIA_ENDPOINT',
  'B2_MEDIA_BUCKET',
  'B2_AUTHORING_KEY_ID',
  'B2_AUTHORING_APPLICATION_KEY',
];
if (names.some((name) => !env[name]))
  throw new Error(
    'Missing authoring secrets. Complete setup:remote before enabling releases.',
  );
const secrets = Object.fromEntries(names.map((name) => [name, env[name]]));
validateB2Config({
  endpoint: secrets.B2_MEDIA_ENDPOINT,
  bucket: secrets.B2_MEDIA_BUCKET,
  keyId: secrets.B2_AUTHORING_KEY_ID,
  applicationKey: secrets.B2_AUTHORING_APPLICATION_KEY,
});
const config = await readJsonc('wrangler.authoring.jsonc');
if (
  config.kv_namespaces.some(
    (binding) => binding.id === '00000000000000000000000000000000',
  )
)
  throw new Error(
    'Provision the OAuth storage namespace before enabling releases',
  );
const { safeEnv, cloudflareEnv } = deploymentEnvironments(env);
let p = spawnSync(process.execPath, ['scripts/build-authoring.mjs'], {
  env: safeEnv,
  stdio: 'inherit',
});
if (p.status !== 0) throw new Error('Authoring build failed');
await withWorkerSecrets(secrets, async (file) => {
  p = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--config',
      'wrangler.authoring.jsonc',
      '--env',
      '',
      '--secrets-file',
      file,
    ],
    { env: cloudflareEnv, stdio: 'inherit' },
  );
  if (p.status !== 0) throw new Error('Authoring deployment failed');
});
