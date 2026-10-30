import fs from 'node:fs/promises';
import { authoringHtml } from '../mcp/authoring-app-server.mjs';
await fs.mkdir('.wrangler/authoring-assets', { recursive: true });
await fs.writeFile(
  '.wrangler/authoring-assets/authoring.html',
  await authoringHtml(),
);
await fs.writeFile(
  '.wrangler/authoring-assets/preview.css',
  (await fs.readFile('src/styles/global.css', 'utf8')).replace(
    /@import[^;]+;/g,
    '',
  ),
);
console.log('Built the remote authoring App and preview styles.');
