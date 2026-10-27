import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStore } from '../mcp/content-server.mjs';
import {
  reserveMediaStorage,
  reserveMediaOperation,
  mediaStorageCeiling,
  mediaOperationCeilings,
} from '../mcp/media-budget.mjs';
import { listMedia, saveMedia } from '../mcp/media.mjs';
import { sqlText } from './lib/d1-content.mjs';

async function setup(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-media-budget-'),
  );
  const store = await createStore({
    database: path.join(directory, 'content.sqlite'),
    localR2: 'relative-test-r2',
  });
  t.after(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return store;
}

test('storage reservations are atomic, shared across connections, and duplicates cannot consume the remaining budget', async (t) => {
  const store = await setup(t);
  const second = await createStore({ database: store.identity.slice(7) });
  t.after(() => second.close());
  assert.equal(store.localR2, path.resolve('relative-test-r2'));
  await store.query(
    `UPDATE media_storage_budget SET reserved_bytes=${mediaStorageCeiling - 10} RETURNING id;`,
  );
  const results = await Promise.allSettled([
    reserveMediaStorage(store, 'a'.repeat(64) + '.jpg', 6),
    reserveMediaStorage(second, 'b'.repeat(64) + '.jpg', 6),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  await reserveMediaStorage(store, 'a'.repeat(64) + '.jpg', 6);
  assert.equal(
    (await store.query('SELECT reserved_bytes FROM media_storage_budget;'))[0]
      .reserved_bytes,
    mediaStorageCeiling - 4,
  );
  let uploads = 0;
  store.media.command = async () => {
    uploads++;
  };
  await assert.rejects(
    saveMedia(await fs.readFile('public/images/videos/go-plant.jpg'), store),
    /8 GB ceiling/,
  );
  assert.equal(
    uploads,
    0,
    'the actual R2 upload must not start after the safety ceiling is reached',
  );
});

test('monthly operation limits fail closed before another request and separate uploads from downloads', async (t) => {
  const store = await setup(t);
  await store.query(
    `INSERT INTO media_operation_budget VALUES(strftime('%Y-%m','now'),'put',${mediaOperationCeilings.put - 1}) RETURNING attempts;`,
  );
  await reserveMediaOperation(store, 'put');
  await assert.rejects(
    reserveMediaOperation(store, 'put'),
    /upload safety limit/,
  );
  await reserveMediaOperation(store, 'get');
  await assert.rejects(reserveMediaOperation(store, 'toString'), /Unsupported/);
  const rows = await store.query(
    'SELECT operation,attempts FROM media_operation_budget ORDER BY operation;',
  );
  assert.deepEqual(
    rows.map((row) => [row.operation, row.attempts]),
    [
      ['get', 1],
      ['put', 5000],
    ],
  );
});

test('media search can find an older match beyond the default catalog window', async (t) => {
  const store = await setup(t);
  for (let i = 0; i < 205; i++) {
    const filename = i.toString(16).padStart(64, '0') + '.jpg';
    const metadata = {
      storage: 'r2',
      bytes: 1,
      name: i === 0 ? 'older-needle.jpg' : 'recent.jpg',
    };
    await store.query(
      `INSERT INTO media_assets(url,kind,metadata_json,created_at) VALUES(${sqlText('/media/' + filename)},'image',${sqlText(JSON.stringify(metadata))},${sqlText(String(i).padStart(8, '0'))}) RETURNING url;`,
    );
  }
  const result = await listMedia(store, 'older-needle');
  assert(result.some((file) => file.name === 'older-needle.jpg'));
});
