import { defineConfig, devices } from '@playwright/test';

const baseURL = 'https://127.0.0.1:8794';

export default defineConfig({
  testDir: './tests/integration',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    // Only this loopback test server uses Wrangler's generated certificate.
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: '**/*.browser.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      testMatch: '**/*.browser.spec.ts',
      use: { ...devices['iPhone 13'] },
    },
    { name: 'http', testMatch: '**/*.http.spec.ts' },
  ],
  webServer: {
    command:
      'npm run build && wrangler dev --local --local-protocol https --ip 127.0.0.1 --port 8794 --persist-to .wrangler/integration --log-level warn',
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SITE_URL: baseURL,
      PUBLIC_GA4_MEASUREMENT_ID: 'G-E2E000000',
      ASTRO_TELEMETRY_DISABLED: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
  },
});
