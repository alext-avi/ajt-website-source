import { b2Client, type B2Config } from '../src/lib/b2.ts';
import type { MediaBucket } from './media.ts';

export interface B2Env {
  B2_MEDIA_ENDPOINT?: string;
  B2_MEDIA_BUCKET?: string;
  B2_MEDIA_KEY_ID?: string;
  B2_MEDIA_APPLICATION_KEY?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
}

export class MediaOriginError extends Error {
  readonly code: string;
  constructor(
    code:
      | 'head-request'
      | 'head-status'
      | 'head-size'
      | 'get-request'
      | 'get-status'
      | 'get-size'
      | 'get-range',
    status?: number,
  ) {
    super('Media origin unavailable');
    this.code = code + (status ? '-' + status : '');
  }
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
  function size(response: Response, code: 'head-size' | 'get-size') {
    const length = response.headers.get('Content-Length');
    if (
      !length ||
      !/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      Number(length) < 1 ||
      Number(length) > 100 * 1024 * 1024
    )
      throw new MediaOriginError(code);
    return Number(length);
  }
  const filename = (key: string) => {
    if (!key.startsWith('assets/')) throw new Error('Invalid media prefix');
    return key.slice(7);
  };
  return {
    async head(key) {
      let response;
      try {
        response = await client.request('HEAD', filename(key));
      } catch {
        throw new MediaOriginError('head-request');
      }
      if (response.status === 404) return null;
      if (response.status !== 200)
        throw new MediaOriginError('head-status', response.status);
      return { size: size(response, 'head-size') };
    },
    async get(key, options) {
      let response;
      try {
        response = await client.request('GET', filename(key), options);
      } catch {
        throw new MediaOriginError('get-request');
      }
      if (response.status === 404) return null;
      if (response.status !== (options?.range ? 206 : 200) || !response.body)
        throw new MediaOriginError('get-status', response.status);
      const length = size(response, 'get-size');
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
          throw new MediaOriginError('get-range');
        total = Number(match[3]);
        if (
          !Number.isSafeInteger(total) ||
          total < offset + requestedLength ||
          total > 100 * 1024 * 1024
        )
          throw new MediaOriginError('get-size');
      }
      return { size: total, body: response.body };
    },
  };
}
