import { writeFile } from 'node:fs/promises';
import { test, expect, type Response } from '@playwright/test';

function collectionEvents(response: Response) {
  const request = response.request();
  const url = new URL(request.url());
  if (
    !(
      url.hostname === 'analytics.google.com' ||
      url.hostname === 'google-analytics.com' ||
      url.hostname.endsWith('.google-analytics.com')
    ) ||
    url.pathname !== '/g/collect'
  )
    return [];
  const lines = request.postData()?.split('\n').filter(Boolean);
  return (lines?.length ? lines : ['']).map((line) => {
    const params = new URLSearchParams(url.search);
    for (const [key, value] of new URLSearchParams(line))
      params.set(key, value);
    return {
      receivedAt: new Date().toISOString(),
      collector: url.origin + url.pathname,
      status: response.status(),
      measurementId: params.get('tid'),
      event: params.get('en'),
      page: params.get('dl'),
      source: params.get('cs'),
      medium: params.get('cm'),
      campaign: params.get('cn'),
      runId: params.get('up.ci_run_id'),
    };
  });
}

test('real production journeys deliver page views through the deployed Google tag', async ({
  page,
  isMobile,
  baseURL,
}, testInfo) => {
  const metadata = testInfo.config.metadata;
  const expectedPageViews = new Map<string, string>();
  let journeyVerified = false;
  const events: ReturnType<typeof collectionEvents> = [];
  const documents: {
    at: string;
    url: string;
    status: number;
    cloudflareRay: string | undefined;
    cacheStatus: string | undefined;
  }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    events.push(...collectionEvents(response));
    const request = response.request();
    if (
      new URL(response.url()).origin === baseURL &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      const headers = response.headers();
      documents.push({
        at: new Date().toISOString(),
        url: response.url(),
        status: response.status(),
        cloudflareRay: headers['cf-ray'],
        cacheStatus: headers['cf-cache-status'],
      });
    }
  });

  async function expectPageView(path: string) {
    await expect
      .poll(
        () =>
          events.some(
            (event) =>
              event.measurementId === metadata.measurementId &&
              event.runId === metadata.runId &&
              event.event === 'page_view' &&
              event.status >= 200 &&
              event.status < 300 &&
              event.page &&
              new URL(event.page).origin === baseURL &&
              new URL(event.page).pathname === path,
          ),
        {
          timeout: 25_000,
          message: 'Google collection accepted page_view for ' + path,
        },
      )
      .toBe(true);
    expectedPageViews.set(path, await page.title());
  }

  try {
    await test.step('follow the live referral Worker and grant real analytics consent', async () => {
      const response = await page.goto(
        '/r/playwright-ci/production-checks?utm_medium=testing&utm_content=' +
          metadata.runId,
      );
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cf-ray']).toBeTruthy();
      const landing = new URL(page.url());
      expect(landing.origin).toBe(baseURL);
      expect(Object.fromEntries(landing.searchParams)).toEqual({
        utm_source: 'playwright-ci',
        utm_medium: 'testing',
        utm_campaign: 'production-checks',
        utm_content: metadata.runId,
      });
      await expect(page.getByRole('heading', { level: 1 })).toContainText(
        'I build software.',
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('#analytics-notice')).toHaveAttribute(
        'data-measurement-id',
        metadata.measurementId,
      );
      expect(events).toEqual([]);
      await page
        .getByRole('button', { name: 'Allow analytics', exact: true })
        .click();
      await expectPageView('/');
      const landingEvent = events.find((event) => event.event === 'page_view')!;
      expect(new URL(landingEvent.page!).searchParams.get('utm_content')).toBe(
        metadata.runId,
      );
    });

    for (const [label, path] of [
      ['About', '/about/'],
      ['Projects', '/projects/'],
      ['Writing', '/writing/'],
      ['Speaking', '/speaking/'],
      ['Contact', '/contact/'],
    ]) {
      await test.step(
        'navigate to ' + label + ' and verify its live page view',
        async () => {
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
          expect(new URL(page.url()).pathname).toBe(path);
          await expect(page).toHaveTitle(label + ' | Alexander Thomas');
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - innerWidth,
            ),
          ).toBeLessThanOrEqual(1);
          await expectPageView(path);
        },
      );
    }

    await test.step('use the live writing search and open the real article', async () => {
      await page.goto('/writing/');
      await page
        .getByRole('searchbox', { name: 'Search writing' })
        .fill('coral');
      await expect(page.getByRole('article')).toHaveCount(1);
      await page
        .getByRole('link', { name: 'AI for coral restoration', exact: true })
        .click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'AI for coral restoration',
      );
      await expectPageView('/writing/2026-09-29-ai-for-coral-restoration/');
    });

    await test.step('verify the deployed talk and its public slide link', async () => {
      await page.goto('/speaking/the-agent-surface/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const slides = page.getByRole('link', {
        name: 'View slides (PDF)',
        exact: true,
      });
      await expect(slides).toBeVisible();
      await expect(slides).toHaveAttribute(
        'href',
        '/slides/the-agent-surface.pdf',
      );
      await expectPageView('/speaking/the-agent-surface/');
    });

    expect(
      errors,
      'No uncaught browser errors during the live journey',
    ).toEqual([]);
    expect(documents.length).toBeGreaterThanOrEqual(9);
    for (const document of documents) {
      expect(document.status, document.url).toBeLessThan(400);
      // WebKit can omit redirect headers; final documents and HTTP tests carry the edge IDs.
      if (document.status === 200)
        expect(document.cloudflareRay, document.url).toBeTruthy();
    }
    await testInfo.attach('live-website', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    journeyVerified = true;
  } finally {
    const evidencePath = testInfo.outputPath(
      'production-network-evidence.json',
    );
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          ...metadata,
          project: testInfo.project.name,
          deviceCategory: isMobile ? 'mobile' : 'desktop',
          journeyVerified,
          expectedPageViews: [...expectedPageViews].map(([path, title]) => ({
            path,
            title,
          })),
          userAgent: testInfo.project.use.userAgent,
          documents,
          googleCollectionResponses: events,
          browserErrors: errors,
          note: 'Real server and Google tag responses; GA4 API read-back is a separate verification step.',
        },
        null,
        2,
      ),
    );
    await testInfo.attach('production-network-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  }
});
