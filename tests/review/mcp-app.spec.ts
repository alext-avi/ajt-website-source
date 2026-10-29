import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('official MCP App bridge edits a project, uploads and removes private media, renders saved revisions, and hands final review to the human desk', async ({
  page,
  request,
}, testInfo) => {
  const prepared = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'create_project_draft',
      arguments: {
        slug: 'mcp-app-project',
        metadata: {
          title: 'A project prepared by the agent',
          summary:
            'The agent has already supplied the project details before human review.',
          role: 'Technical lead',
        },
        body: 'A prepared project body for review.',
      },
    },
  });
  expect((await prepared.json()).isError).not.toBe(true);
  await page.goto(
    'http://127.0.0.1:4334/?collection=projects&slug=mcp-app-project',
  );
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await expect(app.getByRole('navigation')).toHaveCount(0);
  await expect(
    app.getByRole('button', { name: 'New draft', exact: true }),
  ).toHaveCount(0);
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
  await app
    .getByRole('combobox', { name: 'Use upload as', exact: true })
    .selectOption('inline');
  await expect(
    app.getByRole('button', { name: 'Open draft', exact: true }),
  ).toBeEnabled();
  await app
    .getByRole('combobox', { name: 'Use upload as', exact: true })
    .selectOption('image');
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
    app.getByRole('button', { name: 'Open draft', exact: true }),
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
    .getByRole('heading', { name: 'Review draft', exact: true })
    .scrollIntoViewIfNeeded();
  await testInfo.attach('mcp-app-project-editor', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await app.getByRole('button', { name: 'Open draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText(
    'Draft opened in the local publishing desk.',
  );
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
  expect(
    calls.some((name) => /^(create_|list_posts|list_projects)/.test(name)),
  ).toBe(false);
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
  const other = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'create_post_draft',
      arguments: {
        slug: 'app-other-prepared',
        metadata: {
          title: 'Another prepared website draft',
          summary:
            'A separate prepared post to verify agent handoffs preserve unsaved edits.',
          date: '2026-10-29',
          category: 'Architecture',
        },
        body: 'Another saved draft body.',
      },
    },
  });
  expect((await other.json()).isError).not.toBe(true);
  await page.goto('http://127.0.0.1:4334/?slug=app-conflict');
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await app
    .getByLabel('Title', { exact: true })
    .fill('My unsaved editorial title');
  await page.evaluate(() =>
    (window as any).testHost.deliver({
      name: 'get_post',
      arguments: { slug: 'app-other-prepared' },
    }),
  );
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

test('MCP App waits for an agent-prepared draft instead of offering manual draft creation', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:4334/');
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText(
    'Waiting for a draft from your agent.',
  );
  await expect(
    app.getByText('Ask your agent to prepare or open a website draft.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(app.getByLabel('Title', { exact: true })).toBeHidden();
  await expect(app.getByRole('navigation')).toHaveCount(0);
  await expect(
    app.getByRole('button', { name: 'New draft', exact: true }),
  ).toHaveCount(0);
  const prepared = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'create_post_draft',
      arguments: {
        slug: 'app-agent-delivery',
        metadata: {
          title: 'A draft delivered by the agent',
          summary:
            'The human review App loads the prepared draft without a manual creation workflow.',
          date: '2026-10-29',
          category: 'Architecture',
        },
        body: 'Prepared content waiting for human review.',
      },
    },
  });
  expect((await prepared.json()).isError).not.toBe(true);
  await page.evaluate(() =>
    (window as any).testHost.deliver({
      name: 'get_post',
      arguments: { slug: 'app-agent-delivery' },
    }),
  );
  await expect(app.getByRole('status')).toContainText('Ready.');
  await expect(app.getByLabel('Title', { exact: true })).toHaveValue(
    'A draft delivered by the agent',
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

test('MCP App plays a private video after the post text without leaving the review', async ({
  page,
  request,
}, testInfo) => {
  const uploadedResponse = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'upload_media',
      arguments: { path: path.resolve('public/videos/buttery.mp4') },
    },
  });
  const uploaded = await uploadedResponse.json();
  expect(uploaded.isError).not.toBe(true);
  const videoUrl = uploaded.structuredContent.url;
  expect(videoUrl).toMatch(/^\/media\/[a-f0-9]{64}\.mp4$/);
  const preparedResponse = await request.post('http://127.0.0.1:4334/tool', {
    data: {
      name: 'create_post_draft',
      arguments: {
        slug: 'app-inline-video',
        metadata: {
          title: 'A prepared video post for review',
          summary:
            'A private video should play directly in the saved preview while the post stays a draft.',
          date: '2026-10-29',
          category: 'Developer tools',
          video: videoUrl,
          videoPoster: '/images/videos/go-plant.jpg',
          linkedinVideoCredit: 'An isolated local video fixture.',
        },
        body: '## A long article\n\n' + 'Watch the video below.\n\n'.repeat(20),
      },
    },
  });
  expect((await preparedResponse.json()).isError).not.toBe(true);
  await page.goto('http://127.0.0.1:4334/?slug=app-inline-video');
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await expect(app.locator('#preview-status')).toHaveText(
    'Play the video here using its controls.',
  );
  const preview = app.frameLocator('iframe[title="Saved draft preview"]');
  const video = preview.locator('video');
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty('controls', true);
  await expect(video).toHaveJSProperty('autoplay', false);
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('poster', /^data:image\/jpeg;base64,/);
  await expect(video.locator('source')).toHaveAttribute(
    'src',
    /^data:video\/mp4;base64,/,
  );
  await expect
    .poll(() => video.evaluate((player: HTMLVideoElement) => player.readyState))
    .toBeGreaterThanOrEqual(1);
  await expect(video).toHaveJSProperty('paused', true);
  await expect(preview.locator('figcaption')).toHaveText(
    'An isolated local video fixture.',
  );
  const videoBox = await video.boundingBox();
  const articleBox = await preview.locator('article').boundingBox();
  expect(articleBox!.y + articleBox!.height).toBeLessThanOrEqual(videoBox!.y);
  await video.press('Space');
  await expect
    .poll(() =>
      video.evaluate((player: HTMLVideoElement) => player.currentTime),
    )
    .toBeGreaterThan(0.25);
  await video.press('Space');
  await expect(video).toHaveJSProperty('paused', true);
  await app
    .getByRole('heading', { name: 'Review draft', exact: true })
    .scrollIntoViewIfNeeded();
  await testInfo.attach('mcp-app-inline-video', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  expect(page.url()).toBe('http://127.0.0.1:4334/?slug=app-inline-video');
});

