import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import {
  loadWorkerSecrets,
  deploymentEnvironments,
  withWorkerSecrets,
} from './lib/deployment-secrets.mjs';

const bindings = {
  B2_MEDIA_ENDPOINT: 'https://s3.us-east-005.backblazeb2.com',
  B2_MEDIA_BUCKET: 'ajt-test-media',
  B2_MEDIA_KEY_ID: 'readonlytestkey',
  B2_MEDIA_APPLICATION_KEY: 'fake-delivery-secret',
};

test('deployment credentials reach neither build subprocesses nor unrelated Cloudflare commands', async () => {
  const env = {
    ...bindings,
    GITHUB_ACTIONS: 'true',
    CLOUDFLARE_API_TOKEN: 'fake-cloudflare-token',
    GH_TOKEN: 'fake-github-token',
    GA4_ACCESS_TOKEN: 'fake-ga4-token',
    AJT_B2_CONFIG: '/private/authoring.json',
    SITE_URL: 'https://site.test',
  };
  assert.deepEqual(await loadWorkerSecrets('/missing', env), bindings);
  const { safeEnv, cloudflareEnv } = deploymentEnvironments(env);
  for (const [childEnv, expected] of [
    [safeEnv, []],
    [cloudflareEnv, ['CLOUDFLARE_API_TOKEN']],
  ]) {
    const present = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          'console.log(JSON.stringify(Object.keys(process.env).filter(name => /^(CLOUDFLARE_|B2_|AJT_B2|GH_TOKEN$|GA4_ACCESS_TOKEN$)/.test(name))))',
        ],
        { env: childEnv, encoding: 'utf8' },
      ),
    );
    assert.deepEqual(present, expected);
    assert.equal(childEnv.SITE_URL, env.SITE_URL);
  }
});

test('version deployment receives an owner-only secret file that is removed after success or failure', async () => {
  for (const fail of [false, true]) {
    let temporary;
    const deploy = withWorkerSecrets(bindings, async (file) => {
      temporary = file;
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
      const readByChild = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',
            file,
          ],
          { encoding: 'utf8' },
        ),
      );
      assert.deepEqual(readByChild, bindings);
      if (fail) throw new Error('Staging failed');
    });
    if (fail) await assert.rejects(deploy, /Staging failed/);
    else await deploy;
    await assert.rejects(fs.access(path.dirname(temporary)), {
      code: 'ENOENT',
    });
  }
});

test('local secrets require an owner-only real file; CI and partial environment input never fall back to disk', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-secret-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, '.dev.vars');
  await fs.writeFile(
    file,
    Object.entries(bindings)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join('\n'),
    { mode: 0o600 },
  );
  assert.deepEqual(await loadWorkerSecrets(root, {}), bindings);
  await assert.rejects(
    loadWorkerSecrets(root, { GITHUB_ACTIONS: 'true' }),
    /Missing deployment configuration/,
  );
  await assert.rejects(
    loadWorkerSecrets(root, { B2_MEDIA_KEY_ID: 'partial' }),
    /Missing deployment configuration/,
  );
  await fs.chmod(file, 0o644);
  await assert.rejects(loadWorkerSecrets(root, {}), /owner-only/);
  await fs.rename(file, path.join(root, 'real.env'));
  await fs.chmod(path.join(root, 'real.env'), 0o600);
  await fs.symlink('real.env', file);
  await assert.rejects(loadWorkerSecrets(root, {}), /owner-only/);
  await assert.rejects(
    loadWorkerSecrets(root, {
      ...bindings,
      B2_MEDIA_ENDPOINT: 'https://untrusted.test/',
    }),
    (error) =>
      !error.message.includes('fake-delivery-secret') &&
      /Invalid B2/.test(error.message),
  );
});

test('Actions exposes delivery secrets only in the trusted private-main deployment step', async () => {
  const workflow = parse(
    await fs.readFile('.github/workflows/verify.yml', 'utf8'),
  );
  assert(!('pull_request_target' in workflow.on));
  assert(!JSON.stringify(workflow.env).includes('secrets.'));
  assert(!JSON.stringify(workflow.jobs.verify).includes('secrets.'));
  assert(
    !JSON.stringify(workflow.jobs['production-checks']).includes('B2_MEDIA_'),
  );
  const deploy = workflow.jobs.deploy;
  assert.match(deploy.if, /github.repository == 'alext-avi\/ajt-website'/);
  assert.match(deploy.if, /github.ref == 'refs\/heads\/main'/);
  assert.match(deploy.if, /github.event_name == 'push'/);
  assert.match(deploy.if, /github.event_name == 'workflow_dispatch'/);
  const step = deploy.steps.find((step) => step.run === 'npm run deploy');
  assert.equal(
    step.env.B2_MEDIA_APPLICATION_KEY,
    '${{ secrets.B2_MEDIA_APPLICATION_KEY }}',
  );
  assert.equal(step.env.B2_MEDIA_KEY_ID, '${{ secrets.B2_MEDIA_KEY_ID }}');
  assert.equal(
    deploy.steps.find((step) => step.run === 'npm ci').env,
    undefined,
  );
});
