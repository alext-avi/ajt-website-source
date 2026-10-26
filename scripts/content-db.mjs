import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import {
  readPublishedFiles,
  readEntry,
  writeEntrySQL,
  mediaSQL,
  snapshotFromRows,
} from './lib/d1-content.mjs';

const root = new URL('../', import.meta.url);
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    local: { type: 'boolean' },
    remote: { type: 'boolean' },
    collection: { type: 'string' },
    slug: { type: 'string' },
    revision: { type: 'string' },
  },
});
const command = positionals[0];
if (
  !['seed', 'pull', 'push'].includes(command) ||
  values.local === values.remote
) {
  throw new Error(
    'Use seed|pull|push and exactly one of --local or --remote. Push also requires --collection, --slug, and --revision (0 for new).',
  );
}
await fs.mkdir(new URL('.wrangler/', root), { recursive: true });

function executeSQL(sql) {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)),
      'd1',
      'execute',
      'CONTENT_DB',
      values.remote ? '--remote' : '--local',
      '--json',
      '--command',
      sql,
    ],
    {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
      maxBuffer: 10_000_000,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || 'D1 query failed');
  const response = JSON.parse(result.stdout);
  if (response.some((item) => !item.success))
    throw new Error('D1 reported an unsuccessful query');
  return response.flatMap((item) => item.results ?? []);
}

async function executeFile(sql) {
  const path = new URL('.wrangler/content-import.sql', root);
  await fs.writeFile(path, sql);
  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)),
        'd1',
        'execute',
        'CONTENT_DB',
        values.remote ? '--remote' : '--local',
        '--yes',
        '--json',
        '--file',
        fileURLToPath(path),
      ],
      {
        cwd: fileURLToPath(root),
        encoding: 'utf8',
        maxBuffer: 10_000_000,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(result.stderr || result.stdout || 'D1 import failed');
  } finally {
    await fs.rm(path, { force: true });
  }
}

if (command === 'seed') {
  const entries = await readPublishedFiles(root);
  await executeFile(
    entries
      .map((entry) => `${writeEntrySQL(entry)}\n${mediaSQL(entry)}`)
      .join('\n'),
  );
  console.log(
    `Seeded ${entries.length} approved content records; existing records were preserved.`,
  );
} else if (command === 'push') {
  if (values.revision === undefined || !/^\d+$/.test(values.revision))
    throw new Error(
      'Push requires the current --revision; use 0 to insert a new record',
    );
  const entry = await readEntry(root, values.collection, values.slug);
  const changes = executeSQL(
    `${writeEntrySQL(entry, Number(values.revision))}\nSELECT changes() AS changed;`,
  );
  if (changes.at(-1)?.changed !== 1)
    throw new Error(
      'Revision conflict or record missing. Inspect D1 and retry with the current revision.',
    );
  const media = mediaSQL(entry);
  if (media) executeSQL(media);
  console.log(
    `Saved ${entry.collection}/${entry.slug}, revision ${Number(values.revision) + 1}. Run db:pull and review the build before deployment.`,
  );
} else {
  const rows = executeSQL(
    'SELECT collection,slug,metadata_json,body_markdown,revision FROM content_items WHERE is_draft=0 ORDER BY collection,slug;',
  );
  const snapshot = snapshotFromRows(rows);
  const target = new URL('data/content.json', root);
  await fs.mkdir(new URL('data/', root), { recursive: true });
  await fs.writeFile(
    new URL('data/content.next.json', root),
    JSON.stringify(snapshot, null, 2) + '\n',
  );
  await fs.rename(new URL('data/content.next.json', root), target);
  console.log(
    `Exported ${snapshot.entries.length} published D1 records to data/content.json.`,
  );
}
