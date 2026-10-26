import { referralDestination } from '../src/lib/referrals.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  // Bound for future content tools; published pages are built from a D1 snapshot.
  // No public database write endpoint or visitor logging is introduced here.
  CONTENT_DB?: {
    prepare(query: string): {
      bind(...values: unknown[]): unknown;
    };
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const destination = referralDestination(url);
    if (!destination) {
      if (url.pathname.startsWith('/r/')) {
        return new Response('Not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, follow',
          },
        });
      }
      return env.ASSETS.fetch(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
      });
    }
    // Keep this temporary: this route can serve a tailored welcome in the future.
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination.href,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, follow',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    });
  },
};
