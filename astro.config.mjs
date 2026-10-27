import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { satteri } from '@astrojs/markdown-satteri';

const env = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
const site = process.env.SITE_URL || env.SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    mdx(),
    react(),
    sitemap(),
    {
      name: 'development-only-keystatic',
      hooks: {
        'astro:config:setup': async (options) => {
          // The editor and its API are never registered during production builds.
          if (options.command === 'dev') {
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
            }
          }
        },
      },
    },
  ],
  vite: { plugins: [tailwindcss()], server: { strictPort: true } },
  markdown: {
    // Archive text must retain the author's original punctuation.
    processor: satteri({ features: { smartPunctuation: false } }),
    shikiConfig: { theme: 'github-dark', wrap: false },
  },
  devToolbar: { enabled: false },
  server: { host: '127.0.0.1' },
});
