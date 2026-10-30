import { handle } from '@astrojs/cloudflare/handler';
import staticWorker from './index';
import { serveMedia } from './media';

// Public HTTP requests never select working copies, captures, or revision history.
export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname === '/.well-known/ajt-content') {
      await env.CONTENT_DB.prepare(
        'SELECT 1 FROM published_content LIMIT 1',
      ).first();
      response = Response.json(
        { version: 1, publication: 'direct-d1' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } else if (
      url.pathname === '/media' ||
      url.pathname.startsWith('/media/')
    ) {
      response = await serveMedia(
        request,
        {
          ...env,
          async isPublishedMedia(path: string) {
            const row = await env.CONTENT_DB.prepare(
              `SELECT 1 FROM published_content p
            WHERE (p.collection!='posts' OR json_extract(p.metadata_json,'$.date')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            AND (json_extract(p.metadata_json,'$.image')=? OR json_extract(p.metadata_json,'$.video')=?
              OR json_extract(p.metadata_json,'$.videoPoster')=? OR json_extract(p.metadata_json,'$.slides')=?
              OR EXISTS(SELECT 1 FROM published_media m WHERE m.collection=p.collection AND m.slug=p.slug AND m.revision=p.revision AND m.url=?)) LIMIT 1`,
            )
              .bind(path, path, path, path, path)
              .first();
            return !!row;
          },
        },
        { waitUntil: (promise) => ctx.waitUntil(promise) },
      );
    } else if (url.pathname.startsWith('/r/')) {
      response = await staticWorker.fetch(request, env, ctx);
    } else if (
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/review') ||
      url.pathname === '/mcp'
    ) {
      response = new Response('Not found', { status: 404 });
    } else {
      response = await handle(request, env, ctx);
    }
    const result = new Response(response.body, response);
    // No HTML response caching initially: a successful Post is visible on the next request.
    if (
      result.headers.get('Content-Type')?.includes('text/html') ||
      /\.(xml|json)$/.test(url.pathname)
    )
      result.headers.set('Cache-Control', 'no-store');
    if (env.DEPLOYMENT_ENVIRONMENT === 'staging') {
      result.headers.set('X-Robots-Tag', 'noindex, nofollow');
      result.headers.set('X-AJT-Environment', 'staging');
      result.headers.set('X-AJT-Release', env.RELEASE_ID || 'unprepared');
      result.headers.set('Cache-Control', 'no-store');
    }
    return result;
  },
};
