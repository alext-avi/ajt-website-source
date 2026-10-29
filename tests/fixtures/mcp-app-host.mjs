import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Test host only: real SDK bridge -> real stdio MCP -> isolated SQLite/local R2.
const state = path.resolve('.wrangler/review-integration');
const client = new Client({
  name: 'ajt-app-integration-host',
  version: '1.0.0',
});
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [
      'mcp/content-server.mjs',
      '--local',
      '--database',
      path.join(state, 'content.sqlite'),
      '--local-r2',
      path.join(state, 'r2'),
    ],
    env: {
      ...process.env,
      AJT_REVIEW_ORIGIN: 'http://127.0.0.1:4331',
      AJT_REVIEW_DIR: path.join(state, 'tickets'),
      AJT_MEDIA_DIR: path.join(state, 'media'),
    },
    stderr: 'pipe',
  }),
);
const bundle = await build({
  entryPoints: ['tests/fixtures/mcp-app-host-client.mjs'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  minify: true,
  target: 'es2022',
});
const resource = await client.readResource({
  uri: 'ui://ajt-content/authoring.html',
});
const uiCsp = resource.contents[0]._meta.ui.csp;
if (
  uiCsp.connectDomains.length ||
  uiCsp.resourceDomains.length ||
  !uiCsp.frameDomains.includes('blob:')
)
  throw new Error('Unexpected authoring resource network access');
const appHtml = resource.contents[0].text.replace(
  '<head>',
  `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; frame-src ${uiCsp.frameDomains.join(' ')}; connect-src 'none'">`,
);
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (request.url === '/health') {
      response.end('ready');
      return;
    }
    if (request.url === '/host.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].text);
      return;
    }
    if (request.url === '/app') {
      response.setHeader('Content-Type', 'text/html');
      response.end(appHtml);
      return;
    }
    if (request.url === '/tool' && request.method === 'POST') {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 500_000) throw new Error('Test request too large');
        chunks.push(chunk);
      }
      const params = JSON.parse(Buffer.concat(chunks));
      const result = await client.callTool(params);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(result));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>MCP App integration host</title><iframe title="Website authoring app" sandbox="allow-scripts allow-same-origin" style="width:100%;height:1500px;border:0"></iframe><script type="module" src="/host.js"></script>',
    );
  } catch (error) {
    response.statusCode = 400;
    response.end(
      JSON.stringify({
        isError: true,
        content: [{ type: 'text', text: error.message }],
      }),
    );
  }
});
server.listen(4334, '127.0.0.1');
async function close() {
  await client.close();
  server.close();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
