import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { startB2TestServer } from '../tests/fixtures/b2-server.mjs';

const state = path.resolve('.wrangler/remote-integration');
await fs.rm(state, { recursive: true, force: true });
await fs.mkdir(state, { recursive: true });
const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: '',
  WRANGLER_LOG_PATH: path.join(state, 'wrangler.log'),
  WRANGLER_SEND_METRICS: 'false',
  ASTRO_TELEMETRY_DISABLED: '1',
};
function run(args) {
  const p = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (p.status !== 0) throw new Error('Local integration setup failed');
}
run(['scripts/build-authoring.mjs']);
env.AJT_RUNTIME = '1';
env.SITE_URL = 'http://127.0.0.1:8801';
env.PUBLIC_GA4_MEASUREMENT_ID = '';
run(['scripts/build-runtime.mjs']);
const b2 = await startB2TestServer({
  directory: path.join(state, 'objects'),
  port: 8802,
});
const db = {
  binding: 'CONTENT_DB',
  database_name: 'ajt-remote-integration',
  database_id: '11111111-1111-4111-8111-111111111111',
  migrations_dir: path.resolve('migrations'),
};
const authoring = {
  name: 'ajt-remote-integration',
  main: path.resolve('tests/fixtures/remote-worker.mjs'),
  compatibility_date: '2026-10-24',
  compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
  d1_databases: [db],
  kv_namespaces: [
    { binding: 'OAUTH_KV', id: '11111111111111111111111111111111' },
  ],
  assets: {
    directory: path.resolve('.wrangler/authoring-assets'),
    binding: 'APP_ASSETS',
    run_worker_first: true,
  },
  vars: {
    AUTHORING_ORIGIN: 'https://127.0.0.1:8800',
    SITE_URL: 'http://127.0.0.1:8801',
    OWNER_GITHUB_ID: '13840761',
    GITHUB_CLIENT_ID: 'fixture-client',
    GITHUB_CLIENT_SECRET: 'fixture-secret',
    DEPLOYMENT_ENVIRONMENT: 'local-test',
    B2_MEDIA_ENDPOINT: b2.config.endpoint,
    B2_MEDIA_BUCKET: b2.config.bucket,
    B2_AUTHORING_KEY_ID: b2.config.keyId,
    B2_AUTHORING_APPLICATION_KEY: b2.config.applicationKey,
  },
};
const authoringConfig = path.join(state, 'authoring.json');
const runtime = JSON.parse(
  await fs.readFile('dist-runtime/server/wrangler.json', 'utf8'),
);
runtime.main = path.resolve('dist-runtime/server/entry.mjs');
runtime.assets.directory = path.resolve('dist-runtime/client');
runtime.d1_databases = [db];
runtime.kv_namespaces = [];
runtime.vars = {
  MEDIA_PROVIDER: 'b2',
  DEPLOYMENT_ENVIRONMENT: 'local-test',
  B2_MEDIA_ENDPOINT: b2.config.endpoint,
  B2_MEDIA_BUCKET: b2.config.bucket,
  B2_MEDIA_KEY_ID: b2.config.keyId,
  B2_MEDIA_APPLICATION_KEY: b2.config.applicationKey,
};
const siteConfig = path.join(state, 'site.json');
authoring.services = [{ binding: 'PUBLIC_SITE', service: runtime.name }];
await fs.writeFile(authoringConfig, JSON.stringify(authoring));
await fs.writeFile(siteConfig, JSON.stringify(runtime));
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
run([
  wrangler,
  'd1',
  'migrations',
  'apply',
  'CONTENT_DB',
  '--local',
  '--config',
  authoringConfig,
  '--persist-to',
  state,
]);
const children = [];
// Test-only TLS exception is confined to this loopback harness process. The
// child environment was copied before this assignment and does not inherit it.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// Both Workers must live in one workerd process so a single D1 actor owns the
// SQLite database, matching the real platform instead of racing file handles.
const child = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--config',
    authoringConfig,
    '--config',
    siteConfig,
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8800',
    '--inspector-port',
    '9800',
    '--persist-to',
    state,
    '--log-level',
    'warn',
    '--local-protocol',
    'https',
  ],
  { env, stdio: 'inherit' },
);
children.push(child);
const siteServer = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value && !['host', 'connection'].includes(key))
        headers.set(key, String(value));
    headers.set('X-AJT-Test-Public-Site', '1');
    headers.set('Accept-Encoding', 'identity');
    const response = await fetch('https://127.0.0.1:8800' + req.url, {
      method: req.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    // Node fetch decodes compressed responses; do not forward the old wire
    // encoding or length with the decoded stream.
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');
    res.writeHead(response.status, Object.fromEntries(responseHeaders));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch {
    res.writeHead(503).end('Local runtime unavailable');
  }
});
await new Promise((resolve) => siteServer.listen(8801, '127.0.0.1', resolve));
for (const health of [
  'https://127.0.0.1:8800/health',
  'http://127.0.0.1:8801/.well-known/ajt-content',
]) {
  const deadline = Date.now() + 30_000;
  try {
    for (;;) {
      if (child.exitCode !== null)
        throw new Error('Local Worker exited during startup');
      try {
        if ((await fetch(health, { signal: AbortSignal.timeout(1500) })).ok)
          break;
      } catch {}
      if (Date.now() >= deadline)
        throw new Error('Local Worker readiness timed out');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (error) {
    for (const running of children) running.kill('SIGTERM');
    siteServer.close();
    await b2.close();
    throw error;
  }
}
const bundle = await build({
  entryPoints: ['tests/fixtures/mcp-app-host-client.mjs'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  minify: true,
});
let client;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4340');
    if (url.pathname === '/health') {
      res.end('ready');
      return;
    }
    if (url.pathname === '/host.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (url.pathname === '/callback') {
      res.end('OAuth callback received');
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks));
      if (url.pathname === '/connect') {
        await client?.close();
        client = new Client({
          name: 'AJT isolated remote test host',
          version: '1.0.0',
        });
        await client.connect(
          new StreamableHTTPClientTransport(
            new URL('https://127.0.0.1:8800/mcp'),
            {
              requestInit: {
                headers: { Authorization: `Bearer ${data.token}` },
              },
            },
          ),
        );
        res.end('connected');
        return;
      }
      if (url.pathname === '/tool') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(await client.callTool(data)));
        return;
      }
    }
    if (url.pathname === '/app') {
      const resource = await client.readResource({
        uri: 'ui://ajt-content/authoring.html',
      });
      res.setHeader('Content-Type', 'text/html');
      res.end(
        resource.contents[0].text.replace(
          '<head>',
          `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; frame-src blob:; connect-src 'none'">`,
        ),
      );
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<!doctype html><title>Isolated remote MCP App test</title><iframe title="Website authoring app" sandbox="allow-scripts allow-same-origin" style="width:100%;height:1600px;border:0"></iframe><script type="module" src="/host.js"></script>',
    );
  } catch (error) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        isError: true,
        content: [{ type: 'text', text: error.message }],
      }),
    );
  }
});
server.listen(4340, '127.0.0.1');
async function close() {
  await client?.close();
  server.close();
  siteServer.close();
  for (const child of children) child.kill('SIGTERM');
  await b2.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
