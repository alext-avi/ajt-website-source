import { test, expect } from './fixtures';

test('visitors can navigate the main sections on desktop and mobile', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'No thanks', exact: true }).click();
  for (const [label, path] of [
    ['About', '/about/'],
    ['Projects', '/projects/'],
    ['Writing', '/writing/'],
    ['Speaking', '/speaking/'],
    ['Contact', '/contact/'],
  ]) {
    if (isMobile) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: label, exact: true })
        .click();
    } else if (label === 'Contact') {
      await page
        .getByRole('banner')
        .getByRole('link', { name: 'Let’s talk' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: label, exact: true })
        .click();
    }
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(`${label} | Alexander Thomas`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
      `${label} fits the viewport`,
    ).toBeLessThanOrEqual(1);
  }
});

test('mobile navigation closes with Escape and restores keyboard focus', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Mobile menu behavior');
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Open navigation' });
  await open.click();
  const menu = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Writing', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
});

test('dark mode is the default and a chosen theme survives navigation and reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto('/about/');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Switch to dark mode' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('writing filters support shared links, article navigation, browser back, and empty results', async ({
  page,
}) => {
  await page.goto('/writing/?category=Applied+AI&q=coral');
  const search = page.getByRole('searchbox', { name: 'Search writing' });
  await expect(search).toHaveValue('coral');
  await expect(
    page.getByRole('button', { name: 'Applied AI', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page
    .getByRole('link', { name: 'AI for coral restoration', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'AI for coral restoration',
  );
  await expect(page.locator('header.detail-head time')).toHaveAttribute(
    'datetime',
    '2026-09-29T00:00:00.000Z',
  );
  await page.goBack();
  await expect(search).toHaveValue('coral');
  await expect(page.getByRole('article')).toHaveCount(1);
  await search.fill('no-matching-post-e2e');
  await expect(
    page.getByRole('heading', { name: 'No posts found.' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/q=no-matching-post-e2e/);
  await page.getByRole('button', { name: 'Show all writing' }).click();
  await expect(search).toHaveValue('');
  await expect(page).toHaveURL(/\/writing\/$/);
  await expect(
    page.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await page.getByRole('article').count()).toBeGreaterThan(1);
});

test('writing waits for hydration before accepting a search query', async ({
  page,
}) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_astro/WritingExplorer*.js', async (route) => {
    await ready;
    await route.continue();
  });
  try {
    await page.goto('/writing/', { waitUntil: 'domcontentloaded' });
    const search = page.getByRole('searchbox', { name: 'Search writing' });
    await expect(search).toBeDisabled();
    release();
    await search.fill('coral');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page).toHaveURL(/q=coral/);
  } finally {
    release();
  }
});

test('wildcard referral links bring a visitor home with the channel and campaign intact', async ({
  page,
  baseURL,
}) => {
  await page.goto(
    '/r/New-Channel/speaking/autumn?utm_content=post-1&utm_source=spoof&next=https://outside.test&email=private@example.test',
  );
  const destination = new URL(page.url());
  expect(destination.origin).toBe(baseURL);
  expect(destination.pathname).toBe('/');
  expect(Object.fromEntries(destination.searchParams)).toEqual({
    utm_source: 'new-channel',
    utm_medium: 'referral',
    utm_campaign: 'speaking/autumn',
    utm_content: 'post-1',
  });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'I build software.',
  );
});

test('local video articles show a controlled, paused player and its poster', async ({
  page,
}) => {
  await page.goto('/writing/2026-10-12-test-strategy-speed-limit/');
  const video = page.getByLabel(
    'Video accompanying Your test strategy determines your speed limit',
  );
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveAttribute('poster', '/images/videos/go-plant.jpg');
  await expect(video).toHaveJSProperty('paused', true);
  await expect(video).toHaveJSProperty('autoplay', false);
});

test('LinkedIn players contact the provider only after the visitor loads the video', async ({
  page,
  externalRequests,
}) => {
  await page.route('https://www.linkedin.com/embed/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body>Test video player</body></html>',
    }),
  );
  await page.goto('/writing/2026-09-29-ai-for-coral-restoration/');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await page.getByRole('button', { name: 'Load video player' }).click();
  await expect(page.getByTitle('Embedded post')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Load video player' }),
  ).toHaveCount(0);
  await expect
    .poll(
      () =>
        externalRequests.filter((url) =>
          url.startsWith('https://www.linkedin.com/embed/'),
        ).length,
    )
    .toBe(1);
});
