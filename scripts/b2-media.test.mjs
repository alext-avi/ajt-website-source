import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startB2TestServer } from '../tests/fixtures/b2-server.mjs';
import { createStore } from '../mcp/content-server.mjs';
import { saveMedia, resolveAsset, listMedia } from '../mcp/media.mjs';
import { b2Client, validateB2Config } from '../src/lib/b2.ts';
import { mediaStorageCeiling } from '../mcp/media-budget.mjs';
import worker from '../worker/index.ts';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-b2-'));
  const server = await startB2TestServer({
    directory: path.join(directory, 'objects'),
  });
  const config = path.join(directory, 'b2.json');
  await fs.writeFile(config, JSON.stringify(server.config), { mode: 0o600 });
  const store = await createStore({
    database: path.join(directory, 'content.sqlite'),
    localB2: config,
  });
  const previous = process.env.AJT_MEDIA_DIR;
  process.env.AJT_MEDIA_DIR = path.join(directory, 'cache');
  t.after(async () => {
    if (previous === undefined) delete process.env.AJT_MEDIA_DIR;
    else process.env.AJT_MEDIA_DIR = previous;
    store.close();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const bytes = await fs.readFile('public/images/videos/go-plant.jpg');
  return { directory, server, store, bytes };
}

test('B2 authoring signs real HTTP uploads, deduplicates versions, and recovers verified bytes without its cache', async (t) => {
  const { directory, server, store, bytes } = await fixture(t);
  const image = await saveMedia(bytes, store, 'sample.jpg');
  assert.equal(image.storage, 'local-b2');
  assert.equal(
    image.url,
    '/media/' + createHash('sha256').update(bytes).digest('hex') + '.jpg',
  );
  await saveMedia(bytes, store, 'sample.jpg');
  assert.equal(
    server.stats.writes,
    1,
    'a repeated upload must not create a B2 version',
  );
  assert.equal(
    (await store.query('SELECT reserved_bytes FROM media_storage_budget'))[0]
      .reserved_bytes,
    bytes.length,
  );
  await fs.rm(path.join(directory, 'cache'), { recursive: true, force: true });
  assert.deepEqual(
    await fs.readFile(await resolveAsset(image.url, store)),
    bytes,
  );
  assert(
    (await listMedia(store, 'sample.jpg')).some(
      (asset) => asset.url === image.url,
    ),
  );
  assert(server.stats.signed >= 4);
  await fs.writeFile(
    path.join(directory, 'objects', image.url.slice(7)),
    Buffer.concat([bytes.subarray(0, -1), Buffer.from([0])]),
  );
  await assert.rejects(
    resolveAsset(image.url, store, { refresh: true }),
    /B2 operation failed/,
  );
});

test('failed and repeated B2 PUT reservations cannot conceal version storage growth', async (t) => {
  const { server, store, bytes } = await fixture(t);
  server.state.failWrites = true;
  await assert.rejects(saveMedia(bytes, store), /B2 operation failed/);
  await assert.rejects(saveMedia(bytes, store), /B2 operation failed/);
  assert.equal(
    (await store.query('SELECT reserved_bytes FROM media_storage_budget'))[0]
      .reserved_bytes,
    bytes.length * 2,
  );
  assert.equal(
    (await store.query('SELECT COUNT(*) AS count FROM media_assets'))[0].count,
    0,
  );
  await store.query(
    `UPDATE media_storage_budget SET reserved_bytes=${mediaStorageCeiling - 1} RETURNING id;`,
  );
  await assert.rejects(saveMedia(bytes, store), /8 GB ceiling/);
  assert.equal(server.stats.writes, 0);
});

test('B2 private delivery, ranges, conditional requests, and caching preserve the release allowlist', async (t) => {
  const { store, bytes, server } = await fixture(t);
  const image = await saveMedia(bytes, store);
  const videoBytes = Buffer.concat([
    Buffer.from('00000018667479706d703432000000006d703432', 'hex'),
    Buffer.alloc(256),
  ]);
  const video = await saveMedia(videoBytes, store);
  const approved = new Set([image.url.slice(7), video.url.slice(7)]);
  const env = {
    DEPLOYMENT_ENVIRONMENT: 'local-test',
    MEDIA_PROVIDER: 'b2',
    B2_MEDIA_ENDPOINT: server.config.endpoint,
    B2_MEDIA_BUCKET: server.config.bucket,
    B2_MEDIA_KEY_ID: server.config.keyId,
    B2_MEDIA_APPLICATION_KEY: server.config.applicationKey,
    ASSETS: {
      fetch: async () => Response.json({ version: 1, files: [...approved] }),
    },
  };
  const entries = new Map();
  const context = {
    cache: {
      match: async (request) => entries.get(request.url)?.clone(),
      put: async (request, response) => {
        entries.set(
          request.url,
          new Response(await response.arrayBuffer(), response),
        );
      },
    },
  };
  const get = (url, options) =>
    worker.fetch(new Request('https://site.test' + url, options), env, context);
  const cold = await get(image.url);
  assert.equal(cold.status, 200);
  assert.equal(cold.headers.get('x-ajt-media-cache'), 'MISS');
  assert.deepEqual(Buffer.from(await cold.arrayBuffer()), bytes);
  const reads = server.stats.reads;
  const warm = await get(image.url + '?anything=ignored');
  assert.equal(warm.headers.get('x-ajt-media-cache'), 'HIT');
  assert.equal(server.stats.reads, reads);
  assert.equal(
    (
      await get(image.url, {
        headers: { 'If-None-Match': warm.headers.get('etag') },
      })
    ).status,
    304,
  );
  assert.equal(
    (await get(image.url, { method: 'HEAD' })).headers.get('content-length'),
    String(bytes.length),
  );
  assert.equal(
    (await get(image.url, { method: 'PUT', body: 'overwrite' })).status,
    405,
  );
  const partial = await get(video.url, { headers: { Range: 'bytes=0-15' } });
  assert.equal(partial.status, 206);
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    videoBytes.subarray(0, 16),
  );
  assert.equal(
    (await get(video.url, { headers: { Range: 'bytes=-0' } })).status,
    416,
  );
  approved.delete(image.url.slice(7));
  assert.equal(
    (await get(image.url)).status,
    404,
    'cached bytes must not bypass a newer release allowlist',
  );
  assert.equal(
    server.stats.reads,
    reads + 3,
    'unapproved requests must not reach B2',
  );
});

