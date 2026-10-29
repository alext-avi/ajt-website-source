# Website content workflow

Use the `ajt-content` MCP to create and revise website post drafts and submit them for review. Preserve original imported LinkedIn text and dates.

Alex publishes content by pressing Post in the rendered MCP App, or Publish on the local review page, after seeing the saved draft. Never publish on his behalf: do not automate either control, call the app-only publication RPC or review publication endpoint, change a draft to published directly in D1, or deploy to bypass his review. Model-facing MCP tools remain draft-only. Publication and status RPCs are app-only and must only be invoked by Alex's interaction with the rendered App.

Publication tests may exercise Post/Publish only against an isolated local SQLite backend. Never use real production posts or the remote D1 database for test publication.

Keep the public source repository's independent, sanitized history separate from production history. Attribute Git author and committer to Alex Thomas, `13840761+alext-avi@users.noreply.github.com`; do not add model or harness coauthors.
