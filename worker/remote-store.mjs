import { createHash } from 'node:crypto';
import { b2Client } from '../src/lib/b2.ts';
import {
  reserveMediaOperation,
  reserveMediaStorage,
} from '../mcp/media-budget.mjs';

export function remoteStore(env) {
  const db = env.CONTENT_DB;
  if (!db) throw new Error('Authoring database is not configured');
  const client = () =>
    b2Client(
      {
        endpoint: env.B2_MEDIA_ENDPOINT,
        bucket: env.B2_MEDIA_BUCKET,
        keyId: env.B2_AUTHORING_KEY_ID,
        applicationKey: env.B2_AUTHORING_APPLICATION_KEY,
      },
      { localTest: env.DEPLOYMENT_ENVIRONMENT === 'local-test' },
    );
  const store = {
    db,
    identity: 'worker:CONTENT_DB',
    localOnly: env.DEPLOYMENT_ENVIRONMENT === 'local-test',
    async ensureRuntime() {
      const response = await fetch(
        new URL('/.well-known/ajt-content', env.SITE_URL),
        { redirect: 'manual', signal: AbortSignal.timeout(12000) },
      );
      if (
        response.status !== 200 ||
        (await response.json()).publication !== 'direct-d1'
      )
        throw new Error(
          'The website runtime is not active yet. Nothing was published.',
        );
    },
    async query(sql) {
      if (Buffer.byteLength(sql) > 100_000)
        throw new Error('Content exceeds the query limit');
      return (await db.prepare(sql).all()).results;
    },
    async resolveAsset(url) {
      if (/^\/media\/[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|pdf)$/.test(url)) {
        const row = await db
          .prepare('SELECT metadata_json FROM media_assets WHERE url=?')
          .bind(url)
          .first();
        if (!row)
          throw new Error(
            'Private media not found. Upload it before attaching it.',
          );
        return JSON.parse(row.metadata_json);
      }
      if (
        !/^\/(images|videos|uploads|slides)\/[a-zA-Z0-9/_-]+\.(png|jpg|jpeg|gif|webp|svg|mp4|pdf)$/.test(
          url,
        ) ||
        url.includes('..')
      )
        throw new Error('Unsupported asset URL');
      const response = await fetch(new URL(url, env.SITE_URL), {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });
      if (response.status !== 200) throw new Error('Website asset not found');
      return {
        bytes: Number(response.headers.get('content-length')),
        contentType: response.headers.get('content-type'),
      };
    },
    async readAsset(url, offset) {
      const info = await store.resolveAsset(url);
      if (
        !Number.isSafeInteger(info.bytes) ||
        info.bytes < 1 ||
        info.bytes > 25 * 1024 * 1024 ||
        offset >= info.bytes
      )
        throw new Error(
          'Media preview exceeds the 25 MiB limit or has an invalid offset',
        );
      const length = Math.min(256 * 1024, info.bytes - offset);
      let response;
      if (url.startsWith('/media/')) {
        await reserveMediaOperation(store, 'get');
        response = await client().request('GET', url.slice(7), {
          range: { offset, length },
        });
      } else
        response = await fetch(new URL(url, env.SITE_URL), {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` },
          redirect: 'manual',
          signal: AbortSignal.timeout(12000),
        });
      if (
        response.status !== 206 ||
        response.headers.get('content-range') !==
          `bytes ${offset}-${offset + length - 1}/${info.bytes}`
      ) {
        await response.body?.cancel();
        throw new Error('Media preview range failed');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== length) throw new Error('Incomplete media preview');
      return {
        offset,
        totalBytes: info.bytes,
        mimeType: info.contentType,
        data: bytes.toString('base64'),
      };
    },
    async saveMedia(bytes, name) {
      if (!bytes.length || bytes.length > 25 * 1024 * 1024)
        throw new Error('Uploads are limited to 25 MiB');
      const { mediaType } = await import('../mcp/media-bytes.mjs');
      const [extension, contentType, kind] = mediaType(bytes);
      const filename =
        createHash('sha256').update(bytes).digest('hex') + '.' + extension;
      const url = '/media/' + filename;
      const existing = await db
        .prepare('SELECT url FROM media_assets WHERE url=?')
        .bind(url)
        .first();
      if (existing)
        return { url, kind, contentType, bytes: bytes.length, pending: true };
      await reserveMediaOperation(store, 'put');
      await reserveMediaStorage(store, filename, bytes.length, {
        version: true,
      });
      const response = await client().request('PUT', filename, {
        body: bytes,
        contentType,
      });
      await response.body?.cancel();
      if (response.status !== 200)
        throw new Error(
          'Private media upload failed. Check storage before retrying.',
        );
      await db
        .prepare(
          'INSERT INTO media_assets(url,kind,metadata_json) VALUES(?,?,?) ON CONFLICT(url) DO NOTHING',
        )
        .bind(
          url,
          kind === 'document' ? 'slides' : kind,
          JSON.stringify({
            storage: 'b2',
            contentType,
            bytes: bytes.length,
            name: name.replace(/^.*[\\/]/, '').slice(0, 200),
          }),
        )
        .run();
      return { url, kind, contentType, bytes: bytes.length, pending: true };
    },
  };
  return store;
}
