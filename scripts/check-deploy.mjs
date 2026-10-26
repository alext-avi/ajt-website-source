import fs from 'node:fs';
import { loadEnv } from 'vite';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const wranglerConfig = fs.readFileSync('wrangler.jsonc', 'utf8');
if (wranglerConfig.includes('00000000-0000-0000-0000-000000000000')) {
  console.error(
    'Create and authorize the D1 content database before deploying. The database ID is still a local placeholder.',
  );
  process.exit(1);
}
let url;
try {
  url = new URL(env.SITE_URL);
} catch {
  /* handled below */
}
if (
  !url ||
  url.protocol !== 'https:' ||
  /^(localhost|127\.|.*\.test$|.*\.example$|example\.com$)/.test(
    url.hostname,
  ) ||
  url.pathname !== '/' ||
  url.search ||
  url.hash
) {
  console.error(
    'Deployment needs SITE_URL set to your actual HTTPS origin in .env or the build environment.',
  );
  process.exit(1);
}
const home = fs.readFileSync('dist/index.html', 'utf8');
if (
  !home.includes(`href="${url.origin}/"`) ||
  home.includes('content="noindex, nofollow"')
) {
  console.error(
    'The production build does not match SITE_URL. Rebuild with the correct environment before deploying.',
  );
  process.exit(1);
}
console.log(`Deployment configuration verified for ${url.origin}`);
