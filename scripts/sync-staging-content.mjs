import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createStore } from '../mcp/content-server.mjs';
import { validateEntry, writeEntrySQL, sqlText } from './lib/d1-content.mjs';
import { postMedia } from '../mcp/content-render.mjs';
if (process.env.GITHUB_ACTIONS === 'true')
  throw new Error(
    'Staging baseline synchronization is an owner operation; CI does not receive D1 write credentials',
  );
const store = await createStore({ remote: true });
const rows = await store.query(
  'SELECT collection,slug,metadata_json,body_markdown,revision FROM published_content',
);
if (!rows.length) throw new Error('The approved production baseline is empty');
const sql = [];
for (const row of rows) {
  const entry = validateEntry({
    collection: row.collection,
    slug: row.slug,
    data: JSON.parse(row.metadata_json),
    body: row.body_markdown,
  });
  if (entry.data.draft || entry.data.example)
    throw new Error('Refusing unapproved staging content');
  sql.push(writeEntrySQL(entry));
  for (const url of await postMedia({ metadata: entry.data, body: entry.body }))
    if (url.startsWith('/media/'))
      sql.push(
        `INSERT OR IGNORE INTO published_media(collection,slug,revision,url) SELECT collection,slug,revision,${sqlText(url)} FROM published_content WHERE collection=${sqlText(entry.collection)} AND slug=${sqlText(entry.slug)};`,
      );
}
await fs.mkdir('.wrangler', { recursive: true });
const file = '.wrangler/staging-approved.sql';
await fs.writeFile(file, sql.join('\n'), { mode: 0o600 });
try {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'CONTENT_DB',
      '--remote',
      '--config',
      'wrangler.runtime.jsonc',
      '--env',
      'staging',
      '--file',
      file,
      '--yes',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  if (result.status !== 0) throw new Error('Staging baseline import failed');
  console.log(
    `Copied ${rows.length} already-approved entries into the separate staging database. Existing staging records were preserved.`,
  );
} finally {
  await fs.rm(file, { force: true });
  store.close();
}
