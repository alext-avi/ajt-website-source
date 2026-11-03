import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runtimeConfig } from './lib/remote-release.mjs';
import { readJsonc } from './lib/configuration.mjs';

test('runtime releases preserve production domains without attaching them to staging', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ajt-domain-release-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'dist-runtime/server'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'dist-runtime/server/wrangler.json'),
    JSON.stringify({
      name: 'compiled-production',
      routes: [{ pattern: 'compiled-production.example', custom_domain: true }],
      assets: { binding: 'ASSETS' },
    }),
  );
  await fs.copyFile(
    'wrangler.runtime.jsonc',
    path.join(root, 'wrangler.runtime.jsonc'),
  );
  const configured = await readJsonc(path.join(root, 'wrangler.runtime.jsonc'));
  const production = await runtimeConfig('production', 'release-fixture', root);
  const staging = await runtimeConfig('staging', 'release-fixture', root);
  assert.equal(production.name, 'alexander-thomas');
  assert.ok(
    production.routes.some(
      (route) =>
        route.pattern === 'alexanderjthomas.com' && route.custom_domain,
    ),
  );
  assert.ok(
    production.routes.some(
      (route) =>
        route.pattern === 'www.alexanderjthomas.com' && route.custom_domain,
    ),
  );
  assert.deepEqual(production.routes, configured.routes);
  assert.equal(staging.name, 'alexander-thomas-staging');
  assert.deepEqual(staging.routes, []);
  assert.notEqual(
    staging.d1_databases[0].database_id,
    production.d1_databases[0].database_id,
  );
  assert.equal(
    production.main,
    path.join(root, 'dist-runtime/server/entry.mjs'),
  );
  assert.equal(staging.vars.DEPLOYMENT_ENVIRONMENT, 'staging');
});
