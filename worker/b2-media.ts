import { b2Client, type B2Config } from '../src/lib/b2.ts';
import type { MediaBucket } from './media.ts';

export interface B2Env {
  B2_MEDIA_ENDPOINT?: string;
  B2_MEDIA_BUCKET?: string;
  B2_MEDIA_KEY_ID?: string;
  B2_MEDIA_APPLICATION_KEY?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
}

export function b2MediaBucket(env: B2Env): MediaBucket {
  const client = b2Client(
    {
      endpoint: env.B2_MEDIA_ENDPOINT,
      bucket: env.B2_MEDIA_BUCKET,
      keyId: env.B2_MEDIA_KEY_ID,
      applicationKey: env.B2_MEDIA_APPLICATION_KEY,
    } as B2Config,
    { localTest: env.DEPLOYMENT_ENVIRONMENT === 'local-test' },
  );
  function size(response: Response) {
    const length = response.headers.get('Content-Length');
    if (
      !length ||
      !/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      Number(length) < 1 ||
      Number(length) > 100 * 1024 * 1024
    )
      throw new Error('Invalid media response size');
    return Number(length);
  }
  const filename = (key: string) => {
    if (!key.startsWith('assets/')) throw new Error('Invalid media prefix');
    return key.slice(7);
  };
  return {
    async head(key) {
      const response = await client.request('HEAD', filename(key));
      if (response.status === 404) return null;
      if (response.status !== 200)
        throw new Error(`B2 media unavailable (${response.status})`);
      return { size: size(response) };
    },
    async get(key, options) {
      const response = await client.request('GET', filename(key), options);
      if (response.status === 404) return null;
      if (response.status !== (options?.range ? 206 : 200) || !response.body)
        throw new Error('B2 media unavailable');
      const length = size(response);
      let total = length;
      if (options?.range) {
        const { offset, length: requestedLength } = options.range;
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get('Content-Range') || '',
        );
        if (
          !match ||
          Number(match[1]) !== offset ||
          Number(match[2]) !== offset + requestedLength - 1 ||
          length !== requestedLength
        )
          throw new Error('Invalid media range response');
        total = Number(match[3]);
        if (
          !Number.isSafeInteger(total) ||
          total < offset + requestedLength ||
          total > 100 * 1024 * 1024
        )
          throw new Error('Invalid media total size');
      }
      return { size: total, body: response.body };
    },
  };
}
