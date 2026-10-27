import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildMediaManifest } from './lib/media-manifest.mjs';
import worker from '../worker/index.ts';

test('the public allowlist comes only from rendered media references and fails closed without a valid manifest', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-media-release-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const image = 'a'.repeat(64) + '.jpg';
  const pdf = 'b'.repeat(64) + '.pdf';
  const privateFile = 'c'.repeat(64) + '.mp4';
  await fs.writeFile(
    path.join(directory, 'index.html'),
    `<img src="/media/${image}"><a href="/media/${pdf}#page=2">PDF</a><pre>/media/${privateFile}</pre>`,
  );
  const manifest = await buildMediaManifest(directory);
  assert.deepEqual(manifest.files, [image, pdf]);
  for (const body of [
    null,
    '{}',
    JSON.stringify({ version: 1, files: ['../private'] }),
    '{invalid',
  ]) {
    let reads = 0;
    const response = await worker.fetch(
      new Request('https://site.test/media/' + image),
      {
        ASSETS: {
          fetch: async () =>
            new Response(body, { status: body === null ? 404 : 200 }),
        },
        MEDIA_BUCKET: {
          head: async () => {
            reads++;
            return null;
          },
          get: async () => null,
        },
      },
    );
    assert.equal(response.status, 503);
    assert.equal(reads, 0);
  }
  const response = await worker.fetch(
    new Request('https://site.test/media/' + privateFile),
    {
      ASSETS: { fetch: async () => Response.json(manifest) },
      MEDIA_BUCKET: {
        head: async () => {
          throw new Error('Draft must not be read');
        },
        get: async () => null,
      },
    },
  );
  assert.equal(response.status, 404);
});
