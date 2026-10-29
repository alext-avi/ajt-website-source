import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('the sync client defaults to comparison, imports through MCP with its private media environment, and resumes without duplicates', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-sync-client-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const database = path.join(dir, 'content.sqlite');
  const input = path.join(dir, 'captures.json');
  const mediaDirectory = path.join(dir, 'private-media');
  const items = [
    {
      capture: {
        sourceUrl:
          'https://www.linkedin.com/feed/update/urn:li:share:7521286317457084477/',
        date: '2026-10-28',
        text: 'The exact published text.\n\nA second paragraph.',
        dateEvidence: 'Original post date supplied in the owner export.',
      },
      metadata: {
        title: 'A captured post for website review',
        summary:
          'An original post imported through the real client and MCP with its media.',
        category: 'Applied AI',
      },
      media: { image: path.resolve('public/images/videos/go-plant.jpg') },
    },
  ];
  await fs.writeFile(input, JSON.stringify(items));
  const run = async (flags = []) => {
    const result = await promisify(execFile)(
      process.execPath,
      [
        'scripts/linkedin-sync.mjs',
        '--local',
        '--database',
        database,
        '--input',
        input,
        ...flags,
      ],
      {
        env: { ...process.env, AJT_MEDIA_DIR: mediaDirectory },
        timeout: 30_000,
      },
    );
    return JSON.parse(result.stdout);
  };
  const comparison = await run();
  assert.equal(comparison.mode, 'check-only');
  assert.equal(comparison.posts[0].state, 'missing');
  await assert.rejects(fs.access(mediaDirectory), /ENOENT/);
  const imported = await run(['--apply']);
  assert.equal(imported.posts[0].state, 'draft-created');
  const media = await fs.readdir(mediaDirectory);
  assert.equal(media.length, 1);
  assert.deepEqual(
    await fs.readFile(path.join(mediaDirectory, media[0])),
    await fs.readFile(items[0].media.image),
  );
  const repeated = await run(['--apply']);
  assert.equal(repeated.posts[0].state, 'unchanged');
  items[0].capture.text =
    'An edit on LinkedIn must not overwrite website content.';
  await fs.writeFile(input, JSON.stringify(items));
  assert.equal((await run(['--apply'])).posts[0].state, 'source-changed');
  const db = new DatabaseSync(database);
  try {
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM content_items').get().n,
      1,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM linkedin_sources').get().n,
      1,
    );
    const row = db
      .prepare('SELECT is_draft,revision,body_markdown FROM content_items')
      .get();
    assert.equal(row.is_draft, 1);
    assert.equal(row.revision, 1);
    assert.match(row.body_markdown, /exact published text/);
  } finally {
    db.close();
  }
});
