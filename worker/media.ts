import {
  mediaFilename,
  mediaPath,
  mediaManifestPath,
  mediaTypes,
} from '../src/lib/media.ts';
import { b2MediaBucket, MediaOriginError, type B2Env } from './b2-media.ts';

interface ObjectInfo {
  size: number;
}
export interface MediaBucket {
  head(key: string): Promise<ObjectInfo | null>;
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<(ObjectInfo & { body: ReadableStream }) | null>;
}
export interface MediaEnv extends B2Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  MEDIA_BUCKET?: MediaBucket;
  MEDIA_PROVIDER?: string;
}
export interface MediaCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
export interface MediaContext {
  cache?: MediaCache;
  waitUntil?(promise: Promise<unknown>): void;
}
const error = (status: number, headers = {}) =>
  new Response(null, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });

// Storage stays private. Only release-approved GET/HEAD requests reach it.
export async function serveMedia(
  request: Request,
  env: MediaEnv,
  context: MediaContext = {},
): Promise<Response> {
  const url = new URL(request.url);
  const filename = mediaPath.exec(url.pathname)?.[1];
  if (!filename) return error(404);
  if (!['GET', 'HEAD'].includes(request.method))
    return error(405, { Allow: 'GET, HEAD' });
  let step = 'manifest-fetch';
  // Staging diagnostics identify the failed hop without exposing upstream errors,
  // credentials, object metadata, or account details in public responses.
  const unavailable = () =>
    error(
      503,
      env.DEPLOYMENT_ENVIRONMENT === 'staging'
        ? { 'X-AJT-Media-Error': step }
        : {},
    );
  try {
    const response = await env.ASSETS.fetch(
      new Request(new URL(mediaManifestPath, url)),
    );
    if (!response.ok) return unavailable();
    step = 'manifest-parse';
    const manifest = (await response.json()) as {
      version?: number;
      files?: string[];
    };
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      manifest.files.some(
        (name) => typeof name !== 'string' || !mediaFilename.test(name),
      )
    )
      return unavailable();
    // ALWAYS check this release before the edge cache: drafts and removed files
    // cannot be exposed by an old cache entry or a guessed immutable URL.
    if (!manifest.files.includes(filename)) return error(404);
    const cache = context.cache;
    const cacheKey = new Request(new URL('/media/' + filename, url));
    const cacheableRequest =
      !!cache && !request.headers.has('range') && !filename.endsWith('.mp4');
    const etag = '"' + filename.split('.')[0] + '"';
    const matches = request.headers
      .get('if-none-match')
      ?.split(',')
      .map((value) => value.trim().replace(/^W\//, ''));
    function conditional(response: Response) {
      const headers = new Headers(response.headers);
      if (matches?.includes(etag) || matches?.includes('*')) {
        headers.delete('Content-Length');
        return new Response(null, { status: 304, headers });
      }
      return request.method === 'HEAD'
        ? new Response(null, { headers })
        : response;
    }
    if (cacheableRequest) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit?.status === 200 && hit.headers.get('etag') === etag) {
          const headers = new Headers(hit.headers);
          headers.set('X-AJT-Media-Cache', 'HIT');
          return conditional(new Response(hit.body, { headers }));
        }
      } catch {
        /* Cache availability must not prevent origin delivery. */
      }
    }
    step = 'storage-setup';
    const bucket =
      env.MEDIA_PROVIDER === 'b2' ? b2MediaBucket(env) : env.MEDIA_BUCKET;
    if (!bucket) return unavailable();
    const key = 'assets/' + filename;
    step = 'storage-head';
    const info = await bucket.head(key);
    if (!info) return error(404);
    const headers = new Headers({
      'Content-Type': mediaTypes[filename.split('.').at(-1)!],
      'Content-Length': String(info.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'X-AJT-Media-Cache': cacheableRequest ? 'MISS' : 'BYPASS',
    });
    if (matches?.includes(etag) || matches?.includes('*')) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') return new Response(null, { headers });
    let range: { offset: number; length: number } | undefined;
    const requested = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    if (requested && (!ifRange || ifRange === etag)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
      if (!match || (!match[1] && !match[2]))
        return error(416, { 'Content-Range': `bytes */${info.size}` });
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, info.size - Number(match[2]));
      const end =
        match[1] && match[2]
          ? Math.min(Number(match[2]), info.size - 1)
          : info.size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= info.size
      )
        return error(416, { 'Content-Range': `bytes */${info.size}` });
      range = { offset: start, length: end - start + 1 };
      headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
      headers.set('Content-Length', String(range.length));
    }
    step = 'storage-get';
    const object = await bucket.get(key, range ? { range } : undefined);
    if (!object) return error(404);
    step = 'storage-size';
    if (object.size !== info.size) return unavailable();
    const result = new Response(object.body, {
      status: range ? 206 : 200,
      headers,
    });
    if (cacheableRequest && !range && info.size <= 10 * 1024 * 1024) {
      const write = cache!.put(cacheKey, result.clone()).catch(() => {});
      if (context.waitUntil) context.waitUntil(write);
      else await write;
    }
    return result;
  } catch (cause) {
    if (cause instanceof MediaOriginError) step = cause.code;
    return unavailable();
  }
}
