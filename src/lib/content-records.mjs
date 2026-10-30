import { contentSchemas } from './content-schemas.ts';

export const collections = Object.keys(contentSchemas);
export const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function validateEntry(entry) {
  if (
    !collections.includes(entry.collection) ||
    !/^[a-z0-9-]{1,160}$/.test(entry.slug)
  ) {
    throw new Error('Invalid content collection or slug');
  }
  if (
    typeof entry.body !== 'string' ||
    Buffer.byteLength(entry.body) > 1_000_000
  ) {
    throw new Error(`Invalid or oversized body: ${entry.slug}`);
  }
  const data = JSON.parse(
    JSON.stringify(contentSchemas[entry.collection].parse(entry.data)),
  );
  return {
    collection: entry.collection,
    slug: entry.slug,
    data,
    body: entry.body,
    revision: entry.revision ?? 1,
  };
}
