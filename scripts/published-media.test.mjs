import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { publishedMediaSQL } from './lib/published-media.mjs';
import { renderMarkdown } from '../mcp/content-render.mjs';

test('heading links decode entities and avoid generated-suffix collisions', () => {
  const rendered = renderMarkdown(
    '## Intro\n\n## Intro\n\n## Intro 1\n\n## Q&A\n\n## Q&amp;A',
  );
  assert.deepEqual(
    rendered.headings.map(({ slug }) => slug),
    ['intro', 'intro-1', 'intro-1-1', 'q-a', 'q-a-1'],
  );
  assert.equal(rendered.headings[3].text, 'Q&A');
});

test('approved inline-media backfill and updates follow saved revisions without granting draft media access', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(await fs.readFile('migrations/0001_content.sql', 'utf8'));
    const first = '/media/' + 'a'.repeat(64) + '.png';
    const second = '/media/' + 'b'.repeat(64) + '.png';
    const draftOnly = '/media/' + 'c'.repeat(64) + '.png';
    const entry = {
      collection: 'posts',
      slug: 'isolated-media',
      data: { title: 'Synthetic fixture', draft: false, example: false },
      body: `Semicolon; retained.\n\n![Inline](${first})`,
    };
    db.prepare(
      'INSERT INTO content_items(collection,slug,metadata_json,body_markdown) VALUES(?,?,?,?)',
    ).run(entry.collection, entry.slug, JSON.stringify(entry.data), entry.body);
    db.exec(await fs.readFile('migrations/0004_remote_authoring.sql', 'utf8'));
    const register = async (item, revision) => {
      const sql = await publishedMediaSQL(item, revision);
      if (sql) db.exec(sql);
    };
    await register(entry, 1);
    await register(entry, 1);
    assert.deepEqual(
      db
        .prepare('SELECT url FROM published_media')
        .all()
        .map((row) => row.url),
      [first],
    );
    const revised = { ...entry, body: `[Attachment](${second})` };
    db.prepare('UPDATE content_items SET body_markdown=?,revision=2').run(
      revised.body,
    );
    await register(revised, 2);
    const active = () =>
      db
        .prepare(
          'SELECT m.url FROM published_media m JOIN published_content p USING(collection,slug,revision)',
        )
        .all()
        .map((row) => row.url);
    assert.deepEqual(active(), [second]);
    await register({ ...entry, body: `[Unapproved](${draftOnly})` }, 2);
    await register(
      {
        ...revised,
        data: { ...entry.data, draft: true },
        body: `[Draft](${draftOnly})`,
      },
      2,
    );
    await register(entry, 1);
    assert.deepEqual(active(), [second]);
    assert.equal(
      db
        .prepare('SELECT count(*) n FROM published_media WHERE url=?')
        .get(draftOnly).n,
      0,
    );
    assert.equal(
      db.prepare('SELECT count(*) n FROM content_revisions').get().n,
      2,
    );
  } finally {
    db.close();
  }
});
