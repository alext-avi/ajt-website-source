# Draft, review, and publish

The `ajt-content` MCP creates website post and project drafts and submits specific revisions to the local publishing desk. Alex edits the rendered draft and presses Post directly in the App, or Publish in the local desk. Model-facing tools expose no approval, publication, deployment, arbitrary SQL or deletion operation. It does not post to LinkedIn.

## Interactive MCP App

Ask to open the website authoring App, or call `open_authoring_app` with
`collection: "posts"` or `"projects"` and the prepared draft's `slug`. Hosts that
support MCP Apps render its self-contained `ui://ajt-content/authoring.html`
resource in the conversation. Reading, creating and updating a draft also
advertises this resource. Reconnect the MCP after installing an updated server
so the host refreshes its tools and resource metadata. Hosts without MCP Apps
can continue using the same draft tools and local review desk.

The agent creates and selects drafts through the MCP tools. The App focuses on
reviewing that prepared draft: a metadata and Markdown editor, private media
picker/upload/replacement, saved content preview, a primary **Post** button and secondary **Open draft** option.
It has no draft-library sidebar, URL-name setup or New draft control. Opening it
without a slug shows a prompt to ask the agent to prepare or open a draft; no
manual creation form or background draft-list request is offered.
These controls call the existing tools directly; editing does not
require a model turn. Revision conflicts preserve unsaved work. Published
content is read-only, and imported LinkedIn text/date remain locked. Clear an
optional media or repository field to remove it; omitted patch fields retain
their saved values.

The embedded preview shows the saved content. **Post** publishes that exact revision
through the existing media verification, publication lock and staging release gate.
Its ten-minute preview capability is bound to the saved content digest; changed
revisions are rejected. Publication starts only from a trusted human click, never
from tool delivery, saving, rendering or polling. Progress and errors appear in the
App; failed or uncertain jobs are never automatically retried. **Open draft** opens
the optional local desk. A visible loopback link remains available if the host
rejects link opening. The model must never call the app-only publication RPC.

An older running server may serve the new UI without supporting the Post action.
In that case the App disables Post and displays a persistent reconnect warning.
An isolated SQLite backend is explicitly labeled local test mode before posting;
it cannot publish to the live website.

Attached MP4 videos play directly in the App preview after the post text, with a poster,
native playback controls, inline playback and any saved source credit. They
start paused. The App shows progress while loading private video bytes through
MCP; no public draft-media endpoint or external video page is needed. The
25 MiB preview limit still applies, with larger media reviewed at the local desk.

App resources bundle their scripts/styles locally, permit no external network
connections, and allow only a blob frame for the inert preview. Private media
arrives through bounded MCP reads and becomes an inline data URL, rather than a
public draft URL. Tests enforce the declared host policy without silently granting
blob-media access. App-only tools
`render_authoring_preview`, `read_authoring_media`, `begin_authoring_upload`,
`append_authoring_upload` and `finish_authoring_upload` support this interface.
Browser-selected files use 256 KiB chunks, a 25 MiB file limit, a ten-minute
upload lifetime and at most four pending sessions per server. The usual file
signature and storage budget checks still apply. These helpers expose no
filesystem paths, credentials or SQL capability. Separate app-only
`publish_authoring_draft` and `get_authoring_publication_status` support the human
Post control and read-only polling. A publication capability is session-bound,
expires before use, and cannot publish a changed draft or start a duplicate job.
App-only visibility
is a host routing rule, not an authentication boundary against a custom MCP client.

## Use the workflow

1. Upload any new media with `upload_media`, supplying its absolute local file path. It returns a private, immutable `/media/<sha256>.<extension>` URL. Use `list_media` to find reusable assets. File bytes need not go through the conversation.
2. Ask the MCP to create a draft with `create_post_draft`. Supply a slug, title, summary, publication date, category, and Markdown body. Attach returned media URLs in `image`, `video`, `videoPoster`, or a Markdown image/PDF link. It defaults to a draft and cannot overwrite an existing post.
3. Use `get_post` and `update_post_draft` to refine it. Updates require the current `expectedRevision`; omitted fields retain their values. Published posts are protected. To replace media, upload a different file and change this draft's URL; shared files are never overwritten with different bytes.
4. Call `submit_post_for_review` with the current revision. It starts the loopback review console if needed and returns a review link. The desk is at `http://127.0.0.1:4330/review`.
5. Edit the title, summary, date, category, tags, and Markdown in the editor. Browse existing media, upload a cover image/video/poster, insert an inline image/PDF, or replace/remove a draft's media. The human editor uses the same private B2 storage; there is no public upload endpoint. **Save changes and refresh preview** creates a new revision and review. Unsaved changes disable Publish.
6. Review the actual site typography, layout, cover, body formatting, and media in the preview. Press **Publish** yourself. Publication checks the exact revision and content digest, confirms referenced stored bytes still exist, records `human-review` in database history, then runs the staging-gated release command. The page reports publishing, completion, or failure. The model must never automate this action.

