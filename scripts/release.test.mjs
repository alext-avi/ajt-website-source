import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  prepareRelease,
  verifyRelease,
  verifyStaging,
  waitForStaging,
} from './lib/release.mjs';
import worker from '../worker/index.ts';

test('release verification refuses changes to the tested assets, Worker, or release identity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const file of [
    'dist/index.html',
    'dist/app.js',
    'worker/index.ts',
    'worker/media.ts',
    'src/lib/media.ts',
    'src/lib/referrals.ts',
    'wrangler.jsonc',
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), file);
  }
  const release = await prepareRelease(root, 'a'.repeat(40));
  await verifyRelease(root, release);
  for (const file of [
    'dist/app.js',
    'worker/index.ts',
    'worker/media.ts',
    'src/lib/media.ts',
    'wrangler.jsonc',
  ]) {
    const original = await fs.readFile(path.join(root, file));
    await fs.writeFile(path.join(root, file), 'changed');
    await assert.rejects(
      verifyRelease(root, release),
      /tested release changed/,
    );
    await fs.writeFile(path.join(root, file), original);
  }
  await fs.writeFile(
    path.join(root, 'dist/release.json'),
    JSON.stringify({ ...release, revision: 'b'.repeat(40) }),
  );
  await assert.rejects(verifyRelease(root, release), /tested release changed/);
});

test('promotion rejects another staging build and redirecting or non-staging responses', async () => {
  const release = {
    version: 1,
    revision: 'a'.repeat(40),
    artifactSha256: 'b'.repeat(64),
  };
  const response = (body = release, headers = {}) =>
    new Response(JSON.stringify(body), {
      headers: {
        'x-ajt-environment': 'staging',
        'x-ajt-release': release.artifactSha256,
        ...headers,
      },
    });
  await verifyStaging('https://stage.test', release, async () => response());
  await assert.rejects(
    verifyStaging('https://stage.test', release, async () =>
      response({ ...release, revision: 'c'.repeat(40) }),
    ),
    /identity mismatch/,
  );
  await assert.rejects(
    verifyStaging('https://stage.test', release, async () =>
      response(release, { 'x-ajt-environment': 'production' }),
    ),
    /expected release/,
  );
  await assert.rejects(
    verifyStaging(
      'https://stage.test',
      release,
      async () => new Response(null, { status: 302 }),
    ),
    /expected release/,
  );
});

test('staging readiness waits for the expected release and fails closed on an unavailable candidate', async () => {
  const release = {
    version: 1,
    revision: 'a'.repeat(40),
    artifactSha256: 'b'.repeat(64),
  };
  let requests = 0;
  await waitForStaging('https://stage.test', release, {
    timeoutMs: 100,
    intervalMs: 1,
    fetcher: async () =>
      ++requests < 3
        ? new Response('Propagating', { status: 404 })
        : new Response(JSON.stringify(release), {
            headers: {
              'x-ajt-environment': 'staging',
              'x-ajt-release': release.artifactSha256,
            },
          }),
  });
  assert.equal(requests, 3);
  await assert.rejects(
    waitForStaging('https://stage.test', release, {
      timeoutMs: 0,
      fetcher: async () => new Response('Unavailable', { status: 404 }),
    }),
    /did not become ready/,
  );
});

test('staging applies noindex and release identity to assets, redirects, errors, and unsupported methods', async () => {
  const env = {
    DEPLOYMENT_ENVIRONMENT: 'staging',
    RELEASE_ID: 'b'.repeat(64),
    ASSETS: { fetch: async () => new Response('asset', { status: 404 }) },
  };
  for (const [path, method, status] of [
    ['/', 'GET', 404],
    ['/r/anything', 'GET', 302],
    ['/r/anything', 'POST', 405],
    ['/r/a//b', 'GET', 404],
  ]) {
    const response = await worker.fetch(
      new Request('https://stage.test' + path, { method }),
      env,
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('x-ajt-release'), env.RELEASE_ID);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const ordinary = await worker.fetch(new Request('https://site.test/'), {
    ASSETS: env.ASSETS,
  });
  assert.equal(ordinary.headers.get('x-ajt-environment'), null);
  assert.equal(ordinary.headers.get('x-robots-tag'), null);
});
