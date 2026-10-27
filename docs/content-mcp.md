# Draft, review, and publish

The `ajt-content` MCP creates website post drafts and submits specific revisions to the local publishing desk. Alex edits and approves the rendered draft there. The MCP does not expose arbitrary SQL, approval, publication, deployment, or deletion tools. It does not post to LinkedIn.

## Use the workflow

1. Upload any new media with `upload_media`, supplying its absolute local file path. It returns a private, immutable `/media/<sha256>.<extension>` URL. Use `list_media` to find reusable assets. File bytes need not go through the conversation.
2. Ask the MCP to create a draft with `create_post_draft`. Supply a slug, title, summary, publication date, category, and Markdown body. Attach returned media URLs in `image`, `video`, `videoPoster`, or a Markdown image/PDF link. It defaults to a draft and cannot overwrite an existing post.
3. Use `get_post` and `update_post_draft` to refine it. Updates require the current `expectedRevision`; omitted fields retain their values. Published posts are protected. To replace media, upload a different file and change this draft's URL; shared files are never overwritten with different bytes.
4. Call `submit_post_for_review` with the current revision. It starts the loopback review console if needed and returns a review link. The desk is at `http://127.0.0.1:4330/review`.
5. Edit the title, summary, date, category, tags, and Markdown in the editor. Browse existing media, upload a cover image/video/poster, insert an inline image/PDF, or replace/remove a draft's media. The human editor uses the same private R2 storage; there is no public upload endpoint. **Save changes and refresh preview** creates a new revision and review. Unsaved changes disable Publish.
6. Review the actual site typography, layout, cover, body formatting, and media in the preview. Press **Publish** yourself. Publication checks the exact revision and content digest, confirms referenced R2 bytes still exist, records `human-review` in database history, then runs the staging-gated release command. The page reports publishing, completion, or failure. The model must never automate this action.

Saving or submitting a review never changes the live site. An edit made after a review is prepared invalidates that review. A successful publication makes the post read-only in this draft workflow. A failed publication can be explicitly retried; the same approval does not create duplicate database revisions. **Return to draft to edit** creates a fresh draft/review after a failed publication if the approved content has not changed.

An approval changes the D1 record to publication-ready before deployment. If staging or upload fails, that approval remains in D1 and the desk reports failure; it does not claim that the post is live. Inspect the local publishing log before retrying an uncertain upload. A failed staging test prevents production upload. Logs and review records stay in ignored `.wrangler/content-review/`.

If the review server stops during publication, a private SQLite lock tracks its owner and the deployment child. On macOS/Linux it also tracks the child's process group; on Windows only the direct child PID is tracked, so recovery does not guarantee detection of surviving grandchildren. An active tracked process keeps the lock. Once the tracked processes have stopped, the desk shows an interrupted publication with an unknown outcome, allowing an explicit retry or return to draft after inspecting the log. Lock acquisition and stale-owner replacement are transactional; recovery never publishes automatically.

## Media

Uploads accept PNG, JPEG, GIF, WebP, MP4, and PDF files, checked from file signatures. The MCP accepts files up to 100 MiB; the browser form remains limited to 25 MiB. SVG/executable uploads are rejected. Describe meaningful cover images in the image-description field.

Remote mode writes bytes to the private Cloudflare R2 Standard bucket `ajt-website-media` under `assets/<sha256>.<extension>`, then records type, byte length, and original basename in D1's existing `media_assets` table. A failed R2 upload never returns success or creates a draft reference. Local `.wrangler/content-media/r2-cache/` is an optional private cache, not the source of truth: another checkout can reconstruct it through R2 and the D1 catalog. Downloads verify byte length, file signature, and SHA-256. Human approval rechecks storage rather than trusting cached bytes.

