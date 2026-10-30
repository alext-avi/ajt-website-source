import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerAuthoringApp } from './authoring-app-server.mjs';
import { createReview, ensureReviewServer } from './reviews.mjs';
import { resolveAsset, uploadMediaFile, listMedia } from './media.mjs';
import { r2MediaStorage } from './r2-media.mjs';
import { b2MediaStorage } from './b2-media.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const execFileAsync = promisify(execFile);
export async function createStore({
  remote = false,
  database,
  localR2,
  localB2,
} = {}) {
  if ((remote && (localR2 || localB2)) || (localR2 && localB2))
    throw new Error(
      'Local media backends cannot be combined with remote D1 or each other',
    );
  if (localR2) localR2 = path.resolve(localR2);
  if (localB2) localB2 = path.resolve(localB2);
  if (remote) {
    return {
      identity: 'remote:CONTENT_DB',
      async resolveAsset(url) {
        return resolveAsset(url, this);
      },
      media:
        process.env.AJT_MEDIA_PROVIDER === 'r2'
          ? r2MediaStorage()
          : b2MediaStorage(),
      async transaction(statements) {
        // Wrangler's remote file import rolls the entire file back on failure.
        // Keep this legacy human-review adapter atomic without reading tokens
        // out of Wrangler's protected credential store.
        await fs.mkdir(path.join(root, '.wrangler'), { recursive: true });
        const folder = await fs.mkdtemp(
          path.join(root, '.wrangler/review-transaction-'),
        );
        await fs.chmod(folder, 0o700);
        const file = path.join(folder, 'approval.sql');
        try {
          await fs.writeFile(file, statements.join('\n'), {
            mode: 0o600,
            flag: 'wx',
          });
          await execFileAsync(
            process.execPath,
            [
              path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
              'd1',
              'execute',
              'CONTENT_DB',
              '--config',
              path.join(root, 'wrangler.jsonc'),
              '--remote',
              '--json',
              '--yes',
              '--file',
              file,
            ],
            {
              cwd: root,
              timeout: 45_000,
              maxBuffer: 10_000_000,
              env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
            },
          );
        } catch {
          throw new Error(
            'Atomic D1 approval failed. Read the current revision before retrying; credential diagnostics were not logged.',
          );
        } finally {
          await fs.rm(folder, { recursive: true, force: true });
        }
      },
      async query(sql) {
        if (Buffer.byteLength(sql) > 100_000)
          throw new Error('Content exceeds the database command limit');
        try {
          const { stdout } = await execFileAsync(
            process.execPath,
            [
              path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
              'd1',
              'execute',
              'CONTENT_DB',
              '--config',
              path.join(root, 'wrangler.jsonc'),
              '--remote',
              '--json',
              '--command',
              sql,
            ],
            {
              cwd: root,
              timeout: 45_000,
              maxBuffer: 10_000_000,
              env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
            },
          );
          const results = JSON.parse(stdout);
          if (
            !Array.isArray(results) ||
            results.some((result) => result.success !== true)
          )
            throw new Error();
          return results.flatMap((result) => result.results || []);
        } catch {
          // Do not return credential-store diagnostics or command arguments to callers.
          throw new Error(
            'D1 operation failed. Check local Cloudflare authorization and retry; do not retry a write before reading the current revision.',
          );
        }
      },
      close() {},
    };
  }
  if (!database)
    throw new Error('Local mode requires an explicit --database path');
  await fs.mkdir(path.dirname(path.resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  await fs.chmod(database, 0o600);
  db.exec('PRAGMA busy_timeout=5000;');
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='content_items'",
      )
      .get()
  ) {
    db.exec(
      await fs.readFile(path.join(root, 'migrations/0001_content.sql'), 'utf8'),
    );
  }
  db.exec(
    await fs.readFile(
      path.join(root, 'migrations/0002_media_budget.sql'),
      'utf8',
    ),
  );
  db.exec(
    await fs.readFile(
      path.join(root, 'migrations/0003_linkedin_sources.sql'),
      'utf8',
    ),
  );
  db.exec(
    await fs.readFile(
      path.join(root, 'migrations/0004_remote_authoring.sql'),
      'utf8',
    ),
  );
  return {
    identity: 'sqlite:' + path.resolve(database),
    async resolveAsset(url) {
      return resolveAsset(url, this);
    },
    media: localR2
      ? r2MediaStorage({ localState: localR2 })
      : localB2
        ? b2MediaStorage({ configPath: localB2, localTest: true })
        : undefined,
    localR2,
    localB2,
    async transaction(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) db.prepare(statement).all();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async query(sql) {
      return db.prepare(sql).all();
    },
    close() {
      db.close();
    },
  };
}

export {
  draftCollection,
  getPost,
  updateDraft,
  validateDraft,
} from './content-service.mjs';
import { createContentService } from './content-service.mjs';
export function createContentServer(store) {
  store.resolveAsset = (url) => resolveAsset(url, store);
  return createContentService(store, {
    registerAuthoringApp,
    uploadMediaFile,
    listMedia,
    createReview,
    ensureReviewServer,
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      remote: { type: 'boolean' },
      local: { type: 'boolean' },
      database: { type: 'string' },
      'local-r2': { type: 'string' },
      'local-b2': { type: 'string' },
    },
  });
  if (
    !!values.remote === !!values.local ||
    (values.remote &&
      (values.database || values['local-r2'] || values['local-b2']))
  )
    throw new Error('Choose --remote or --local --database <path>');
  const store = await createStore({
    remote: values.remote,
    database: values.database,
    localR2: values['local-r2'],
    localB2: values['local-b2'],
  });
  const handle = serveStdio(() => createContentServer(store), {
    onerror: () => console.error('Content MCP protocol error'),
  });
  const close = async () => {
    await handle.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
