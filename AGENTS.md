# Website content workflow

Use the `ajt-content` MCP to create and revise website post drafts and submit them for review. Preserve original imported LinkedIn text and dates.

Alex publishes content from the local review page after seeing the rendered draft. Never publish a new post on his behalf: do not automate the Publish button, call the review publication endpoint, change a draft to published directly in D1, or use a deployment command to bypass his review. The MCP intentionally has no approve, publish, deploy, or arbitrary SQL tool.

Publication tests may exercise the Publish control only against an isolated local SQLite backend. Never use real production posts or the remote D1 database for test publication.

Keep the public source repository's independent, sanitized history separate from production history. Attribute Git author and committer to Alex Thomas, `13840761+alext-avi@users.noreply.github.com`; do not add model or harness coauthors.
