import { test as base, expect } from '@playwright/test';

export const test = base.extend<{
  externalRequests: string[];
  browserErrors: string[];
}>({
  externalRequests: [
    async ({ context, baseURL }, use) => {
      const requests: string[] = [];
      const origin = new URL(baseURL!).origin;
      context.on('request', (request) => {
        if (new URL(request.url()).origin !== origin)
          requests.push(request.url());
      });
      // Exercise our application while keeping third-party services out of tests.
      // Individual tests can fulfill a specific external dependency with page.route.
      await context.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort('blockedbyclient'),
      );
      await use(requests);
    },
    { auto: true },
  ],
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use(errors);
      expect(errors, 'No uncaught application errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
