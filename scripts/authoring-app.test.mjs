import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test(
  'MCP App advertises its resource, keeps helpers app-only, and validates chunked private uploads through real RPC',
  { timeout: 30_000 },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-authoring-app-'));
    const client = new Client({ name: 'app-protocol-test', version: '1.0.0' });
    t.after(async () => {
      await client.close();
      await fs.rm(dir, { recursive: true, force: true });
    });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          'mcp/content-server.mjs',
          '--local',
          '--database',
          path.join(dir, 'content.sqlite'),
          '--local-r2',
          path.join(dir, 'r2'),
        ],
        env: {
          ...process.env,
          AJT_MEDIA_DIR: path.join(dir, 'media'),
          AJT_REVIEW_DIR: path.join(dir, 'reviews'),
        },
        stderr: 'pipe',
      }),
    );
    const call = (name, args) => client.callTool({ name, arguments: args });
    const value = (result) => {
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.structuredContent;
    };
    const rejected = async (name, args) => {
      try {
        assert.equal((await call(name, args)).isError, true);
      } catch (error) {
        assert.match(error.message, /valid|schema|argument/i);
      }
    };
    const { tools } = await client.listTools();
    const uri = 'ui://ajt-content/authoring.html';
    for (const name of [
      'open_authoring_app',
      'get_post',
      'get_project',
      'create_post_draft',
      'update_project_draft',
    ])
      assert.equal(
        tools.find((tool) => tool.name === name)._meta.ui.resourceUri,
        uri,
      );
    for (const name of [
      'render_authoring_preview',
      'begin_authoring_upload',
      'append_authoring_upload',
      'finish_authoring_upload',
      'read_authoring_media',
      'publish_authoring_draft',
      'get_authoring_publication_status',
    ])
      assert.deepEqual(
        tools.find((tool) => tool.name === name)._meta.ui.visibility,
        ['app'],
      );
    assert(
      !tools.some(
        (tool) =>
          /publish|approve|deploy|sql|delete/.test(tool.name) &&
          tool._meta?.ui?.visibility?.includes('model') !== false,
      ),
    );
    const { resources } = await client.listResources();
    assert(resources.some((resource) => resource.uri === uri));
    const {
      contents: [resource],
    } = await client.readResource({ uri });
    assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
    assert.deepEqual(resource._meta.ui.csp, {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: ['blob:'],
    });
    assert(resource.text.includes('Website authoring'));
    assert(!/<script[^>]*src=/.test(resource.text));

    await rejected('begin_authoring_upload', {
      name: 'too-large.mp4',
      bytes: 25 * 1024 * 1024 + 1,
    });
    const bytes = Buffer.concat([
      await fs.readFile('public/images/videos/go-plant.jpg'),
      Buffer.alloc(300_000, 1),
    ]);
    const upload = value(
      await call('begin_authoring_upload', {
        name: 'rpc-cover.jpg',
        bytes: bytes.length,
      }),
    );
    await rejected('finish_authoring_upload', { uploadId: upload.uploadId });
    await rejected('append_authoring_upload', {
      uploadId: upload.uploadId,
      offset: 1,
      data: bytes.subarray(0, 3).toString('base64'),
    });
    for (let offset = 0; offset < bytes.length; offset += upload.chunkBytes)
      value(
        await call('append_authoring_upload', {
          uploadId: upload.uploadId,
          offset,
          data: bytes
            .subarray(offset, offset + upload.chunkBytes)
            .toString('base64'),
        }),
      );
    const asset = value(
      await call('finish_authoring_upload', { uploadId: upload.uploadId }),
    );
    assert.match(asset.url, /^\/media\/[a-f0-9]{64}\.jpg$/);
    assert.equal(asset.name, 'rpc-cover.jpg');
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += upload.chunkBytes) {
      const part = value(
        await call('read_authoring_media', { url: asset.url, offset }),
      );
      assert.equal(part.offset, offset);
      assert.equal(part.totalBytes, bytes.length);
      assert.equal(part.mimeType, 'image/jpeg');
      chunks.push(Buffer.from(part.data, 'base64'));
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    await rejected('read_authoring_media', { url: '/images/../../.env' });
    await rejected('read_authoring_media', {
      url: 'https://outside.test/image.png',
    });
    await rejected('append_authoring_upload', {
      uploadId: upload.uploadId,
      offset: 0,
      data: 'YWJj',
    });
    const unsafe = Buffer.from('<svg onload="alert(1)"></svg>');
    const invalid = value(
      await call('begin_authoring_upload', {
        name: 'active.svg',
        bytes: unsafe.length,
      }),
    );
    value(
      await call('append_authoring_upload', {
        uploadId: invalid.uploadId,
        offset: 0,
        data: unsafe.toString('base64'),
      }),
    );
    await rejected('finish_authoring_upload', { uploadId: invalid.uploadId });
    assert.equal(
      value(await call('list_media', { query: 'active.svg' })).media.length,
      0,
    );
    assert.deepEqual(
      value(await call('open_authoring_app', { collection: 'projects' })),
      { collection: 'projects' },
    );
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        call('begin_authoring_upload', {
          name: `pending-${index}.jpg`,
          bytes: 3,
        }),
      ),
    );
    assert.equal(
      concurrent.filter((result) => !result.isError).length,
      4,
      'concurrent requests cannot exceed four pending private uploads',
    );
  },
);