Saving or submitting a review never changes the live site. An edit made after a review is prepared invalidates that review. A successful publication makes the post read-only in this draft workflow. A failed publication can be explicitly retried; the same approval does not create duplicate database revisions. **Return to draft to edit** creates a fresh draft/review after a failed publication if the approved content has not changed.

An approval changes the D1 record to publication-ready before deployment. If staging or upload fails, that approval remains in D1 and the desk reports failure; it does not claim that the post is live. Inspect the local publishing log before retrying an uncertain upload. A failed staging test prevents production upload. Logs and review records stay in ignored `.wrangler/content-review/`.

If the review server stops during publication, a private SQLite lock tracks its owner and the deployment child. On macOS/Linux it also tracks the child's process group; on Windows only the direct child PID is tracked, so recovery does not guarantee detection of surviving grandchildren. An active tracked process keeps the lock. Once the tracked processes have stopped, the desk shows an interrupted publication with an unknown outcome, allowing an explicit retry or return to draft after inspecting the log. Lock acquisition and stale-owner replacement are transactional; recovery never publishes automatically.

## Projects as data

Projects already use the same D1 `content_items` table and shared validated
schema as posts. Use `list_projects`, `get_project`, `get_project_history`,
`create_project_draft`, `update_project_draft`, and `submit_project_for_review`.
Creating a project requires title, summary, role and Markdown body. Optional
fields include technologies, supported outcomes, repository URL, related article
slugs, display order, featured status, tags, cover image/description, and the
existing illustration choices. Project dates are not required or inferred.

The project desk supports editing these fields, private cover uploads and inline
image/PDF links. Its preview and public detail route share the same component,
including artwork, body, outcomes and role/tools sidebar. Revision checks, stale
reviews, private media and human-only publication apply equally to both
collections. Matching post/project slugs cannot cross-edit or cross-publish.
Existing published projects remain protected; this workflow only changes drafts.

## LinkedIn captures

Use `check_linkedin_sync` and `import_linkedin_post` for repeatable imports of
captured original posts. They preserve the source text and date, recognize
existing source identifiers and report upstream edits without overwriting content.
The publishing desk displays the original capture and keeps its text/date read-only
while allowing website metadata and media edits. Neither tool reads LinkedIn or
publishes. See [LinkedIn synchronization](linkedin-sync.md) for capture, source-date
verification, API limitations, and ongoing checks. Apply additive migration
`0003_linkedin_sources.sql` before remote use, then restart the MCP connection to
refresh its tool list.

## Media

Uploads accept PNG, JPEG, GIF, WebP, MP4, and PDF files, checked from file signatures. The MCP accepts files up to 100 MiB; the browser form remains limited to 25 MiB. SVG/executable uploads are rejected. Describe meaningful cover images in the image-description field.

Remote mode defaults to a private Backblaze B2 bucket configured locally under `assets/<sha256>.<extension>`, then records type, byte length, and original basename in D1's existing `media_assets` table. A failed storage upload never returns success or creates a draft reference. Local `.wrangler/content-media/object-cache/` is an optional private cache, not the source of truth: another checkout can reconstruct it through B2 and the D1 catalog. Downloads verify byte length, file signature, and SHA-256. Human approval rechecks storage rather than trusting cached bytes.

Keep the B2 bucket private. The website uses a separate read-only application key; uploads use a local read/write key, both scoped to this bucket and the `assets/` prefix. The website Worker exposes only GET/HEAD at `/media/<sha256>.<extension>`. Each build writes `dist/media-manifest.json` from rendered published HTML, including social-image references. Only files listed in that release can be read through the Worker. Knowing a draft's URL does not make its bytes accessible; approval alone also does not expose them before a release. Staging uses the same private bucket and its own tested manifest. Video responses support byte ranges and conditional requests. The published allowlist and media runtime are covered by the release artifact hash.

Post bodies use Markdown with the same Sätteri processor and Shiki theme as published posts. Active HTML, executable attributes, and unsafe link protocols are rejected. The rendered preview is also sandboxed without script/form execution, and its publication controls live outside the preview.

New uploads need no Git commits or CI upload permission. CI reads the published D1 snapshot, builds its media allowlist, then requires staged HTTP checks to retrieve every referenced storage object and verify its SHA-256 before promotion. Missing bytes stop the release. Existing versioned `public/images/`, `public/videos/`, and `public/slides/` assets keep working. Remote drafts cannot attach old machine-only pending `/uploads/` files: re-upload those through the MCP. No private research, new uploads, or draft catalog is pushed into the public source repository. Unreferenced storage objects are retained privately; automatic deletion is intentionally absent so shared or historical media cannot be removed by an agent.

