import { test, expect } from '@playwright/test';
import { publishedPosts, publishedTalks } from '../published-content';

test('the actual Worker handles new referral channels without registration or cookies', async ({
  request,
  baseURL,
}) => {
  for (const method of ['GET', 'HEAD']) {
    const response = await request.fetch(
      '/r/Fresh-Channel/launch?utm_source=spoof&next=https://outside.test&email=private@example.test',
      { method, maxRedirects: 0 },
    );
    expect(response.status()).toBe(302);
    const destination = new URL(response.headers().location);
    expect(destination.origin).toBe(baseURL);
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      utm_source: 'fresh-channel',
      utm_medium: 'referral',
      utm_campaign: 'launch',
    });
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
  const rejected = await request.post('/r/fresh-channel', { maxRedirects: 0 });
  expect(rejected.status()).toBe(405);
  expect(rejected.headers().allow).toBe('GET, HEAD');
});

test('invalid referrals and unpublished routes return real 404 responses', async ({
  request,
}) => {
  for (const path of [
    '/r/a@example.test',
    '/r/a//b',
    '/keystatic/',
    '/api/keystatic/',
    '/review/',
    '/review-health',
    '/api/review/not-a-review',
    '/writing/ai-code-review/',
    '/projects/resource-planning/',
    '/missing-integration-page/',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers().location, path).toBeUndefined();
  }
});

test('public slide links serve PDFs and the consulting session exposes no slide download', async ({
  request,
}) => {
  for (const entry of publishedTalks.filter((talk) => talk.data.slides)) {
    const talk = await request.get(`/speaking/${entry.slug}/`);
    expect(talk.status()).toBe(200);
    expect(await talk.text()).toContain(`href="${entry.data.slides}"`);
    if (entry.data.slides!.startsWith('/slides/')) {
      const slides = await request.get(entry.data.slides!);
      expect(slides.status()).toBe(200);
      expect(slides.headers()['content-type']).toContain('application/pdf');
      expect((await slides.body()).subarray(0, 5).toString()).toBe('%PDF-');
    } else {
      // External presentation pages need not be PDFs or allow automated clients.
      expect(new URL(entry.data.slides!).protocol).toMatch(/^https?:$/);
    }
  }
  for (const entry of publishedTalks.filter(
    (talk) => talk.data.event === 'Enterprise consulting',
  )) {
    expect(
      entry.data.slides,
      'Consulting slide materials remain private',
    ).toBeUndefined();
    const consulting = await request.get(`/speaking/${entry.slug}/`);
    expect(consulting.status()).toBe(200);
    expect(await consulting.text()).not.toMatch(
      /href="\/slides\/|>\s*View slides(?:\s|\()/,
    );
  }
});

test('hosted video is served as MP4 through the static asset runtime', async ({
  request,
}) => {
  const video = publishedPosts.find((post) => post.data.video);
  test.skip(!video, 'This publication snapshot has no hosted video');
  const response = await request.get(video!.data.video!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  const bytes = await response.body();
  expect(bytes.length).toBe(Number(response.headers()['content-length']));
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
});
