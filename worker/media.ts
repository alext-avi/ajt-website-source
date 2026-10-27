import {
  mediaFilename,
  mediaPath,
  mediaManifestPath,
  mediaTypes,
} from '../src/lib/media.ts';

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
interface MediaEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  MEDIA_BUCKET?: MediaBucket;
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

// Only GET/HEAD are exposed. R2 itself has neither a public URL nor a write route.
export async function serveMedia(
  request: Request,
  env: MediaEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const filename = mediaPath.exec(url.pathname)?.[1];
  if (!filename) return error(404);
  if (!['GET', 'HEAD'].includes(request.method))
    return error(405, { Allow: 'GET, HEAD' });
  try {
    const response = await env.ASSETS.fetch(
      new Request(new URL(mediaManifestPath, url)),
    );
    if (!response.ok) return error(503);
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
      return error(503);
    // Absence from this release fails closed, even if the object exists in R2.
    if (!manifest.files.includes(filename)) return error(404);
    if (!env.MEDIA_BUCKET) return error(503);
    const key = 'assets/' + filename;
    const info = await env.MEDIA_BUCKET.head(key);
    if (!info) return error(404);
    const etag = '"' + filename.split('.')[0] + '"';
    const headers = new Headers({
      'Content-Type': mediaTypes[filename.split('.').at(-1)!],
      'Content-Length': String(info.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Accept-Ranges': 'bytes',
      ETag: etag,
    });
    const matches = request.headers
      .get('if-none-match')
      ?.split(',')
      .map((value) => value.trim().replace(/^W\//, ''));
    if (matches?.includes(etag) || matches?.includes('*')) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') return new Response(null, { headers });
    let range;
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
    const object = await env.MEDIA_BUCKET.get(
      key,
      range ? { range } : undefined,
    );
    if (!object) return error(404);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch {
    return error(503);
  }
}
