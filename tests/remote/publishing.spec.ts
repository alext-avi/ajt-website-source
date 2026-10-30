import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
const auth = 'https://127.0.0.1:8800';
const host = 'http://127.0.0.1:4340';
const site = 'http://127.0.0.1:8801';

async function login(page: Page, request: APIRequestContext, owner = true) {
  await expect
    .poll(async () => {
      try {
        return (await request.get(auth + '/health')).status();
      } catch {
        return 0;
      }
    })
    .toBe(200);
  const registered = await request.post(auth + '/oauth/register', {
    data: {
      client_name: 'Isolated Playwright authoring host',
      redirect_uris: [host + '/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(registered.status()).toBe(201);
  const client = await registered.json();
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL('/authorize', auth);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: host + '/callback',
    response_type: 'code',
    resource: auth + '/mcp',
    scope: 'content:read content:write offline_access',
    state: 'isolated-playwright',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  await page.route(auth + '/authorize', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const upstream = new URL(response.headers().location);
    expect(upstream.origin + upstream.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    const callback = new URL(upstream.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({
      state: upstream.searchParams.get('state')!,
      code: owner ? 'fixture-owner' : 'fixture-intruder',
    }).toString();
    return route.fulfill({
      status: 302,
      headers: { ...response.headers(), location: callback.href },
    });
  });
  await page.goto(url.href);
  await expect(
    page.getByRole('heading', { name: 'Connect website authoring' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue with GitHub' }).click();
  await page.waitForURL(host + '/callback?**');
  const callback = new URL(page.url());
  if (!owner) {
    expect(callback.searchParams.get('error')).toBe('access_denied');
    return;
  }
  expect(callback.searchParams.get('state')).toBe('isolated-playwright');
  const tokenResponse = await request.post(auth + '/oauth/token', {
    form: {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: host + '/callback',
      resource: auth + '/mcp',
      code: callback.searchParams.get('code')!,
      code_verifier: verifier,
    },
  });
  expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
  const token = await tokenResponse.json();
  const connected = await request.post(host + '/connect', {
    data: { token: token.access_token },
  });
  expect(connected.status(), await connected.text()).toBe(200);
  return token;
}
async function call(request: APIRequestContext, name: string, args: object) {
  const response = await request.post(host + '/tool', {
    data: { name, arguments: args },
  });
  const result = await response.json();
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent;
}
const metadata = {
  title: 'Direct Worker publication integration',
  summary:
    'A synthetic article proving a real authenticated MCP App can publish directly through Workers and SQLite.',
  date: '2026-10-25',
  category: 'Architecture',
  tags: ['Remote publishing'],
  featured: true,
};

test('anonymous requests cannot reach tools, unknown GitHub identities cannot connect, and forged browser approval is rejected', async ({
  page,
  request,
}) => {
  await expect
    .poll(async () => {
      try {
        return (await request.get(auth + '/health')).status();
      } catch {
        return 0;
      }
    })
    .toBe(200);
  expect(
    (
      await request.post(auth + '/mcp', {
        data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(auth + '/authorize', {
        headers: { Origin: 'https://attacker.test' },
        form: { handle: 'fake', decision: 'allow' },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get(auth + '/authoring.html')).status()).toBe(404);
  expect(
    (
      await request.get(auth + '/.well-known/oauth-protected-resource/mcp')
    ).status(),
  ).toBe(200);
  await login(page, request, false);
});

test('real remote MCP App uploads private media and Post makes the approved revision visible across the server without a deployment', async ({
  page,
  request,
}) => {
  await login(page, request);
  const slug = 'remote-api-post';
  await call(request, 'create_post_draft', {
    slug,
    metadata,
    body: '## A real server round trip\n\nThe content stays private until the human presses Post.',
  });
  expect((await request.get(site + `/writing/${slug}/`)).status()).toBe(404);
  await page.goto(host + '/?slug=' + slug);
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await expect(
    app.getByRole('button', { name: 'Open draft', exact: true }),
  ).toBeHidden();
  await app.getByText('Media and uploads', { exact: true }).click();
  await app
    .locator('#upload')
    .setInputFiles({
      name: 'fixture.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  await expect(app.getByRole('status')).toContainText('Upload ready.');
  const media = await app
    .getByLabel('Cover image', { exact: true })
    .inputValue();
  expect((await request.get(site + media)).status()).toBe(404);
  await app.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Draft saved.');
  await expect(
    app.getByRole('button', { name: 'Post', exact: true }),
  ).toBeEnabled();
  await app
    .getByRole('button', { name: 'Post', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  expect((await call(request, 'get_post', { slug })).metadata.draft).toBe(true);
  await app.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Posted.');
  const posted = await call(request, 'get_post', { slug });
  expect(posted.metadata.draft).toBe(false);
  expect(posted.revision).toBe(3);
  expect(posted.updatedBy).toBe('human-app:13840761');
  const response = await request.get(site + `/writing/${slug}/`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain(metadata.title);
  expect(html).toContain('2026-10-25');
  expect(html).toContain(media);
  for (const path of [
    '/',
    '/writing/',
    '/tags/remote-publishing/',
    '/rss.xml',
    '/sitemap-0.xml',
  ]) {
    const response = await request.get(site + path);
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).toContain(slug);
  }
  expect((await request.get(site + media)).status()).toBe(200);
  const rpc = await page.evaluate(
    () => (window as any).testHost.calls as string[],
  );
  expect(rpc.filter((name) => name === 'publish_authoring_draft')).toHaveLength(
    1,
  );
  await expect(
    app.getByRole('button', { name: 'Post', exact: true }),
  ).toBeDisabled();
  // Reopening a posted item cannot prepare another publication.
  expect(
    await call(request, 'update_post_draft', {
      slug,
      expectedRevision: 3,
      metadata: { title: 'Attempted overwrite' },
    }).catch(() => null),
  ).toBe(null);
});

test('a changed revision cannot be published from a stale App preview; projects use the same direct API', async ({
  page,
  request,
}) => {
  await login(page, request);
  const slug = 'remote-api-project';
  await call(request, 'create_project_draft', {
    slug,
    metadata: {
      title: 'A project published through Workers',
      summary:
        'A synthetic project for checking isolated local publishing and stale revision handling.',
      role: 'Integration test',
      featured: true,
    },
    body: '## The project\n\nAn isolated test case.',
  });
  await page.goto(host + '/?collection=projects&slug=' + slug);
  const app = page.frameLocator('iframe[title="Website authoring app"]');
  await expect(app.getByRole('status')).toContainText('Ready.');
  await call(request, 'update_project_draft', {
    slug,
    expectedRevision: 1,
    metadata: { title: 'The updated project revision' },
  });
  await app.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('draft changed');
  expect((await request.get(site + `/projects/${slug}/`)).status()).toBe(404);
  expect((await call(request, 'get_project', { slug })).metadata.draft).toBe(
    true,
  );
  await app
    .getByRole('button', { name: 'Reload saved draft', exact: true })
    .click();
  await expect(app.getByRole('status')).toContainText('Reloaded');
  await app.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(app.getByRole('status')).toContainText('Posted.');
  const response = await request.get(site + `/projects/${slug}/`);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('The updated project revision');
});
