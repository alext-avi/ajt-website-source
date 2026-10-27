import { test, expect } from '@playwright/test';
import { publishedPosts, publishedTalks } from '../published-content';

const sample = publishedPosts[0];
const embedded = publishedPosts.find((post) => post.data.linkedinVideoEmbed);
const hosted = publishedPosts.find((post) => post.data.video);
const slides = publishedTalks.find((talk) => talk.data.slides);

test('the staged release supports real desktop/mobile journeys without production analytics', async ({
  page,
  isMobile,
  baseURL,
}, testInfo) => {
  const metadata = testInfo.config.metadata;
  const documents: object[] = [];
  const analyticsRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      /\.(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)$/.test(
        '.' + new URL(request.url()).hostname,
      )
    )
      analyticsRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (
      response.request().isNavigationRequest() &&
      new URL(response.url()).origin === baseURL
    )
      documents.push({
        url: response.url(),
        status: response.status(),
        cloudflareRay: response.headers()['cf-ray'],
        release: response.headers()['x-ajt-release'],
      });
  });
  // Prove the staging hostname cannot enable the production tag, even with consent.
  await page.addInitScript(() =>
    localStorage.setItem('ajt.analytics-consent.v1', 'allowed'),
  );
  try {
    const response = await page.goto(
      '/r/Unregistered-Stage-Channel/release-gate?utm_content=' +
        metadata.revision,
    );
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cf-ray']).toBeTruthy();
    expect(response?.headers()['x-ajt-release']).toBe(metadata.release);
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
    expect(new URL(page.url()).origin).toBe(baseURL);
    expect(new URL(page.url()).searchParams.get('utm_source')).toBe(
      'unregistered-stage-channel',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#analytics-notice')).toBeHidden();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      metadata.canonical + '/',
    );
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
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
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page).toHaveTitle(`${label} | Alexander Thomas`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    await page.goto('/writing/');
    expect(
      sample,
      'A published article is available for the journey',
    ).toBeTruthy();
    await page
      .getByRole('searchbox', { name: 'Search writing' })
      .fill(sample.data.title);
    const articlePath = `/writing/${sample.slug}/`;
    await page
      .getByRole('link', { name: sample.data.title, exact: true })
      .and(page.locator(`a[href="${articlePath}"]`))
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      sample.data.title,
    );
    await expect(page.locator('header.detail-head time')).toHaveAttribute(
      'datetime',
      new Date(sample.data.date!).toISOString(),
    );
    if (embedded) {
      await page.goto(`/writing/${embedded.slug}/`);
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Load video player' }),
      ).toBeVisible();
    }
    if (hosted) {
      await page.goto(`/writing/${hosted.slug}/`);
      const video = page.locator('video');
      await expect(video).toHaveAttribute('controls', '');
      await expect(video).toHaveJSProperty('paused', true);
      await expect(video).toHaveAttribute('preload', 'none');
    }
    if (slides) {
      await page.goto(`/speaking/${slides.slug}/`);
      await expect(
        page.getByRole('link', { name: 'View slides (PDF)', exact: true }),
      ).toHaveAttribute('href', slides.data.slides!);
    }
    expect(
      analyticsRequests,
      'No production analytics requests from staging',
    ).toEqual([]);
    expect(errors, 'No uncaught browser errors').toEqual([]);
    expect(documents.length).toBeGreaterThanOrEqual(8);
    for (const document of documents as {
      url: string;
      status: number;
      cloudflareRay?: string;
      release?: string;
    }[]) {
      expect(document.status, document.url).toBeLessThan(400);
      if (document.status === 200) {
        expect(document.cloudflareRay, document.url).toBeTruthy();
        expect(document.release, document.url).toBe(metadata.release);
      }
    }
    await testInfo.attach('staging-website', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  } finally {
    await testInfo.attach('staging-network-evidence', {
      body: JSON.stringify(
        {
          ...metadata,
          project: testInfo.project.name,
          documents,
          analyticsRequests,
          browserErrors: errors,
          selectedContent: {
            article: sample?.slug,
            embeddedVideo: embedded?.slug,
            hostedVideo: hosted?.slug,
            slides: slides?.slug,
          },
          note: 'Real Cloudflare responses; no responses mocked and no analytics events injected.',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  }
});
