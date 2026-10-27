import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b2Client } from '../src/lib/b2.ts';
import { verifyMediaBytes } from './r2-media.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const b2ConfigPath = () =>
  path.resolve(
    process.env.AJT_B2_CONFIG ||
      path.join(root, '.wrangler/content-media/b2.json'),
  );

export function b2MediaStorage({
  configPath = b2ConfigPath(),
  localTest = false,
} = {}) {
  return {
    provider: 'b2',
    mode: localTest ? 'local-b2' : 'remote-b2',
    async command(operation, filename, file, contentType, { beforePut } = {}) {
      if (!['put', 'get'].includes(operation))
        throw new Error('Unsupported B2 media operation');
      try {
        const stat = await fs.stat(configPath);
        if (!stat.isFile() || stat.mode & 0o077)
          throw new Error('B2 credentials must be in an owner-only file');
        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
        const client = b2Client(config, { localTest });
        const body = operation === 'put' ? await fs.readFile(file) : undefined;
        if (body) verifyMediaBytes(filename, body);
        if (operation === 'put') {
          const existing = await client.request('HEAD', filename);
          if (existing.status === 200) {
            if (Number(existing.headers.get('Content-Length')) !== body.length)
              throw new Error(
                'Existing immutable media differs from this upload',
              );
            return; // Reuse existing immutable objects without creating another B2 version.
          }
          if (existing.status !== 404)
            throw new Error('B2 media lookup failed');
          if (!beforePut)
            throw new Error('A storage reservation is required before upload');
          await beforePut();
        }
        const response = await client.request(
          operation === 'put' ? 'PUT' : 'GET',
          filename,
          { body, contentType },
        );
        if (!response.ok || (operation === 'get' && response.status !== 200)) {
          await response.body?.cancel();
          throw new Error('B2 rejected the media request');
        }
        if (operation === 'put') {
          await response.body?.cancel();
          return;
        }
        // Bound the actual stream, including a misleading/missing Content-Length.
        const maximum = 100 * 1024 * 1024;
        if (Number(response.headers.get('Content-Length')) > maximum) {
          await response.body?.cancel();
          throw new Error('B2 media exceeds the upload limit');
        }
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > maximum)
              throw new Error('B2 media exceeds the upload limit');
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const bytes = Buffer.concat(chunks, length);
        verifyMediaBytes(filename, bytes);
        await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      } catch {
        // Never leak application keys, signed requests, account diagnostics, or local paths.
        throw new Error(
          'B2 operation failed. Check the private media configuration, permissions, and free-account caps, then retry. No draft was published.',
        );
      }
    },
  };
}
