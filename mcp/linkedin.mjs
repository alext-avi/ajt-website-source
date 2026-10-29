import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { sqlText } from '../scripts/lib/d1-content.mjs';

export const linkedinCaptureSchema = z
  .object({
    sourceUrl: z.url(),
    date: z.iso.date(),
    text: z.string().min(1).max(24_000),
    dateEvidence: z.string().min(10).max(1000),
  })
  .strict();

export function linkedinIdentity(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.linkedin.com' || url.username || url.password)
    throw new Error('Use an original https://www.linkedin.com post URL');
  const pathname = decodeURIComponent(url.pathname);
  const id =
    pathname.match(
      /^\/feed\/update\/urn:li:(?:share|ugcPost|activity):(\d{15,22})\/?$/,
    )?.[1] ||
    pathname.match(
      /^\/posts\/[^/]+-(?:activity|share|ugcPost)-(\d{15,22})(?:-[^/]*)?\/?$/,
    )?.[1];
  if (!id)
    throw new Error(
      'Use a permanent LinkedIn post URL with its post identifier',
    );
  url.search = '';
  url.hash = '';
  return { id, url: url.href };
}

// Escape Markdown syntax, keeping the captured plain text as the rendered body.
export const linkedinMarkdown = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
export const sourceHash = (capture) =>
  createHash('sha256')
    .update(JSON.stringify({ date: capture.date, text: capture.text }))
    .digest('hex');

export async function findLinkedinPost(store, sourceUrl) {
  const identity = linkedinIdentity(sourceUrl);
  const source = (
    await store.query(
      `SELECT * FROM linkedin_sources WHERE source_id=${sqlText(identity.id)};`,
    )
  )[0];
  if (source) return { identity, source, slug: source.slug };
  // Recognize the original archive too, without rewriting its text or metadata.
  const posts = await store.query(
    "SELECT slug,metadata_json,body_markdown FROM content_items WHERE collection='posts' AND json_extract(metadata_json,'$.linkedinUrl') IS NOT NULL;",
  );
  const match = posts.find((row) => {
    try {
      return (
        linkedinIdentity(JSON.parse(row.metadata_json).linkedinUrl).id ===
        identity.id
      );
    } catch {
      return false;
    }
  });
  return { identity, slug: match?.slug, existing: match };
}

export async function checkLinkedinCaptures(store, captures) {
  const result = [];
  const seen = new Set();
  for (const input of captures) {
    const capture = linkedinCaptureSchema.parse(input);
    const found = await findLinkedinPost(store, capture.sourceUrl);
    if (seen.has(found.identity.id))
      throw new Error('Duplicate post identifiers in this capture batch');
    seen.add(found.identity.id);
    const baseline = found.source;
    result.push({
      sourceUrl: found.identity.url,
      date: capture.date,
      slug: found.slug,
      state: baseline
        ? baseline.original_date === capture.date &&
          baseline.original_text === capture.text
          ? 'unchanged'
          : 'source-changed'
        : found.existing
          ? 'already-imported-legacy'
          : 'missing',
    });
  }
  return {
    posts: result,
    coverage:
      'Only the supplied posts were checked. This is not proof that the entire LinkedIn feed is synchronized.',
  };
}

export async function importLinkedinCapture(
  store,
  capture,
  metadata,
  validateDraft,
) {
  capture = linkedinCaptureSchema.parse(capture);
  const {
    identity,
    source,
    slug: existingSlug,
  } = await findLinkedinPost(store, capture.sourceUrl);
  if (existingSlug) {
    return {
      slug: existingSlug,
      state:
        source &&
        (source.original_text !== capture.text ||
          source.original_date !== capture.date)
          ? 'source-changed'
          : 'already-imported',
      publication:
        'Existing content was preserved. Nothing was overwritten or published.',
    };
  }
  const slug = 'linkedin-' + identity.id;
  const body = linkedinMarkdown(capture.text);
  const entry = await validateDraft(
    slug,
    { ...metadata, date: capture.date, linkedinUrl: identity.url },
    body,
    store,
  );
  // A single SQL statement claims the source and inserts the draft atomically.
  // The trigger creates the draft in the same transaction as its original capture.
  const values = [
    identity.id,
    identity.url,
    slug,
    capture.date,
    capture.text,
    capture.dateEvidence,
    JSON.stringify(entry.data),
    body,
  ].map(sqlText);
  const rows = await store.query(
    `INSERT INTO linkedin_sources(source_id,source_url,slug,original_date,original_text,date_evidence,initial_metadata_json,initial_body_markdown) VALUES (${values.join(',')}) ON CONFLICT(source_id) DO NOTHING RETURNING slug;`,
  );
  if (!rows.length)
    throw new Error(
      'Concurrent import or slug conflict; check the current post before retrying',
    );
  return {
    slug,
    revision: 1,
    state: 'draft-created',
    sourceUrl: identity.url,
    date: capture.date,
    sourceSha256: sourceHash(capture),
    publication: 'Imported as a draft. Alex must review and publish it.',
  };
}

export async function getLinkedinSource(store, slug) {
  const source = (
    await store.query(
      `SELECT source_url,original_date,original_text,date_evidence,captured_at FROM linkedin_sources WHERE slug=${sqlText(slug)};`,
    )
  )[0];
  if (!source) return undefined;
  return {
    sourceUrl: source.source_url,
    date: source.original_date,
    text: source.original_text,
    dateEvidence: source.date_evidence,
    capturedAt: source.captured_at,
  };
}
