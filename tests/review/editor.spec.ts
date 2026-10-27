import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import fs from 'node:fs/promises';
import path from 'node:path';

const state = path.resolve('.wrangler/review-integration');
let client: Client;
const metadata = {
  title: 'A draft for human review',
  summary:
    'A complete draft summary for checking the editor, media, and human publication controls.',
  date: '2026-10-27',
  category: 'Engineering leadership',
  tags: ['review'],
};
test.beforeAll(async () => {
  client = new Client({ name: 'ajt-review-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        'mcp/content-server.mjs',
        '--local',
        '--database',
        path.join(state, 'content.sqlite'),
        '--local-r2',
        path.join(state, 'r2'),
      ],
      cwd: process.cwd(),
      env: {
        ...(process.env as Record<string, string>),
        AJT_REVIEW_ORIGIN: 'http://127.0.0.1:4331',
        AJT_REVIEW_DIR: path.join(state, 'tickets'),
        AJT_MEDIA_DIR: path.join(state, 'media'),
      },
      stderr: 'pipe',
    }),
  );
});
test.afterAll(async () => {
  await client.close();
});
async function tool(name: string, args: object) {
  const result = await client.callTool({
    name,
    arguments: args as Record<string, unknown>,
  });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return JSON.parse(
    result.content.find((block) => block.type === 'text')!.text as string,
  );
}
async function draft(slug: string) {
  await tool('create_post_draft', {
    slug,
    metadata,
    body: '## A real rendered heading\n\nThe body contains **formatted text**.',
  });
  return tool('submit_post_for_review', { slug, expectedRevision: 1 });
}

test('human editor saves revisions, privately uploads/replaces media, and publishes only the saved review', async ({
  page,
}, testInfo) => {
  const review = await draft('human-editor-test');
  await page.goto('/review/' + review.id);
  const preview = page.frameLocator('iframe[title="Rendered draft"]');
  await expect(
    preview.getByRole('heading', { name: metadata.title, exact: true }),
  ).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('formatted text');
  await expect(
    page.getByRole('button', { name: 'Publish', exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel('Title', { exact: true })
    .fill('An edited draft ready for review');
  await expect(
    page.getByRole('button', { name: 'Publish', exact: true }),
  ).toBeDisabled();
  const first = await fs.readFile('public/images/videos/go-plant.jpg');
  await page.locator('[data-upload-field="image"]').setInputFiles({
    name: 'cover.jpg',
    mimeType: 'image/jpeg',
    buffer: first,
  });
  await expect(page.locator('#upload-status')).toContainText('Upload ready');
  const firstUrl = await page.locator('#media-image').inputValue();
  await expect(
    page.getByRole('button', { name: 'Publish', exact: true }),
  ).toBeDisabled();
  await expect(async () => {
    await expect(
      fs.access(path.join('public', firstUrl)),
    ).rejects.toBeDefined();
  }).toPass();
  await page
    .getByLabel('Cover image description')
    .fill('A plant used to illustrate the article');
  await page
    .getByRole('button', { name: 'Save changes and refresh preview' })
    .click();
  await expect(
    preview.getByRole('heading', {
      name: 'An edited draft ready for review',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByAltText('A plant used to illustrate the article'),
  ).toBeVisible();
  const afterSave = await tool('get_post', { slug: 'human-editor-test' });
  expect(afterSave.revision).toBe(2);
  expect(afterSave.metadata.draft).toBe(true);
  const replacement = Buffer.concat([
    first,
    Buffer.from('replacement fixture'),
  ]);
  await page.locator('[data-upload-field="image"]').setInputFiles({
    name: 'replacement.jpg',
    mimeType: 'image/jpeg',
    buffer: replacement,
  });
  await expect(page.locator('#upload-status')).toContainText('Upload ready');
  expect(await page.locator('#media-image').inputValue()).not.toBe(firstUrl);
  await page
    .getByRole('button', { name: 'Save changes and refresh preview' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Publish', exact: true }),
  ).toBeEnabled();
  await testInfo.attach('draft-editor-and-preview', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Approved in the local test database',
  );
  const published = await tool('get_post', { slug: 'human-editor-test' });
  expect(published.metadata.draft).toBe(false);
  expect(published.revision).toBe(4);
  const history = await tool('get_post_history', { slug: 'human-editor-test' });
  expect(history.revisions[0].changedBy).toBe('human-review');
  await expect(
    page.getByRole('button', { name: 'Publish', exact: true }),
  ).toBeDisabled();
});

test('stale reviews and cross-origin requests cannot publish a changed draft', async ({
  page,
  request,
}) => {
  const review = await draft('stale-editor-test');
  const response = await page.goto('/review/' + review.id);
  expect(response!.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  expect(response!.headers()['x-frame-options']).toBe('DENY');
  const index = await request.get('/review');
  expect(index.headers()['x-frame-options']).toBe('DENY');
  const csrf = await page.locator('[data-csrf]').getAttribute('data-csrf');
  const denied = await request.post('/api/review/' + review.id, {
    form: { csrf: csrf!, action: 'publish' },
    headers: { Origin: 'https://outside.test', 'Sec-Fetch-Site': 'cross-site' },
  });
  expect(denied.status()).toBe(403);
  await tool('update_post_draft', {
    slug: 'stale-editor-test',
    expectedRevision: 1,
    body: 'Changed after the review was prepared.',
  });
  await page.reload();
  await expect(page.getByRole('status')).toContainText(
    'This draft has changed',
  );
  await expect(
    page.getByRole('button', { name: 'Publish', exact: true }),
  ).toBeDisabled();
  const tools = await client.listTools();
  expect(
    tools.tools.some((tool) => /publish|approve|deploy/.test(tool.name)),
  ).toBe(false);
  const post = await tool('get_post', { slug: 'stale-editor-test' });
  expect(post.metadata.draft).toBe(true);
});
