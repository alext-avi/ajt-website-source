import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildMediaManifest } from './lib/media-manifest.mjs';
import { startB2TestServer } from '../tests/fixtures/b2-server.mjs';
const state = path.resolve('.wrangler/review-integration');
await fs.rm(state, { recursive: true, force: true });
await fs.mkdir(state, { recursive: true });
const b2State = path.join(state, 'b2');
await fs.mkdir(b2State);
const b2 = await startB2TestServer({
  directory: path.join(b2State, 'objects'),
  port: 8795,
});
const b2Config = path.join(b2State, 'b2.json');
await fs.writeFile(b2Config, JSON.stringify(b2.config), { mode: 0o600 });
const b2Site = path.join(b2State, 'site');
await fs.mkdir(b2Site);
await fs.writeFile(
  path.join(b2Site, 'index.html'),
  '<h1>Isolated B2 media integration server</h1>',
);
await buildMediaManifest(b2Site);
const b2WorkerConfig = path.join(b2State, 'wrangler.json');
await fs.writeFile(
  b2WorkerConfig,
  JSON.stringify({
    name: 'ajt-b2-integration',
    compatibility_date: '2026-10-24',
    main: path.resolve('worker/index.ts'),
    vars: {
      DEPLOYMENT_ENVIRONMENT: 'local-test',
      MEDIA_PROVIDER: 'b2',
      B2_MEDIA_ENDPOINT: b2.config.endpoint,
      B2_MEDIA_BUCKET: b2.config.bucket,
      B2_MEDIA_KEY_ID: b2.config.keyId,
      B2_MEDIA_APPLICATION_KEY: b2.config.applicationKey,
    },
    assets: {
      directory: b2Site,
      binding: 'ASSETS',
      run_worker_first: true,
      not_found_handling: '404-page',
    },
  }),
);
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
    '--inspector-port',
    '9236',
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
const b2Worker = spawn(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--config',
    b2WorkerConfig,
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8797',
    '--inspector-port',
    '9237',
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
const stopMedia = () => {
  media.kill('SIGTERM');
  b2Worker.kill('SIGTERM');
  void b2.close();
};
process.on('exit', stopMedia);
const deadline = Date.now() + 60_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    const responses = await Promise.all(
      [8796, 8797].map((port) =>
        fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(1_000),
        }),
      ),
    );
    if (responses.every((response) => response.ok)) {
      ready = true;
      break;
    }
  } catch {
    /* Wait for the real local Worker. */
  }
  if (media.exitCode !== null || b2Worker.exitCode !== null) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error('The isolated media Worker did not start');
const b2Desk = spawn(
  process.execPath,
  [
    'node_modules/astro/bin/astro.mjs',
    'dev',
    '--ignore-lock',
    '--host',
    '127.0.0.1',
    '--port',
    '4332',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      AJT_REVIEW_ENABLED: '1',
      AJT_REVIEW_TARGET: 'local',
      AJT_REVIEW_DATABASE: path.join(b2State, 'content.sqlite'),
      AJT_REVIEW_DIR: path.join(b2State, 'tickets'),
      AJT_MEDIA_DIR: path.join(b2State, 'media'),
      AJT_REVIEW_B2_LOCAL_CONFIG: b2Config,
      AJT_REVIEW_R2_LOCAL_STATE: '',
      ASTRO_TELEMETRY_DISABLED: '1',
    },
  },
);
// Astro's generated .astro files are shared by this checkout. Finish the first
// server's initialization before starting the second to avoid competing renames.
let deskReady = false;
const deskDeadline = Date.now() + 60_000;
while (Date.now() < deskDeadline && b2Desk.exitCode === null) {
  try {
    if (
      (
        await fetch('http://127.0.0.1:4332/review-health', {
          signal: AbortSignal.timeout(1_000),
        })
      ).ok
    ) {
      deskReady = true;
      break;
    }
  } catch {
    /* Wait for the isolated B2 desk. */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!deskReady) {
  b2Desk.kill('SIGTERM');
  throw new Error('The isolated B2 review desk did not start');
}
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
  b2Desk.kill('SIGTERM');
  stopMedia();
});
process.on('SIGINT', () => {
  child.kill('SIGINT');
  b2Desk.kill('SIGINT');
  stopMedia();
});
child.on('exit', (code) => {
  b2Desk.kill('SIGTERM');
  process.exit(code || 0);
});
