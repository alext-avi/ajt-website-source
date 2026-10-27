import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('staging serves the exact release and noindex headers on pages, assets, errors, and redirects', async ({
  request,
}, testInfo) => {
  const { release, revision } = testInfo.config.metadata;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          '/release.json?expected=' + release,
          { maxRedirects: 0 },
        );
        if (response.status() !== 200) return null;
        return response.json();
      },
      { timeout: 30_000 },
    )
    .toEqual({ version: 1, revision, artifactSha256: release });
  for (const [path, status] of [
    ['/', 200],
    ['/release.json', 200],
    ['/favicon.svg', 200],
    ['/missing-staging-page/', 404],
    ['/r/new-stage-source', 302],
  ] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(status);
    expect(response.headers()['cf-ray'], path).toBeTruthy();
    expect(response.headers()['x-ajt-environment'], path).toBe('staging');
    expect(response.headers()['x-ajt-release'], path).toBe(release);
    expect(response.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
    expect(response.headers()['cache-control'], path).toBe('no-store');
  }
});

test('the staged release serves every approved R2 asset with matching bytes and video ranges', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const expected = JSON.parse(
    await fs.readFile('dist/media-manifest.json', 'utf8'),
  );
  const response = await request.get('/media-manifest.json');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(expected);
  for (const filename of expected.files) {
    const url = '/media/' + filename;
    const media = await request.get(url);
    expect(media.status(), url).toBe(200);
    expect(media.headers()['x-ajt-environment']).toBe('staging');
    expect(media.headers()['cache-control']).toBe('no-store');
    expect(media.headers()['x-content-type-options']).toBe('nosniff');
    const bytes = await media.body();
    expect(createHash('sha256').update(bytes).digest('hex'), url).toBe(
      filename.split('.')[0],
    );
    const head = await request.head(url);
    expect(head.status(), url).toBe(200);
    expect(head.headers()['content-length']).toBe(String(bytes.length));
    if (filename.endsWith('.mp4')) {
      const range = await request.get(url, {
        headers: { Range: 'bytes=0-15' },
      });
      expect(range.status(), url).toBe(206);
      expect(range.headers()['content-type']).toBe('video/mp4');
      expect(await range.body()).toEqual(bytes.subarray(0, 16));
    }
  }
  expect(
    (await request.get('/media/' + '0'.repeat(64) + '.jpg')).status(),
  ).toBe(404);
});
