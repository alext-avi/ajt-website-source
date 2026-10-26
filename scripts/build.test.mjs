import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from 'vite';
const env = {
  ...loadEnv('production', process.cwd(), 'PUBLIC_'),
  ...process.env,
};
const expectedEmail = env.PUBLIC_CONTACT_EMAIL || 'alext@avi.com';
const expectedLinkedIn =
  env.PUBLIC_LINKEDIN_URL || 'https://www.linkedin.com/in/alexander-jt/';

const root = path.resolve('dist');
const files = fs.readdirSync(root, { recursive: true }).map(String);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pagePath = (href) => {
  const pathname = decodeURIComponent(
    new URL(href, 'https://site.test').pathname,
  );
  return path.join(
    root,
    pathname.endsWith('/') ? `${pathname}index.html` : pathname,
  );
};

test('all six main pages and reusable content routes are generated', () => {
  for (const page of [
    'index.html',
    'about/index.html',
    'projects/index.html',
    'writing/index.html',
    'speaking/index.html',
    'contact/index.html',
    'writing/2026-10-12-test-strategy-speed-limit/index.html',
    'projects/mealtrack-modernization/index.html',
    'speaking/the-agent-surface/index.html',
    '404.html',
  ])
    assert.ok(files.includes(page), page);
});

test('every internal page link, asset, and anchor resolves', () => {
  const issues = [];
  for (const file of htmlFiles) {
    const html = read(file);
    const currentURL = new URL(
      file === 'index.html' ? '/' : `/${file.replace(/index\.html$/, '')}`,
      'https://site.test',
    );
    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
      const raw = match[1].replaceAll('&amp;', '&');
      if (
        /^(?:mailto:|https?:\/\/|data:|javascript:)/.test(raw) ||
        raw.startsWith('//')
      )
        continue;
      const url = new URL(raw, currentURL);
      const target = pagePath(url.href);
      if (!fs.existsSync(target)) {
        issues.push(`${file}: ${raw}`);
        continue;
      }
      if (url.hash && target.endsWith('.html')) {
        const id = decodeURIComponent(url.hash.slice(1));
        const targetHTML = fs.readFileSync(target, 'utf8');
        if (
          !targetHTML.includes(`id="${id}"`) &&
          !targetHTML.includes(`id='${id}'`)
        )
          issues.push(`${file}: missing #${id}`);
      }
    }
  }
  assert.deepEqual(issues, []);
});

test('production excludes draft content, editor API, and resume files', () => {
  assert.ok(
    !files.some((f) =>
      /resource-planning|keystatic|(^|\/)api\/|resume.*\.pdf/i.test(f),
    ),
  );
  for (const file of htmlFiles)
    assert.ok(!read(file).includes('/projects/resource-planning/'), file);
});

