# Editing content

Run `npm run dev` and open `/keystatic/` on localhost. The editor has Writing, Projects, and Speaking collections, each backed by MDX files. You can also edit those files directly in an IDE or in GitHub’s authenticated file editor.

## Creating and editing

Choose a collection, create an entry, fill its required fields, and save. The title determines the initial slug. Changing a published slug changes its URL; keep stable slugs or add a redirect before renaming.

Writing requires a title, summary, publication date, and category. Projects require a title, summary, and role. Talks require a title, summary, audience, and status. Upcoming talks additionally require an event, date, and location. Past sessions require an event or engagement context; date and location are optional when they are not intended for public disclosure. Omit a private date entirely rather than hiding it with CSS. Proposed topics must not be presented as confirmed appearances.

All entries support tags, featured status, a draft checkbox, an example-content label, a cover image, image alternative text, and rich MDX body content. Write a useful alternative description for non-decorative images. The project editor also includes technologies, verified outcomes, a public repository URL, related article slugs, ordering, and an illustration style. Talks include slides, video, resources, and related article slugs.

## Previewing

Imported LinkedIn writing uses the original date and author body. `linkedinUrl` links to the original publication; `linkedinRepost` identifies commentary on a shared post, and `linkedinVideo` identifies posts whose originals include video. Keep the body unchanged when maintaining an archive entry. Editorial titles, summaries, categories, and tags can differ from LinkedIn’s untitled feed format. Local attached images live under `public/images/linkedin/`. The import manifest and build test protect the captured wording and publication dates.

Local development includes drafts and future-dated articles. Draft pages show a clear notice and all local pages are `noindex`. Changes appear in the local website after saving. Open the relevant slug in a second tab to inspect it.

Use `npm run build && npm run preview` to inspect the public result. Production filters out drafts and future-dated articles from listings, detail routes, tags, and the sitemap. RSS always excludes drafts and future-dated articles, even during local development.

Keystatic’s preview workflow here is the local website in a second tab. It does not provide a hosted per-branch preview service. GitHub-mode branch content must be checked out locally to render it; writing to a remote branch does not automatically change the local filesystem.

## Publishing and unpublishing

To publish, turn off **Draft**, save, and review the local page. Push the specific record to D1 with its current revision, then export the publication snapshot with `npm run db:pull -- --remote`. Commit the snapshot, authoring file, and any new media. Follow the exact commands in [D1 storage](d1-content.md). GitHub Actions pulls D1, verifies the resulting build, and deploys `main` when its Cloudflare CI secret is configured; see [deployment setup](deployment.md). Manual publication uses `npm run deploy` through the authorized local Wrangler login.

To unpublish, turn **Draft** on, save, and push that record's next revision to D1 before pulling the snapshot and deploying. The next successful deployment removes the detail route, listing entries, tag references, and feed item. A future article date also holds a post out of production. Time passing does not rebuild a static site: publish scheduled articles by triggering a build at or after the intended date.

Publication dates are interpreted in UTC. Dates in the UI display in UTC so date-only values do not shift to the previous day in another timezone. Future event dates are allowed on published talks because an upcoming appearance is intentionally public.

Production content comes from D1. To unpublish, set the record's draft flag and push the next revision to D1, then pull the snapshot and deploy. Deleting only a local authoring file does not remove the D1 record. Git and D1 revision history retain previous versions; a draft flag is not a way to remove a secret from history.

## Images and technical content

Cover-image and body-image uploads are saved under `public/uploads/` and versioned alongside the content. Their URL begins with `/uploads/`. Keep filenames stable, resize images before uploading, and use appropriate compressed web formats. Public assets are copied to production regardless of an entry’s draft flag. Do not upload confidential draft images into `public/`.

MDX supports Markdown headings, lists, tables, links, code fences, and images. Code fences include the language (`typescript`, `csharp`, `json`, etc.) for build-time syntax highlighting. Articles with three or more second- or third-level headings get an automatic table of contents. Related articles are selected by shared tags; project and talk relationships use article slugs.


## Article videos

For local originals, set `video` to `/videos/name.mp4`, `videoPoster` to a local image, and `videoWidth` / `videoHeight` to the original dimensions. Use H.264 MP4 with web-compatible audio, if present. Keep files below Cloudflare’s 25 MiB static asset limit. A fast-start container allows playback metadata to arrive before the encoded media; rearranging that container does not require re-encoding the video. Local players use native controls and `preload="none"`.

For a shared video, obtain LinkedIn’s official **Embed video only** URL from the original creator’s public post. Set `linkedinVideoEmbed`, `linkedinVideoCredit`, and `linkedinVideoSource`. Do not embed Alex’s commentary repost itself, or copy another creator’s video file. The player is kept in an inert template until the visitor chooses **Load video player**. The original video link and attribution remain visible, including without JavaScript. The security policy allows LinkedIn frames and same-origin local video; no other embed provider is enabled.

`docs/linkedin-videos.json` records the five matched video sources, dimensions, hashes, and creator attribution. Original publication dates and body hashes remain in the separate import manifest.

The Keystatic schema mirrors the Astro schema. When adding a field, update both `keystatic.config.ts` and `src/content.config.ts`, plus its display template if needed. This prevents a structured editor save from dropping metadata it does not know about.

## Public slide downloads

Talks can link to an external slide URL or a local `/slides/name.pdf`. PDFs are copied from `public/slides/`; cover previews are in `public/images/talks/`. A cover with a configured slide URL appears as a linked preview on the talk page. Keep the original deck design and public event date. Incremental slide builds can appear as repeated pages in the PDF.

Only public talk material is hosted. Enterprise consulting and other non-public sessions retain descriptions without slide downloads. A draft flag does not protect a file placed in `public/`; keep private decks, notes, research reports, and draft exports outside that directory.
