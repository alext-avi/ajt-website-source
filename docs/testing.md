# Automated testing

Use Node 24 LTS and install the lockfile-pinned dependencies and test browsers:

```sh
npm ci
npx --no-install playwright install chromium webkit
npm run test:ci
```

On Linux, use `playwright install --with-deps chromium webkit` to install the browsers' system libraries. CI uses Microsoft's digest-pinned Playwright container with browsers and libraries preinstalled, avoiding a fresh Ubuntu package download on every run. Keep the image version and digest in `.github/workflows/verify.yml` aligned with `@playwright/test` when upgrading.

## Integration coverage

Playwright runs browser journeys in desktop Chromium and mobile WebKit (iPhone 13 emulation). It covers main navigation, mobile menu keyboard focus, dark-mode defaults and theme persistence, Writing search/category links and browser-back behavior, wildcard referral navigation, native video markup, opt-in LinkedIn players, and analytics consent, URL sanitization, withdrawal, and Do Not Track. The mobile-menu-specific test runs only in the mobile project.

A separate HTTP project exercises the actual Worker and static asset server: referral redirects and method handling, invalid/private/unpublished routes, public PDF slides, consulting-slide exclusion, and MP4 delivery. Tests check uncaught browser errors. Third-party browser requests are blocked; the analytics script and LinkedIn player are fulfilled with test responses in the tests that need them.

The Playwright web-server configuration builds the production site from the committed D1 publication snapshot and serves it through local Wrangler at **https://127.0.0.1:8794**. It starts its own server and fails if that port is occupied, preventing an old development server from satisfying the tests. Local database state is kept under ignored `.wrangler/integration`; no remote D1 access or Cloudflare credentials are required.

HTTPS preserves the production `upgrade-insecure-requests` security header, including Safari behavior. Certificate errors are ignored only for this loopback test server's generated certificate. The test build uses its loopback HTTPS origin as its canonical origin and the synthetic GA4 ID `G-E2E000000`. Tests send no real Google Analytics events, and CI does not deploy this test build. Production deployment rebuilds using its own configuration and retains the existing repository, branch, event, and credential guards.

## Commands and diagnostics

```sh
npm run verify                                      # Existing type/build/Node checks
npm run test:e2e                                    # Build and run all integration projects
npm run test:e2e -- --project=mobile-safari           # Mobile WebKit only
npm run test:e2e:ui                                 # Interactive Playwright UI
npx --no-install playwright show-report              # Open the latest HTML report
npx --no-install playwright show-trace path/to/trace.zip
```

`npm run test:ci` runs type checking, builds and tests the site through Playwright, and runs the existing Node content/database/referral checks against that build. Every test gets a fresh browser context. CI retries a failed integration test once and rejects accidentally focused tests (`test.only`). Screenshots and traces are retained on failure; HTML reports and failure artifacts are uploaded by GitHub Actions for seven days. Local reports and test results are Git-ignored.

## Deployed staging gate

`npm run stage` refreshes published D1 content, verifies and builds the production artifact, stamps its source revision and SHA-256 identity, deploys it to `https://alexander-thomas-staging.alexander-jt.workers.dev`, and runs `playwright.staging.config.ts`. `npm run deploy` performs the same sequence and only then uploads the tested assets to production. CI uses that same entry point. The stage-only command never promotes to production.

Seven tests make real HTTPS requests with normal certificate validation and no response mocks: two desktop/mobile browser journeys plus five HTTP tests. They cover navigation, theme persistence, search, original post dates, wildcard referrals, media markup, PDFs/video delivery, private-route exclusions, staging response headers, and the expected release manifest. Browser evidence records actual Cloudflare Ray IDs and release IDs; failures retain screenshots/traces. CI saves `staging-playwright-results` for seven days.

Staging serves the production build's canonical URLs. Its Worker adds `X-Robots-Tag: noindex, nofollow` to every response and has no database binding. The Google tag only runs when the browser origin matches the build's canonical origin. Staging tests deliberately start with analytics consent already allowed and require no production analytics requests. They do not replace the separate real production Google collection/API round trip.

