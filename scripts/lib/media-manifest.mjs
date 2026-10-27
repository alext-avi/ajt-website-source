import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import { mediaPath, mediaManifestPath } from '../../src/lib/media.ts';

// Scan the pages actually rendered into this release, never private draft records.
export async function buildMediaManifest(directory) {
  const files = new Set();
  function visit(node, base) {
    for (const { name, value } of node.attrs || []) {
      const socialImage =
        name === 'content' &&
        node.tagName === 'meta' &&
        node.attrs.some(
          (attribute) =>
            ['property', 'name'].includes(attribute.name) &&
            ['og:image', 'twitter:image'].includes(attribute.value),
        );
      if (!['src', 'href', 'poster', 'srcset'].includes(name) && !socialImage)
        continue;
      const values =
        name === 'srcset'
          ? value.split(',').map((item) => item.trim().split(/\s+/)[0])
          : [value];
      for (const candidate of values) {
        let url;
        try {
          url = new URL(candidate, base);
        } catch {
          continue;
        }
        if (url.origin !== base.origin) continue;
        const match = mediaPath.exec(url.pathname);
        if (match) files.add(match[1]);
      }
    }
    for (const child of node.childNodes || []) visit(child, base);
    if (node.content) visit(node.content, base);
  }
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.html')) {
        const document = parse(await fs.readFile(file, 'utf8'));
        let base = new URL(
          path.relative(directory, file),
          'https://media-manifest.invalid/',
        );
        function canonical(node) {
          if (
            node.tagName === 'link' &&
            node.attrs.some(
              (attribute) =>
                attribute.name === 'rel' && attribute.value === 'canonical',
            )
          ) {
            const href = node.attrs.find(
              (attribute) => attribute.name === 'href',
            )?.value;
            if (href) base = new URL(href);
          }
          for (const child of node.childNodes || []) canonical(child);
        }
        canonical(document);
        visit(document, base);
      }
    }
  }
  await walk(directory);
  const manifest = { version: 1, files: [...files].sort() };
  await fs.writeFile(
    path.join(directory, mediaManifestPath.slice(1)),
    JSON.stringify(manifest) + '\n',
  );
  return manifest;
}
