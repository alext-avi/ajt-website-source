import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { AUTHORING_URI } from '../mcp/content-service.mjs';
import {
  escapeHtml as e,
  renderMarkdown,
  postMedia,
} from '../mcp/content-render.mjs';
import { remotePublication } from './remote-publication.mjs';

const identity = z.object({
  collection: z.enum(['posts', 'projects']).default('posts'),
  slug: z.string().regex(/^[a-z0-9-]{1,160}$/),
});
const maximum = 25 * 1024 * 1024;
const chunkBytes = 256 * 1024;
export function registerRemoteApp(env, ownerId) {
  return function register(server, tool, store, getPost) {
    const ui = { resourceUri: AUTHORING_URI, visibility: ['app'] };
    const publication = remotePublication(store, ownerId, env.SITE_URL);
    registerAppResource(
      server,
      'Website authoring',
      AUTHORING_URI,
      { mimeType: RESOURCE_MIME_TYPE },
      async () => ({
        contents: [
          {
            uri: AUTHORING_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: await (
              await env.APP_ASSETS.fetch(
                new Request('https://assets/authoring.html'),
              )
            ).text(),
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
      'Open a prepared draft for Alex to edit, preview and press Post. Never publishes automatically.',
      identity.partial({ slug: true }).strict(),
      true,
      async ({ collection, slug }) => ({
        collection,
        ...(slug ? { item: await getPost(store, slug, collection) } : {}),
      }),
      { resourceUri: AUTHORING_URI },
    );
    tool(
      'render_authoring_preview',
      'Render the exact saved revision for the App. No publication.',
      identity
        .extend({ expectedRevision: z.number().int().positive() })
        .strict(),
      true,
      async ({ collection, slug, expectedRevision }) => {
        const item = await getPost(store, slug, collection);
        if (item.revision !== expectedRevision)
          throw new Error('Revision conflict. Reload the saved draft.');
        const styles = await (
          await env.APP_ASSETS.fetch(new Request('https://assets/preview.css'))
        ).text();
        const data = item.metadata;
        const html = renderMarkdown(item.body).html;
        const picture = data.image
          ? `<img class="article-cover" src="${e(data.image)}" alt="${e(data.imageAlt)}">`
          : '';
        const list = (values) =>
          `<ul>${values.map((v) => `<li>${e(v)}</li>`).join('')}</ul>`;
        const video = data.video
          ? `<figure class="app-video"><video controls playsinline preload="metadata" aria-label="Video for ${e(data.title)}" poster="${e(data.videoPoster || '')}" width="${data.videoWidth}" height="${data.videoHeight}"><source src="${e(data.video)}" type="video/mp4"></video>${data.linkedinVideoCredit ? `<figcaption>${e(data.linkedinVideoCredit)}</figcaption>` : ''}</figure>`
          : '';
        return {
          revision: item.revision,
          previewToken: await publication.prepare(item, collection),
          publicationTarget: store.localOnly ? 'local-test' : 'website',
          reviewAvailable: false,
          assets: await postMedia(item),
          html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style>${styles}\nbody{padding:24px}h1{font-size:clamp(28px,5vw,44px)}.app-video{margin:24px 0}.app-video video{width:100%;height:auto}a{pointer-events:none}</style></head><body><header><p class="eyebrow">${e(collection === 'projects' ? data.tags.join(' / ') : data.category)}</p><h1>${e(data.title)}</h1><p class="lede">${e(data.summary)}</p>${data.date ? `<time>${e(data.date.slice(0, 10))}</time>` : ''}</header>${picture}<article class="prose">${html}</article>${video}${collection === 'projects' ? `<section><h2>Selected outcomes</h2>${list(data.outcomes)}<h2>My role</h2><p>${e(data.role)}</p><h2>Tools &amp; disciplines</h2>${list(data.technologies)}</section>` : ''}</body></html>`,
        };
      },
      ui,
    );
    const token = z
      .object({ previewToken: z.string().regex(/^[a-f0-9]{48}$/) })
      .strict();
    tool(
      'publish_authoring_draft',
      'Human Post click only. Publish the exact approved revision directly in D1. No deployment or GitHub Actions.',
      token,
      false,
      ({ previewToken }) => publication.post(previewToken),
      ui,
    );
    tool(
      'get_authoring_publication_status',
      'App-only status for a publication Alex started. Never starts publication.',
      token,
      true,
      ({ previewToken }) => publication.status(previewToken),
      ui,
    );
    tool(
      'read_authoring_media',
      'Read a private media chunk for the App preview.',
      z
        .object({
          url: z.string().min(1).max(500),
          offset: z.number().int().nonnegative().default(0),
        })
        .strict(),
      true,
      ({ url, offset }) => store.readAsset(url, offset),
      ui,
    );

    const uploadId = z.string().regex(/^[a-f0-9]{48}$/);
    const db = store.db;
    async function upload(id) {
      const state = await db
        .prepare(
          "SELECT * FROM authoring_uploads WHERE id=? AND owner_id=? AND expires_at>? AND state='uploading'",
        )
        .bind(id, ownerId, Date.now())
        .first();
      if (!state) throw new Error('Upload expired. Select the file again.');
      return state;
    }
    tool(
      'begin_authoring_upload',
      'Start a private file upload up to 25 MiB. Nothing is published.',
      z
        .object({
          name: z.string().min(1).max(200),
          bytes: z.number().int().positive().max(maximum),
        })
        .strict(),
      false,
      async ({ name, bytes }) => {
        await db
          .prepare('DELETE FROM authoring_uploads WHERE expires_at<?')
          .bind(Date.now())
          .run();
        const id = randomBytes(24).toString('hex');
        const result = await db
          .prepare(
            `INSERT INTO authoring_uploads(id,owner_id,name,bytes,expires_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM authoring_uploads WHERE owner_id=?)<2 RETURNING id`,
          )
          .bind(id, ownerId, name, bytes, Date.now() + 600_000, ownerId)
          .all();
        if (!result.results.length)
          throw new Error('Finish the existing uploads first.');
        return { uploadId: id, chunkBytes };
      },
      ui,
    );
    tool(
      'append_authoring_upload',
      'Append the next bounded chunk to a private upload.',
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
        const state = await upload(id);
        const bytes = Buffer.from(data, 'base64');
        if (
          bytes.toString('base64') !== data ||
          bytes.length > chunkBytes ||
          state.received !== offset ||
          offset + bytes.length > state.bytes
        )
          throw new Error('Invalid upload chunk or offset');
        const results = await db.batch([
          db
            .prepare(
              'INSERT INTO authoring_upload_chunks(upload_id,offset,data) SELECT id,?,? FROM authoring_uploads WHERE id=? AND owner_id=? AND received=? AND expires_at>?',
            )
            .bind(offset, bytes, id, ownerId, offset, Date.now()),
          db
            .prepare(
              'UPDATE authoring_uploads SET received=received+? WHERE id=? AND owner_id=? AND received=? AND EXISTS(SELECT 1 FROM authoring_upload_chunks WHERE upload_id=? AND offset=?) RETURNING received',
            )
            .bind(bytes.length, id, ownerId, offset, id, offset),
        ]);
        if (!results[1].results.length)
          throw new Error('Concurrent upload chunk. Refresh before retrying.');
        return { received: offset + bytes.length };
      },
      ui,
    );
    tool(
      'finish_authoring_upload',
      'Validate and store a complete private upload in B2. Nothing is published.',
      z.object({ uploadId }).strict(),
      false,
      async ({ uploadId: id }) => {
        const state = await upload(id);
        if (state.received !== state.bytes)
          throw new Error('Upload is incomplete');
        // Claim the lease atomically before network I/O, preventing two finishes.
        const claimed = await db
          .prepare(
            "UPDATE authoring_uploads SET state='finishing',expires_at=? WHERE id=? AND owner_id=? AND expires_at>? AND state='uploading' RETURNING id",
          )
          .bind(Date.now() + 600_000, id, ownerId, Date.now())
          .all();
        if (!claimed.results.length)
          throw new Error('Upload is already finishing');
        try {
          const rows = (
            await db
              .prepare(
                'SELECT data FROM authoring_upload_chunks WHERE upload_id=? ORDER BY offset',
              )
              .bind(id)
              .all()
          ).results;
          const bytes = Buffer.concat(rows.map((row) => Buffer.from(row.data)));
          if (bytes.length !== state.bytes)
            throw new Error('Incomplete upload');
          return {
            ...(await store.saveMedia(bytes, state.name)),
            name: state.name,
          };
        } finally {
          await db
            .prepare('DELETE FROM authoring_uploads WHERE id=? AND owner_id=?')
            .bind(id, ownerId)
            .run();
        }
      },
      ui,
    );
  };
}