Keep R2 public development URLs and custom-domain access disabled. The website Worker exposes only GET/HEAD at `/media/<sha256>.<extension>`. Each build writes `dist/media-manifest.json` from rendered published HTML, including social-image references. Only files listed in that release can be read through the Worker. Knowing a draft's URL does not make its bytes accessible; approval alone also does not expose them before a release. Staging uses the same private bucket and its own tested manifest. Video responses support byte ranges and conditional requests. The published allowlist and media runtime are covered by the release artifact hash.

Post bodies use Markdown with the same Sätteri processor and Shiki theme as published posts. Active HTML, executable attributes, and unsafe link protocols are rejected. The rendered preview is also sandboxed without script/form execution, and its publication controls live outside the preview.

New uploads need no Git commits or CI upload permission. CI reads the published D1 snapshot, builds its media allowlist, then requires staged HTTP checks to retrieve every referenced R2 object and verify its SHA-256 before promotion. Missing bytes stop the release. Existing versioned `public/images/`, `public/videos/`, and `public/slides/` assets keep working. Remote drafts cannot attach old machine-only pending `/uploads/` files: re-upload those through the MCP. No private research, new uploads, or draft catalog is pushed into the public source repository. Unreferenced R2 objects are retained privately; automatic deletion is intentionally absent so shared or historical media cannot be removed by an agent.

See [r2-media.md](r2-media.md) for subscription, bucket setup, permissions, and cost limits.

## Local MCP setup

Use Node 24 LTS and `npm ci`. Launch the stdio server directly so npm banners do not enter its JSON-RPC output:

```sh
node mcp/content-server.mjs --remote
# A separate local SQLite database, for development only:
node mcp/content-server.mjs --local --database .wrangler/content-mcp.sqlite
# Explicit isolated R2 emulation, for integration tests only:
node mcp/content-server.mjs --local --database .wrangler/example.sqlite --local-r2 .wrangler/example-r2
```

Remote mode uses the existing protected Wrangler login, or a Cloudflare token supplied to the server process. No Cloudflare credential is placed in source or returned by a tool. Local SQLite files and review records are private to the OS user. This is a local stdio integration, not a hosted public MCP endpoint. It is an interface restriction, not a sandbox against code already running with the same user's shell/credential access.

The tools are `upload_media`, `list_media`, `list_posts`, `get_post`, `get_post_history`, `create_post_draft`, `update_post_draft`, and `submit_post_for_review`. `list_posts` defaults to drafts. Writes are limited to private uploads and post drafts, retain revision history, validate the shared content schema, and check referenced assets. Bodies are limited to 32 KB and metadata to 16 KB. None can publish, approve, delete, deploy, or execute arbitrary SQL. Local mode never falls back to remote R2 or remote D1.

The review console starts automatically on submission, or manually with `npm run content:review`. It binds only to `127.0.0.1:4330`. Review URLs are opaque capabilities; keep them private. Write requests require the matching review confirmation, exact same-origin browser metadata, and current revision/digest. A global local publication lock prevents two desk publications at once. Do not run manual or CI production deployments concurrently with a desk publication. A future hosted console needs its own authenticated publisher identity and authorization boundary.

Routes are injected only in explicitly enabled local development. Production/staging builds exclude the editor, review APIs, and pending uploads. The static website has no publishing endpoint.

## Verification

`npm test` includes a real stdio MCP client/SQLite round trip plus approval, history, safe-rendering, manifest isolation, and private-media checks. `npm run test:review` starts real local Astro and Wrangler servers, separate SQLite, and shared isolated R2 emulation. Playwright uploads through MCP, deletes the cache and recovers bytes from R2, renders images in the browser, verifies private URLs return 404 publicly, and exercises Publish only in local mode. Its isolated release then verifies exact image/PDF bytes, MP4 ranges, conditional requests, immutable caching, and rejected writes through the real Worker. Stale reviews and cross-origin requests cannot publish. No test publishes a remote draft or writes remote D1/R2.

These tests are part of `npm run test:ci`; reports and screenshots are retained in `playwright-report-review/` and `test-results-review/`. Neither test content nor its media enters the public website.
