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

HTTPS preserves the production `upgrade-insecure-requests` security header, including Safari behavior. Certificate errors are ignored only for this loopback test server's generated certificate. The test build uses `https://website.test` and the synthetic GA4 ID `G-E2E000000`. Tests send no real Google Analytics events, and CI does not deploy this test build. Production deployment rebuilds using its own configuration and retains the existing repository, branch, event, and credential guards.

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

## Live production tests

The local suite verifies a build before publication. A separate production suite makes real HTTPS requests to the deployed website in desktop Chromium and mobile WebKit. It follows the referral Worker, accepts analytics consent, navigates the main sections, searches Writing, opens an article and a talk, and verifies successful page-view collection responses from the real Google tag. An HTTP project checks public slides, video headers, and private-route exclusions against the same public server. No responses are mocked and no Analytics events are injected by the test.

Run it explicitly with the target and expected measurement ID:

    PLAYWRIGHT_PRODUCTION_URL=https://alexander-thomas.alexander-jt.workers.dev \
    PLAYWRIGHT_GA4_MEASUREMENT_ID=G-JLX8RLTRH4 \
    npm run test:live

Each browser starts at /r/playwright-ci/production-checks with medium testing and a unique utm_content run marker. The user agent includes AJT-Playwright/1.0 for server logs. No GA4 exclusion filter is enabled by this setup: traffic should remain visible in Realtime and subsequently in campaign reports, subject to Google's normal processing and bot filtering. Raw user agent is not a general GA4 data-filter dimension; use the campaign source to identify these visits. Google collection accepting a request is transport evidence; GA4's reporting UI or API is the separate evidence of ingestion.

The HTML report at playwright-report-production/index.html attaches the tested URL, run marker, CI link, source revision, document statuses, Cloudflare Ray IDs, and successful Google collection responses. Only selected collection fields are saved in the JSON evidence, without cookies or client/session IDs. The live suite makes normal TLS checks, runs one worker with no retries, and requires explicit configuration to prevent accidental live traffic.

On private production main, the production-checks CI job runs after successful verification and the deploy stage. It tests the current live site when deployment credentials are absent, and labels that as existing-production-deployment rather than claiming the workflow's revision was deployed. It runs after an actual successful upload when credentials are configured. Failed deployments and outdated queued uploads do not start live checks. Pull requests and the public source repository never automatically run production tests. Reports and network evidence are retained for seven days.

## Interactive test authoring with MCP

Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp) can inspect pages and try interactions while authoring tests. It is a developer tool, separate from the test runner and CI. For Codex, a pinned, isolated setup is:

```sh
codex mcp add playwright -- npx --yes @playwright/mcp@0.0.83 --isolated --headless --browser chrome
```

This setup uses an installed Chrome browser with an in-memory profile. It does not attach to a signed-in browser session. Keep real account credentials and browser storage exports out of tests and source control. Committed Playwright tests run without the MCP server.
