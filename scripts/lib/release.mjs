import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const runtimeFiles = [
  'worker/index.ts',
  'worker/media.ts',
  'worker/b2-media.ts',
  'src/lib/b2.ts',
  'src/lib/media.ts',
  'src/lib/referrals.ts',
  'wrangler.jsonc',
  'package.json',
  'package-lock.json',
];

export async function artifactHash(root) {
  const files = [...runtimeFiles];
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const file = `${relative}/${entry.name}`;
      if (file === 'dist/release.json') continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
      else throw new Error(`Unsupported release file: ${file}`);
    }
  }
  await visit('dist');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = await fs.readFile(path.join(root, file));
    hash.update(`${file}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function validateRelease(release) {
  if (
    release?.version !== 1 ||
    !/^[a-f0-9]{40}$/.test(release.revision || '') ||
    !/^[a-f0-9]{64}$/.test(release.artifactSha256 || '')
  ) {
    throw new Error('Invalid release identity');
  }
  return release;
}

export async function prepareRelease(root, revision) {
  const release = validateRelease({
    version: 1,
    revision,
    artifactSha256: await artifactHash(root),
  });
  await fs.writeFile(
    path.join(root, 'dist/release.json'),
    JSON.stringify(release, null, 2) + '\n',
  );
  return release;
}

export async function verifyRelease(root, expected) {
  const release = validateRelease(
    JSON.parse(await fs.readFile(path.join(root, 'dist/release.json'), 'utf8')),
  );
  if (
    release.artifactSha256 !== expected.artifactSha256 ||
    release.revision !== expected.revision ||
    (await artifactHash(root)) !== expected.artifactSha256
  ) {
    throw new Error(
      'The tested release changed; refusing production deployment',
    );
  }
  return release;
}

export async function verifyStaging(origin, expected, fetcher = fetch) {
  const response = await fetcher(
    new URL(`/release.json?release=${expected.artifactSha256}`, origin),
    {
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    },
  );
  if (
    !response.ok ||
    response.headers.get('x-ajt-environment') !== 'staging' ||
    response.headers.get('x-ajt-release') !== expected.artifactSha256
  ) {
    throw new Error('Staging is not serving the expected release');
  }
  const actual = validateRelease(await response.json());
  if (
    actual.revision !== expected.revision ||
    actual.artifactSha256 !== expected.artifactSha256
  ) {
    throw new Error(
      'Staging release identity mismatch; refusing production deployment',
    );
  }
}

export async function waitForStaging(origin, expected, options = {}) {
  const timeout = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      await verifyStaging(origin, expected, options.fetcher || fetch);
      return;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) =>
        setTimeout(resolve, options.intervalMs ?? 2_000),
      );
    }
  } while (Date.now() < deadline);
  throw new Error('Staging did not become ready with the expected release', {
    cause: lastError,
  });
}
