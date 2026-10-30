import type { APIContext } from 'astro';
import { getPosts, getProjects, getTalks, tagSlug } from '../src/lib/content';
import { escapeHtml } from '../mcp/content-render.mjs';
export async function GET({ site }: APIContext) {
  const [posts, projects, talks] = await Promise.all([
    getPosts(),
    getProjects(),
    getTalks(),
  ]);
  const paths = [
    '/',
    '/about/',
    '/contact/',
    '/privacy/',
    '/writing/',
    '/projects/',
    '/speaking/',
    ...posts.map((p) => `/writing/${p.id}/`),
    ...projects.map((p) => `/projects/${p.id}/`),
    ...talks.map((p) => `/speaking/${p.id}/`),
    ...new Set(
      posts.flatMap((p) => p.data.tags).map((tag) => `/tags/${tagSlug(tag)}/`),
    ),
  ];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeHtml(new URL(path, site).href)}</loc></url>`).join('')}</urlset>`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
