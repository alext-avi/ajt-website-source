import type { APIRoute } from 'astro';
import { reviewStore, backendId } from './reviews.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ url }) =>
  url.hostname === '127.0.0.1'
    ? Response.json(
        {
          service: 'ajt-content-review',
          backend: backendId((await reviewStore()).identity),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    : new Response('Not found', { status: 404 });
