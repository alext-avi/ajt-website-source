import { defineConfig, devices } from '@playwright/test';

const target = process.env.PLAYWRIGHT_PRODUCTION_URL;
const measurementId = process.env.PLAYWRIGHT_GA4_MEASUREMENT_ID;
if (!target || !measurementId || !/^G-[A-Z0-9]+$/.test(measurementId))
  throw new Error(
    'Set PLAYWRIGHT_PRODUCTION_URL and PLAYWRIGHT_GA4_MEASUREMENT_ID to explicitly enable live tests.',
  );
const url = new URL(target);
if (
  url.protocol !== 'https:' ||
  url.username ||
  url.password ||
  url.pathname !== '/' ||
  url.search ||
  url.hash
)
  throw new Error('PLAYWRIGHT_PRODUCTION_URL must be an HTTPS origin.');

const runId =
  process.env.PLAYWRIGHT_RUN_ID ||
  'local-' + new Date().toISOString().replace(/[^0-9]/g, '');
if (
  runId.length > 36 ||
  !/^(gha-[0-9]+-[0-9]+|local-[a-z0-9][a-z0-9._-]*)$/.test(runId)
)
  throw new Error(
    'PLAYWRIGHT_RUN_ID must start with gha- or local- and fit GA4’s 36-character user-property limit.',
  );

const userAgentSuffix = ' AJT-Playwright/1.0';
export default defineConfig({
  testDir: './tests/production',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  globalTimeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-production', open: 'never' }],
  ],
  outputDir: 'test-results-production',
  metadata: {
    target: url.origin,
    measurementId,
    runId,
    sourceRevision: process.env.GITHUB_SHA || 'local',
    deployment:
      process.env.PRODUCTION_DEPLOYMENT || 'existing-production-deployment',
    ciRunUrl: process.env.GITHUB_RUN_ID
      ? (process.env.GITHUB_SERVER_URL || 'https://github.com') +
        '/' +
        process.env.GITHUB_REPOSITORY +
        '/actions/runs/' +
        process.env.GITHUB_RUN_ID
      : null,
  },
  use: {
    baseURL: url.origin,
    // Live tests use normal TLS validation and unmodified network responses.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'live-chromium',
      testMatch: '**/*.browser.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        userAgent: devices['Desktop Chrome'].userAgent + userAgentSuffix,
      },
    },
    {
      name: 'live-mobile-safari',
      testMatch: '**/*.browser.spec.ts',
      use: {
        ...devices['iPhone 13'],
        userAgent: devices['iPhone 13'].userAgent + userAgentSuffix,
      },
    },
    {
      name: 'live-http',
      testMatch: '**/*.http.spec.ts',
      use: { userAgent: 'AJT-Playwright/1.0 (production asset checks)' },
    },
  ],
});
