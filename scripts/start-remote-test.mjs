import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
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
await fs.writeFile(authoringConfig, JSON.stringify(authoring));
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
for (const [config, port, https] of [
  [authoringConfig, 8800, true],
  [siteConfig, 8801, false],
]) {
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--config',
      config,
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(port + 1000),
      '--persist-to',
      state,
      '--log-level',
      'warn',
      ...(https ? ['--local-protocol', 'https'] : []),
    ],
    { env, stdio: 'inherit' },
  );
  children.push(child);
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
// Test-only TLS exception is confined to this loopback harness process.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
server.listen(4340, '127.0.0.1');
async function close() {
  await client?.close();
  server.close();
  for (const child of children) child.kill('SIGTERM');
  await b2.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
