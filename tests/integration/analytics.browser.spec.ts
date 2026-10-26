import { test, expect } from './fixtures';

test('the CI run property starts after consent, follows navigation, and clears on withdrawal', async ({
  page,
}) => {
  await page.route('https://www.googletagmanager.com/gtag/js**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: '/* Local test tag. */',
    }),
  );
  const runId = 'gha-12345-1-d';
  const storedRun = () =>
    page.evaluate(() => sessionStorage.getItem('ajt.analytics-ci-run.v1'));
  const config = () =>
    page.evaluate(
      () =>
        (Reflect.get(window, 'dataLayer') as ArrayLike<unknown>[] | undefined)
          ?.map((args) => Array.from(args))
          .find((args) => args[0] === 'config')?.[2],
    );
  await page.goto(
    '/r/playwright-ci/production-checks?utm_medium=testing&utm_content=' +
      runId,
  );
  expect(await storedRun()).toBeNull();
  await page
    .getByRole('button', { name: 'Allow analytics', exact: true })
    .click();
  await expect
    .poll(config)
    .toMatchObject({ user_properties: { ci_run_id: runId } });
  await page.goto('/about/');
  await expect
    .poll(config)
    .toMatchObject({ user_properties: { ci_run_id: runId } });
  await page
    .getByRole('button', { name: 'Analytics choices', exact: true })
    .click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'No thanks', exact: true }).click(),
  ]);
  expect(await storedRun()).toBeNull();
});

test('declining analytics persists across page loads and preferences can be reopened', async ({
  page,
  externalRequests,
}) => {
  await page.goto('/');
  const notice = page.getByRole('complementary', { name: 'Analytics choices' });
  await expect(notice).toBeVisible();
  expect(externalRequests).toEqual([]);
  await notice.getByRole('button', { name: 'No thanks' }).click();
  await page.goto('/about/');
  await expect(notice).toBeHidden();
  expect(externalRequests).toEqual([]);
  await page
    .getByRole('button', { name: 'Analytics choices', exact: true })
    .click();
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole('button', { name: 'Allow analytics' }),
  ).toBeFocused();
});

test('analytics requires opt-in, sanitizes visit URLs, and stops after consent is withdrawn', async ({
  page,
  externalRequests,
  baseURL,
}) => {
  await page.route('https://www.googletagmanager.com/gtag/js**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: '/* No live analytics in tests. */',
    }),
  );
  const analyticsLoads = () =>
    externalRequests.filter((url) =>
      url.startsWith('https://www.googletagmanager.com/gtag/js'),
    );
  await page.goto(
    '/?utm_source=linkedin&q=private-search&email=private@example.test#secret',
  );
  expect(analyticsLoads()).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Allow analytics', exact: true })
    .click();
  await expect.poll(() => analyticsLoads().length).toBe(1);
  const config = await page.evaluate(() => {
    const layer = Reflect.get(window, 'dataLayer') as
      ArrayLike<unknown>[] | undefined;
    return (layer ?? [])
      .map((args) => Array.from(args))
      .find((args) => args[0] === 'config');
  });
  expect(config).toEqual([
    'config',
    'G-E2E000000',
    expect.objectContaining({
      page_location: `${baseURL}/?utm_source=linkedin`,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    }),
  ]);
  expect(JSON.stringify(config)).not.toMatch(
    /private-search|private@example|#secret/,
  );
  await page.reload();
  await expect.poll(() => analyticsLoads().length).toBe(2);
  await page
    .getByRole('button', { name: 'Analytics choices', exact: true })
    .click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'No thanks', exact: true }).click(),
  ]);
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Analytics choices' }),
  ).toBeHidden();
  expect(analyticsLoads()).toHaveLength(2);
});

test('Do Not Track prevents analytics loading even after an allow choice', async ({
  context,
  page,
  externalRequests,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('complementary', { name: 'Analytics choices' }),
  ).toBeHidden();
  await page
    .getByRole('button', { name: 'Analytics choices', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Allow analytics', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Analytics choices' }),
  ).toBeHidden();
  expect(externalRequests).toEqual([]);
});
