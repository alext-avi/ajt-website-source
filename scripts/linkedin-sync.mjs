import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { linkedinCaptureSchema } from '../mcp/linkedin.mjs';

// Owner-supplied capture files only. This client neither scrapes nor publishes.
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    remote: { type: 'boolean' },
    local: { type: 'boolean' },
    database: { type: 'string' },
    apply: { type: 'boolean' },
    review: { type: 'boolean' },
  },
});
if (values.review && !values.apply)
  throw new Error(
    '--review requires --apply; the default check never writes review records.',
  );
if (
  !values.input ||
  !!values.remote === !!values.local ||
  (values.local && !values.database) ||
  (values.remote && values.database)
)
  throw new Error(
    'Choose --input <captures.json> and either --remote or --local --database <path>. Default is read-only; --apply creates missing drafts; --review prepares review links.',
  );
const input = await fs.readFile(values.input);
if (input.byteLength > 3_000_000) throw new Error('Capture file exceeds 3 MB');
const items = JSON.parse(input);
if (!Array.isArray(items) || items.length < 1 || items.length > 100)
  throw new Error('Supply 1–100 captured posts');
for (const item of items) {
  linkedinCaptureSchema.parse(item.capture);
  for (const [field, file] of Object.entries(item.media || {})) {
    if (
      !['image', 'video', 'videoPoster'].includes(field) ||
      typeof file !== 'string' ||
      !path.isAbsolute(file)
    )
      throw new Error(
        'Media must map image/video/videoPoster to an absolute local path',
      );
  }
}
const client = new Client({
  name: 'ajt-linkedin-capture-client',
  version: '1.0.0',
});
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      cwd: root,
      env: process.env,
      args: [
        path.join(root, 'mcp/content-server.mjs'),
        ...(values.remote
          ? ['--remote']
          : ['--local', '--database', path.resolve(values.database)]),
      ],
      stderr: 'pipe',
    }),
  );
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError)
      throw new Error(
        result.content.find((block) => block.type === 'text')?.text ||
          'Content MCP failed',
      );
    return result.structuredContent;
  }
  const before = await call('check_linkedin_sync', {
    captures: items.map((item) => item.capture),
  });
  const results = [];
  for (const [index, item] of items.entries()) {
    let result = before.posts[index];
    if (result.state === 'missing' && values.apply) {
      const metadata = { ...item.metadata };
      for (const [field, file] of Object.entries(item.media || {})) {
        const media = await call('upload_media', { path: file });
        metadata[field] = media.url;
      }
      result = await call('import_linkedin_post', {
        capture: item.capture,
        metadata,
      });
    }
    if (
      values.review &&
      result.slug &&
      !['source-changed', 'already-imported-legacy'].includes(result.state)
    ) {
      const post = await call('get_post', { slug: result.slug });
      if (post.metadata.draft)
        result.review = await call('submit_post_for_review', {
          slug: result.slug,
          expectedRevision: post.revision,
        });
    }
    results.push(result);
  }
  const report = {
    mode: values.apply ? 'import-drafts' : 'check-only',
    posts: results,
    coverage: before.coverage,
    publication: 'No content was published.',
  };
  if (values.output) {
    await fs.mkdir(path.dirname(path.resolve(values.output)), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(values.output, JSON.stringify(report, null, 2) + '\n', {
      mode: 0o600,
    });
    await fs.chmod(values.output, 0o600);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
