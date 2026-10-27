import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mediaFilename } from '../src/lib/media.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const execFileAsync = promisify(execFile);
export const mediaBucketName = 'ajt-website-media';

export function r2MediaStorage({ localState } = {}) {
  return {
    provider: 'r2',
    // Local test mode can never fall back to remote R2.
    mode: localState ? 'local-r2' : 'remote-r2',
    async command(operation, filename, file, contentType) {
      if (!mediaFilename.test(filename))
        throw new Error('Invalid media object name');
      const args = [
        path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
        'r2',
        'object',
        operation,
        `${mediaBucketName}/assets/${filename}`,
        '--config',
        path.join(root, 'wrangler.jsonc'),
        '--file',
        file,
        ...(localState
          ? ['--local', '--persist-to', path.resolve(localState)]
          : ['--remote']),
        ...(operation === 'put'
          ? ['--content-type', contentType, '--storage-class', 'Standard']
          : []),
      ];
      try {
        await execFileAsync(process.execPath, args, {
          cwd: root,
          timeout: 120_000,
          maxBuffer: 2_000_000,
          env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
        });
      } catch (error) {
        // Keep account diagnostics, authorization tokens, and file paths out of MCP/UI errors.
        if (`${error.stdout || ''}${error.stderr || ''}`.includes('10042'))
          throw new Error(
            'Enable R2 in the Cloudflare dashboard before uploading media. No draft was published.',
          );
        throw new Error(
          'R2 operation failed. Check Cloudflare R2 setup and authorization, then retry. No draft was published.',
        );
      }
    },
  };
}

export function verifyMediaBytes(filename, bytes) {
  if (
    !mediaFilename.test(filename) ||
    createHash('sha256').update(bytes).digest('hex') !== filename.split('.')[0]
  )
    throw new Error(
      'Media integrity check failed; upload the original file again',
    );
}
