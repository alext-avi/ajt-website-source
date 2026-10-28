import { AwsClient } from 'aws4fetch';
import { mediaFilename } from './media.ts';

export interface B2Config {
  endpoint: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
}

export function validateB2Config(config: B2Config, localTest = false) {
  const endpoint = new URL(config.endpoint);
  const region = /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(
    endpoint.hostname,
  )?.[1];
  const local =
    localTest &&
    endpoint.protocol === 'http:' &&
    endpoint.hostname === '127.0.0.1';
  if (
    (!local && (endpoint.protocol !== 'https:' || !region || endpoint.port)) ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{4,48}[a-zA-Z0-9]$/.test(config.bucket) ||
    !/^[a-zA-Z0-9]{1,128}$/.test(config.keyId) ||
    typeof config.applicationKey !== 'string' ||
    !config.applicationKey ||
    config.applicationKey.length > 256 ||
    /\s/.test(config.applicationKey)
  )
    throw new Error('Invalid B2 media configuration');
  return { endpoint, region: region || 'us-east-005' };
}

// The only supported operations address immutable media inside one fixed bucket/prefix.
// Never forward browser headers, cookies, credentials, or arbitrary paths upstream.
export function b2Client(
  config: B2Config,
  { localTest = false, fetcher = fetch } = {},
) {
  const { endpoint, region } = validateB2Config(config, localTest);
  const client = new AwsClient({
    accessKeyId: config.keyId,
    secretAccessKey: config.applicationKey,
    service: 's3',
    region,
    retries: 0,
  });
  return {
    async request(
      method: 'GET' | 'HEAD' | 'PUT',
      filename: string,
      {
        body,
        contentType,
        range,
      }: {
        body?: Uint8Array;
        contentType?: string;
        range?: { offset: number; length: number };
      } = {},
    ) {
      if (
        !['GET', 'HEAD', 'PUT'].includes(method) ||
        !mediaFilename.test(filename)
      )
        throw new Error('Unsupported B2 media operation');
      const url = new URL(`${config.bucket}/assets/${filename}`, endpoint);
      const headers = new Headers();
      if (contentType) headers.set('Content-Type', contentType);
      if (range)
        headers.set(
          'Range',
          `bytes=${range.offset}-${range.offset + range.length - 1}`,
        );
      const signed = await client.sign(url, {
        method,
        headers,
        body: body as BodyInit | undefined,
        // Workers supports manual/follow, not Node's redirect:error. Never
        // follow a redirect carrying signed authorization to another host.
        redirect: 'manual',
        // A cache miss may rewrite HEAD to GET, invalidating its method-bound
        // SigV4 signature. Cache approved public bytes in the Worker instead.
        cache: 'no-store',
        signal: AbortSignal.timeout(120_000),
      });
      const response = await fetcher(signed);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('B2 media redirects are not allowed');
      }
      return response;
    },
  };
}
