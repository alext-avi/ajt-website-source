import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { satteri } from '@astrojs/markdown-satteri';
import { buildMediaManifest } from './scripts/lib/media-manifest.mjs';
import { fileURLToPath } from 'node:url';

const runtime = process.env.AJT_RUNTIME === '1';
const env = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
const site = process.env.SITE_URL || env.SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site,
  output: runtime ? 'server' : 'static',
  ...(runtime ? { session: false } : {}),
  ...(runtime
    ? {
        adapter: cloudflare({
          configPath: './wrangler.runtime.jsonc',
          imageService: 'compile',
        }),
        outDir: './dist-runtime',
      }
    : {}),
  trailingSlash: 'always',
  integrations: [
    mdx(),
    react(),
    ...(!runtime ? [sitemap()] : []),
    ...(runtime
      ? [
          {
            name: 'runtime-sitemap',
            hooks: {
              'astro:config:setup': ({ injectRoute }) => {
                injectRoute({
                  pattern: '/sitemap-index.xml',
                  entrypoint: './worker/sitemap-index.ts',
                });
                injectRoute({
                  pattern: '/sitemap-0.xml',
                  entrypoint: './worker/sitemap.ts',
                });
              },
            },
          },
        ]
      : []),
    {
      name: 'published-media-manifest',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          if (!runtime) await buildMediaManifest(fileURLToPath(dir));
        },
      },
    },
    {
      name: 'development-only-keystatic',
      hooks: {
        'astro:config:setup': async (options) => {
          // The editor and its API are never registered during production builds.
          if (options.command === 'dev' && !runtime) {
            // Keystatic API requests intentionally omit trailing slashes.
            options.updateConfig({ trailingSlash: 'ignore' });
            await keystatic().hooks['astro:config:setup'](options);
            if (process.env.AJT_REVIEW_ENABLED === '1') {
              options.injectRoute({
                pattern: '/review-health',
                entrypoint: './mcp/review-health.ts',
              });
              options.injectRoute({
                pattern: '/review',
                entrypoint: './mcp/review-index.astro',
              });
              options.injectRoute({
                pattern: '/review/[ticket]',
                entrypoint: './mcp/review-page.astro',
              });
              options.injectRoute({
                pattern: '/review/[ticket]/preview',
                entrypoint: './mcp/review-preview.astro',
              });
              options.injectRoute({
                pattern: '/api/review/[ticket]',
                entrypoint: './mcp/review-api.ts',
              });
              options.injectRoute({
                pattern: '/uploads/[filename]',
                entrypoint: './mcp/media-api.ts',
              });
              options.injectRoute({
                pattern: '/videos/[filename]',
                entrypoint: './mcp/media-api.ts',
              });
              options.injectRoute({
                pattern: '/media/[filename]',
                entrypoint: './mcp/media-api.ts',
              });
            }
          }
        },
      },
    },
  ],
  vite: {
    define: { 'import.meta.env.AJT_RUNTIME': JSON.stringify(runtime) },
    plugins: [
      tailwindcss(),
      {
        name: 'ajt-runtime-db',
        resolveId(id) {
          if (id === 'virtual:ajt-runtime-db') return '\0ajt-runtime-db';
        },
        load(id) {
          if (id === '\0ajt-runtime-db')
            return runtime
              ? `import {env} from 'cloudflare:workers'; export const runtimeEnabled=true; export async function publishedRows(collection) { if(!env.CONTENT_DB) throw new Error('Runtime content database is not configured'); const result=await env.CONTENT_DB.prepare('SELECT collection,slug,metadata_json,body_markdown,revision FROM published_content WHERE collection=?').bind(collection).all(); return result.results; }`
              : `export const runtimeEnabled=false; export async function publishedRows() { return []; }`;
        },
      },
    ],
    server: { strictPort: true },
  },
  markdown: {
    // Archive text must retain the author's original punctuation.
    processor: satteri({ features: { smartPunctuation: false } }),
    shikiConfig: { theme: 'github-dark', wrap: false },
  },
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
});
