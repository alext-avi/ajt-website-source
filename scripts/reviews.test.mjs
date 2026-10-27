import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore, getPost } from '../mcp/content-server.mjs';
import {
  createReview,
  readReview,
  reviewState,
  publishReview,
  reopenReview,
  renderPost,
} from '../mcp/reviews.mjs';
import { saveMedia, resolveAsset } from '../mcp/media.mjs';
import { writeEntrySQL } from './lib/d1-content.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  acquirePublication,
  releasePublication,
  publicationStatus,
  trackPublicationChild,
} from '../mcp/publication-lock.mjs';

test('rendered drafts reject active HTML and unsafe links while preserving ordinary code examples', async () => {
  for (const body of [
    '<script>fetch("/api/review/x")</script>',
    '<img src="/x" onerror="alert(1)">',
    '[Unsafe](javascript:alert%281%29)',
    '<iframe src="https://outside.test"></iframe>',
  ])
    await assert.rejects(
      renderPost(body),
      /active HTML|Executable HTML|Unsafe/,
    );
  const code = await renderPost(
    '```html\n<script>an example</script>\n```\n\nAn ordinary **paragraph**.',
  );
  assert(code.includes('&lt;'));
  assert(!/<script[\s>]/i.test(code));
  assert(code.includes('<strong>paragraph</strong>'));
});

