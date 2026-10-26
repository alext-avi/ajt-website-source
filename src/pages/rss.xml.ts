import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { site } from '../lib/site';
export async function GET(context: APIContext) {
  // Never syndicate local drafts or scheduled posts, including in development.
  const posts = (await getCollection('posts'))
    .filter((p) => !p.data.draft && p.data.date <= new Date())
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
  return rss({
    title: `${site.name} | Writing`,
    description:
      'Practical notes on software, engineering leadership, and applied AI.',
    site: context.site!,
    items: posts.map((p) => ({
      title: `${p.data.example ? '[Example article] ' : ''}${p.data.title}`,
      description: p.data.summary,
      pubDate: p.data.date,
      link: `/writing/${p.id}/`,
      categories: [p.data.category, ...p.data.tags],
    })),
    customData: '<language>en-us</language>',
  });
}
