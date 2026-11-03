import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderPost } from '../../mcp/reviews.mjs';

// Serve the real Markdown renderer, compiled website CSS and carousel bundle over
// loopback HTTP. Synthetic content never enters D1 or the publication workflow.
let server: Server;
let origin: string;
test.beforeAll(async () => {
  const script = await build({
    stdin: {
      contents: `import { enhanceProjectCarousels } from './src/scripts/project-carousel';
        enhanceProjectCarousels(); enhanceProjectCarousels();`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
  });
  const files = await fs.readdir('dist/_astro');
  const styles = (
    await Promise.all(
      files
        .filter((file) => file.endsWith('.css'))
        .map((file) => fs.readFile(path.join('dist/_astro', file), 'utf8')),
    )
  ).join('\n');
  const image = await fs.readFile('public/images/videos/go-plant.jpg');
  const body = await renderPost(
    '## App screenshots\n\n' +
      [
        ['Home — iOS', 'iOS phone frame'],
        ['Workouts — iOS', 'iOS phone frame'],
        ['Digital key tag — iOS', 'iOS phone frame'],
        ['Home — Android', 'Android phone frame'],
        ['Workouts — Android', 'Android phone frame'],
        ['Earlier interface', 'iPhone 8-style frame'],
      ]
        .map(
          ([caption, frame], i) =>
            `[![Screen ${i + 1}](/screen.jpg "${frame}")](/screen.jpg)  \n${caption}`,
        )
        .join('\n\n') +
      '\n\n## Project details\n\nOrdinary content stays outside the carousel.',
  );
  const html = `<!doctype html><html lang="en" data-theme="dark"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Isolated project gallery</title><link rel="stylesheet" href="/style.css">
    <main class="shell page-body article-grid"><div class="article-body">
    <article class="prose">${body}</article></div></main>
    <script type="module" src="/carousel.js"></script></html>`;
  const routes = new Map([
    ['/', ['text/html', Buffer.from(html)]],
    ['/style.css', ['text/css', Buffer.from(styles)]],
    [
      '/carousel.js',
      ['text/javascript', Buffer.from(script.outputFiles[0].text)],
    ],
    ['/screen.jpg', ['image/jpeg', image]],
  ] as const);
  server = createServer((request, response) => {
    const asset = routes.get(request.url as '/');
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': asset[0],
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'",
    });
    response.end(asset[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('framed project screens support buttons, keys and native horizontal scrolling', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin);
  const gallery = page.getByRole('region', { name: 'App screenshots' });
  await expect(gallery).toHaveCount(1); // Initialization is idempotent.
  const track = gallery.locator('.project-carousel-track');
  const previous = gallery.getByRole('button', { name: 'Previous screen' });
  const next = gallery.getByRole('button', { name: 'Next screen' });
  const status = gallery.locator('.project-carousel-status');
  await expect(status).toHaveText('1 / 6');
  await expect(previous).toBeDisabled();
  await expect(gallery.getByRole('img', { name: 'Screen 1' })).toBeVisible();
  await expect(gallery.getByRole('img', { name: 'Screen 2' })).toHaveCount(0);
  await next.click();
  await expect(status).toHaveText('2 / 6');
  await expect(
    gallery.getByRole('button', { name: 'Show screen 2' }),
  ).toHaveAttribute('aria-current', 'true');
  await gallery.getByRole('button', { name: 'Show screen 6' }).click();
  await expect(status).toHaveText('6 / 6');
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(status).toHaveText('5 / 6');
  await track.focus();
  await page.keyboard.press('Home');
  await expect(status).toHaveText('1 / 6');
  await page.keyboard.press('ArrowRight');
  await expect(status).toHaveText('2 / 6');
  await page.keyboard.press('End');
  await expect(status).toHaveText('6 / 6');
  // Touch swipes and the scrollbar use this same native scroll path.
  await track.evaluate((element) =>
    element.scrollTo({ left: element.clientWidth, behavior: 'instant' }),
  );
  await expect(status).toHaveText('2 / 6');
  await expect(gallery.getByRole('link', { name: 'Screen 2' })).toHaveAttribute(
    'href',
    '/screen.jpg',
  );
  await expect(
    page.getByRole('heading', { name: 'Project details' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await gallery.getByRole('link', { name: 'Screen 2' }).click();
  await expect(page).toHaveURL(origin + '/screen.jpg');
  expect(errors).toEqual([]);
});

test('screens and original image links remain available without JavaScript', async ({
  browser,
}) => {
  const page = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    await page.goto(origin);
    await expect(page.getByRole('img')).toHaveCount(6);
    await expect(page.getByRole('link')).toHaveCount(6);
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    await page.close();
  }
});
