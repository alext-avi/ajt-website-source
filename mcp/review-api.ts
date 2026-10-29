import type { APIRoute } from 'astro';
import {
  reviewStore,
  reviewState,
  checkConfirmation,
  publishReview,
  createReview,
  failReview,
  reopenReview,
  reviewCollection,
} from './reviews.mjs';
import { updateDraft } from './content-server.mjs';
import { saveMedia } from './media.mjs';

const jobs = new Map<string, Promise<unknown>>();
export const prerender = false;
export const POST: APIRoute = async ({ request, params, redirect }) => {
  const url = new URL(request.url);
  if (
    url.hostname !== '127.0.0.1' ||
    request.headers.get('origin') !== url.origin ||
    request.headers.get('sec-fetch-site') !== 'same-origin'
  )
    return new Response('Local, same-origin review required', { status: 403 });
  try {
    // Bound multipart parsing before allocating the full file in memory.
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of request.body || []) {
      length += chunk.byteLength;
      if (length > 26 * 1024 * 1024)
        return new Response('Upload exceeds 25 MiB', { status: 413 });
      chunks.push(chunk);
    }
    const bounded = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    const form = await bounded.formData();
    const id = params.ticket!;
    const store = await reviewStore();
    const { review, stale } = await reviewState(store, id);
    checkConfirmation(review, String(form.get('csrf') || ''));
    const action = form.get('action');
    if (stale)
      return new Response(
        'This draft changed. Refresh and submit its latest revision for review.',
        { status: 409 },
      );
    if (jobs.has(id))
      return new Response('Publication is already running', { status: 409 });
    if (action === 'reopen') {
      const next = await reopenReview(store, id, String(form.get('csrf')));
      return redirect('/review/' + next.id, 303);
    }
    if (action === 'upload') {
      if (review.status !== 'review' || !review.post.metadata.draft)
        return new Response('Only editable drafts accept uploads', {
          status: 409,
        });
      const file = form.get('file');
      if (!(file instanceof File))
        return new Response('Choose a media file', { status: 400 });
      if (file.size > 25 * 1024 * 1024)
        return new Response(
          'Browser uploads are limited to 25 MiB; use the MCP for files up to 100 MiB',
          { status: 413 },
        );
      const media = await saveMedia(
        Buffer.from(await file.arrayBuffer()),
        store,
        file.name,
      );
      return Response.json(media, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'save') {
      if (review.approvedAt)
        return new Response(
          'An approved post cannot be edited through this review',
          { status: 409 },
        );
      const text = (field: string) => String(form.get(field) || '').trim();
      const lines = (field: string) =>
        text(field)
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      const collection = reviewCollection(review.post);
      const post = await updateDraft(
        store,
        {
          slug: review.post.slug,
          expectedRevision: review.post.revision,
          body: String(form.get('body') || '').replace(/\r\n/g, '\n'),
          metadata: {
            title: text('title'),
            summary: text('summary'),
            ...(collection === 'projects'
              ? {
                  role: text('role'),
                  technologies: text('technologies')
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                  outcomes: lines('outcomes'),
                  relatedArticles: lines('relatedArticles'),
                  repository: text('repository') || undefined,
                  kind: text('kind'),
                  order: Number(text('order')),
                  featured: form.get('featured') === 'on',
                }
              : { date: text('date'), category: text('category') }),
            tags: text('tags')
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            image: text('image') || undefined,
            imageAlt: text('imageAlt') || undefined,
            ...(collection === 'posts'
              ? {
                  video: text('video') || undefined,
                  videoPoster: text('videoPoster') || undefined,
                }
              : {}),
          },
        },
        'human-editor',
        collection,
      );
      const next = await createReview(post, store.identity);
      return redirect('/review/' + next.id, 303);
    }
    if (action !== 'publish')
      return new Response('Unknown review action', { status: 400 });
    let acknowledge!: () => void;
    const started = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const job = publishReview(store, id, String(form.get('csrf')), undefined, {
      onStarted: acknowledge,
    })
      .catch((error) => failReview(id, error))
      .finally(() => jobs.delete(id));
    jobs.set(id, job);
    // A retry must persist its new publishing state before the browser loads.
    // Otherwise it can render the previous failure without enabling refresh.
    await Promise.race([started, job]);
    return redirect('/review/' + id + '?pending=1', 303);
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Review operation failed',
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
