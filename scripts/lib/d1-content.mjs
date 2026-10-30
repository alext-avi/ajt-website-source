import fs from 'node:fs/promises';
import { parse } from 'yaml';

export { collections, sqlText, validateEntry } from '../../src/lib/content-records.mjs';
import { collections, sqlText, validateEntry } from '../../src/lib/content-records.mjs';

export async function readEntry(root, collection, slug) {
  if (!collections.includes(collection) || !/^[a-z0-9-]{1,160}$/.test(slug)) {
    throw new Error('Invalid content collection or slug');
  }
  const source = await fs.readFile(
    new URL(`src/content/${collection}/${slug}.mdx`, root),
    'utf8',
  );
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${collection}/${slug}`);
  return validateEntry({
    collection,
    slug,
    data: parse(match[1]),
    body: match[2],
  });
}

export async function readPublishedFiles(root) {
  const entries = [];
  for (const collection of collections) {
    const files = (
      await fs.readdir(new URL(`src/content/${collection}/`, root))
    )
      .filter((file) => file.endsWith('.mdx'))
      .sort();
    for (const file of files) {
      const entry = await readEntry(root, collection, file.slice(0, -4));
      if (!entry.data.draft && !entry.data.example) entries.push(entry);
    }
  }
  return entries;
}

export function writeEntrySQL(entry, expectedRevision) {
  const { collection, slug, data, body } = validateEntry(entry);
  const values = [collection, slug, JSON.stringify(data), body].map(sqlText);
  if (expectedRevision === undefined) {
    // Initial imports are idempotent and never overwrite subsequent database edits.
    return `INSERT INTO content_items(collection,slug,metadata_json,body_markdown) VALUES (${values.join(',')}) ON CONFLICT(collection,slug) DO NOTHING;`;
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new Error('Revision must be a nonnegative integer');
  if (expectedRevision === 0) {
    return `INSERT INTO content_items(collection,slug,metadata_json,body_markdown,updated_by) VALUES (${values.join(',')},'local-editor') ON CONFLICT(collection,slug) DO NOTHING;`;
  }
  return `UPDATE content_items SET metadata_json=${values[2]},body_markdown=${values[3]},revision=revision+1,updated_by='local-editor',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE collection=${values[0]} AND slug=${values[1]} AND revision=${expectedRevision};`;
}

export function mediaSQL(entry) {
  const fields = {
    image: 'image',
    videoPoster: 'image',
    video: 'video',
    linkedinVideoEmbed: 'video',
    slides: 'slides',
  };
  return Object.entries(fields)
    .flatMap(([field, kind]) => {
      const url = entry.data[field];
      if (!url) return [];
      const metadata = {
        field,
        credit: entry.data.linkedinVideoCredit,
        sourceUrl: entry.data.linkedinVideoSource,
      };
      return [
        `INSERT INTO media_assets(url,kind,metadata_json) VALUES (${sqlText(url)},${sqlText(kind)},${sqlText(JSON.stringify(metadata))}) ON CONFLICT(url) DO NOTHING;`,
      ];
    })
    .join('\n');
}

export function snapshotFromRows(rows) {
  const entries = rows.map((row) =>
    validateEntry({
      collection: row.collection,
      slug: row.slug,
      data: JSON.parse(row.metadata_json),
      body: row.body_markdown,
      revision: row.revision,
    }),
  );
  if (!entries.length)
    throw new Error(
      'Refusing to replace the publication snapshot with an empty database',
    );
  if (entries.some((entry) => entry.data.draft || entry.data.example))
    throw new Error('Public snapshot cannot contain drafts or example content');
  if (
    new Set(entries.map((entry) => `${entry.collection}/${entry.slug}`))
      .size !== entries.length
  )
    throw new Error('Duplicate content IDs');
  return { version: 1, entries };
}
