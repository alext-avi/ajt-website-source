# D1 content storage

Selected by Alex on October 25, 2026. Database: `ajt-website-content`; Worker binding: `CONTENT_DB`.

The live database was created in the existing Cloudflare account in region `ENAM`, with ID `7bfb4c08-b765-4393-b6d2-bd72f750de33`. The initial migration and 41-record import completed, and the publication snapshot was read back from that remote database.

## Publication model

D1 is the production content source. `npm run db:pull -- --remote` exports published records to the versioned `data/content.json` snapshot. Production Astro builds load that snapshot through `src/lib/content-loader.ts`, validate every record against the shared schemas, and render Markdown to static pages. An unavailable database stops the next publication; it does not affect the site already deployed.

Ordinary `npm run build` and pull-request verification use the committed snapshot without Cloudflare credentials. `npm run deploy` first refreshes it from D1, then runs all checks and deploys. The GitHub deployment job follows the same sequence; its token needs the documented D1 read permission. Neither deployment path seeds or overwrites the database.

Local `npm run dev` still uses the MDX files and Keystatic for authoring and private draft previews. `CONTENT_SOURCE=d1 npm run dev` previews the publication snapshot instead. `CONTENT_SOURCE=files npm run build` is an explicit recovery/development override, not the production deployment workflow. Database bodies are Markdown; they are not executed as MDX components or JavaScript.

## Tables

| Table               | Purpose                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content_items`     | Posts, projects, and talks, with stable collection/slug IDs, validated metadata JSON, Markdown, a revision number, and editing timestamps. Generated columns expose titles, draft status, and post publication dates to SQL queries. |
| `content_revisions` | A complete copy of every inserted/updated content revision, recorded by triggers.                                                                                                                                                    |
| `media_assets`      | Image, video, and slide URLs with descriptive metadata. File bytes stay in static assets or external video players.                                                                                                                  |
| `referral_channels` | Optional channel names and future welcome/highlight fields. Existing wildcard referral redirects remain registration-free. No visitor records are collected.                                                                         |

The initial import includes 33 published LinkedIn posts, three projects, and five talks. Unpublished drafts are excluded. Private slide decks and research files are not imported. LinkedIn publication dates and original body text are preserved.

## Initial setup

The existing Cloudflare account and Workers Free plan are used. No plan upgrade or separate service account is required.

```sh
# Authorize only the existing deployment scopes plus D1; complete in Safari if needed.
npx wrangler login --scopes user:read account:read workers:write workers_scripts:write d1:write
# Only if the named database has not already been created:
npx wrangler d1 create ajt-website-content --binding CONTENT_DB --update-config
npm run db:migrate:remote
npm run db:seed -- --remote
npm run db:pull -- --remote
npm run deploy
```

`wrangler.jsonc` must contain the real database UUID returned by creation. The all-zero UUID is a local setup placeholder and must never be deployed. Check for an existing named database before creating one. Keep credentials in Wrangler's protected credential store or GitHub Actions secrets.

Migrations are tracked in `migrations/`; D1 records applied migrations. `db:seed` imports published source files using insert-if-absent statements. Repeating it cannot overwrite content subsequently edited in D1. It is an initial import/recovery tool, not a deployment step.

## Editing a record

1. Inspect the current D1 record/revision and edit its local authoring file through Keystatic or a text editor. If D1 has newer content, use that version as the starting point.
2. Push that specific record, supplying its expected revision. Use `--revision 0` only for a new record:

```sh
npm run db:push -- --remote --collection talks --slug after-the-prototype --revision 1
```

The write is conditional on that revision still being current. A stale revision or a missing record fails rather than overwriting another edit. Successful updates increment the revision and append history. To unpublish, set `draft: true` and push the next revision; retain the record/history.

3. Run `npm run db:pull -- --remote`, review the snapshot diff and static preview, then commit the snapshot and any authoring/assets changes. Publish with `npm run deploy`, or the configured GitHub Actions workflow. D1 changes do not alter live pages until publication.

Only published, non-example records enter `data/content.json`. An empty or invalid export fails before replacing the snapshot. The snapshot is publication material and is deliberately versioned; it must never contain confidential research. The original LinkedIn archive integrity tests also protect imported text and dates.

## Local verification and recovery

```sh
npm run db:migrate:local
npm run db:seed -- --local
npm run db:pull -- --local
npm run verify
```

Local state lives in ignored `.wrangler/` and is separate from the remote database. Before production deployment, pull from `--remote` again. For backups use D1 Time Travel or `wrangler d1 export CONTENT_DB --remote --output <ignored-backup-path.sql>`. Database backups may include drafts and revision history; keep them out of public assets and Git.

## Future agent

The database is ready for a later authenticated content tool layer with operations such as `search_content`, `save_draft`, and `attach_media`. Revision checks and history provide the persistence foundation. This setup does not deploy an autonomous agent, expose a public SQL/write endpoint, create agent credentials, or enable personalized referral welcomes yet.

References: [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [imports and exports](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [pricing](https://developers.cloudflare.com/d1/platform/pricing/).
