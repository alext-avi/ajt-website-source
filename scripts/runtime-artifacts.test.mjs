import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  removePreviewFiles,
  assertRuntimeArtifacts,
} from './lib/runtime-artifacts.mjs';
test('runtime builds remove preview environment files and reject credentials in remaining artifacts', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-runtime-artifacts-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'server'));
  const key = 'synthetic-private-credential';
  await fs.writeFile(
    path.join(root, 'server/.dev.vars'),
    `B2_MEDIA_APPLICATION_KEY=${key}`,
  );
  await fs.writeFile(
    path.join(root, 'server/.env.preview'),
    `B2_MEDIA_APPLICATION_KEY=${key}`,
  );
  await fs.writeFile(path.join(root, 'server/entry.mjs'), 'export default {};');
  await assert.rejects(assertRuntimeArtifacts(root), /Private preview/);
  await removePreviewFiles(root);
  await assertRuntimeArtifacts(root, { B2_MEDIA_APPLICATION_KEY: key });
  await fs.writeFile(
    path.join(root, 'server/entry.mjs'),
    `export const accidental=${JSON.stringify(key)};`,
  );
  await assert.rejects(
    assertRuntimeArtifacts(root, { B2_MEDIA_APPLICATION_KEY: key }),
    (error) =>
      error.message.includes('B2_MEDIA_APPLICATION_KEY') &&
      !error.message.includes(key),
  );
});
