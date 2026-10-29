import fs from 'node:fs/promises';
import { glob, type Loader } from 'astro/loaders';

/** Published content uses D1 snapshots; legacy post/talk file previews remain explicit. */
export function contentLoader(
  collection: 'posts' | 'projects' | 'talks',
): Loader {
  if (
    process.env.CONTENT_SOURCE === 'files' ||
    (import.meta.env.DEV &&
      process.env.CONTENT_SOURCE !== 'd1' &&
      collection !== 'projects')
  ) {
    return glob({
      pattern: '**/*.{md,mdx}',
      base: `./src/content/${collection}`,
    });
  }
  return {
    name: `d1-snapshot-${collection}`,
    async load({ store, parseData, renderMarkdown, generateDigest, logger }) {
      const snapshot = JSON.parse(
        await fs.readFile(
          new URL('../../data/content.json', import.meta.url),
          'utf8',
        ),
      );
      if (snapshot.version !== 1 || !Array.isArray(snapshot.entries)) {
        throw new Error(
          'Invalid D1 content snapshot. Run npm run db:pull -- --remote.',
        );
      }
      store.clear();
      for (const entry of snapshot.entries) {
        if (entry.collection !== collection) continue;
        if (entry.data.draft !== false || entry.data.example) {
          throw new Error(
            `Unpublished content in public snapshot: ${entry.slug}`,
          );
        }
        const data = await parseData({ id: entry.slug, data: entry.data });
        store.set({
          id: entry.slug,
          data,
          body: entry.body,
          rendered: await renderMarkdown(entry.body),
          digest: generateDigest(entry),
        });
      }
      logger.info(
        `Loaded ${store.values().length} published entries from D1 snapshot`,
      );
    },
  };
}
