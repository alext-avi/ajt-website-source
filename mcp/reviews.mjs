import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import { parseFragment } from 'parse5';
import { sqlText, validateEntry } from '../scripts/lib/d1-content.mjs';
import { materializeMedia } from './media.mjs';
import {
  acquirePublication,
  releasePublication,
  publicationStatus,
  trackPublicationChild,
} from './publication-lock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const renderer = createSatteriMarkdownProcessor({
  features: { smartPunctuation: false },
  shikiConfig: { theme: 'github-dark', wrap: false },
});
const blockedTags = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'style',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'svg',
  'math',
]);
const idPattern = /^[a-f0-9]{48}$/;
const directory = () =>
  path.resolve(
    process.env.AJT_REVIEW_DIR || path.join(root, '.wrangler/content-review'),
  );
const ticketPath = (id) => {
  if (!idPattern.test(id)) throw new Error('Review not found');
  return path.join(directory(), id + '.json');
};

export async function renderPost(body) {
  const result = await (await renderer).render(body);
  function check(node) {
    if (blockedTags.has(node.tagName))
      throw new Error(
        'Use Markdown and the post media fields; active HTML is not allowed in post bodies',
      );
    for (const { name, value } of node.attrs || []) {
      if (/^on/i.test(name) || name === 'srcdoc')
        throw new Error('Executable HTML attributes are not allowed');
      if (['href', 'src', 'xlink:href'].includes(name)) {
        const protocol = new URL(value, 'https://content.test/').protocol;
        if (!['https:', 'http:', 'mailto:', 'tel:'].includes(protocol))
          throw new Error('Unsafe link or media protocol in post body');
      }
    }
    for (const child of node.childNodes || []) check(child);
    if (node.content) check(node.content);
  }
  check(parseFragment(result.code));
  return result.code;
}

export async function postMedia(post) {
  const urls = ['image', 'videoPoster', 'video']
    .map((field) => post.metadata[field])
    .filter(Boolean);
  function visit(node) {
    for (const attribute of node.attrs || [])
      if (
        ['href', 'src'].includes(attribute.name) &&
        /^\/(uploads|videos|media)\//.test(attribute.value)
      )
        urls.push(new URL(attribute.value, 'https://content.test').pathname);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parseFragment(await renderPost(post.body)));
  return urls;
}

export function postDigest(post) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        slug: post.slug,
        metadata: post.metadata,
        body: post.body,
        revision: post.revision,
      }),
    )
    .digest('hex');
}

