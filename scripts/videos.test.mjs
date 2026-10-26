import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const { media } = JSON.parse(
  fs.readFileSync('docs/linkedin-videos.json', 'utf8'),
);
const imported = JSON.parse(
  fs.readFileSync('docs/linkedin-import.json', 'utf8'),
);

test('every imported video post has a player and all local media fits the hosting limit', () => {
  assert.deepEqual(
    media.map((entry) => entry.slug).sort(),
    imported.posts
      .filter((post) => post.videoOnLinkedIn)
      .map((post) => post.slug)
      .sort(),
  );
  assert.equal(media.filter((entry) => entry.kind === 'local').length, 3);
  assert.equal(media.filter((entry) => entry.kind === 'linkedin').length, 2);
  for (const entry of media) {
    const html = fs.readFileSync(
      `dist/writing/${entry.slug}/index.html`,
      'utf8',
    );
    if (entry.kind === 'local') {
      assert.match(
        html,
        /<video\b[^>]*controls[^>]*playsinline[^>]*preload="none"/,
      );
      assert.ok(html.includes(`src="${entry.src}"`));
      assert.ok(html.includes(`poster="${entry.poster}"`));
      const video = fs.readFileSync(`dist${entry.src}`);
      assert.equal(
        crypto.createHash('sha256').update(video).digest('hex'),
        entry.sha256,
      );
      assert.ok(video.length <= 25 * 1024 * 1024);
      assert.ok(fs.existsSync(`dist${entry.poster}`));
      assert.doesNotMatch(html, /<video\b[^>]*autoplay/);
    } else {
      assert.ok(html.includes(`<iframe src="${entry.embedUrl}"`));
      assert.match(
        html,
        /<template>\s*<iframe\b[^>]*>[\s\S]*?<\/iframe>\s*<\/template>/,
      );
      const outsideTemplate = html.replace(
        /<template>[\s\S]*?<\/template>/g,
        '',
      );
      assert.doesNotMatch(outsideTemplate, /<iframe\b/);
      assert.match(outsideTemplate, /Load video player/);
      assert.ok(html.includes(entry.credit));
      assert.ok(html.includes(`href="${entry.sourceUrl}"`));
    }
  }
});
