import fs from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { validateB2Config } from '../src/lib/b2.ts';
const { values } = parseArgs({
  options: { configure: { type: 'boolean' }, apply: { type: 'boolean' } },
});
const file = '.dev.vars.authoring';
const repo = 'alext-avi/ajt-website';
function gh(args, input) {
  const result = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, GH_DEBUG: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0)
    throw new Error(
      'GitHub configuration failed. Check your gh login and repository administrator access. Secret values were not logged.',
    );
  return result.stdout;
}
async function hidden(prompt) {
  if (!process.stdin.isTTY)
    throw new Error('Interactive configuration requires a local terminal');
  process.stderr.write(prompt + ': ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      process.stdin.off('data', read);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      error ? reject(error) : resolve(value);
    }
    function read(chunk) {
      for (const char of chunk.toString()) {
        if (char === '\u0003') {
          finish(new Error('Cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u007f') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    }
    process.stdin.on('data', read);
  });
}
if (values.configure) {
  try {
    await fs.lstat(file);
    throw new Error(
      'The local authoring file already exists. Edit it in your local editor to rotate credentials.',
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log(
    'Create a personal GitHub OAuth App at https://github.com/settings/applications/new',
  );
  console.log('Name: Alexander Thomas Website Authoring');
  console.log('Homepage: https://ajt-content.alexander-jt.workers.dev');
  console.log(
    'Callback: https://ajt-content.alexander-jt.workers.dev/callback',
  );
  console.log(
    'Device flow: leave disabled. No repository permissions are needed.',
  );
  const client = await hidden('GitHub OAuth Client ID');
  const secret = await hidden('GitHub OAuth Client secret');
  const b2File = '.wrangler/content-media/b2.json';
  const stat = await fs.lstat(b2File);
  if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid())
    throw new Error('B2 authoring file must be owner-only');
  const stored = JSON.parse(await fs.readFile(b2File, 'utf8'));
  const b2 = stored.config || stored;
  validateB2Config(b2);
  const config = {
    GITHUB_CLIENT_ID: client,
    GITHUB_CLIENT_SECRET: secret,
    B2_MEDIA_ENDPOINT: b2.endpoint,
    B2_MEDIA_BUCKET: b2.bucket,
    B2_AUTHORING_KEY_ID: b2.keyId,
    B2_AUTHORING_APPLICATION_KEY: b2.applicationKey,
  };
  await fs.writeFile(
    file,
    Object.entries(config)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Saved the ignored, owner-only authoring environment file. No values were printed.',
  );
}
if (!values.apply) {
  console.log(
    'Remote authoring requires a GitHub OAuth App, an OAuth KV namespace, and the separate staging D1 database.',
  );
  console.log(
    'Run setup:remote -- --configure in a local terminal to save credentials without showing them.',
  );
  console.log(
    'Run setup:remote -- --apply to send the saved authoring credentials to the private production GitHub environment. This does not deploy or enable remote publishing.',
  );
  process.exit(0);
}
const stat = await fs.lstat(file);
if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid())
  throw new Error('The local authoring file must be owner-only');
const config = parseEnv(await fs.readFile(file, 'utf8'));
const names = {
  GITHUB_CLIENT_ID: 'AUTHORING_GITHUB_CLIENT_ID',
  GITHUB_CLIENT_SECRET: 'AUTHORING_GITHUB_CLIENT_SECRET',
  B2_AUTHORING_KEY_ID: 'B2_AUTHORING_KEY_ID',
  B2_AUTHORING_APPLICATION_KEY: 'B2_AUTHORING_APPLICATION_KEY',
};
if (
  [...Object.keys(names), 'B2_MEDIA_ENDPOINT', 'B2_MEDIA_BUCKET'].some(
    (name) => !config[name],
  )
)
  throw new Error('The authoring environment file is incomplete');
const environment = JSON.parse(
  gh(['api', `repos/${repo}/environments/production`]),
);
if (!environment.deployment_branch_policy?.custom_branch_policies)
  throw new Error(
    'The production environment needs a main-only deployment policy first',
  );
const rules = JSON.parse(
  gh([
    'api',
    `repos/${repo}/environments/production/deployment-branch-policies`,
  ]),
).branch_policies;
if (
  rules.length !== 1 ||
  rules[0].name !== 'main' ||
  rules[0].type !== 'branch'
)
  throw new Error(
    'Refusing to copy credentials into an environment not restricted to main',
  );
for (const [local, github] of Object.entries(names)) {
  gh(
    ['secret', 'set', github, '--repo', repo, '--env', 'production'],
    config[local],
  );
  console.log('Configured private environment secret: ' + github);
}
console.log(
  'Authoring secrets are stored separately from public source. Remote mode remains disabled until the schema, bindings and runtime release are ready.',
);
