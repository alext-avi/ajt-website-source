import { test, expect } from '@playwright/test';

test('the production edge serves redirects, published slides, video, and private-route exclusions', async ({
  request,
  baseURL,
}, testInfo) => {
  const responses: {
    path: string;
    status: number;
    cloudflareRay: string | undefined;
  }[] = [];
  async function record(
    path: string,
    method: 'GET' | 'HEAD' = 'GET',
    headers?: Record<string, string>,
  ) {
    const response = await request.fetch(path, {
      method,
      headers,
      maxRedirects: 0,
    });
    responses.push({
      path,
      status: response.status(),
      cloudflareRay: response.headers()['cf-ray'],
    });
    expect(response.headers()['cf-ray'], path).toBeTruthy();
    return response;
  }
  try {
    const referral = await record('/r/playwright-ci/production-checks');
    expect(referral.status()).toBe(302);
    expect(referral.headers()['cache-control']).toBe('no-store');
    const target = new URL(referral.headers().location);
    expect(target.origin).toBe(baseURL);
    expect(target.searchParams.get('utm_source')).toBe('playwright-ci');
    for (const [slug, filename] of [
      ['the-agent-surface', 'the-agent-surface.pdf'],
      ['your-next-power-user', 'your-next-power-user.pdf'],
      ['ai-agents-for-the-rest-of-us', 'ai-agents-in-practice.pdf'],
    ]) {
      const talk = await record('/speaking/' + slug + '/');
      expect(talk.status()).toBe(200);
      expect(await talk.text()).toContain('href="/slides/' + filename + '"');
      const slides = await record('/slides/' + filename);
      expect(slides.status()).toBe(200);
      expect(slides.headers()['content-type']).toContain('application/pdf');
      expect((await slides.body()).subarray(0, 5).toString()).toBe('%PDF-');
    }
    const video = await record('/videos/go-plant.mp4', 'GET', {
      Range: 'bytes=0-15',
    });
    expect([200, 206]).toContain(video.status());
    expect(video.headers()['content-type']).toContain('video/mp4');
    expect((await video.body()).subarray(4, 8).toString()).toBe('ftyp');
    if (video.status() === 206)
      expect(video.headers()['content-range']).toMatch(/^bytes 0-15\/[0-9]+$/);
    const consulting = await record('/speaking/the-agentic-sdlc/');
    expect(consulting.status()).toBe(200);
    expect(await consulting.text()).not.toMatch(/href="\/slides\//);
    for (const path of [
      '/keystatic/',
      '/api/keystatic/',
      '/missing-production-check-page/',
    ]) {
      expect((await record(path)).status()).toBe(404);
    }
  } finally {
    await testInfo.attach('production-edge-evidence', {
      body: JSON.stringify({ ...testInfo.config.metadata, responses }, null, 2),
      contentType: 'application/json',
    });
  }
});
