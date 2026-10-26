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

## Interactive test authoring with MCP

Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp) can inspect pages and try interactions while authoring tests. It is a developer tool, separate from the test runner and CI. For Codex, a pinned, isolated setup is:

```sh
codex mcp add playwright -- npx --yes @playwright/mcp@0.0.83 --isolated --headless --browser chrome
```

This setup uses an installed Chrome browser with an in-memory profile. It does not attach to a signed-in browser session. Keep real account credentials and browser storage exports out of tests and source control. Committed Playwright tests run without the MCP server.
