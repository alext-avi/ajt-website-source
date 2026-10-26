import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const manifest = JSON.parse(
  fs.readFileSync('docs/linkedin-import.json', 'utf8'),
);
const decode = (text) =>
  text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_, entity) => {
      if (entity.startsWith('#'))
        return String.fromCodePoint(
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10),
        );
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[
        entity.toLowerCase()
      ];
    },
  );
const bodyText = (html) =>
  decode(
    html
      .replace(/<br\b[^>]*>|<\/(?:p|h[1-6]|li|blockquote|div)>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/gu, ' ')
    .trim();

test('LinkedIn archive preserves every captured body, export date, and original source', () => {
  assert.equal(manifest.posts.length, 33);
  assert.equal(manifest.posts.filter((post) => post.commentary).length, 4);
  for (const key of ['slug', 'postId', 'sourceUrl'])
    assert.equal(
      new Set(manifest.posts.map((post) => post[key])).size,
      33,
      key,
    );

  const rssItems = [
    ...fs
      .readFileSync('dist/rss.xml', 'utf8')
      .matchAll(/<item>[\s\S]*?<\/item>/g),
  ].map((match) => match[0]);
  for (const post of manifest.posts) {
    const html = fs.readFileSync(
      `dist/writing/${post.slug}/index.html`,
      'utf8',
    );
    const body = html.match(
      /<article class="prose">([\s\S]*?)<\/article>/,
    )?.[1];
    assert.ok(body, `${post.slug}: article body`);
    assert.equal(
      crypto.createHash('sha256').update(bodyText(body)).digest('hex'),
      post.normalizedBodySha256,
      `${post.slug}: original wording`,
    );
    assert.ok(
      html.includes(`href="${post.sourceUrl}"`),
      `${post.slug}: source`,
    );
    assert.ok(
      html.includes(
        post.commentary
          ? 'My commentary on a shared post.'
          : 'Originally published on LinkedIn.',
      ),
      `${post.slug}: attribution`,
    );
    const schema = [
      ...html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ]
      .map((match) => JSON.parse(match[1]))
      .find((data) => data['@type'] === 'BlogPosting');
    const expectedDate = `${post.date}T00:00:00.000Z`;
    assert.equal(
      schema?.datePublished,
      expectedDate,
      `${post.slug}: structured date`,
    );
    assert.ok(
      html.includes(`<time datetime="${expectedDate}"`),
      `${post.slug}: visible date`,
    );
    const item = rssItems.find((entry) =>
      entry.includes(`/writing/${post.slug}/`),
    );
    assert.ok(item, `${post.slug}: feed item`);
    assert.equal(
      new Date(item.match(/<pubDate>([^<]+)<\/pubDate>/)[1]).toISOString(),
      expectedDate,
    );
    for (const image of post.localImages) {
      assert.ok(html.includes(`src="${image}"`), `${post.slug}: local media`);
      assert.ok(fs.existsSync(`dist${image}`), `${post.slug}: shipped media`);
    }
    assert.equal(post.dateEvidence.sheet, 'TOP POSTS');
    assert.match(post.dateEvidence.cell, /^[BF]\d+$/);
  }
});
