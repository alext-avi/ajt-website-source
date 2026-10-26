import { test, expect } from '@playwright/test';

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
  for (const [slug, filename] of [
    ['the-agent-surface', 'the-agent-surface.pdf'],
    ['your-next-power-user', 'your-next-power-user.pdf'],
    ['ai-agents-for-the-rest-of-us', 'ai-agents-in-practice.pdf'],
  ]) {
    const talk = await request.get(`/speaking/${slug}/`);
    expect(talk.status()).toBe(200);
    expect(await talk.text()).toContain(`href="/slides/${filename}"`);
    const slides = await request.get(`/slides/${filename}`);
    expect(slides.status()).toBe(200);
    expect(slides.headers()['content-type']).toContain('application/pdf');
    expect((await slides.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
  const consulting = await request.get('/speaking/the-agentic-sdlc/');
  expect(consulting.status()).toBe(200);
  expect(await consulting.text()).not.toMatch(/href="\/slides\//);
});

test('hosted video is served as MP4 through the static asset runtime', async ({
  request,
}) => {
  const response = await request.get('/videos/go-plant.mp4');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('video/mp4');
  const bytes = await response.body();
  expect(bytes.length).toBe(Number(response.headers()['content-length']));
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
});