async function saveReview(review) {
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  const temporary =
    ticketPath(review.id) + '.' + randomBytes(6).toString('hex') + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(review, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  await fs.rename(temporary, ticketPath(review.id));
}

export async function createReview(post, backend) {
  if (!post.metadata.draft)
    throw new Error('Only drafts can be submitted for review');
  await renderPost(post.body);
  const review = {
    version: 1,
    id: randomBytes(24).toString('hex'),
    csrf: randomBytes(24).toString('hex'),
    backend,
    post,
    digest: postDigest(post),
    status: 'review',
    createdAt: new Date().toISOString(),
  };
  await saveReview(review);
  return {
    id: review.id,
    slug: post.slug,
    revision: post.revision,
    digest: review.digest,
    reviewUrl: `${reviewOrigin().origin}/review/${review.id}`,
    status: 'awaiting-human-review',
  };
}

export function reviewOrigin() {
  const url = new URL(process.env.AJT_REVIEW_ORIGIN || 'http://127.0.0.1:4330');
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('The review console must use a loopback HTTP origin');
  return url;
}

export const backendId = (identity) =>
  createHash('sha256').update(identity).digest('hex');
export async function ensureReviewServer(store) {
  const origin = reviewOrigin();
  async function healthy() {
    try {
      const response = await fetch(new URL('/review-health', origin), {
        signal: AbortSignal.timeout(1_500),
      });
      const status = await response.json();
      if (
        status.service !== 'ajt-content-review' ||
        status.backend !== backendId(store.identity)
      )
        throw new Error(
          'The review port is already in use by another service or database',
        );
      return true;
    } catch (error) {
      if (error.message.includes('already in use')) throw error;
      return false;
    }
  }
  if (await healthy()) return;
  if (origin.port !== '4330')
    throw new Error(
      'Start the configured local review server before submitting a review',
    );
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  const log = await fs.open(path.join(directory(), 'console.log'), 'a', 0o600);
  try {
    const child = spawn(
      process.execPath,
      [
        path.join(root, 'node_modules/astro/bin/astro.mjs'),
        'dev',
        '--ignore-lock',
        '--host',
        '127.0.0.1',
        '--port',
        origin.port,
      ],
      {
        cwd: root,
        detached: true,
        stdio: ['ignore', log.fd, log.fd],
        env: {
          ...process.env,
          AJT_REVIEW_ENABLED: '1',
          AJT_REVIEW_TARGET: store.identity.startsWith('sqlite:')
            ? 'local'
            : 'remote',
          AJT_REVIEW_DATABASE: store.identity.startsWith('sqlite:')
            ? store.identity.slice(7)
            : '',
          AJT_REVIEW_R2_LOCAL_STATE: store.localR2 || '',
          ASTRO_TELEMETRY_DISABLED: '1',
        },
      },
    );
    child.on('error', () => {}); // Startup failure is reported by the bounded health check below.
    child.unref();
  } finally {
    await log.close();
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    'The review console did not start. Run npm run content:review and retry.',
  );
}

export async function readReview(id) {
  const review = JSON.parse(await fs.readFile(ticketPath(id), 'utf8'));
  if (
    review.version !== 1 ||
    review.id !== id ||
    postDigest(review.post) !== review.digest
  )
    throw new Error('Invalid review record');
  validateEntry({
    collection: 'posts',
    slug: review.post.slug,
    data: review.post.metadata,
    body: review.post.body,
  });
  return review;
}

export async function listReviews() {
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 });
  const reviews = [];
  for (const file of await fs.readdir(directory())) {
    if (!file.endsWith('.json') || !idPattern.test(file.slice(0, -5))) continue;
    const review = interruptedReview(await readReview(file.slice(0, -5)));
    reviews.push({
      id: review.id,
      title: review.post.metadata.title,
      revision: review.post.revision,
      status: review.status,
      createdAt: review.createdAt,
    });
  }
  return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function currentPost(store, slug) {
  const row = (
    await store.query(
      `SELECT slug,metadata_json,body_markdown,revision FROM content_items WHERE collection='posts' AND slug=${sqlText(slug)};`,
    )
  )[0];
  if (!row) throw new Error('The draft no longer exists');
  return {
    slug: row.slug,
    metadata: JSON.parse(row.metadata_json),
    body: row.body_markdown,
    revision: row.revision,
  };
}

export async function reviewState(store, id) {
  const review = interruptedReview(await readReview(id));
  if (review.backend !== store.identity)
    throw new Error('This review belongs to another database');
  const current = await currentPost(store, review.post.slug);
  let expected = review.post;
  if (review.approvedAt)
    expected = {
      ...review.post,
      metadata: { ...review.post.metadata, draft: false },
      revision: review.post.revision + 1,
    };
  const currentDigest = postDigest(current);
  const valid =
    currentDigest === postDigest(expected) ||
    (['publishing', 'failed'].includes(review.status) &&
      currentDigest === review.digest);
  return { review, stale: !valid, current };
}

function interruptedReview(review) {
  if (review.status !== 'publishing') return review;
  const status = publicationStatus(directory());
  if (status.active && status.lock.review === review.id) return review;
  return {
    ...review,
    status: 'failed',
    error:
      'Publication was interrupted. Its deployment outcome is unknown. Inspect the local publishing log before retrying or returning to draft.',
  };
}

