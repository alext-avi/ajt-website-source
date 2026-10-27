import type { APIRoute } from 'astro';
import { pendingMedia } from './media.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ url, params }) => {
  if (url.hostname !== '127.0.0.1')
    return new Response('Not found', { status: 404 });
  try {
    const media = await pendingMedia(params.filename!);
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
