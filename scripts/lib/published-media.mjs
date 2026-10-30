import { postMedia } from '../../mcp/content-render.mjs';
import { sqlText } from '../../src/lib/content-records.mjs';

// Register only the exact saved, approved revision. A concurrent change or a
// working draft cannot grant public access to its own media.
export async function publishedMediaStatements(entry, revision) {
  if (entry.data.draft || entry.data.example) return [];
  if (
    revision !== undefined &&
    (!Number.isSafeInteger(revision) || revision < 1)
  )
    throw new Error('Published revision must be a positive integer');
  const urls = await postMedia({ metadata: entry.data, body: entry.body });
  return urls
    .filter((url) => url.startsWith('/media/'))
    .map(
      (
        url,
      ) => `INSERT OR IGNORE INTO published_media(collection,slug,revision,url)
SELECT collection,slug,revision,${sqlText(url)} FROM published_content
WHERE collection=${sqlText(entry.collection)} AND slug=${sqlText(entry.slug)}
AND metadata_json=${sqlText(JSON.stringify(entry.data))} AND body_markdown=${sqlText(entry.body)}
${revision === undefined ? '' : `AND revision=${Number(revision)}`};`,
    );
}

export async function publishedMediaSQL(entry, revision) {
  return (await publishedMediaStatements(entry, revision)).join('\n');
}
