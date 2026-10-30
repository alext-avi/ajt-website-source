import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { validateB2Config } from '../../src/lib/b2.ts';

export const workerSecretNames = [
  'B2_MEDIA_ENDPOINT',
  'B2_MEDIA_BUCKET',
  'B2_MEDIA_KEY_ID',
  'B2_MEDIA_APPLICATION_KEY',
];

export async function loadWorkerSecrets(root, env) {
  let values = env;
  const supplied = workerSecretNames.filter((name) => env[name]);
  if (!supplied.length && env.GITHUB_ACTIONS !== 'true') {
    const file = path.join(root, '.dev.vars');
    try {
      const stat = await fs.lstat(file);
      if (
        process.platform === 'win32' ||
        !stat.isFile() ||
        stat.mode & 0o077 ||
        stat.uid !== process.getuid()
      )
        throw new Error();
      values = parseEnv(await fs.readFile(file, 'utf8'));
    } catch {
      throw new Error(
        'Local deployment requires an owner-only .dev.vars file with the read-only B2 delivery bindings. See docs/secrets.md.',
      );
    }
  }
  const missing = workerSecretNames.filter((name) => !values[name]);
  if (missing.length)
    throw new Error('Missing deployment configuration: ' + missing.join(', '));
  const secrets = Object.fromEntries(
    workerSecretNames.map((name) => [name, values[name]]),
  );
  try {
    validateB2Config({
      endpoint: secrets.B2_MEDIA_ENDPOINT,
      bucket: secrets.B2_MEDIA_BUCKET,
      keyId: secrets.B2_MEDIA_KEY_ID,
      applicationKey: secrets.B2_MEDIA_APPLICATION_KEY,
    });
  } catch {
    throw new Error(
      'Invalid B2 delivery configuration; values were not logged.',
    );
  }
  return secrets;
}

// Only Wrangler's cloud operations receive its token. Builds, tests, and their
// dependency hooks receive neither deployment nor media/authoring credentials.
export function deploymentEnvironments(env) {
  const safeEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !/^(?:CLOUDFLARE_|B2_|AJT_B2|AJT_REVIEW_|VITE_USER_NODE_ENV$|GH_TOKEN$|GITHUB_TOKEN$|GITHUB_CLIENT_|GA4_ACCESS_TOKEN$)/.test(
          name,
        ),
    ),
  );
  // The local review desk runs under Astro dev. Its environment must never
  // turn a release build into a legacy-file/draft preview.
  safeEnv.NODE_ENV = 'production';
  safeEnv.CONTENT_SOURCE = 'd1';
  const cloudflareEnv = { ...safeEnv };
  if (env.CLOUDFLARE_API_TOKEN)
    cloudflareEnv.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN;
  return { safeEnv, cloudflareEnv };
}

export async function withWorkerSecrets(secrets, deploy) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-worker-secrets-'),
  );
  try {
    await fs.chmod(directory, 0o700);
    const file = path.join(directory, 'bindings.json');
    await fs.writeFile(file, JSON.stringify(secrets), {
      mode: 0o600,
      flag: 'wx',
    });
    return await deploy(file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
