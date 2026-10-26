import type { APIContext } from 'astro';
export function GET({ site }: APIContext) {
  const configured =
    site?.protocol === 'https:' && site.hostname !== 'localhost';
  return new Response(
    configured
      ? `User-agent: *\nAllow: /\nDisallow: /keystatic\nDisallow: /api/keystatic\nSitemap: ${new URL('sitemap-index.xml', site)}\n`
      : 'User-agent: *\nDisallow: /\n',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
