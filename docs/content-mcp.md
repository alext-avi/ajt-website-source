# Draft, review, and publish

The `ajt-content` MCP creates website post drafts and submits specific revisions to the local publishing desk. Alex edits and approves the rendered draft there. The MCP does not expose arbitrary SQL, approval, publication, deployment, or deletion tools. It does not post to LinkedIn.

## Use the workflow

1. Ask the MCP to create a draft with `create_post_draft`. Supply a slug, title, summary, publication date, category, and Markdown body. It defaults to a draft and cannot overwrite an existing post.
2. Use `get_post` and `update_post_draft` to refine it. Updates require the current `expectedRevision`; omitted fields retain their values. Published posts are protected.
3. Call `submit_post_for_review` with the current revision. It starts the loopback review console if needed and returns a review link. The desk is at `http://127.0.0.1:4330/review`.
4. Edit the title, summary, date, category, tags, and Markdown in the editor. Browse existing media, upload a cover image/video/poster, insert an inline image/PDF, or replace/remove a draft's media. **Save changes and refresh preview** creates a new revision and review. Unsaved changes disable Publish.
5. Review the actual site typography, layout, cover, body formatting, and media in the preview. Press **Publish** yourself. Publication checks the exact revision and content digest, records `human-review` in database history, then runs the staging-gated release command. The page reports publishing, completion, or failure. The model must never automate this action.

Saving or submitting a review never changes the live site. An edit made after a review is prepared invalidates that review. A successful publication makes the post read-only in this draft workflow. A failed publication can be explicitly retried; the same approval does not create duplicate database revisions. **Return to draft to edit** creates a fresh draft/review after a failed publication if the approved content has not changed.

An approval changes the D1 record to publication-ready before deployment. If staging or upload fails, that approval remains in D1 and the desk reports failure; it does not claim that the post is live. Inspect the local publishing log before retrying an uncertain upload. A failed staging test prevents production upload. Logs and review records stay in ignored `.wrangler/content-review/`.

If the review server stops during publication, a private SQLite lock tracks both its owner and the detached deployment process group. An active deployment keeps the lock. Once both have stopped, the desk shows an interrupted publication with an unknown outcome, allowing an explicit retry or return to draft after inspecting the log. Lock acquisition and stale-owner replacement are transactional; recovery never publishes automatically.

## Media

Uploads accept PNG, JPEG, GIF, WebP, MP4, and PDF files, checked from file signatures, up to 25 MiB. SVG/executable uploads are rejected. Files receive content-addressed names. New uploads remain in ignored `.wrangler/content-media/`, outside `public/`, and are served only by the local review console. Publication copies only the approved post's referenced pending assets into public assets before building. Replacing media changes this draft's reference; it never overwrites a shared file used by another post. Describe meaningful cover images in the image-description field.

Post bodies use Markdown with the same Sätteri processor and Shiki theme as published posts. Active HTML, executable attributes, and unsafe link protocols are rejected. The rendered preview is also sandboxed without script/form execution, and its publication controls live outside the preview.

Approved assets are ordinary files in `public/uploads/` or `public/videos/`. Keep them and the refreshed publication snapshot in version control before deploying from a different checkout or enabling GitHub deployment; D1 stores references, not file bytes. The desk does not silently create Git commits or push content into the public source repository.

## Local MCP setup

Use Node 24 LTS and `npm ci`. Launch the stdio server directly so npm banners do not enter its JSON-RPC output:

```sh
node mcp/content-server.mjs --remote
# A separate local SQLite database, for development only:
node mcp/content-server.mjs --local --database .wrangler/content-mcp.sqlite
```

Remote mode uses the existing protected Wrangler login, or a Cloudflare token supplied to the server process. No Cloudflare credential is placed in source or returned by a tool. Local SQLite files and review records are private to the OS user. This is a local stdio integration, not a hosted public MCP endpoint. It is an interface restriction, not a sandbox against code already running with the same user's shell/credential access.

The tools are `list_posts`, `get_post`, `get_post_history`, `create_post_draft`, `update_post_draft`, and `submit_post_for_review`. `list_posts` defaults to drafts. Writes are limited to posts, retain revision history, validate the shared content schema, and check referenced assets. Bodies are limited to 32 KB and metadata to 16 KB.

The review console starts automatically on submission, or manually with `npm run content:review`. It binds only to `127.0.0.1:4330`. Review URLs are opaque capabilities; keep them private. Write requests require the matching review confirmation, exact same-origin browser metadata, and current revision/digest. A global local publication lock prevents two desk publications at once. Do not run manual or CI production deployments concurrently with a desk publication. A future hosted console needs its own authenticated publisher identity and authorization boundary.

Routes are injected only in explicitly enabled local development. Production/staging builds exclude the editor, review APIs, and pending uploads. The static website has no publishing endpoint.

## Verification

`npm test` includes a real stdio MCP client/SQLite round trip plus approval, history, safe-rendering, and private-media checks. `npm run test:review` starts a real local Astro server and separate SQLite database. Playwright creates/submits drafts through MCP, edits them in the browser, uploads/replaces an image, refreshes the rendered preview, and exercises Publish only in local mode. It verifies that stale reviews and cross-origin requests cannot publish. Local mode never deploys or writes remote D1.

These tests are part of `npm run test:ci`; reports and screenshots are retained in `playwright-report-review/` and `test-results-review/`. Neither test content nor its media enters the public website.
