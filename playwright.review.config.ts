import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/review',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-review', open: 'never' }],
  ],
  outputDir: 'test-results-review',
  use: {
    baseURL: 'http://127.0.0.1:4331',
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/start-review-test.mjs',
    url: 'http://127.0.0.1:4334/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
