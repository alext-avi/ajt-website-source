# Editing content

Posts and projects are data in D1. The `ajt-content` MCP creates validated drafts,
retains revisions and submits them to the local publishing desk. Alex reviews
the rendered draft and presses Publish himself. The MCP cannot publish or deploy.

See [the draft/review workflow](content-mcp.md) for the current authoring tools,
editor, media library, upload/replacement controls, and revision checks.

Posts require a title, summary, original publication date, category and Markdown
body. Projects require a title, summary, role and body, with optional tools,
supported outcomes, tags, repository URL, related writing, display order and
artwork. The project preview uses the same layout as the public project page.
Dates are not inferred for project work.

LinkedIn imports preserve published author text and original dates. Website
titles, summaries, categories and tags are editorial metadata. Use the repeatable
[capture/import workflow](linkedin-sync.md) to recognize duplicates and flag
source edits. A captured post becomes a website draft, never a publication.

Media uploads use private Backblaze B2 through the MCP or local desk. New bytes
remain private until referenced by a published release's media allowlist. Upload
a new immutable asset to replace media on a draft; shared files are not overwritten.
Never place confidential files in `public/`, whose versioned contents are public.
Public talks may link to slide PDFs; non-public sessions retain descriptions only.

Publication is initiated only by Alex from the rendered review. It verifies the
exact revision and stored media, then runs the staging-gated release. A failed
release remains visible for human retry or return to draft. Repository main
changes also deploy through [GitHub Actions](deployment.md); builds read only
published D1 content. New draft content does not enter public source history.

Date-only post values display in UTC, avoiding a shift to the previous day.
Upcoming talks may have future dates; confidential engagement dates are omitted
entirely. Keep published slugs stable because they determine public URLs.

The legacy local Keystatic/MDX files remain available as historical authoring
sources and speaking configuration. Editing a local file does not change D1.
They are not the publication or new-post workflow. Do not bypass Alex's review
by changing draft flags, pushing SQL, or deploying new content directly.