test('human approval is bound to a reviewed revision, retains history, and supports an explicit retry after deployment failure', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-reviews-'));
  const previous = process.env.AJT_REVIEW_DIR;
  process.env.AJT_REVIEW_DIR = path.join(temporary, 'tickets');
  const store = await createStore({
    database: path.join(temporary, 'content.sqlite'),
  });
  t.after(async () => {
    store.close();
    if (previous === undefined) delete process.env.AJT_REVIEW_DIR;
    else process.env.AJT_REVIEW_DIR = previous;
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const entry = {
    collection: 'posts',
    slug: 'approval-test',
    data: {
      title: 'A carefully reviewed draft',
      summary:
        'A full summary for testing the human publication approval process.',
      date: '2026-10-27',
      category: 'Architecture',
      draft: true,
    },
    body: 'This exact text is under review.',
  };
  await store.query(writeEntrySQL(entry).replace(/;$/, ' RETURNING slug;'));
  const initial = await getPost(store, entry.slug);
  const submitted = await createReview(initial, store.identity);
  const ticket = await readReview(submitted.id);
  let deployments = 0;
  await assert.rejects(
    publishReview(store, ticket.id, 'wrong', async () => {
      deployments++;
    }),
    /Invalid publication confirmation/,
  );
  assert.equal(deployments, 0);
  await assert.rejects(
    publishReview(store, ticket.id, ticket.csrf, async () => {
      deployments++;
      throw new Error('Staging tests failed');
    }),
    /Staging tests failed/,
  );
  assert.equal((await readReview(ticket.id)).status, 'failed');
  assert.equal((await getPost(store, entry.slug)).revision, 2);
  assert.equal((await getPost(store, entry.slug)).metadata.draft, false);
  // A human can withdraw a failed approval and review a new draft revision.
  const reopened = await reopenReview(store, ticket.id, ticket.csrf);
  assert.equal((await getPost(store, entry.slug)).metadata.draft, true);
  assert.equal((await getPost(store, entry.slug)).revision, 3);
  assert.equal((await reviewState(store, ticket.id)).stale, true);
  const freshTicket = await readReview(reopened.id);
  await assert.rejects(
    publishReview(store, freshTicket.id, freshTicket.csrf, async () => {
      throw new Error('Staging tests failed again');
    }),
    /Staging tests failed again/,
  );
  await publishReview(store, freshTicket.id, freshTicket.csrf, async () => {
    deployments++;
  });
  assert.equal((await readReview(freshTicket.id)).status, 'approved-local');
  assert.equal((await getPost(store, entry.slug)).revision, 4);
  assert.equal(deployments, 2);
  await publishReview(store, freshTicket.id, freshTicket.csrf, async () => {
    deployments++;
  });
  assert.equal(deployments, 2, 'duplicate confirmation cannot redeploy');
  const history = await store.query(
    "SELECT changed_by FROM content_revisions WHERE slug='approval-test' ORDER BY revision",
  );
  assert.equal(history.at(-1).changed_by, 'human-review');
  await assert.rejects(
    reviewState({ ...store, identity: 'remote:CONTENT_DB' }, ticket.id),
    /another database/,
  );
});

test('failed database approval retains a usable review and can return to an editable draft', async (t) => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-approval-failure-'),
  );
  const previous = process.env.AJT_REVIEW_DIR;
  process.env.AJT_REVIEW_DIR = path.join(temporary, 'tickets');
  const store = await createStore({
    database: path.join(temporary, 'content.sqlite'),
  });
  t.after(async () => {
    store.close();
    if (previous === undefined) delete process.env.AJT_REVIEW_DIR;
    else process.env.AJT_REVIEW_DIR = previous;
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await store.query(
    writeEntrySQL({
      collection: 'posts',
      slug: 'approval-failure',
      data: {
        title: 'A recoverable draft approval',
        summary: 'A complete summary for a database failure before approval.',
        date: '2026-10-27',
        category: 'Architecture',
        draft: true,
      },
      body: 'Reviewed content before an interrupted database write.',
    }).replace(/;$/, ' RETURNING slug;'),
  );
  const submitted = await createReview(
    await getPost(store, 'approval-failure'),
    store.identity,
  );
  const ticket = await readReview(submitted.id);
  const unavailable = {
    ...store,
    query: async (sql) => {
      if (sql.startsWith('UPDATE '))
        throw new Error('Database temporarily unavailable');
      return store.query(sql);
    },
  };
  await assert.rejects(
    publishReview(unavailable, ticket.id, ticket.csrf),
    /temporarily unavailable/,
  );
  assert.equal((await reviewState(store, ticket.id)).stale, false);
  assert.equal((await getPost(store, 'approval-failure')).metadata.draft, true);
  const reopened = await reopenReview(store, ticket.id, ticket.csrf);
  assert.equal((await readReview(reopened.id)).status, 'review');
  assert.equal((await getPost(store, 'approval-failure')).revision, 2);
});

test('uploaded media stays outside public assets and rejects executable uploads and traversal paths', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-media-'));
  const previous = process.env.AJT_MEDIA_DIR;
  process.env.AJT_MEDIA_DIR = temporary;
  t.after(async () => {
    if (previous === undefined) delete process.env.AJT_MEDIA_DIR;
    else process.env.AJT_MEDIA_DIR = previous;
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const bytes = await fs.readFile('public/images/videos/go-plant.jpg');
  const media = await saveMedia(bytes);
  assert.equal(media.pending, true);
  assert.equal((await saveMedia(bytes)).url, media.url);
  assert((await resolveAsset(media.url)).startsWith(temporary));
  const mp4 = Buffer.from('00000018667479706d703432000000006d703432', 'hex');
  const video = await saveMedia(mp4);
  assert.equal(video.kind, 'video');
  assert(video.url.startsWith('/videos/'));
  assert((await resolveAsset(video.url)).startsWith(temporary));
  for (const brand of [
    'heic',
    'heix',
    'mif1',
    'avif',
    'qt  ',
    '3gp5',
    'M4A ',
  ]) {
    const other = Buffer.from(mp4);
    other.write(brand, 8, 'latin1');
    await assert.rejects(saveMedia(other), /not accepted/);
  }
  await assert.rejects(fs.access(path.join('public', media.url)), /ENOENT/);
  await assert.rejects(
    saveMedia(Buffer.from('<svg onload="alert(1)"></svg>')),
    /not accepted/,
  );
  await assert.rejects(
    resolveAsset('/uploads/../../.env'),
    /Invalid media asset/,
  );
});

test('publication locks recover dead owners, retain live child deployments, and expose interrupted reviews for human recovery', async (t) => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ajt-publication-lock-'),
  );
  const previous = process.env.AJT_REVIEW_DIR;
  process.env.AJT_REVIEW_DIR = temporary;
  const store = await createStore({
    database: path.join(temporary, 'content.sqlite'),
  });
  let child;
  t.after(async () => {
    if (child?.exitCode === null && child?.signalCode === null) child.kill();
    store.close();
    if (previous === undefined) delete process.env.AJT_REVIEW_DIR;
    else process.env.AJT_REVIEW_DIR = previous;
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const exited = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await once(exited, 'exit');
  const old = acquirePublication(temporary, 'interrupted', exited.pid);
  assert.equal(publicationStatus(temporary).active, false);
  child = spawn(
    process.execPath,
    ['-e', "console.log('ready');setInterval(()=>{},1000)"],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await once(child.stdout, 'data');
  trackPublicationChild(temporary, old, child.pid);
  assert.equal(publicationStatus(temporary).active, true);
  assert.throws(
    () => acquirePublication(temporary, 'second'),
    /Another publication/,
  );
  const stopped = once(child, 'exit');
  child.kill();
  await stopped;
  const next = acquirePublication(temporary, 'second');
  releasePublication(temporary, old);
  assert.equal(publicationStatus(temporary).lock.token, next);
  releasePublication(temporary, next);

  await store.query(
    writeEntrySQL({
      collection: 'posts',
      slug: 'interrupted-review',
      data: {
        title: 'An interrupted publication',
        summary:
          'A complete summary for recovery after a local publishing process stops.',
        date: '2026-10-27',
        category: 'Architecture',
        draft: true,
      },
      body: 'The exact draft remains available for human review.',
    }).replace(/;$/, ' RETURNING slug;'),
  );
  const submitted = await createReview(
    await getPost(store, 'interrupted-review'),
    store.identity,
  );
  const review = await readReview(submitted.id);
  await fs.writeFile(
    path.join(temporary, review.id + '.json'),
    JSON.stringify({
      ...review,
      status: 'publishing',
      approvedAt: new Date().toISOString(),
    }),
  );
  acquirePublication(temporary, review.id, exited.pid);
  const interrupted = await reviewState(store, review.id);
  assert.equal(interrupted.review.status, 'failed');
  assert.match(interrupted.review.error, /outcome is unknown/);
  assert.equal(interrupted.stale, false);
  await publishReview(store, review.id, review.csrf);
  assert.equal((await readReview(review.id)).status, 'approved-local');
  assert.equal(publicationStatus(temporary).active, false);
});
