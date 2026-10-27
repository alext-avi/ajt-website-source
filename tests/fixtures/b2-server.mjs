// Isolated, disk-backed S3 test server. Never accepts real credentials or remote URLs.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mediaFilename } from '../../src/lib/media.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
export const testB2Credentials = {
  bucket: 'ajt-local-media',
  keyId: 'localkey',
  applicationKey: 'localtestsecret',
};

export async function startB2TestServer({ directory, port = 0 }) {
  await fs.mkdir(directory, { recursive: true });
  const stats = { reads: 0, writes: 0, signed: 0 };
  const state = { failWrites: false };
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) throw new Error('Too large');
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const url = new URL(request.url, 'http://' + request.headers.host);
      const auth =
        /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(
          request.headers.authorization || '',
        );
      if (!auth || auth[1] !== testB2Credentials.keyId) {
        response.writeHead(403).end();
        return;
      }
      const headers = auth[3]
        .split(';')
        .map(
          (name) =>
            `${name}:${String(request.headers[name] || '')
              .trim()
              .replace(/\s+/g, ' ')}\n`,
        )
        .join('');
      const canonical = [
        request.method,
        url.pathname,
        '',
        headers,
        auth[3],
        request.headers['x-amz-content-sha256'] || hash(body),
      ].join('\n');
      const [date, region, service, terminal] = auth[2].split('/');
      if (service !== 's3' || terminal !== 'aws4_request')
        throw new Error('Invalid signing scope');
      const signingKey = hmac(
        hmac(
          hmac(hmac('AWS4' + testB2Credentials.applicationKey, date), region),
          service,
        ),
        terminal,
      );
      const signature = createHmac('sha256', signingKey)
        .update(
          [
            'AWS4-HMAC-SHA256',
            request.headers['x-amz-date'],
            auth[2],
            hash(canonical),
          ].join('\n'),
        )
        .digest('hex');
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(auth[4]))) {
        response.writeHead(403).end();
        return;
      }
      stats.signed++;
      const prefix = '/' + testB2Credentials.bucket + '/assets/';
      const filename = url.pathname.slice(prefix.length);
      if (
        !url.pathname.startsWith(prefix) ||
        !mediaFilename.test(filename) ||
        url.search
      ) {
        response.writeHead(404).end();
        return;
      }
      const file = path.join(directory, filename);
      if (request.method === 'PUT') {
        if (state.failWrites) {
          response.writeHead(503).end();
          return;
        }
        stats.writes++;
        await fs.writeFile(file, body);
        response.writeHead(200).end();
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      stats.reads++;
      let bytes;
      try {
        bytes = await fs.readFile(file);
      } catch {
        response.writeHead(404).end();
        return;
      }
      const total = bytes.length;
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
      if (range) {
        const start = Number(range[1]),
          end = Number(range[2]);
        response.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        bytes = bytes.subarray(start, end + 1);
      }
      response.writeHead(range ? 206 : 200, { 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    stats,
    state,
    config: {
      ...testB2Credentials,
      endpoint: `http://127.0.0.1:${server.address().port}`,
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