export async function publishReview(
  store,
  id,
  csrf,
  publisher = deployWebsite,
  { onStarted } = {},
) {
  const { review, stale } = await reviewState(store, id);
  checkConfirmation(review, csrf);
  if (stale)
    throw new Error(
      'The draft changed. Submit the current revision for a new review before publishing.',
    );
  if (review.status === 'published' || review.status === 'approved-local')
    return review;
  if (new Date(review.post.metadata.date).getTime() > Date.now())
    throw new Error(
      'This post has a future date. Revise the date before publishing.',
    );
  const lock = acquirePublication(directory(), id);
  try {
    const fresh = await reviewState(store, id);
    if (fresh.stale) throw new Error('The draft changed before publication');
    if (['published', 'approved-local'].includes(fresh.review.status))
      return fresh.review;
    review.status = 'publishing';
    review.approvedAt ||= new Date().toISOString();
    await saveReview(review);
    onStarted?.();
    await renderPost(review.post.body);
    if (store.media || !store.identity.startsWith('sqlite:'))
      await materializeMedia(await postMedia(review.post), store);
    const metadata = { ...review.post.metadata, draft: false };
    const rows = await store.query(
      `UPDATE content_items SET metadata_json=${sqlText(JSON.stringify(metadata))},revision=revision+1,updated_by='human-review',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE collection='posts' AND slug=${sqlText(review.post.slug)} AND revision=${review.post.revision} AND is_draft=1 RETURNING revision;`,
    );
    if (!rows.length) {
      const retry = await currentPost(store, review.post.slug);
      const approved = {
        ...review.post,
        metadata,
        revision: review.post.revision + 1,
      };
      if (postDigest(retry) !== postDigest(approved))
        throw new Error('Revision conflict during approval');
    }
    await publisher(review, store, lock);
    review.status = store.identity.startsWith('sqlite:')
      ? 'approved-local'
      : 'published';
    review.publishedAt = new Date().toISOString();
    delete review.error;
    await saveReview(review);
    return review;
  } catch (error) {
    review.status = 'failed';
    review.error =
      error instanceof Error ? error.message : 'Publication failed';
    await saveReview(review);
    throw error;
  } finally {
    releasePublication(directory(), lock);
  }
}

export function checkConfirmation(review, csrf) {
  const supplied = Buffer.from(csrf || '');
  const expected = Buffer.from(review.csrf);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Error('Invalid publication confirmation');
}

export async function failReview(id, error) {
  const review = await readReview(id);
  if (['published', 'approved-local'].includes(review.status)) return;
  review.status = 'failed';
  review.error = error instanceof Error ? error.message : 'Publication failed';
  await saveReview(review);
}

export async function reopenReview(store, id, csrf) {
  const { review, stale, current } = await reviewState(store, id);
  checkConfirmation(review, csrf);
  if (stale || review.status !== 'failed' || !review.approvedAt)
    throw new Error(
      'Only an unchanged, failed publication can return to draft',
    );
  const metadata = { ...review.post.metadata, draft: true };
  const rows = await store.query(
    `UPDATE content_items SET metadata_json=${sqlText(JSON.stringify(metadata))},revision=revision+1,updated_by='human-editor',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE collection='posts' AND slug=${sqlText(review.post.slug)} AND revision=${current.revision} AND is_draft=${current.metadata.draft ? 1 : 0} RETURNING revision;`,
  );
  if (!rows.length)
    throw new Error('Revision conflict; refresh before editing');
  return createReview(
    await currentPost(store, review.post.slug),
    store.identity,
  );
}

async function deployWebsite(review, store, lock) {
  // Local mode performs real SQLite approval/history writes, never a remote deployment.
  if (store.identity.startsWith('sqlite:')) return;
  try {
    await fs.access(path.join(root, 'scripts/deploy.mjs'));
  } catch {
    throw new Error(
      'The staging release gate must be installed before publishing.',
    );
  }
  const log = await fs.open(
    path.join(directory(), review.id + '.log'),
    'a',
    0o600,
  );
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', 'deploy'], {
        cwd: root,
        detached: true,
        env: {
          ...process.env,
          PATH:
            path.dirname(process.execPath) +
            path.delimiter +
            (process.env.PATH || ''),
          ASTRO_TELEMETRY_DISABLED: '1',
        },
        stdio: ['ignore', log.fd, log.fd],
      });
      child.on('error', () =>
        reject(
          new Error(
            'Could not start publication. Check the local publishing log.',
          ),
        ),
      );
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                'Publication checks or deployment failed. Inspect the local publishing log before retrying.',
              ),
            ),
      );
      if (child.pid) {
        try {
          trackPublicationChild(directory(), lock, child.pid);
        } catch (error) {
          try {
            process.kill(
              process.platform === 'win32' ? child.pid : -child.pid,
              'SIGTERM',
            );
          } catch {}
          reject(error);
        }
      }
    });
  } finally {
    await log.close();
  }
}

let storePromise;
export async function reviewStore() {
  if (!storePromise)
    storePromise = import('./content-server.mjs').then(({ createStore }) =>
      createStore({
        remote: process.env.AJT_REVIEW_TARGET !== 'local',
        database: process.env.AJT_REVIEW_DATABASE,
        localR2:
          process.env.AJT_REVIEW_TARGET === 'local'
            ? process.env.AJT_REVIEW_R2_LOCAL_STATE || undefined
            : undefined,
      }),
    );
  return storePromise;
}
