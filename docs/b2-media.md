# Private Backblaze B2 media

The default remote media provider is B2. The website and D1 remain on Cloudflare. This source change alone does not create a Backblaze account, upload a file, configure a Worker secret, or prove live delivery speed.

## Account and credentials

1. Create/verify a free B2 account without adding a payment method. Inspect **Caps & Alerts** and retain free-account limits. Do not increase caps, enable paid features, create public buckets, add billing, or enable Event Notifications. Public buckets require payment verification; this design uses a private bucket. Record the verified limits before the first live upload.
2. Create one **private** bucket in an appropriate region. No public URL, CORS rule, or custom Backblaze domain is required. Leave Object Lock and Event Notifications disabled. Retain historical objects for release rollback; agents must not delete them.
3. Create a bucket-scoped authoring application key with read/write access, restricted to the `assets/` filename prefix. Do not use a master/account-wide key. Save this JSON to `.wrangler/content-media/b2.json` with file permissions `0600` and an owner-only parent directory. `AJT_B2_CONFIG` may point to another protected local file. Never paste keys into chat, Git, MCP arguments, or logs.

   ```json
   {
     "endpoint": "https://s3.us-east-005.backblazeb2.com",
     "bucket": "your-private-media-bucket",
     "keyId": "your-authoring-key-id",
     "applicationKey": "your-authoring-application-key"
   }
   ```

   Use the actual endpoint shown for the bucket. Remote requests only accept HTTPS `s3.<region>.backblazeb2.com` endpoints. Redirects and implicit retries are disabled. Local test mode permits only an explicitly configured HTTP loopback fixture; it cannot silently use real B2.
4. Create a **separate read-only** application key for the same bucket and prefix. Store `B2_MEDIA_ENDPOINT`, `B2_MEDIA_BUCKET`, `B2_MEDIA_KEY_ID`, and `B2_MEDIA_APPLICATION_KEY` as Cloudflare Worker secrets on **both** production and staging. For example, use Wrangler's interactive `secret put` commands or a protected temporary JSON file with `wrangler secret bulk`; never put secret values on the command line. No B2 write key belongs in the Worker, CI, browser, or public repository. CI deploys code and uses the Workers' existing read-only secrets.
5. Apply additive `migrations/0002_media_budget.sql` before remote authoring. This only adds budget metadata. It neither approves nor publishes content. The local SQLite backend initializes it automatically.

The stdio MCP retains exactly its draft/media tools. Alex reviews and presses Publish in the loopback editor; no agent can publish through the MCP.

## Delivery and caching

MCP/editor uploads use immutable `/media/<sha256>.<extension>` references. The private B2 key is `assets/<sha256>.<extension>`. The D1 catalog stores provider, MIME type, byte length, and original basename, with no credentials. Local `.wrangler/content-media/object-cache/` is expendable. A clean checkout can rehydrate and verify SHA-256, file signature, and byte length from B2. Human approval always rechecks durable bytes.

The public Worker checks the current release's rendered-media allowlist **before** any cache or storage read. A draft or removed reference returns 404 even if older bytes are cached. Public methods are GET/HEAD only; browser credentials and headers are never forwarded to B2. This keeps delivery on the site's own origin and avoids browser CORS/third-party-cookie dependencies.

Images and PDFs up to 10 MiB use the Workers Cache API after approval checks. `X-AJT-Media-Cache` reports `MISS`, `HIT`, or `BYPASS`. Cached bytes are immutable and browser-cacheable for one year. Cache contents are local to a Cloudflare data center and can be evicted; a miss still fetches B2. Video and range requests bypass the edge object cache and stream from B2 with validated range/size headers. Staging's outer response remains `no-store`/`noindex`, including for internally cached media.

B2 is always-hot storage, with no archive restoration step. Actual image latency depends on origin location, file size, network conditions, and caching; local fixture results are not performance evidence for the live provider.

## Free usage and safety limits

Stay on a free B2 account with no payment method. Provider-enforced free-account restrictions take precedence over application counters. Verify the account's effective settings; do not claim an unconditional account-wide spending guarantee from these counters. Backblaze caps exclude Class D operations, so Event Notifications remain disabled.

The existing shared D1 ledger stops this authoring workflow at 8,000,000,000 reserved bytes. B2 retains versions, so each attempted new PUT reserves its full byte size, including failed/uncertain/concurrent writes. A HEAD check reuses an existing immutable object without another PUT. Reservations are not automatically reclaimed. Up to 5,000 authoring upload operations and 10,000 uncached authoring downloads are allowed per UTC calendar month; an upload can also include one HEAD request. Errors never trigger hidden retries. These are conservative application limits, separate from B2's account caps and Cloudflare Workers' request allowance. Direct API access and other applications are outside this workflow's limits.

## Verification and first live trial

`npm test` exercises real signed HTTP calls against an independent local S3 fixture, file integrity, version reservations, endpoint restrictions, cache hits, and allowlist checks before cache access. `npm run test:review` exercises actual MCP/editor/SQLite/Worker flows for both B2 and R2 using isolated storage. It publishes only local test records. These tests never write remote D1 or cloud storage.

After account setup, privately upload one already-public website image through the MCP. For a delivery benchmark, use a staging-only trial artifact whose media allowlist references that image, with an unreferenced private upload as a 404 control. Never create or publish a remote test post. Measure the actual staging route and save evidence:

```sh
node scripts/benchmark-media.mjs --origin https://your-staging-site.example --path /media/SHA256.jpg
```

The script makes real GET requests, verifies each body against its content-addressed filename, and records time to headers, total download time, byte count, cache state, and Cloudflare request IDs. It reports observations from the machine running it, not a worldwide latency guarantee. Run a browser check of the rendered image as well. Production promotion still requires the normal tested release and human publication workflow.

Sources: [B2 setup](https://www.backblaze.com/cloud-storage), [private B2 through Cloudflare](https://www.backblaze.com/docs/cloud-storage-deliver-private-backblaze-b2-content-through-cloudflare-cdn), [caps](https://www.backblaze.com/docs/en/cloud-storage-data-caps-and-alerts), [B2 pricing](https://www.backblaze.com/cloud-storage/pricing), [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).
