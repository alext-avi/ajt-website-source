import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildMediaManifest } from './lib/media-manifest.mjs';
const state = path.resolve('.wrangler/review-integration');
await fs.rm(state, { recursive: true, force: true });
await fs.mkdir(state, { recursive: true });
const mediaSite = path.join(state, 'site');
await fs.mkdir(mediaSite);
await fs.writeFile(
  path.join(mediaSite, 'index.html'),
  '<h1>Local media integration server</h1>',
);
await buildMediaManifest(mediaSite);
const mediaConfig = path.join(state, 'wrangler.json');
await fs.writeFile(
  mediaConfig,
  JSON.stringify({
    name: 'ajt-media-integration',
    compatibility_date: '2026-10-24',
    main: path.resolve('worker/index.ts'),
    r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: 'ajt-website-media' }],
    assets: {
      directory: mediaSite,
      binding: 'ASSETS',
      run_worker_first: true,
      not_found_handling: '404-page',
    },
  }),
);
const r2State = path.join(state, 'r2');
const media = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--config',
    mediaConfig,
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8796',
    '--persist-to',
    r2State,
    '--log-level',
    'warn',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: '',
      WRANGLER_SEND_METRICS: 'false',
    },
  },
);
const stopMedia = () => media.kill('SIGTERM');
process.on('exit', stopMedia);
const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://127.0.0.1:8796/', {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Wait for the real local Worker. */
  }
  if (media.exitCode !== null) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error('The isolated media Worker did not start');
const child = spawn(
  process.execPath,
  [
    'node_modules/astro/bin/astro.mjs',
    'dev',
    '--ignore-lock',
    '--host',
    '127.0.0.1',
    '--port',
    '4331',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      AJT_REVIEW_ENABLED: '1',
      AJT_REVIEW_TARGET: 'local',
      AJT_REVIEW_DATABASE: path.join(state, 'content.sqlite'),
      AJT_REVIEW_DIR: path.join(state, 'tickets'),
      AJT_MEDIA_DIR: path.join(state, 'media'),
      AJT_REVIEW_R2_LOCAL_STATE: r2State,
      ASTRO_TELEMETRY_DISABLED: '1',
    },
  },
);
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
  stopMedia();
});
process.on('SIGINT', () => {
  child.kill('SIGINT');
  stopMedia();
});
child.on('exit', (code) => process.exit(code || 0));
