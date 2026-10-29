import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('official MCP App bridge edits a project, uploads and removes private media, renders saved revisions, and hands final review to the human desk', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('http://127.0.0.1:4334/?collection=projects');
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await app.getByLabel('URL name', { exact: true }).fill('mcp-app-project');
  await app
    .getByLabel('Title', { exact: true })
    .fill('A project authored inside the conversation');
  await app
    .getByLabel('Summary', { exact: true })
    .fill(
      'A project demonstrating a real MCP App editor, private media, rendering and a human review handoff.',
    );
  await app.getByLabel('My role', { exact: true }).fill('Engineering lead');
  await app
    .getByLabel('Tools & disciplines', { exact: true })
    .fill('MCP Apps, SQLite, Playwright');
  await app
    .getByLabel('Selected outcomes', { exact: true })
    .fill('A tested review workflow');
  await app
    .getByLabel('Body (Markdown)', { exact: true })
    .fill('## The problem\n\nThe human can **inspect and edit** this draft.');
  await app.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Draft saved.');
  const preview = app.frameLocator('iframe[title="Saved draft preview"]');
  await expect(
    preview.getByRole('heading', {
      name: 'A project authored inside the conversation',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    preview.getByText('Engineering lead', { exact: true }),
  ).toBeVisible();
  await app.getByText('Media and uploads', { exact: true }).click();
  await app.locator('#upload').setInputFiles({
    name: 'app-cover.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.concat([
      await fs.readFile('public/images/videos/go-plant.jpg'),
      Buffer.from('MCP App image fixture'),
    ]),
  });
  await expect(app.getByRole('status')).toContainText('Upload ready.');
  const asset = await app
    .getByLabel('Cover image', { exact: true })
    .inputValue();
  expect(asset).toMatch(/^\/media\/[a-f0-9]{64}\.jpg$/);
  await app
    .getByLabel('Cover image description', { exact: true })
    .fill('A private project cover');
  await expect(
    app.getByRole('button', { name: 'Open final review', exact: true }),
  ).toBeDisabled();
  await app.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Draft saved.');
  await expect(preview.getByAltText('A private project cover')).toBeVisible();
  await expect
    .poll(async () =>
      preview
        .getByAltText('A private project cover')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await app.getByLabel('Cover image', { exact: true }).fill('');
  await app.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Draft saved.');
  await expect(preview.locator('img')).toHaveCount(0);
  await app
    .getByRole('heading', { name: 'Draft authoring', exact: true })
    .scrollIntoViewIfNeeded();
  await testInfo.attach('mcp-app-project-editor', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await app
    .getByRole('button', { name: 'Open final review', exact: true })
    .click();
  await expect(app.getByRole('status')).toContainText('Final review opened.');
  const opened = await page.evaluate(() => (window as any).testHost.opened);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatch(
    /^http:\/\/127\.0\.0\.1:4331\/review\/[a-f0-9]{48}$/,
  );
  const review = await request.get(opened[0]);
  expect(review.ok()).toBe(true);
  expect(await review.text()).toContain(
    'A project authored inside the conversation',
  );
  const calls = await page.evaluate(
    () => (window as any).testHost.calls as string[],
  );
  expect(calls).toContain('append_authoring_upload');
  expect(calls).toContain('update_project_draft');
  expect(calls.some((name) => /publish|approve|deploy/.test(name))).toBe(false);
  await expect(
    app.getByRole('button', { name: 'Publish', exact: true }),
  ).toHaveCount(0);
});

test('MCP App preserves unsaved work and rejects a stale save without overwriting a concurrent revision', async ({
  page,
  request,
}) => {
  const result = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'create_post_draft',
      arguments: {
        slug: 'app-conflict',
        metadata: {
          title: 'An existing draft for conflict checks',
          summary:
            'A post that verifies stale saves cannot overwrite a concurrent draft edit.',
          date: '2026-10-29',
          category: 'Architecture',
        },
        body: 'Original saved body.',
      },
    },
  });
  expect((await result.json()).isError).not.toBe(true);
  await page.goto('http://127.0.0.1:4334/');
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await app
    .getByRole('button', {
      name: 'An existing draft for conflict checks',
      exact: false,
    })
    .click();
  await expect(app.getByRole('status')).toContainText('Saved draft loaded.');
  await app
    .getByLabel('Title', { exact: true })
    .fill('My unsaved editorial title');
  await app.getByRole('button', { name: 'New draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Save or reload');
  await expect(app.getByLabel('Title', { exact: true })).toHaveValue(
    'My unsaved editorial title',
  );
  const edit = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'update_post_draft',
      arguments: {
        slug: 'app-conflict',
        expectedRevision: 1,
        body: 'A concurrent saved revision.',
      },
    },
  });
  expect((await edit.json()).isError).not.toBe(true);
  await app.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Revision conflict');
  await expect(app.getByLabel('Title', { exact: true })).toHaveValue(
    'My unsaved editorial title',
  );
  await app
    .getByRole('button', { name: 'Reload saved draft', exact: true })
    .click();
  await expect(app.getByRole('status')).toContainText('Reloaded the latest');
  await expect(app.getByLabel('Body (Markdown)', { exact: true })).toHaveValue(
    'A concurrent saved revision.',
  );
});

test('MCP App edits imported post metadata while locking the original text and publication date', async ({
  page,
  request,
}) => {
  const capture = {
    sourceUrl:
      'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000007/',
    date: '2026-10-28',
    text: 'Original *literal* text.\nAnother original line.',
    dateEvidence:
      'Synthetic isolated fixture date for the MCP App integration test.',
  };
  const response = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'import_linkedin_post',
      arguments: {
        capture,
        metadata: {
          title: 'A captured post for the MCP App',
          summary:
            'A preserved original with editable website metadata and a human review handoff.',
          category: 'Architecture',
        },
      },
    },
  });
  const result = await response.json();
  expect(result.isError).not.toBe(true);
  const imported = result.structuredContent;
  expect(imported.state).toBe('draft-created');
  await page.goto(`http://127.0.0.1:4334/?slug=${imported.slug}`);
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await expect(
    app.getByLabel('Body (Markdown)', { exact: true }),
  ).toHaveAttribute('readonly', '');
  await expect(
    app.getByLabel('Publication date', { exact: true }),
  ).toHaveAttribute('readonly', '');
  await expect(app.getByLabel('Publication date', { exact: true })).toHaveValue(
    capture.date,
  );
  await app.getByText('Original capture', { exact: true }).click();
  await expect(app.locator('#source-text')).toHaveText(capture.text);
  const preview = app.frameLocator('iframe[title="Saved draft preview"]');
  await expect(preview.locator('article')).toHaveText(
    'Original *literal* text. Another original line.',
  );
  await expect(preview.locator('article br')).toHaveCount(1);
  await app
    .getByLabel('Title', { exact: true })
    .fill('An editorial title with its original intact');
  await app.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Draft saved.');
  const savedResponse = await request.post('http://127.0.0.1:4334/tool', {
    data: { name: 'get_post', arguments: { slug: imported.slug } },
  });
  const saved = (await savedResponse.json()).structuredContent;
  expect(saved.linkedinSource.text).toBe(capture.text);
  expect(saved.metadata.date.slice(0, 10)).toBe(capture.date);
  expect(saved.metadata.draft).toBe(true);
  expect(saved.revision).toBe(2);
});
