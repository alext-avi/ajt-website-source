import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/remote',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-remote' }],
  ],
  outputDir: 'test-results-remote',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4340',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/start-remote-test.mjs',
    url: 'http://127.0.0.1:4340/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ASTRO_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' },
  },
});
