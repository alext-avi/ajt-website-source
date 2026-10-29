import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { z } from 'zod/v4';
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { renderPost, postMedia } from './reviews.mjs';
import {
  resolveAsset,
  mediaType,
  uploadMediaFile,
  mediaDirectory,
} from './media.mjs';

export const AUTHORING_URI = 'ui://ajt-content/authoring.html';
const root = fileURLToPath(new URL('../', import.meta.url));
const chunkBytes = 256 * 1024;
const maximum = 25 * 1024 * 1024;
const expiry = 10 * 60_000;
const identity = z.object({
  collection: z.enum(['posts', 'projects']),
  slug: z.string().regex(/^[a-z0-9-]{1,160}$/),
});
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ],
  );
let htmlPromise;

export async function authoringHtml() {
  htmlPromise ||= (async () => {
    const result = await build({
      entryPoints: [path.join(root, 'mcp/authoring-app.mjs')],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2022',
      minify: true,
    });
    const css = await fs.readFile(
      path.join(root, 'mcp/authoring-app.css'),
      'utf8',
    );
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website authoring</title><style>${css}</style></head><body><main id="app"><p role="status">Connecting to the publishing desk…</p></main><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
  })();
  return htmlPromise;
}

export function registerAuthoringApp(server, tool, store, getPost) {
  const ui = { resourceUri: AUTHORING_URI, visibility: ['app'] };
  registerAppResource(
    server,
    'Website authoring',
    AUTHORING_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description:
        'Edit website post and project drafts, preview content, and manage private media.',
    },
    async () => ({
      contents: [
        {
          uri: AUTHORING_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await authoringHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: ['blob:'],
              },
            },
          },
        },
      ],
    }),
  );
  tool(
    'open_authoring_app',
    'Open a prepared website post or project draft by slug for human review, editing, preview and media changes. Create and select the draft with the agent tools first. Saves drafts only; it does not post to LinkedIn. Final website publication remains on Alex’s local review page.',
    identity
      .partial({ slug: true })
      .extend({ collection: z.enum(['posts', 'projects']).default('posts') })
      .strict(),
    true,
    async ({ collection, slug }) => ({
      collection,
      ...(slug ? { item: await getPost(store, slug, collection) } : {}),
    }),
    { resourceUri: AUTHORING_URI },
  );
  tool(
    'render_authoring_preview',
    'Render the exact saved draft revision as inert HTML for the embedded editor. No publication or deployment.',
    identity.extend({ expectedRevision: z.number().int().positive() }).strict(),
    true,
    async ({ collection, slug, expectedRevision }) => {
      const item = await getPost(store, slug, collection);
      if (item.revision !== expectedRevision)
        throw new Error(
          'Revision conflict; reload the saved draft before previewing',
        );
      const data = item.metadata;
      const body = await renderPost(item.body);
      const styles = (
        await fs.readFile(path.join(root, 'src/styles/global.css'), 'utf8')
      ).replace(/@import[^;]+;/g, '');
      const picture = data.image
        ? `<img class="article-cover" src="${escape(data.image)}" alt="${escape(data.imageAlt)}">`
        : '';
      const list = (values) =>
        `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`;
      const facts =
        collection === 'projects'
          ? `<aside class="project-facts"><h2>My role</h2><p>${escape(data.role)}</p><h2>Tools &amp; disciplines</h2>${list(data.technologies)}</aside>`
          : '';
      const outcomes =
        collection === 'projects' && data.outcomes.length
          ? `<section><h2>Selected outcomes</h2>${list(data.outcomes)}</section>`
          : '';
      const video = data.video
        ? `<figure class="app-video"><video controls playsinline preload="metadata" aria-label="Video for ${escape(data.title)}" poster="${escape(data.videoPoster || '')}" width="${data.videoWidth}" height="${data.videoHeight}"><source src="${escape(data.video)}" type="video/mp4"></video>${data.linkedinVideoCredit ? `<figcaption>${escape(data.linkedinVideoCredit)}</figcaption>` : ''}</figure>`
        : '';
      return {
        revision: item.revision,
        assets: [...new Set(await postMedia(item))],
        html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style>${styles}\nbody{padding:24px}h1{font-size:clamp(28px,5vw,44px)}.article-grid{display:block}.project-facts{margin-top:24px}.app-video{margin:24px 0}.app-video video{display:block;width:100%;height:auto;border-radius:8px;background:#000}.app-video figcaption{font-size:12px;color:#a2adc0;margin-top:8px}a{pointer-events:none}</style></head><body><header><p class="eyebrow">${escape(collection === 'projects' ? data.tags.join(' / ') : data.category)}</p><h1>${escape(data.title)}</h1><p class="lede">${escape(data.summary)}</p>${data.date ? `<time>${escape(data.date.slice(0, 10))}</time>` : ''}</header>${video}${picture}<article class="prose">${body}</article>${outcomes}${facts}</body></html>`,
      };
    },
    ui,
  );

  const uploads = new Map();
  const folder = path.join(
    mediaDirectory(),
    'app-uploads',
    createHash('sha256').update(store.identity).digest('hex').slice(0, 16),
  );
  const uploadId = z.string().regex(/^[a-f0-9]{48}$/);
  function session(id) {
    const state = uploads.get(id);
    if (!state || Date.now() - state.created > expiry)
      throw new Error('Upload expired; select the file again');
    if (state.busy)
      throw new Error('An upload chunk is already being processed');
    return state;
  }
  tool(
    'begin_authoring_upload',
    'Begin a private browser-selected media upload, limited to 25 MiB. Does not attach or publish it.',
    z
      .object({
        name: z.string().min(1).max(200),
        bytes: z.number().int().positive().max(maximum),
      })
      .strict(),
    false,
    async ({ name, bytes }) => {
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      for (const file of await fs.readdir(folder)) {
        if (!/^[a-f0-9]{48}$/.test(file)) continue;
        if (
          Date.now() - (await fs.stat(path.join(folder, file))).mtimeMs >
          expiry
        ) {
          await fs.rm(path.join(folder, file));
          uploads.delete(file);
        }
      }
      if (uploads.size >= 4)
        throw new Error('Finish the current uploads before starting another');
      const id = randomBytes(24).toString('hex');
      const filename = path.join(folder, id);
      // Reserve the slot before asynchronous file I/O, including concurrent RPCs.
      uploads.set(id, {
        filename,
        name: path.basename(name),
        bytes,
        received: 0,
        created: Date.now(),
        busy: true,
      });
      try {
        await fs.writeFile(filename, Buffer.alloc(0), {
          mode: 0o600,
          flag: 'wx',
        });
        uploads.get(id).busy = false;
      } catch (error) {
        uploads.delete(id);
        throw error;
      }
      return { uploadId: id, chunkBytes };
    },
    ui,
  );
  tool(
    'append_authoring_upload',
    'Append the next bounded media chunk to a pending private upload.',
    z
      .object({
        uploadId,
        offset: z.number().int().nonnegative(),
        data: z
          .string()
          .min(4)
          .max(Math.ceil(chunkBytes / 3) * 4)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict(),
    false,
    async ({ uploadId: id, offset, data }) => {
      const state = session(id);
      state.busy = true;
      try {
        const bytes = Buffer.from(data, 'base64');
        if (
          bytes.toString('base64') !== data ||
          bytes.length > chunkBytes ||
          offset !== state.received ||
          offset + bytes.length > state.bytes
        )
          throw new Error('Invalid chunk size, encoding or offset');
        await fs.appendFile(state.filename, bytes);
        state.received += bytes.length;
        return { received: state.received };
      } finally {
        state.busy = false;
      }
    },
    ui,
  );
  tool(
    'finish_authoring_upload',
    'Validate and store a completed media upload using the existing private storage and budget controls. Nothing is published.',
    z.object({ uploadId }).strict(),
    false,
    async ({ uploadId: id }) => {
      const state = session(id);
      if (state.received !== state.bytes)
        throw new Error('The upload is incomplete');
      state.busy = true;
      try {
        return await uploadMediaFile(state.filename, store, state.name).then(
          (result) => ({ ...result, name: state.name }),
        );
      } finally {
        uploads.delete(id);
        await fs.rm(state.filename, { force: true });
      }
    },
    ui,
  );
  tool(
    'read_authoring_media',
    'Read a bounded chunk of an existing website or private draft asset for an in-app preview. No filesystem paths or credentials are returned.',
    z
      .object({
        url: z.string().min(1).max(500),
        offset: z.number().int().nonnegative().default(0),
      })
      .strict(),
    true,
    async ({ url, offset }) => {
      const filename = await resolveAsset(url, store);
      const file = await fs.open(filename, 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > maximum || offset > stat.size)
          throw new Error(
            'Use the local review page to preview media larger than 25 MiB',
          );
        const head = Buffer.alloc(32);
        await file.read(head, 0, 32, 0);
        const mimeType = filename.endsWith('.svg')
          ? 'image/svg+xml'
          : mediaType(head)[1];
        const bytes = Buffer.alloc(Math.min(chunkBytes, stat.size - offset));
        const result = await file.read(bytes, 0, bytes.length, offset);
        return {
          offset,
          totalBytes: stat.size,
          mimeType,
          data: bytes.subarray(0, result.bytesRead).toString('base64'),
        };
      } finally {
        await file.close();
      }
    },
    ui,
  );
}