test('B2 credentials only go to the configured HTTPS Backblaze endpoint; local mode and media names are explicit', async () => {
  const config = {
    endpoint: 'https://s3.us-east-005.backblazeb2.com',
    bucket: 'ajt-media',
    keyId: 'key',
    applicationKey: 'secret',
  };
  assert.equal(validateB2Config(config).region, 'us-east-005');
  for (const endpoint of [
    'http://s3.us-east-005.backblazeb2.com',
    'https://evil.test',
    'https://s3.us-east-005.backblazeb2.com.evil.test',
    'https://s3.us-east-005.backblazeb2.com/other',
    'http://127.0.0.1:9999',
  ])
    assert.throws(() => validateB2Config({ ...config, endpoint }));
  let calls = 0;
  const client = b2Client(config, {
    fetcher: async (request) => {
      calls++;
      assert.equal(request.redirect, 'manual');
      assert.equal(request.cache, 'no-store');
      assert(!request.url.includes('secret'));
      return new Response(null, { status: 503 });
    },
  });
  await assert.rejects(client.request('GET', '../private'));
  await assert.rejects(client.request('DELETE', 'a'.repeat(64) + '.jpg'));
  assert.equal(
    (await client.request('HEAD', 'a'.repeat(64) + '.jpg')).status,
    503,
  );
  assert.equal(
    calls,
    1,
    'no hidden automatic retries consume the free-account quota',
  );
  let redirects = 0;
  const redirecting = b2Client(config, {
    fetcher: async () => {
      redirects++;
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://outside.test/' },
      });
    },
  });
  await assert.rejects(
    redirecting.request('HEAD', 'a'.repeat(64) + '.jpg'),
    /redirects are not allowed/,
  );
  assert.equal(redirects, 1);
});

test('world-readable B2 credential files fail before any storage request', async (t) => {
  const { directory, server, store, bytes } = await fixture(t);
  await fs.chmod(path.join(directory, 'b2.json'), 0o644);
  await assert.rejects(saveMedia(bytes, store), /B2 operation failed/);
  assert.equal(server.stats.signed, 0);
});

test('signed HEAD requests bypass intermediary caches that convert cold HEAD requests into GET', async (t) => {
  const { directory, server, bytes } = await fixture(t);
  const filename = createHash('sha256').update(bytes).digest('hex') + '.jpg';
  await fs.writeFile(path.join(directory, 'objects', filename), bytes);
  const client = b2Client(server.config, {
    localTest: true,
    // Model Cloudflare's documented cold-cache HEAD-to-GET conversion. The
    // independent S3 fixture rejects the changed method's original signature.
    fetcher: (request) =>
      fetch(
        request.cache === 'no-store'
          ? request
          : new Request(request, { method: 'GET' }),
      ),
  });
  const response = await client.request('HEAD', filename);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal(server.stats.signed, 1);
});
