import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonc } from './lib/configuration.mjs';
test('formatted Wrangler configurations retain the intended owner, separate staging database and credential-free public runtime', async () => {
  const [legacy, site, authoring] = await Promise.all(
    [
      'wrangler.jsonc',
      'wrangler.runtime.jsonc',
      'wrangler.authoring.jsonc',
    ].map(readJsonc),
  );
  assert.equal(
    site.d1_databases[0].database_id,
    legacy.d1_databases[0].database_id,
  );
  assert.equal(
    authoring.d1_databases[0].database_id,
    site.d1_databases[0].database_id,
  );
  assert.notEqual(
    site.env.staging.d1_databases[0].database_id,
    site.d1_databases[0].database_id,
  );
  assert.equal(
    authoring.env.staging.d1_databases[0].database_id,
    site.env.staging.d1_databases[0].database_id,
  );
  assert.match(authoring.vars.OWNER_GITHUB_ID, /^[0-9]+$/);
  assert.equal(
    authoring.vars.AUTHORING_ORIGIN + '/callback',
    'https://ajt-content.alexander-jt.workers.dev/callback',
  );
  for (const vars of [site.vars, site.env.staging.vars, authoring.vars])
    assert.ok(
      !Object.keys(vars).some((name) =>
        /SECRET|TOKEN|APPLICATION_KEY|CLIENT_ID|KEY_ID/.test(name),
      ),
    );
});
