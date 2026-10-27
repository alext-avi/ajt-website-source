import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sqlText } from '../scripts/lib/d1-content.mjs';
import { mediaPath } from '../src/lib/media.ts';
import { constants } from 'node:fs';
import { verifyMediaBytes } from './r2-media.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const mediaDirectory = () =>
  path.resolve(
    process.env.AJT_MEDIA_DIR || path.join(root, '.wrangler/content-media'),
  );
const pendingName = /^[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|pdf)$/;
export const maximumMediaBytes = 100 * 1024 * 1024;
const cacheDirectory = () => path.join(mediaDirectory(), 'r2-cache');
async function cacheFile(filename, bytes) {
  await fs.mkdir(cacheDirectory(), { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(cacheDirectory(), 'write-'));
  try {
    await fs.writeFile(path.join(temporary, filename), bytes, {
      mode: 0o600,
      flag: 'wx',
    });
    await fs.rename(
      path.join(temporary, filename),
      path.join(cacheDirectory(), filename),
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  return path.join(cacheDirectory(), filename);
}
export function mediaType(bytes) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return ['png', 'image/png', 'image'];
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return ['jpg', 'image/jpeg', 'image'];
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()))
    return ['gif', 'image/gif', 'image'];
  if (
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return ['webp', 'image/webp', 'image'];
  if (
    bytes.length >= 16 &&
    bytes.subarray(4, 8).toString() === 'ftyp' &&
    /^(isom|iso[2-9]|mp41|mp42|avc1|M4V |dash)$/.test(
      bytes.subarray(8, 12).toString('latin1'),
    )
  )
    return ['mp4', 'video/mp4', 'video'];
  if (bytes.subarray(0, 5).toString() === '%PDF-')
    return ['pdf', 'application/pdf', 'document'];
  throw new Error(
    'Upload a PNG, JPEG, GIF, WebP, MP4, or PDF file. SVG and executable files are not accepted.',
  );
}
export async function saveMedia(bytes, store, originalName = '') {
  if (!bytes.length || bytes.length > maximumMediaBytes)
    throw new Error('Media must be between 1 byte and 100 MiB');
  const [extension, contentType, kind] = mediaType(bytes);
  const filename =
    createHash('sha256').update(bytes).digest('hex') + '.' + extension;
  if (store?.media) {
    const file = await cacheFile(filename, bytes);
    await store.media.command('put', filename, file, contentType);
    const url = '/media/' + filename;
    const metadata = {
      storage: 'r2',
      contentType,
      bytes: bytes.length,
      name: path.basename(originalName).slice(0, 200),
    };
    await store.query(
      `INSERT INTO media_assets(url,kind,metadata_json) VALUES (${sqlText(url)},${sqlText(kind === 'document' ? 'slides' : kind)},${sqlText(JSON.stringify(metadata))}) ON CONFLICT(url) DO NOTHING RETURNING url;`,
    );
    return {
      url,
      kind,
      contentType,
      bytes: bytes.length,
      pending: true,
      storage: store.media.mode,
    };
  }
  await fs.mkdir(mediaDirectory(), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(path.join(mediaDirectory(), filename), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return {
    url: (kind === 'video' ? '/videos/' : '/uploads/') + filename,
    kind,
    contentType,
    bytes: bytes.length,
    pending: true,
  };
}
export async function uploadMediaFile(filename, store) {
  if (!path.isAbsolute(filename))
    throw new Error('Provide an absolute path to a media file');
  const file = await fs.open(
    filename,
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !stat.size || stat.size > maximumMediaBytes)
      throw new Error('Choose a regular media file up to 100 MiB');
    // A bounded read also protects against a file growing between stat and read.
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length !== stat.size)
      throw new Error(
        'The media file changed during upload; retry with a stable file',
      );
    return saveMedia(bytes.subarray(0, length), store, path.basename(filename));
  } finally {
    await file.close();
  }
}

async function r2Asset(url, store, refresh) {
  const filename = mediaPath.exec(url)?.[1];
  if (!filename || !store?.media)
    throw new Error(
      'Upload the media through this content MCP before attaching it',
    );
  const row = (
    await store.query(
      `SELECT metadata_json FROM media_assets WHERE url=${sqlText(url)} AND json_extract(metadata_json,'$.storage')='r2';`,
    )
  )[0];
  if (!row)
    throw new Error(
      'Upload the media through this content MCP before attaching it',
    );
  const metadata = JSON.parse(row.metadata_json);
  const cached = path.join(cacheDirectory(), filename);
  if (!refresh) {
    try {
      const bytes = await fs.readFile(cached);
      verifyMediaBytes(filename, bytes);
      if (
        bytes.length !== metadata.bytes ||
        mediaType(bytes)[1] !== metadata.contentType
      )
        throw new Error();
      return cached;
    } catch {
      /* Missing or corrupt local caches are reconstructed from R2. */
    }
  }
  await fs.mkdir(cacheDirectory(), { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp(path.join(cacheDirectory(), 'download-'));
  try {
    const target = path.join(temporary, filename);
    await store.media.command('get', filename, target);
    const stat = await fs.stat(target);
    if (stat.size > maximumMediaBytes || stat.size !== metadata.bytes)
      throw new Error('Media size does not match the upload record');
    const bytes = await fs.readFile(target);
    verifyMediaBytes(filename, bytes);
    if (mediaType(bytes)[1] !== metadata.contentType)
      throw new Error('Media type does not match the upload record');
    return await cacheFile(filename, bytes);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
export async function pendingMedia(filename) {
  if (!pendingName.test(filename)) throw new Error('Media not found');
  const bytes = await fs.readFile(path.join(mediaDirectory(), filename));
  return { bytes, contentType: mediaType(bytes)[1] };
}
export async function resolveAsset(url, store, { refresh = false } = {}) {
  if (url.startsWith('/media/')) return r2Asset(url, store, refresh);
  if (
    !/^\/(images|uploads|videos)\/[a-zA-Z0-9/_().-]+$/.test(url) ||
    url.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid media asset path');
  const publicRoot = await fs.realpath(path.join(root, 'public'));
  try {
    const resolved = await fs.realpath(path.join(publicRoot, url.slice(1)));
    if (
      !resolved.startsWith(publicRoot + path.sep) ||
      !(await fs.stat(resolved)).isFile()
    )
      throw new Error('Invalid media asset');
    return resolved;
  } catch {
    if (store?.media)
      throw new Error(
        'This asset is not in the deployment checkout. Upload it through the content MCP to store it in R2.',
      );
    const name = url.split('/').at(-1);
    if (
      !(url.startsWith('/uploads/') || url.startsWith('/videos/')) ||
      !pendingName.test(name)
    )
      throw new Error('Upload the media asset before attaching it');
    await pendingMedia(name);
    return path.join(mediaDirectory(), name);
  }
}
export async function materializeMedia(urls, store) {
  for (const url of new Set(urls)) {
    if (url?.startsWith('/media/')) {
      // Recheck actual storage before human approval changes D1. Never publish using a cache alone.
      await resolveAsset(url, store, { refresh: true });
      continue;
    }
    if (!(url?.startsWith('/uploads/') || url?.startsWith('/videos/')))
      continue;
    const destination = path.join(root, 'public', url.split('/')[1]);
    const name = url.split('/').at(-1);
    if (!pendingName.test(name)) continue;
    const source = await resolveAsset(url, store);
    if (!source.startsWith(mediaDirectory() + path.sep)) continue;
    await fs.mkdir(destination, { recursive: true });
    await fs.copyFile(source, path.join(destination, name));
  }
}
export async function listMedia(store) {
  const files = [];
  async function walk(directory, prefix, pending = false) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(
          path.join(directory, entry.name),
          prefix + entry.name + '/',
          pending,
        );
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.(png|jpe?g|gif|webp|svg|mp4|pdf)$/i.test(entry.name)
      )
        continue;
      const stat = await fs.stat(path.join(directory, entry.name));
      files.push({
        url:
          pending && /\.mp4$/i.test(entry.name)
            ? '/videos/' + entry.name
            : prefix + entry.name,
        kind: /\.mp4$/i.test(entry.name)
          ? 'video'
          : /\.pdf$/i.test(entry.name)
            ? 'document'
            : 'image',
        bytes: stat.size,
        pending,
      });
    }
  }
  for (const prefix of ['images', 'uploads', 'videos'])
    await walk(path.join(root, 'public', prefix), '/' + prefix + '/');
  if (store?.media) {
    const rows = await store.query(
      "SELECT url,kind,metadata_json FROM media_assets WHERE json_extract(metadata_json,'$.storage')='r2' ORDER BY created_at DESC LIMIT 200;",
    );
    const published = await store.query(
      'SELECT metadata_json,body_markdown FROM content_items WHERE is_draft=0;',
    );
    const references = published
      .map((row) => row.metadata_json + row.body_markdown)
      .join('\n');
    for (const row of rows) {
      if (!mediaPath.test(row.url)) continue;
      const metadata = JSON.parse(row.metadata_json);
      files.push({
        url: row.url,
        kind: row.kind === 'slides' ? 'document' : row.kind,
        bytes: metadata.bytes,
        name: metadata.name,
        pending: !references.includes(row.url),
        storage: store.media.mode,
      });
    }
  } else await walk(mediaDirectory(), '/uploads/', true);
  return [...new Map(files.map((file) => [file.url, file])).values()].sort(
    (a, b) => a.url.localeCompare(b.url),
  );
}
