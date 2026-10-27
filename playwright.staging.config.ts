import { defineConfig, devices } from '@playwright/test';

const target = new URL(process.env.PLAYWRIGHT_STAGING_URL || '');
const release = process.env.EXPECTED_RELEASE_ID;
const revision = process.env.EXPECTED_SOURCE_REVISION;
const canonical = new URL(process.env.EXPECTED_CANONICAL_ORIGIN || '');
if (
  target.protocol !== 'https:' ||
  target.pathname !== '/' ||
  target.search ||
  target.hash ||
  target.username ||
  target.password ||
  target.origin === canonical.origin ||
  !/^[a-f0-9]{64}$/.test(release || '') ||
  !/^[a-f0-9]{40}$/.test(revision || '')
) {
  throw new Error(
    'Staging tests require a separate HTTPS origin, canonical origin, and exact release/revision IDs',
  );
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  globalTimeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-staging', open: 'never' }],
  ],
  outputDir: 'test-results-staging',
  metadata: {
    target: target.origin,
    canonical: canonical.origin,
    release,
    revision,
  },
  use: {
    baseURL: target.origin,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'staging-chromium',
      testMatch: '**/staging/*.browser.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'staging-mobile-safari',
      testMatch: '**/staging/*.browser.spec.ts',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'staging-http',
      testMatch: [
        '**/staging/*.http.spec.ts',
        '**/integration/edge.http.spec.ts',
      ],
      use: { userAgent: 'AJT-Playwright/1.0 (staging edge checks)' },
    },
  ],
});
