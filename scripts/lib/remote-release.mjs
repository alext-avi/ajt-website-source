import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJsonc } from './configuration.mjs';
export async function runtimeHash(root = process.cwd()) {
  const files = [];
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const name = relative + '/' + entry.name;
      if (name === 'dist-runtime/client/release.json') continue;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error('Unsupported runtime artifact');
    }
  }
  await visit('dist-runtime');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = await fs.readFile(path.join(root, file));
    hash.update(file + '\0' + bytes.length + '\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
}
export async function runtimeConfig(environment, releaseId) {
  const original = JSON.parse(
    await fs.readFile('dist-runtime/server/wrangler.json', 'utf8'),
  );
  const source = await readJsonc('wrangler.runtime.jsonc');
  if (
    source.env.staging.d1_databases.some((stage) =>
      source.d1_databases.some(
        (prod) => prod.database_id === stage.database_id,
      ),
    )
  )
    throw new Error('Staging must use a separate content database');
  const target = environment === 'staging' ? source.env.staging : source;
  if (target.d1_databases.some((db) => db.database_id.startsWith('00000000')))
    throw new Error('Provision the separate staging database first');
  return {
    ...original,
    name: target.name,
    main: path.resolve('dist-runtime/server/entry.mjs'),
    assets: {
      ...original.assets,
      directory: path.resolve('dist-runtime/client'),
    },
    vars: { ...target.vars, RELEASE_ID: releaseId },
    d1_databases: target.d1_databases.map((db) => ({
      ...db,
      migrations_dir: path.resolve('migrations'),
    })),
  };
}
