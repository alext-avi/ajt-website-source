import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { remotePublication } from '../worker/remote-publication.mjs';
import { getPost, updateDraft } from '../mcp/content-service.mjs';

async function fixture(t) {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-remote-publication-'),
  );
  const sqlite = new DatabaseSync(path.join(folder, 'isolated.sqlite'));
  t.after(async () => {
    sqlite.close();
    await fs.rm(folder, { recursive: true, force: true });
  });
  for (const file of (await fs.readdir('migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort())
    sqlite.exec(await fs.readFile('migrations/' + file, 'utf8'));
  let pending = Promise.resolve();
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...args) };
        },
        async first() {
          return sqlite.prepare(sql).get(...args);
        },
        async run() {
          sqlite.prepare(sql).run(...args);
          return { success: true };
        },
      };
    },
    batch(statements) {
      const turn = pending.then(async () => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements)
            results.push(await statement.all());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
      pending = turn.catch(() => {});
      return turn;
    },
  };
  const metadata = {
    title: 'An isolated publication fixture',
    summary:
      'Synthetic content exercising publication transactions and access separation.',
    draft: true,
    example: false,
    featured: false,
    tags: [],
    date: '2026-10-25T00:00:00.000Z',
    category: 'Architecture',
    linkedinRepost: false,
    linkedinVideo: false,
    videoWidth: 1280,
    videoHeight: 720,
  };
  sqlite
    .prepare(
      "INSERT INTO content_items(collection,slug,metadata_json,body_markdown) VALUES('posts','fixture',?,'A synthetic local body.')",
    )
    .run(JSON.stringify(metadata));
  const store = {
    db,
    query: async (sql) => sqlite.prepare(sql).all(),
    identity: 'sqlite:' + folder,
    localOnly: true,
    resolveAsset: async () => {},
  };
  return {
    store,
    sqlite,
    publication: remotePublication(store, 'owner', 'https://site.test'),
  };
}
test('an owner-bound preview publishes atomically once, retaining revision history and excluding drafts from public reads', async (t) => {
  const { store, sqlite, publication } = await fixture(t);
  assert.equal(
    sqlite.prepare('SELECT count(*) n FROM published_content').get().n,
    0,
  );
  const item = await getPost(store, 'fixture');
  const token = await publication.prepare(item, 'posts');
  await assert.rejects(
    remotePublication(store, 'another-owner', 'https://site.test').post(token),
    /expired/,
  );
  const [a, b] = await Promise.all([
    publication.post(token),
    publication.post(token),
  ]);
  assert.equal(a.status, 'posted');
  assert.equal(b.status, 'posted');
  assert.equal((await getPost(store, 'fixture')).revision, 2);
  assert.equal(
    sqlite.prepare('SELECT count(*) n FROM content_revisions').get().n,
    2,
  );
  assert.equal(
    JSON.parse(
      sqlite.prepare('SELECT metadata_json FROM published_content').get()
        .metadata_json,
    ).draft,
    false,
  );
  assert.equal((await publication.post(token)).status, 'posted');
  assert.equal(
    sqlite.prepare('SELECT count(*) n FROM content_revisions').get().n,
    2,
  );
});
test('expired and stale previews cannot change the working copy or approved snapshot', async (t) => {
  const { store, sqlite, publication } = await fixture(t);
  const token = await publication.prepare(
    await getPost(store, 'fixture'),
    'posts',
  );
  await updateDraft(store, {
    slug: 'fixture',
    expectedRevision: 1,
    metadata: { title: 'A changed synthetic draft' },
  });
  await assert.rejects(publication.post(token), /draft changed/);
  const current = await publication.prepare(
    await getPost(store, 'fixture'),
    'posts',
  );
  sqlite.exec('UPDATE authoring_previews SET expires_at=0');
  await assert.rejects(publication.post(current), /expired/);
  assert.equal((await getPost(store, 'fixture')).metadata.draft, true);
  assert.equal(
    sqlite.prepare('SELECT count(*) n FROM published_content').get().n,
    0,
  );
});
test('an inactive website runtime blocks publication before any approval is committed', async (t) => {
  const { store, sqlite, publication } = await fixture(t);
  store.ensureRuntime = async () => {
    throw new Error('Runtime is not active');
  };
  const token = await publication.prepare(
    await getPost(store, 'fixture'),
    'posts',
  );
  await assert.rejects(publication.post(token), /not active/);
  assert.equal(
    sqlite.prepare('SELECT count(*) n FROM published_content').get().n,
    0,
  );
  assert.equal((await getPost(store, 'fixture')).metadata.draft, true);
});
test('a failed transaction exposes neither the snapshot nor its media and may be safely retried with the same capability', async (t) => {
  const { store, sqlite, publication } = await fixture(t);
  const original = store.db.batch;
  store.db.batch = async (statements) => {
    sqlite.exec(
      "CREATE TRIGGER fail_snapshot BEFORE INSERT ON published_content BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    try {
      return await original(statements);
    } finally {
      sqlite.exec('DROP TRIGGER fail_snapshot');
    }
  };
  const token = await publication.prepare(
    await getPost(store, 'fixture'),
    'posts',
  );
  await assert.rejects(publication.post(token), /fixture failure/);
  assert.equal(
    sqlite.prepare('SELECT count(*) n FROM published_content').get().n,
    0,
  );
  assert.equal((await getPost(store, 'fixture')).metadata.draft, true);
  store.db.batch = original;
  assert.equal((await publication.post(token)).status, 'posted');
});