See [b2-media.md](b2-media.md) for free-account setup, credentials, delivery, and performance verification. [r2-media.md](r2-media.md) documents the inactive R2 alternative.

New B2 PUT attempts reserve storage against a shared 8 GB ceiling before the upload starts. Repeated uploads reuse an existing object; a failed or concurrent PUT still consumes a reservation because B2 retains object versions. Authoring also stops at 5,000 upload attempts or 10,000 uncached downloads per UTC month. Limits fail closed, and agents cannot reset them. Apply the additive `0002_media_budget.sql` migration before remote uploads. These checks are application limits, not a provider-level spending cap.

## Local MCP setup

Use Node 24 LTS and `npm ci`. Launch the stdio server directly so npm banners do not enter its JSON-RPC output:

```sh
node mcp/content-server.mjs --remote
# A separate local SQLite database, for development only:
node mcp/content-server.mjs --local --database .wrangler/content-mcp.sqlite
# Explicit isolated media emulation, for integration tests only:
node mcp/content-server.mjs --local --database .wrangler/example.sqlite --local-r2 .wrangler/example-r2
# A deliberately configured loopback S3 fixture, never real B2:
node mcp/content-server.mjs --local --database .wrangler/example.sqlite --local-b2 .wrangler/test-b2.json
```

Remote mode uses the existing protected Wrangler login, or a Cloudflare token supplied to the server process. Backblaze authoring credentials live in an ignored owner-only `.wrangler/content-media/b2.json`; no credentials are placed in source or returned by a tool. Local SQLite files and review records are private to the OS user. This is a local stdio integration, not a hosted public MCP endpoint. It is an interface restriction, not a sandbox against code already running with the same user's shell/credential access.

The tools include `open_authoring_app`, shared `upload_media`/`list_media`,
`list_posts`, `get_post`, `get_post_history`, `create_post_draft`,
`update_post_draft`, `submit_post_for_review`, and their six `project`/`projects`
counterparts. `check_linkedin_sync` and `import_linkedin_post` add capture checks
and provenance-preserving imports. Lists default to drafts. Writes are limited
to post/project drafts and revision history, immutable LinkedIn provenance,
private media/catalog and budget reservations, review records, and the bounded
temporary App uploads described above. They validate the shared schema and
referenced assets. Bodies are limited to 32 KB and metadata to 16 KB. These
model-facing operations cannot publish, approve, delete content, deploy, or execute
arbitrary SQL. Only the human App control uses the app-only publication RPC. Local mode
never falls back to remote storage or remote D1.

The review console starts automatically on submission, or manually with `npm run content:review`. It binds only to `127.0.0.1:4330`. Review URLs are opaque capabilities; keep them private. Write requests require the matching review confirmation, exact same-origin browser metadata, and current revision/digest. A global local publication lock prevents two desk publications at once. Do not run manual or CI production deployments concurrently with a desk publication. A future hosted console needs its own authenticated publisher identity and authorization boundary.

Routes are injected only in explicitly enabled local development. Production/staging builds exclude the editor, review APIs, and pending uploads. The static website has no publishing endpoint.

## Verification

`npm test` includes a real stdio MCP client/SQLite round trip plus approval, history, safe-rendering, manifest isolation, and private-media checks. `npm run test:review` starts real local Astro and Wrangler servers, separate SQLite, and isolated R2 emulation and a disk-backed S3 HTTP fixture that independently verifies B2 request signatures. Playwright uploads through MCP, deletes the cache and recovers bytes from each storage backend, renders images in the browser, verifies private URLs return 404 publicly, and exercises Publish only in local mode. Its isolated release then verifies exact image/PDF bytes, MP4 ranges, conditional requests, immutable caching, and rejected writes through the real Worker. Stale reviews and cross-origin requests cannot publish. No test publishes a remote draft or writes remote D1/B2/R2. These fixture tests do not attest that a real B2 account is connected.

These tests are part of `npm run test:ci`; reports and screenshots are retained in `playwright-report-review/` and `test-results-review/`. Neither test content nor its media enters the public website.

The App tests use the official MCP Apps `AppBridge`, the actual resource and a
real stdio MCP server backed by isolated SQLite. Playwright edits projects,
round-trips private media bytes, checks rendered previews and stale revisions,
verifies the fallback local review handoff, and exercises the human Post control
only against isolated SQLite. It rejects changed drafts and script-triggered
clicks and confirms that previewing alone leaves a post as a draft. It also starts
and pauses a real private MP4 through the embedded player's controls. Protocol tests
also enforce resource metadata, app-only routing metadata, upload bounds,
signature checks and traversal rejection. This tests the standard bridge;
individual desktop hosts must also support MCP Apps and allow loopback links.
