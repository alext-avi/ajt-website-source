import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { writeEntrySQL } from './lib/d1-content.mjs';

test(
  'a real MCP client creates and revises SQLite drafts while protecting published posts and revision history',
  { timeout: 30_000 },
  async (t) => {
    const temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ajt-content-mcp-'),
    );
    const database = path.join(temporary, 'content.sqlite');
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const db = new DatabaseSync(database);
    t.after(() => db.close());
    db.exec(await fs.readFile('migrations/0001_content.sql', 'utf8'));
    const metadata = {
      title: 'A real MCP integration post',
      summary:
        'A sufficiently detailed summary for an actual MCP protocol and database test.',
      date: '2026-10-27',
      category: 'Developer tools',
      tags: ['mcp'],
    };
    db.exec(
      writeEntrySQL({
        collection: 'posts',
        slug: 'published-original',
        data: { ...metadata, draft: false },
        body: 'Original published text',
      }),
    );
    const client = new Client({
      name: 'ajt-content-integration',
      version: '1.0.0',
    });
    t.after(() => client.close());
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['mcp/content-server.mjs', '--local', '--database', database],
      cwd: process.cwd(),
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr.on('data', (data) => {
      diagnostics += data.toString();
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'append_authoring_upload',
      'begin_authoring_upload',
      'check_linkedin_sync',
      'create_post_draft',
      'create_project_draft',
      'finish_authoring_upload',
      'get_authoring_publication_status',
      'get_post',
      'get_post_history',
      'get_project',
      'get_project_history',
      'import_linkedin_post',
      'list_media',
      'list_posts',
      'list_projects',
      'open_authoring_app',
      'publish_authoring_draft',
      'read_authoring_media',
      'render_authoring_preview',
      'submit_post_for_review',
      'submit_project_for_review',
      'update_post_draft',
      'update_project_draft',
      'upload_media',
    ]);
    const call = (name, args) => client.callTool({ name, arguments: args });
    const value = (result) => {
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse(
        result.content.find((block) => block.type === 'text').text,
      );
    };
    const body = "Preserve Alex's text: '); DROP TABLE content_items; --";
    const created = value(
      await call('create_post_draft', {
        slug: 'new-mcp-draft',
        metadata,
        body,
      }),
    );
    assert.equal(created.metadata.draft, true);
    assert.equal(created.metadata.example, false);
    assert.equal(created.revision, 1);
    assert.equal(created.body, body);
    assert.equal(
      db
        .prepare(
          "SELECT is_draft FROM content_items WHERE slug='new-mcp-draft'",
        )
        .get().is_draft,
      1,
    );
    assert.equal(
      (
        await call('create_post_draft', {
          slug: 'new-mcp-draft',
          metadata,
          body: 'Duplicate',
        })
      ).isError,
      true,
    );
    const revised = value(
      await call('update_post_draft', {
        slug: 'new-mcp-draft',
        expectedRevision: 1,
        metadata: {
          summary:
            'A revised summary that preserves the original post date and other metadata.',
        },
      }),
    );
    assert.equal(revised.revision, 2);
    assert.equal(revised.body, body);
    assert.equal(revised.metadata.date, created.metadata.date);
    assert.deepEqual(revised.metadata.tags, ['mcp']);
    assert.equal(
      (
        await call('update_post_draft', {
          slug: 'new-mcp-draft',
          expectedRevision: 1,
          body: 'Stale change',
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await call('update_post_draft', {
          slug: 'published-original',
          expectedRevision: 1,
          body: 'Unauthorized replacement',
        })
      ).isError,
      true,
    );
    assert.equal(
      value(await call('get_post', { slug: 'published-original' })).body,
      'Original published text',
    );
    const history = value(
      await call('get_post_history', { slug: 'new-mcp-draft' }),
    );
    assert.deepEqual(
      history.revisions.map((revision) => revision.revision),
      [2, 1],
    );
    assert(
      history.revisions.every(
        (revision) => revision.changedBy === 'content-mcp',
      ),
    );
    assert.equal(value(await call('list_posts', {})).posts.length, 1);
    assert.equal(
      value(await call('list_posts', { status: 'published' })).posts[0].slug,
      'published-original',
    );
    for (const args of [
      { slug: '../private', metadata, body },
      {
        slug: 'invalid-date',
        metadata: { ...metadata, date: 'not-a-date' },
        body,
      },
      {
        slug: 'bad-image',
        metadata: { ...metadata, image: '/images/../../.env' },
        body,
      },
      {
        slug: 'missing-image',
        metadata: { ...metadata, image: '/images/not-uploaded.png' },
        body,
      },
      {
        slug: 'publish-attempt',
        metadata: { ...metadata, draft: false },
        body,
      },
    ]) {
      try {
        assert.equal((await call('create_post_draft', args)).isError, true);
      } catch (error) {
        assert.match(error.message, /valid|schema|argument|date|slug|draft/i);
      }
    }
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM content_items').get().n,
      2,
    );
    assert(!diagnostics.includes('CLOUDFLARE_API_TOKEN'));
  },
);