test('pages have accessible landmarks, descriptions, canonical URLs, and one primary heading', () => {
  for (const file of htmlFiles) {
    const html = read(file);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${file}: h1`);
    assert.match(html, /<html lang="en"/, file);
    assert.match(html, /<main id="main"/, file);
    assert.match(html, /name="description" content="[^\"]+"/, file);
    assert.match(html, /rel="canonical"/, file);
    assert.match(html, /property="og:image"/, file);
    assert.match(html, /href="#main"/, file);
    for (const image of html.matchAll(/<img\b[^>]*>/g))
      assert.match(image[0], /\balt=/, `${file}: image alt`);
    for (const json of html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ))
      assert.doesNotThrow(() => JSON.parse(json[1]), `${file}: JSON-LD`);
  }
});

test('example articles are unpublished across routes, listings, relationships, sitemap, and RSS', () => {
  const examples = [
    'after-the-prototype',
    'ai-code-review',
    'modernization-as-decisions',
  ];
  for (const slug of examples) {
    assert.ok(!files.includes(`writing/${slug}/index.html`), slug);
    for (const file of [...htmlFiles, 'rss.xml', 'sitemap-0.xml'])
      assert.ok(!read(file).includes(`/writing/${slug}/`), `${file}: ${slug}`);
  }
  assert.doesNotMatch(read('writing/index.html'), /Example article/);
  const article = read(
    'writing/2026-10-12-test-strategy-speed-limit/index.html',
  );
  assert.match(article, /Keep thinking\./);
  assert.match(article, /\/tags\/evaluation\//);
});

test('RSS is valid XML with links to published articles and no example content', () => {
  const xml = read('rss.xml');
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<rss/);
  const articlePages = files.filter(
    (file) =>
      file.startsWith('writing/') &&
      file.endsWith('/index.html') &&
      file !== 'writing/index.html',
  );
  assert.equal((xml.match(/<item>/g) ?? []).length, articlePages.length);
  for (const file of articlePages)
    assert.ok(xml.includes(`/${file.replace(/index\.html$/, '')}`), file);
  assert.doesNotMatch(xml, /\[Example article\]/);
  assert.ok(!xml.includes('resource-planning'));
});

test('only Writing hydrates a React island; ordinary pages ship no React runtime', () => {
  for (const file of htmlFiles) {
    const html = read(file);
    assert.equal(
      html.includes('<astro-island'),
      file === 'writing/index.html',
      file,
    );
  }
});

test('sitemap contains published routes, no drafts or editor, and contact uses verified details', () => {
  const sitemap = read('sitemap-0.xml');
  assert.match(sitemap, /\/speaking\/the-agent-surface\//);
  assert.ok(!/resource-planning|keystatic|404\.html/.test(sitemap));
  const contact = read('contact/index.html');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail))
    assert.ok(contact.includes(`mailto:${expectedEmail}`));
  if (/^https:\/\/(www\.)?linkedin\.com\/in\/[^\s]+$/.test(expectedLinkedIn))
    assert.ok(contact.includes(expectedLinkedIn));
  assert.match(contact, /github\.com\/alext-avi/);
});

test('delivered consulting sessions publish without private dates or proposed-topic labels', () => {
  const detail = read('speaking/the-agentic-sdlc/index.html');
  const header = detail.match(
    /<header class="shell detail-head">[\s\S]*?<\/header>/,
  )?.[0];
  assert.ok(header, 'consulting session has a detail header');
  assert.match(header, /Enterprise consulting/);
  assert.match(header, /Past session/);
  assert.doesNotMatch(header, /<time\b|Proposed topic|Available session topic/);
  const consultingBody = detail.match(
    /<article class="prose">([\s\S]*?)<\/article>/,
  )?.[1];
  assert.ok(consultingBody, 'consulting session body');
  assert.doesNotMatch(
    consultingBody,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/,
  );

  const listing = read('speaking/index.html');
  const consultingCard = [
    ...listing.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g),
  ]
    .map((match) => match[0])
    .find((card) => card.includes('/speaking/the-agentic-sdlc/'));
  assert.ok(consultingCard, 'consulting session is listed');
  assert.match(consultingCard, /PAST SESSION/);
  assert.doesNotMatch(consultingCard, /<time\b|PROPOSED TOPIC/);

  const conference = read('speaking/the-agent-surface/index.html');
  assert.match(conference, /<time datetime="2026-10-20T00:00:00\.000Z"/);
});

test('public talks host PDF slides while consulting materials remain private', () => {
  const downloads = {
    'the-agent-surface': 'the-agent-surface.pdf',
    'your-next-power-user': 'your-next-power-user.pdf',
    'ai-agents-for-the-rest-of-us': 'ai-agents-in-practice.pdf',
  };
  for (const [slug, filename] of Object.entries(downloads)) {
    const html = read(`speaking/${slug}/index.html`);
    assert.ok(html.includes(`href="/slides/${filename}"`), slug);
    assert.match(html, /View slides \(PDF\)/, slug);
    const pdf = fs.readFileSync(path.join(root, 'slides', filename));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', filename);
    assert.ok(pdf.subarray(-1024).includes(Buffer.from('%%EOF')), filename);
  }
  assert.deepEqual(
    files
      .filter((file) => file.startsWith('slides/') && file.endsWith('.pdf'))
      .sort(),
    Object.values(downloads)
      .map((filename) => `slides/${filename}`)
      .sort(),
  );
  assert.doesNotMatch(
    read('speaking/the-agentic-sdlc/index.html'),
    /href="\/slides\//,
  );
  assert.doesNotMatch(
    read('speaking/after-the-prototype/index.html'),
    /href="\/slides\//,
  );
});
