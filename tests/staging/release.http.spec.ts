import { test, expect } from '@playwright/test';

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
