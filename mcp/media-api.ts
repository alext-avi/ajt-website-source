import type { APIRoute } from 'astro';
import { pendingMedia, resolveAsset } from './media.mjs';
import { reviewStore } from './reviews.mjs';
import fs from 'node:fs/promises';
import { mediaType } from './media.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ url, params }) => {
  if (url.hostname !== '127.0.0.1')
    return new Response('Not found', { status: 404 });
  try {
    let media;
    if (url.pathname.startsWith('/media/')) {
      const file = await resolveAsset(
        '/media/' + params.filename,
        await reviewStore(),
      );
      const bytes = await fs.readFile(file);
      media = { bytes, contentType: mediaType(bytes)[1] };
    } else media = await pendingMedia(params.filename!);
    return new Response(media.bytes, {
      headers: {
        'Content-Type': media.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
