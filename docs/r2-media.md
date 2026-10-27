# Private R2 media storage

New media lives in Cloudflare R2, independent of Git and the author's computer. Authoring uploads happen through the local `ajt-content` MCP (or Alex's loopback editor). The public website has no upload, overwrite, delete, or approval endpoint. R2's own public URL must remain disabled.

## Setup and activation

1. In the website's Cloudflare account, open **Storage & databases → R2 → Overview**. Enable the R2 subscription if needed. This requires Cloudflare's checkout/billing setup; do not complete it without Alex's approval. This account returned API error 10042 (R2 not enabled) during implementation; local tests do not claim that cloud activation happened.
2. With authorized R2 access, create the private Standard bucket: `npx wrangler r2 bucket create ajt-website-media`. Keep public development URL/custom-domain access disabled. No paid media transformation or streaming service is required for this implementation.
3. Authoring requires object read/write access to this bucket, in addition to existing D1 authoring permissions. Use local Wrangler authorization; if additional permission is required, request only R2 while preserving existing permissions. Do not put credentials in MCP arguments, source, logs, or chat. The MCP exposes no bucket administration tool. The same OS user's direct shell/credential access is outside the MCP's interface boundary.
4. Both existing Worker environments bind this bucket as `MEDIA_BUCKET`. Deployment must be authorized to attach that binding. CI does not upload media, edit the media catalog, create buckets, enable subscriptions, or receive R2 object-write credentials. Review the actual Cloudflare permission requirements before granting the deployment credential; do not silently expand account access.
5. Run `npm run verify`, `npm run test:e2e`, and `npm run test:review`. Then `npm run stage` tests a release on the real staging server, including its approved R2 files. Only the normal staging-gated release can update production.
6. For the first live content trial, Alex supplies/approves an actual media file, the MCP uploads it privately, and Alex reviews and presses Publish. Verify a second clean checkout can resolve the asset using only D1/R2, and verify production bytes after promotion. Never create or publish a production test post automatically.

R2 objects use immutable content-addressed names; replacement uploads get a new URL. Human approval verifies every referenced uploaded object's bytes before changing the D1 draft flag. Build output contains only approved media references. Each Worker checks that release's allowlist before reading R2; unlisted objects return 404 without an R2 read. Staging checks hash every referenced R2 object, so missing/corrupt media blocks promotion. Rolling back an artifact restores its allowlist; existing cached public bytes cannot be recalled. Keep historical R2 objects so older releases still have their referenced bytes.

## Cost

The public HTTP interface is read-only. The R2 Worker binding itself provides read/write capability; a credential that can replace Worker code is therefore trusted with that binding. Restrict deployment access and workflow changes accordingly. The local MCP's limited tool set is also an interface boundary, not a sandbox against the same OS user's shell credentials.

Cloudflare's Standard R2 allowance includes **10 GB-month of storage, 1 million Class A operations, and 10 million Class B operations per month**. Internet egress has no R2 bandwidth charge. Usage beyond the allowance is billed: currently $0.015/GB-month, $4.50/million Class A operations, and $0.36/million Class B operations. This is a usage-billed subscription with included free usage, not a hard free-only cap. Workers requests have their own allowance. The MCP limits each file to 100 MiB; that is not a total account budget limit. Unused uploads still consume storage until deliberately cleaned up.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 subscription setup](https://developers.cloudflare.com/r2/get-started/), [private bucket access](https://developers.cloudflare.com/r2/buckets/public-buckets/), [Worker R2 bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
