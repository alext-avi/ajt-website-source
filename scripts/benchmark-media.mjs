import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mediaPath } from '../src/lib/media.ts';

const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    path: { type: 'string' },
    output: { type: 'string', default: 'artifacts/b2-media-trial.json' },
  },
});
const origin = new URL(values.origin);
const filename = mediaPath.exec(values.path || '')?.[1];
if (
  origin.protocol !== 'https:' ||
  origin.pathname !== '/' ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  !filename
)
  throw new Error(
    'Supply an HTTPS origin and a content-addressed /media/ path',
  );
const url = new URL(values.path, origin);
const samples = [];
for (let i = 0; i < 6; i++) {
  const start = performance.now();
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const headersAt = performance.now();
  if (!response.ok || response.status !== 200)
    throw new Error(`Media delivery failed (HTTP ${response.status})`);
  if (Number(response.headers.get('Content-Length')) > 100 * 1024 * 1024)
    throw new Error('Unexpectedly large media');
  const bytes = Buffer.from(await response.arrayBuffer());
  const finishedAt = performance.now();
  if (
    createHash('sha256').update(bytes).digest('hex') !== filename.split('.')[0]
  )
    throw new Error('Delivered media failed its SHA-256 check');
  samples.push({
    sample: i + 1,
    timeToHeadersMs: +(headersAt - start).toFixed(1),
    totalMs: +(finishedAt - start).toFixed(1),
    bytes: bytes.length,
    cache: response.headers.get('x-ajt-media-cache'),
    cloudflareRay: response.headers.get('cf-ray'),
    contentType: response.headers.get('content-type'),
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
const report = {
  version: 1,
  measuredAt: new Date().toISOString(),
  url: url.href,
  scope: 'Actual HTTP requests from this machine; no global latency claim.',
  samples,
};
await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
await fs.writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
console.table(samples);
console.log(`Verified bytes and saved delivery evidence to ${values.output}`);
