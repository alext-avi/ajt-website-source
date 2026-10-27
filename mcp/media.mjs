import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const mediaDirectory = () =>
  path.resolve(
    process.env.AJT_MEDIA_DIR || path.join(root, '.wrangler/content-media'),
  );
const pendingName = /^[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|pdf)$/;
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
  if (bytes.subarray(4, 8).toString() === 'ftyp')
    return ['mp4', 'video/mp4', 'video'];
  if (bytes.subarray(0, 5).toString() === '%PDF-')
    return ['pdf', 'application/pdf', 'document'];
  throw new Error(
    'Upload a PNG, JPEG, GIF, WebP, MP4, or PDF file. SVG and executable files are not accepted.',
  );
}
export async function saveMedia(bytes) {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024)
    throw new Error('Media must be between 1 byte and 25 MiB');
  const [extension, contentType, kind] = mediaType(bytes);
  const filename =
    createHash('sha256').update(bytes).digest('hex') + '.' + extension;
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
export async function pendingMedia(filename) {
  if (!pendingName.test(filename)) throw new Error('Media not found');
  const bytes = await fs.readFile(path.join(mediaDirectory(), filename));
  return { bytes, contentType: mediaType(bytes)[1] };
}
export async function resolveAsset(url) {
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
export async function materializeMedia(urls) {
  for (const url of new Set(urls)) {
    if (!(url?.startsWith('/uploads/') || url?.startsWith('/videos/')))
      continue;
    const destination = path.join(root, 'public', url.split('/')[1]);
    const name = url.split('/').at(-1);
    if (!pendingName.test(name)) continue;
    const source = await resolveAsset(url);
    if (!source.startsWith(mediaDirectory() + path.sep)) continue;
    await fs.mkdir(destination, { recursive: true });
    await fs.copyFile(source, path.join(destination, name));
  }
}
export async function listMedia() {
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
  await walk(mediaDirectory(), '/uploads/', true);
  return [...new Map(files.map((file) => [file.url, file])).values()].sort(
    (a, b) => a.url.localeCompare(b.url),
  );
}