test('human Post click publishes the rendered local draft even when the host cannot open links', async ({
  page,
  request,
}) => {
  const slug = 'app-human-post';
  const call = async (name: string, args: object) => {
    const response = await request.post('http://127.0.0.1:4334/tool', {
      data: { name, arguments: args },
    });
    const result = await response.json();
    expect(result.isError).not.toBe(true);
    return result.structuredContent;
  };
  await call('create_post_draft', {
    slug,
    metadata: {
      title: 'A human-approved local post',
      summary:
        'An isolated draft that only becomes published after the human clicks Post.',
      date: '2026-10-25',
      category: 'Architecture',
    },
    body: 'This is an isolated local publication fixture.',
  });
  await page.goto(`http://127.0.0.1:4334/?slug=${slug}&denyOpen=1`);
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  expect((await call('get_post', { slug })).metadata.draft).toBe(true);
  await app
    .getByRole('button', { name: 'Refresh preview', exact: true })
    .click();
  await expect(
    app.getByRole('button', { name: 'Post', exact: true }),
  ).toBeEnabled();
  expect((await call('get_post', { slug })).revision).toBe(1);
  await app.getByRole('button', { name: 'Open draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Use the draft link');
  const link = app.getByRole('link', {
    name: 'Open draft in publishing desk ↗',
  });
  await expect(link).toBeVisible();
  await expect(app.getByLabel('Draft address', { exact: true })).toHaveValue(
    /^http:\/\/127\.0\.0\.1:4331\/review\/[a-f0-9]{48}$/,
  );
  expect((await request.get((await link.getAttribute('href'))!)).ok()).toBe(
    true,
  );
  // A programmatic click must not publish; Playwright's real pointer click below does.
  await app
    .getByRole('button', { name: 'Post', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  expect((await call('get_post', { slug })).metadata.draft).toBe(true);
  await app.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(app.getByRole('status')).toContainText(
    'Posted in the local test database.',
  );
  const posted = await call('get_post', { slug });
  expect(posted.metadata.draft).toBe(false);
  expect(posted.revision).toBe(2);
  expect(posted.updatedBy).toBe('human-review');
  await expect(
    app.getByRole('button', { name: 'Post', exact: true }),
  ).toBeDisabled();
  const calls = await page.evaluate(
    () => (window as any).testHost.calls as string[],
  );
  expect(
    calls.filter((name) => name === 'publish_authoring_draft'),
  ).toHaveLength(1);
});

test('Post rejects a saved draft changed after its rendered preview', async ({
  page,
  request,
}) => {
  const slug = 'app-stale-publication';
  const call = async (name: string, args: object) => {
    const result = await (
      await request.post('http://127.0.0.1:4334/tool', {
        data: { name, arguments: args },
      })
    ).json();
    expect(result.isError).not.toBe(true);
    return result.structuredContent;
  };
  await call('create_post_draft', {
    slug,
    metadata: {
      title: 'A draft with a stale preview',
      summary:
        'An isolated draft that cannot publish a revision the reviewer has not seen.',
      date: '2026-10-25',
      category: 'Architecture',
    },
    body: 'The body originally rendered for review.',
  });
  await page.goto(`http://127.0.0.1:4334/?slug=${slug}`);
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await call('update_post_draft', {
    slug,
    expectedRevision: 1,
    body: 'A different saved revision that has not been reviewed.',
  });
  await app.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('The draft changed.');
  const current = await call('get_post', { slug });
  expect(current.metadata.draft).toBe(true);
  expect(current.revision).toBe(2);
  await expect(
    app.getByRole('button', { name: 'Post', exact: true }),
  ).toBeDisabled();
});
