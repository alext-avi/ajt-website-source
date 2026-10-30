import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import {
  removePreviewFiles,
  assertRuntimeArtifacts,
} from './lib/runtime-artifacts.mjs';
import { deploymentEnvironments } from './lib/deployment-secrets.mjs';
const { safeEnv } = deploymentEnvironments(process.env);
try {
  const result = spawnSync(
    process.execPath,
    ['node_modules/astro/bin/astro.mjs', 'build'],
    { stdio: 'inherit', env: { ...safeEnv, AJT_RUNTIME: '1' } },
  );
  if (result.status !== 0) throw new Error('Runtime build failed');
} finally {
  // The adapter copies development bindings for `astro preview`. Releases and
  // test artifacts must never retain those files; deployment injects secrets
  // through an owner-only temporary file instead.
  await removePreviewFiles('dist-runtime');
  const candidates = { ...process.env };
  for (const name of ['.dev.vars', '.dev.vars.authoring']) {
    try {
      Object.assign(candidates, parseEnv(await fs.readFile(name, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const secrets = Object.fromEntries(
    Object.entries(candidates).filter(
      ([name, value]) =>
        /^(?:B2_.*(?:KEY_ID|APPLICATION_KEY)|GITHUB_CLIENT_SECRET)$/.test(
          name,
        ) && value,
    ),
  );
  await assertRuntimeArtifacts('dist-runtime', secrets);
  // The adapter writes a default-command redirect. This repository deliberately
  // retains a static release path during rollout, so never leave that redirect.
  const file = '.wrangler/deploy/config.json';
  try {
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    if (
      config.configPath
        ?.replaceAll('\\', '/')
        .includes('dist-runtime/server/wrangler.json')
    )
      await fs.rm(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
