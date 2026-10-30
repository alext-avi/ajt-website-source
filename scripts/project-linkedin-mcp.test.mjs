import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createStore } from '../mcp/content-server.mjs';
import { linkedinIdentity, linkedinMarkdown } from '../mcp/linkedin.mjs';
import { renderPost } from '../mcp/reviews.mjs';
import { writeEntrySQL, sqlText } from './lib/d1-content.mjs';

test('real MCP project drafts retain metadata, isolate collections, and protect published projects', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-projects-'));
  const database = path.join(dir, 'content.sqlite');
  const store = await createStore({ database });
  const client = new Client({ name: 'project-content-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['mcp/content-server.mjs', '--local', '--database', database],
      stderr: 'pipe',
    }),
  );
  const call = (name, args) => client.callTool({ name, arguments: args });
  const value = (result) => {
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  };
  const metadata = {
    title: 'A meaningful project case study',
    summary:
      'A verified project overview with a clear role and supported outcomes.',
    role: 'Technical lead',
    technologies: ['TypeScript', 'SQLite'],
    outcomes: ['Delivered the reviewed workflow'],
    kind: 'agents',
    featured: true,
    order: 3,
  };
  const created = value(
    await call('create_project_draft', {
      slug: 'shared-slug',
      metadata,
      body: '## Problem\n\nA project body.',
    }),
  );
  assert.equal(created.collection, 'projects');
  assert.equal(created.metadata.draft, true);
  assert.equal(created.revision, 1);
  const revised = value(
    await call('update_project_draft', {
      slug: 'shared-slug',
      expectedRevision: 1,
      metadata: {
        summary:
          'A revised project overview with the same role, tools and verified outcomes.',
      },
    }),
  );
  for (const field of [
    'technologies',
    'outcomes',
    'kind',
    'featured',
    'order',
    'role',
  ])
    assert.deepEqual(revised.metadata[field], created.metadata[field]);
  assert.equal(
    (
      await call('update_project_draft', {
        slug: 'shared-slug',
        expectedRevision: 1,
        body: 'stale',
      })
    ).isError,
    true,
  );
  assert.equal(
    value(await call('get_project_history', { slug: 'shared-slug' })).revisions
      .length,
    2,
  );
  assert.equal(value(await call('list_projects', {})).projects.length, 1);
  assert.equal(value(await call('list_posts', {})).posts.length, 0);
  for (const extra of [
    { draft: false },
    { date: '2026-10-29' },
    { category: 'Architecture' },
    { repository: 'javascript:alert(1)' },
  ])
    assert.equal(
      (
        await call('create_project_draft', {
          slug: 'invalid-project',
          metadata: { ...metadata, ...extra },
          body: 'Invalid',
        })
      ).isError,
      true,
    );
  await store.query(
    writeEntrySQL({
      collection: 'projects',
      slug: 'published-project',
      data: { ...metadata, draft: false },
      body: 'Published project',
    }).replace(/;$/, ' RETURNING slug;'),
  );
  assert.equal(
    (
      await call('update_project_draft', {
        slug: 'published-project',
        expectedRevision: 1,
        body: 'replace',
      })
    ).isError,
    true,
  );
  // The same slug in a different collection must never be edited as a project.
  await store.query(
    writeEntrySQL({
      collection: 'posts',
      slug: 'shared-slug',
      data: {
        title: 'A different website post',
        summary: metadata.summary,
        category: 'Architecture',
        date: '2026-10-29',
        draft: true,
      },
      body: 'Unchanged post',
    }).replace(/;$/, ' RETURNING slug;'),
  );
  assert.equal(
    value(await call('get_post', { slug: 'shared-slug' })).body,
    'Unchanged post',
  );

  const capture = {
    sourceUrl:
      'https://www.linkedin.com/feed/update/urn:li:share:7521286317457084417/?utm_source=test',
    date: '2026-10-28',
    text: '# Original *words*\n\n1. A literal list, <markup> & punctuation.',
    dateEvidence: 'Export confirms original publication on October 28, 2026.',
  };
  const postMetadata = {
    title: 'Original LinkedIn content',
    summary: metadata.summary,
    category: 'Engineering leadership',
  };
  assert.equal(
    value(await call('check_linkedin_sync', { captures: [capture] })).posts[0]
      .state,
    'missing',
  );
  const imported = value(
    await call('import_linkedin_post', { capture, metadata: postMetadata }),
  );
  assert.equal(imported.state, 'draft-created');
  const post = value(await call('get_post', { slug: imported.slug }));
  assert.equal(post.metadata.draft, true);
  assert.equal(post.metadata.date, capture.date + 'T00:00:00.000Z');
  assert.equal(post.linkedinSource.text, capture.text);
  assert.equal(post.metadata.linkedinUrl.includes('?'), false);
  assert.equal(
    value(
      await call('import_linkedin_post', {
        capture: {
          ...capture,
          sourceUrl:
            'https://www.linkedin.com/posts/alexander-jt_example-share-7521286317457084417-x',
        },
        metadata: postMetadata,
      }),
    ).state,
    'already-imported',
  );
  assert.equal(
    value(await call('check_linkedin_sync', { captures: [capture] })).posts[0]
      .state,
    'unchanged',
  );
  assert.equal(
    value(
      await call('check_linkedin_sync', {
        captures: [{ ...capture, text: 'Edited on LinkedIn' }],
      }),
    ).posts[0].state,
    'source-changed',
  );
  assert.equal(
    value(
      await call('import_linkedin_post', {
        capture: { ...capture, date: '2026-10-29' },
        metadata: postMetadata,
      }),
    ).state,
    'source-changed',
  );
  assert.equal(
    (
      await call('update_post_draft', {
        slug: imported.slug,
        expectedRevision: 1,
        body: 'Rewrite the original',
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await call('update_post_draft', {
        slug: imported.slug,
        expectedRevision: 1,
        metadata: { date: '2026-10-29' },
      })
    ).isError,
    true,
  );
  assert.equal(
    value(
      await call('update_post_draft', {
        slug: imported.slug,
        expectedRevision: 1,
        metadata: { tags: ['linkedin'] },
      }),
    ).revision,
    2,
  );
  assert.equal(
    value(await call('get_post', { slug: imported.slug })).body,
    post.body,
  );
  const rows = await store.query('SELECT count(*) AS n FROM linkedin_sources;');
  assert.equal(rows[0].n, 1);
  await assert.rejects(
    store.query(
      "UPDATE linkedin_sources SET original_text='Replacement' RETURNING source_id",
    ),
    /immutable/,
  );
  await assert.rejects(
    store.query('DELETE FROM linkedin_sources RETURNING source_id'),
    /immutable/,
  );
  assert.equal(
    (await store.query('SELECT original_text FROM linkedin_sources'))[0]
      .original_text,
    capture.text,
  );
  // Failed validation and a collision cannot leave a source record without a draft.
  const invalid = {
    ...capture,
    sourceUrl:
      'https://www.linkedin.com/feed/update/urn:li:share:7521286317457084418/',
  };
  assert.equal(
    (
      await call('import_linkedin_post', {
        capture: invalid,
        metadata: { ...postMetadata, image: '/images/missing.png' },
      })
    ).isError,
    true,
  );
  await store.query(
    writeEntrySQL({
      collection: 'posts',
      slug: 'linkedin-7521286317457084418',
      data: { ...post.metadata },
      body: 'Reserved slug',
    }).replace(/;$/, ' RETURNING slug;'),
  );
  assert.equal(
    (
      await call('import_linkedin_post', {
        capture: invalid,
        metadata: postMetadata,
      })
    ).isError,
    true,
  );
  assert.equal(
    (await store.query('SELECT count(*) AS n FROM linkedin_sources;'))[0].n,
    1,
  );
  // A formatting upgrade must not lock previously imported source captures.
  const oldText = 'Original first line\nOriginal second line';
  const oldUrl =
    'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/';
  await store.query(
    `INSERT INTO linkedin_sources(source_id,source_url,slug,original_date,original_text,date_evidence,initial_metadata_json,initial_body_markdown) VALUES ('7000000000000000001',${sqlText(oldUrl)},'legacy-source-format',${sqlText(capture.date)},${sqlText(oldText)},'Isolated pre-hard-break capture fixture',${sqlText(JSON.stringify({ ...post.metadata, linkedinUrl: oldUrl }))},${sqlText(oldText)}) RETURNING slug;`,
  );
  const oldEdited = value(
    await call('update_post_draft', {
      slug: 'legacy-source-format',
      expectedRevision: 1,
      metadata: { tags: ['preserved'] },
    }),
  );
  assert.equal(oldEdited.body, oldText);
  assert.equal(oldEdited.revision, 2);
  const publicationTools = (await client.listTools()).tools.filter((tool) =>
    /approve|publish|deploy|sql|delete/i.test(tool.name),
  );
  assert.deepEqual(
    publicationTools.map((tool) => tool.name),
    ['publish_authoring_draft'],
  );
  assert.deepEqual(publicationTools[0]._meta.ui.visibility, ['app']);
  assert.equal(publicationTools[0].annotations.readOnlyHint, false);
});

test('LinkedIn permanent identifiers normalize tracking variants and reject unrelated destinations', async () => {
  assert.equal(
    linkedinIdentity(
      'https://www.linkedin.com/posts/alexander-jt_a-post-activity-7521286317457084417-abc',
    ).id,
    '7521286317457084417',
  );
  for (const url of [
    'https://evil.test/posts/a-activity-7521286317457084417',
    'https://www.linkedin.com.evil.test/feed/update/urn:li:share:7521286317457084417/',
    'https://www.linkedin.com/in/alexander-jt/',
    'https://x@www.linkedin.com/feed/update/urn:li:share:7521286317457084417/',
  ])
    assert.throws(() => linkedinIdentity(url));
  const html = await renderPost(
    linkedinMarkdown('# Heading\n\n*literal* <script>hello</script> & words.'),
  );
  assert(html.includes('*literal*'));
  assert(html.includes('&lt;script&gt;'));
  assert(!html.includes('<script>'));
  const lines = await renderPost(
    linkedinMarkdown('First line.\nSecond line.\n\nA new paragraph.'),
  );
  assert.match(lines, /First line\.<br\s*\/?>\s*Second line\./);
  assert.match(lines, /<p>A new paragraph\.<\/p>/);
});
