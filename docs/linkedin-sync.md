# Keeping LinkedIn and the website aligned

LinkedIn is the original publication. New captures become private website drafts;
Alex reviews the rendering and presses Publish. Importing is never publication.

## Current capture workflow

1. Read Alex's latest original posts in his signed-in activity view. Expand the
   complete author text. Do not include comments, analytics, messages or another
   author's shared body. For reposts, capture Alex's commentary only.
2. Use each post's analytics export to verify its canonical Post URL and Post Date.
   Supply the original date as `YYYY-MM-DD`, not today's import date. Record the
   source of the date in `dateEvidence`. Local writing drafts can differ from the
   published text and are not the authority for the final body.
3. Call `check_linkedin_sync` with the captures. It reports `missing`, `unchanged`,
   `source-changed`, or `already-imported-legacy`. This checks only the supplied
   posts. It does not enumerate LinkedIn or prove complete feed coverage.
4. Upload the matching original media through `upload_media`. Attach it in the
   import metadata. Do not store expiring LinkedIn CDN URLs as website assets.
5. For each missing post, call `import_linkedin_post` with `capture: { sourceUrl,
date, text, dateEvidence }` and website `metadata: { title, summary, category,
tags, image, imageAlt, video, videoPoster, ... }`.
6. Call `submit_post_for_review` with the returned slug and revision. Alex can edit
   the title, summary, category, tags and media in the publishing desk. Captured
   text, date and source are preserved. He alone presses Publish.

Imports use deterministic slugs (`linkedin-<post identifier>`). URL tracking
parameters and `/posts/` versus `/feed/update/` variants with the same identifier
do not create duplicates. Use the canonical content identifier from the export;
an activity identifier can differ from a video's content identifier. Source edits
are surfaced without replacing drafts or published content. Deletions on LinkedIn
do not automatically delete or unpublish website articles.

The initial 33-post archive remains untouched. Legacy matches are recognized by
their stored source URLs; a legacy match does not claim that its body has been
compared with a new capture. New imports store an immutable original text/date
capture in the private `linkedin_sources` table. One transactional insert creates
the capture and draft together. Neither originals nor private export files are
added to the public publication snapshot or source repository while in draft.

## Ongoing checks

The MCP tools deliberately do not scrape LinkedIn, store LinkedIn cookies, or
post there. Prefer a deterministic capture integration where approved source
access exists. The current fallback is a daily assistant check at 9 a.m. local
using the existing signed-in author activity view and this workflow. Report
login/capture failures rather than claiming synchronization. This discovery step
uses an assistant; once a capture exists, duplicate checking and draft import
are ordinary code and MCP calls.
Keep notifications quiet when there are no new posts or actionable changes.
Website publication always remains a separate human action.

For a dependable source independent of browser sessions, a future writing flow
can capture the final post and LinkedIn identifier at the moment Alex publishes
it. A saved pre-publication draft alone is insufficient because Alex may edit it
in LinkedIn before posting.

## API limitations

As checked October 29, 2026, the [official Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
requires `r_member_social` permission to retrieve a person's posts. LinkedIn's
[Community Management FAQ](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-08)
says this permission is closed and is not accepting new access requests.
Normal [self-service sign-in and sharing permissions](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
do not grant it. Do not promise automatic personal-feed retrieval from a normal
OAuth connection or a third-party MCP wrapper.

LinkedIn's [download-your-data documentation](https://www.linkedin.com/help/linkedin/answer/a1339364/downloading-your-account-data)
also describes portability APIs for EU/EEA/Switzerland members. This is not a
general substitute for Alex's US account. Approved API access, if obtained later,
can feed the same capture/import tools without changing the review boundary.

## Setup and tests

`npm run linkedin:sync -- --remote --input <private-captures.json>` is a read-only
MCP client for a locally captured batch. Add `--apply --review` to upload the
specified media, create only missing drafts, and prepare human review links.
An optional `--output <private-report.json>` saves an owner-only report. Each array
item contains `capture`, website `metadata`, and optional `media` mapping
`image`, `video`, or `videoPoster` to absolute local file paths. Captures and
reports belong under ignored `artifacts/` or `.wrangler/`, never committed source.
The command has no publish or LinkedIn-posting operation. For isolated work use
`--local --database <sqlite-path>` instead of `--remote`.

Apply additive migration `0003_linkedin_sources.sql` before using the new MCP
with remote D1. Local SQLite applies it automatically. The deployment token stays
D1-read-only; schema changes use the local authenticated authoring connection.
No new credential or browser cookie is needed in GitHub Actions.

Real MCP/SQLite tests cover duplicate imports, unchanged versus edited originals,
canonical identifiers, preserved dates and literal text, invalid input, atomic
rollback and published-content protection. Playwright renders an imported draft
through the local server and edits its website metadata. Tests never import into
or publish from remote D1.
