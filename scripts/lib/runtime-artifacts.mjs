import fs from 'node:fs/promises';
import path from 'node:path';
export async function removePreviewFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await removePreviewFiles(file);
    else if (
      entry.name.startsWith('.dev.vars') ||
      entry.name === '.env' ||
      entry.name.startsWith('.env.')
    )
      await fs.rm(file);
  }
}
export async function assertRuntimeArtifacts(directory, secrets = {}) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertRuntimeArtifacts(file, secrets);
      continue;
    }
    if (!entry.isFile())
      throw new Error('Unsupported runtime artifact: ' + file);
    if (
      entry.name.startsWith('.dev.vars') ||
      entry.name === '.env' ||
      entry.name.startsWith('.env.')
    )
      throw new Error(
        'Private preview environment file in runtime artifact: ' + file,
      );
    const bytes = await fs.readFile(file);
    for (const [name, value] of Object.entries(secrets))
      if (value && bytes.includes(Buffer.from(value)))
        throw new Error(
          `Credential ${name} found in runtime artifact ${file}; value was not logged`,
        );
  }
}