`dist/release.json` identifies the source revision and hashes all static assets plus Worker/referral source and Wrangler configuration. The deployment command verifies the local artifact and the currently served staging identity after tests, without rebuilding, then rechecks the latest `main` before promotion in CI. Any test failure, changed build, mismatched staging release, or failed identity check prevents production upload. The workflow serializes releases. Local operators must avoid simultaneous manual production deployments.

To rerun tests on an already prepared candidate, set `PLAYWRIGHT_STAGING_URL`, `EXPECTED_RELEASE_ID`, `EXPECTED_SOURCE_REVISION`, and `EXPECTED_CANONICAL_ORIGIN`, then run `npm run test:staging`. Use the recorded candidate identity, not values copied from an arbitrary current response.

## Live production tests

The live suite also writes machine-readable journey manifests for [GA4 API ingestion verification](ga4-api-verification.md). After both full browser journeys pass, production CI uses a read-only Realtime Data API report to confirm processed Views for at least one actual visited page from this exact run. Exact page_view delivery is verified in the browser collection assertions; the API metric combines page and screen views. It reports observed coverage across all journey pages separately; it does not require aggregate analytics to act as a complete request log. It needs the dedicated reporting identity and User-scoped ci_run_id definition described in that guide.

The local suite verifies a build before publication. A separate production suite makes real HTTPS requests to the deployed website in desktop Chromium and mobile WebKit. It follows the referral Worker, accepts analytics consent, navigates the main sections, searches Writing, opens an article and a talk, and verifies successful page-view collection responses from the real Google tag. An HTTP project checks public slides, video headers, and private-route exclusions against the same public server. No responses are mocked and no Analytics events are injected by the test.

Run it explicitly with the target and expected measurement ID:

    PLAYWRIGHT_PRODUCTION_URL=https://alexander-thomas.alexander-jt.workers.dev \
    PLAYWRIGHT_GA4_MEASUREMENT_ID=G-JLX8RLTRH4 \
    npm run test:live

Each browser starts at /r/playwright-ci/production-checks with medium testing and a unique utm_content browser marker: the workflow run ID followed by -d for desktop Chromium or -m for mobile Safari. Browsers retain their standard Playwright device-profile user agents; the HTTP asset checks use AJT-Playwright/1.0. No GA4 exclusion filter is enabled by this setup. Raw user agent is not a general GA4 data-filter dimension; use the campaign source and browser markers to identify these visits. Google collection accepting a request is transport evidence; GA4's reporting UI or API is the separate evidence of ingestion.

The HTML report at playwright-report-production/index.html attaches the tested URL, run marker, CI link, source revision, document statuses, Cloudflare Ray IDs, and successful Google collection responses. Only selected collection fields are saved in the JSON evidence, without cookies or client/session IDs. The live suite makes normal TLS checks, runs one worker with no retries, and requires explicit configuration to prevent accidental live traffic.

On private production main, the production-checks CI job runs after successful verification and the deploy stage. It tests the current live site when deployment credentials are absent, and labels that as existing-production-deployment rather than claiming the workflow's revision was deployed. It runs after an actual successful upload when credentials are configured. Failed deployments and outdated queued uploads do not start live checks. Pull requests and the public source repository never automatically run production tests. Reports and network evidence are retained for seven days.

## Draft editor and media

`npm run test:review` starts a separate local Astro review server and isolated SQLite database. It exercises the real MCP protocol, browser editing, private image upload/replacement, refreshed rendering, and human publication controls. Only the local test backend is approved; tests never publish remote posts. Stale revisions and cross-origin mutations are rejected. This suite runs in `npm run test:ci`; its HTML report and preview screenshot are saved with the CI artifacts. See [the workflow](content-mcp.md).

## Interactive test authoring with MCP

Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp) can inspect pages and try interactions while authoring tests. It is a developer tool, separate from the test runner and CI. For Codex, a pinned, isolated setup is:

```sh
codex mcp add playwright -- npx --yes @playwright/mcp@0.0.83 --isolated --headless --browser chrome
```

This setup uses an installed Chrome browser with an in-memory profile. It does not attach to a signed-in browser session. Keep real account credentials and browser storage exports out of tests and source control. Committed Playwright tests run without the MCP server.
