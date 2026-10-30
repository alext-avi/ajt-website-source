# Hosted authoring and direct content publication

The hosted path is `MCP App → authenticated authoring Worker → D1 → server-rendered website`. Content Post does not invoke GitHub, start a build, run a local process, or dispatch Actions. Actions releases code/templates only.

Runtime builds automatically remove adapter-generated preview environment files, scan remaining artifacts for configured credentials, and clear Wrangler’s default-command redirect. Static and runtime release commands always use explicit configurations.

The existing local stdio MCP and static site remain available until rollout is enabled. The local `--remote` flag still means remote storage, not a hosted MCP server.

## Identity and human review

GitHub is the identity provider; no additional IdP account is required. `@cloudflare/workers-oauth-provider` handles MCP OAuth 2.1, browser-bound consent/state, PKCE, encrypted token storage, audience checks, ten-minute access tokens, thirty-day refresh grants and revocation. GitHub's public-profile login is used only to verify numeric account ID `13840761`. GitHub tokens are discarded after identity verification. No repository permissions are requested.

The owner's authenticated MCP connection supports draft/media tools and the rendered App. Model-facing tools cannot publish. The app-only Post RPC takes a random, ten-minute preview capability bound to the owner, collection, slug, revision and content digest. The App calls it only from a trusted user click. Concurrent/repeated requests cannot create another revision. A changed draft requires a fresh preview. Approval, revision history, the approved snapshot and media permissions commit together in D1.

App-only routing is enforced by the MCP host. It is not cryptographic human attestation, nor a sandbox against a malicious client holding the owner's token. The server still authenticates every request and validates the saved revision. There is one GitHub login and one Post click; no second publishing desk is required.

OAuth grants are independent authoring sessions. Revoking the GitHub login app is not a substitute for revoking already-issued authoring grants. Use the provider's advertised revocation endpoint or clear the authoring OAuth namespace as an owner recovery action; do not expose that administrative operation as an agent tool.

## Public content and media

`published_content` is separate from working copies, LinkedIn captures and revision history. Migration 0004 backfills **only already-approved** content. The public runtime selects from that table; listings, home features, detail routes, tags, RSS and sitemaps use the same approved source. HTML/XML are initially uncached so the next request sees a committed Post. Future-dated posts remain hidden until their publication date.

The public Worker receives a read-only B2 delivery key. The authoring Worker receives a separate bucket/prefix-scoped B2 read/write key. No key is sent to the App/model. Public `/media/` checks current approved references before reading the edge cache or B2. Guessing a draft's URL does not expose it. Native MP4 follows the post body.

Browser uploads use bounded 256 KiB tool chunks, with a maximum of two active uploads and 25 MiB per file. Temporary chunks live in D1 for at most ten minutes and are removed after completion or on subsequent upload cleanup. Complete objects live in B2. Existing storage/request reservations remain enforced. These are application limits, not a provider spending cap. Remote servers cannot read a Mac filesystem path: use the App file picker for large local files; the remote `upload_media` tool accepts a small base64 payload.

## Rollout

1. Create a **personal GitHub OAuth App** at <https://github.com/settings/applications/new>:
   - Name: `Alexander Thomas Website Authoring`
   - Homepage: `https://ajt-content.alexander-jt.workers.dev`
   - Callback: `https://ajt-content.alexander-jt.workers.dev/callback`
   - Leave Device Flow disabled.
2. Run `npm run setup:remote -- --configure` in a local terminal. The hidden prompts save the OAuth values and existing private B2 authoring configuration to ignored, owner-only `.dev.vars.authoring`. Do not paste secrets into chat.
3. Run `npm run setup:remote -- --apply`. This verifies the private repository's main-only production environment before sending authoring secrets through stdin to GitHub. It does not deploy, publish, or enable remote mode.
4. Authorize the additional **`workers_kv:write`** Wrangler scope, preserving existing account/Worker/D1 permissions. Create the `ajt-content-oauth` KV namespace and replace the production namespace placeholder in `wrangler.authoring.jsonc`. Keep the optional staging authoring namespace separate if that endpoint is activated later.
5. Apply migration 0004 to production and all migrations to the separate `ajt-website-content-staging` database. Run `npm run sync:staging` locally to copy only already-approved content as a staging baseline. CI keeps D1 read access; it receives no direct D1 write credential.
6. Review/merge the code while `REMOTE_CONTENT_ENABLED` is unset. After the schema, resources, secrets and staging baseline are ready, set private repository Actions variable `REMOTE_CONTENT_ENABLED=true` and dispatch the main verification/release workflow. The runtime release stages the compiled artifact, runs existing real desktop/mobile/HTTP gates, verifies artifact identity, then deploys production. This is a code rollout, not content publication.
7. Release the authoring Worker through its main-only workflow. It refuses to publish content until the website's `/.well-known/ajt-content` reports the direct-D1 runtime. Test the real GitHub sign-in, then connect the MCP client to `https://ajt-content.alexander-jt.workers.dev/mcp`. Keep the local connection until the real hosted App is verified by Alex.

The optional staging authoring endpoint needs its own OAuth callback registration/namespace. Automated publication tests never use it: all Post/Publish tests use synthetic content and isolated local SQLite.

`sync:staging` never overwrites existing staging content or turns a staging draft into a published record. Refresh that baseline deliberately when the release's approved fixtures change. Do not use production drafts as staging test data.

## Verification

`npm run test:remote` starts real Workers and an Astro server runtime backed by isolated local SQLite, plus a signed loopback B2 fixture. Only GitHub's upstream identity response is simulated. The browser exercises actual consent, browser state, PKCE, token exchange, authenticated HTTP MCP, official AppBridge, editor, chunked upload, saved preview and a trusted Post click. It verifies draft/media secrecy, unknown-account rejection, stale previews, both post/project publication, and immediate public listings/feed/sitemap updates. No production publication, remote database write, external storage upload or GitHub Actions dispatch occurs.

`npm test` also verifies owner-bound and expired capabilities, concurrent/repeated requests, revision history, rollback, and the inactive-runtime guard using disposable SQLite. The existing site and local review suites remain blocking in CI. These tests do not attest that real GitHub OAuth registration or deployed remote sign-in is configured.

References: [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/), [GitHub OAuth template](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth), [MCP App-only tools](https://apps.extensions.modelcontextprotocol.io/api/documents/Patterns.html#tools-that-are-private-to-apps), [Astro Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/).
