import { readFileSync } from 'node:fs';

type Entry = {
  collection: string;
  slug: string;
  data: {
    title: string;
    date?: string;
    video?: string;
    slides?: string;
    event?: string;
    linkedinVideoEmbed?: string;
  };
};
// The same validated snapshot used for this build, never content injected into the server.
const snapshot = JSON.parse(
  readFileSync(new URL('../data/content.json', import.meta.url), 'utf8'),
);
export const publishedPosts: Entry[] = snapshot.entries.filter(
  (entry: Entry) => entry.collection === 'posts',
);
export const publishedTalks: Entry[] = snapshot.entries.filter(
  (entry: Entry) => entry.collection === 'talks',
);
