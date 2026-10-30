import { runtimeEnabled, publishedRows } from 'virtual:ajt-runtime-db';
import { contentSchemas } from './content-schemas';
import { getCollection, type CollectionEntry } from 'astro:content';

export const isPreview = import.meta.env.DEV && !runtimeEnabled;

async function entries<C extends 'posts' | 'projects' | 'talks'>(
  collection: C,
): Promise<CollectionEntry<C>[]> {
  if (!runtimeEnabled) return getCollection(collection);
  return (await publishedRows(collection)).map(
    (row: any) =>
      ({
        id: row.slug,
        collection,
        body: row.body_markdown,
        data: contentSchemas[collection].parse(JSON.parse(row.metadata_json)),
      }) as CollectionEntry<C>,
  );
}

export function isVisible(data: { draft: boolean; date?: Date }) {
  return isPreview || (!data.draft && (!data.date || data.date <= new Date()));
}

export async function getPosts() {
  return (await entries('posts'))
    .filter(({ data }) => isVisible(data))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
export async function getProjects() {
  return (await entries('projects'))
    .filter(({ data }) => isVisible(data))
    .sort((a, b) => a.data.order - b.data.order);
}
export async function getTalks() {
  // Talk dates describe the event, not a scheduled publication date.
  return (await entries('talks'))
    .filter(({ data }) => isPreview || !data.draft)
    .sort(
      (a, b) => (b.data.date?.getTime() ?? 0) - (a.data.date?.getTime() ?? 0),
    );
}
export function readingTime(body: string | undefined) {
  const words = (body ?? '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}
export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
export function tagSlug(tag: string) {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
export function relatedPosts(
  post: CollectionEntry<'posts'>,
  all: CollectionEntry<'posts'>[],
) {
  return all
    .filter((p) => p.id !== post.id)
    .map((p) => ({
      post: p,
      score: p.data.tags.filter((t) => post.data.tags.includes(t)).length,
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((p) => p.post);
}
