import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const state = path.resolve('.wrangler/review-integration');
await fs.rm(state, { recursive: true, force: true });
await fs.mkdir(state, { recursive: true });
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
      ASTRO_TELEMETRY_DISABLED: '1',
    },
  },
);
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', (code) => process.exit(code || 0));
