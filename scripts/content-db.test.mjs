import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  writeEntrySQL,
  readPublishedFiles,
  snapshotFromRows,
  mediaSQL,
  validateEntry,
} from './lib/d1-content.mjs';

const migration = fs.readFileSync('migrations/0001_content.sql', 'utf8');
const root = new URL('../', import.meta.url);

test('D1 migration preserves the complete published inventory, original dates, and safe repeat imports', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migration);
    const entries = await readPublishedFiles(root);
    const count = entries.length;
    assert.ok(count > 0);
    for (const entry of entries)
      db.exec(`${writeEntrySQL(entry)}\n${mediaSQL(entry)}`);
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM content_revisions').get().n,
      count,
    );
    const first = entries.find((entry) => entry.collection === 'posts');
    const revised = structuredClone(first);
    revised.data.summary =
      "An updated summary with Alex's apostrophe and a quoted 'source'.";
    revised.body = "Preserve this text: '); DROP TABLE content_items; --";
    db.exec(writeEntrySQL(revised, 1));
    assert.equal(db.prepare('SELECT changes() AS n').get().n, 1);
    for (const entry of entries) db.exec(writeEntrySQL(entry));
    const stored = db
      .prepare('SELECT * FROM content_items WHERE collection=? AND slug=?')
      .get(first.collection, first.slug);
    assert.equal(stored.body_markdown, revised.body);
    assert.equal(stored.revision, 2);
    assert.equal(stored.published_on, first.data.date);
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM content_revisions').get().n,
      count + 1,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM content_items').get().n,
      count,
    );
    assert.ok(
      db.prepare('SELECT count(*) AS n FROM media_assets').get().n > 20,
    );
    const rows = db
      .prepare(
        'SELECT * FROM content_items WHERE is_draft=0 ORDER BY collection,slug',
      )
      .all();
    assert.equal(snapshotFromRows(rows).entries.length, count);
  } finally {
    db.close();
  }
});

test('D1 editing rejects stale revisions, retains history, and keeps drafts out of snapshots', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(migration);
    const entry = (await readPublishedFiles(root))[0];
    db.exec(writeEntrySQL(entry));
    const draft = structuredClone(entry);
    draft.data.draft = true;
    db.exec(writeEntrySQL(draft, 1));
    assert.equal(db.prepare('SELECT changes() AS n').get().n, 1);
    db.exec(writeEntrySQL(entry, 1));
    assert.equal(db.prepare('SELECT changes() AS n').get().n, 0);
    assert.equal(
      db.prepare('SELECT is_draft FROM content_items').get().is_draft,
      1,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM content_revisions').get().n,
      2,
    );
    assert.throws(
      () => snapshotFromRows(db.prepare('SELECT * FROM content_items').all()),
      /drafts/,
    );
    assert.throws(() => snapshotFromRows([]), /empty database/);
    assert.throws(
      () => writeEntrySQL({ ...entry, slug: '../private' }),
      /slug/,
    );
    assert.throws(() => writeEntrySQL(entry, -1), /Revision/);
  } finally {
    db.close();
  }
});

test('committed publication snapshot validates and preserves imported LinkedIn bodies and original publication dates', async () => {
  const snapshot = JSON.parse(fs.readFileSync('data/content.json', 'utf8'));
  const files = await readPublishedFiles(root);
  assert.equal(snapshot.version, 1);
  assert.ok(snapshot.entries.length > 0);
  for (const entry of snapshot.entries) {
    validateEntry(entry);
    assert.equal(entry.data.draft, false);
    assert.equal(entry.data.example, false);
  }
  for (const original of files.filter(
    (entry) => entry.collection === 'posts' && entry.data.linkedinUrl,
  )) {
    const record = snapshot.entries.find(
      (entry) =>
        entry.collection === original.collection &&
        entry.slug === original.slug,
    );
    assert.ok(record, original.slug);
    assert.equal(record.data.date, original.data.date, original.slug);
    assert.equal(
      record.data.linkedinUrl,
      original.data.linkedinUrl,
      original.slug,
    );
    assert.equal(record.body, original.body, original.slug);
    assert.equal(record.data.draft, false);
    assert.equal(record.data.example, false);
  }
});
