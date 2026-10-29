# Alexander Thomas

A personal professional website built with Astro, TypeScript, Tailwind CSS, and Astro content collections. Production content lives in Cloudflare D1 and is exported to a validated, versioned snapshot for static builds. Local authoring uses MDX and Keystatic. A small Cloudflare Worker handles wildcard referral links under `/r/*`; other pages are served as static assets. React is hydrated only for the Writing page’s search and category filters.

Production origin: https://alexander-thomas.alexander-jt.workers.dev

Staging origin: https://alexander-thomas-staging.alexander-jt.workers.dev

This clean source release contains the website implementation and its already-published reference content. Private development history, unpublished drafts, and research/source notes are excluded.

## Run locally

The package manager is recorded as npm 11.19.0, matching the verified CI toolchain. Regenerate dependency locks with that version so platform-specific native package selectors are retained.

Use Node 24 LTS (`.nvmrc`). Astro 7 requires Node 22.23.4 or newer; the older Node 22.22.1 installation on this machine is insufficient.

```sh
nvm use
npm ci
npm run dev
```

Open **http://127.0.0.1:4321/**. The content editor is at **http://127.0.0.1:4321/keystatic/**. Both bind only to the loopback interface. Local development sets `noindex`.

To disable Astro telemetry in a restricted environment, set `ASTRO_TELEMETRY_DISABLED=1` before running commands.

```sh
npm run verify       # Typecheck, static build, production contract tests
npm run preview      # Inspect the actual static production build
npm run cf:preview   # Build and serve with the Cloudflare local runtime
npm run cf:dry-run   # Validate Cloudflare deployment packaging without uploading
npm run stage        # Deploy staging and run real browser/HTTP tests
npm run deploy       # Stage and test, then promote the same assets
```

## Site settings

Copy `.env.example` to `.env`. It contains the configured production origin. Change `SITE_URL` when moving to a custom domain. Without a configured origin, builds default to localhost, disable indexing, and cannot pass the deployment guard. Local development always disables indexing.

Approved public business contact defaults are in `src/lib/site.ts`:

- Email: `alext@avi.com`
- LinkedIn: `https://www.linkedin.com/in/alexander-jt/`
- GitHub: `https://github.com/alext-avi`

Environment overrides are optional. Empty email or LinkedIn overrides fall back to those approved values. Invalid overrides hide the affected link. No resume PDF is included or linked, following Alex’s instruction to use it only as source material.

## Content

Website posts and projects can be drafted as D1 data through the local `ajt-content` MCP. The agent prepares and selects a draft; its interactive MCP App provides a focused editor, saved preview and private media uploads/replacements inside compatible hosts. Alex opens the local desk for final review and presses Publish; the MCP has no publishing tool. Repeatable LinkedIn imports preserve original text and dates and flag duplicates or source edits. This workflow does not post to LinkedIn. See [draft, review, and publish](docs/content-mcp.md) and [LinkedIn synchronization](docs/linkedin-sync.md).

| Collection | Authoring source | Public route |
| --- | --- | --- |
| Writing | D1 through the MCP and review desk | `/writing/<slug>/` |
| Projects | D1 through the MCP and review desk | `/projects/<slug>/` |
| Speaking | Existing local authoring files imported into D1 | `/speaking/<slug>/` |

Production builds use `data/content.json`, exported from published D1 records. Projects also use that data snapshot in local development; new drafts are previewed in the publishing desk. Legacy MDX files remain historical sources, not the new-content workflow. See [D1 storage and publication](docs/d1-content.md) and [the editing guide](docs/content.md). All three collections share validation schemas. New entries default to `draft: true`.

The public material includes 33 dated LinkedIn posts with original author text and source links, three sourced project overviews, two past All Things Open sessions, a past Apex session, a delivered enterprise consulting session, and a proposed speaking topic. Sixteen attached images/GIFs and three original videos are hosted locally. Two shared videos use LinkedIn’s original video-only players. Unpublished drafts are excluded from this release.

## Browser editing and GitHub

Keystatic runs locally by default. Its admin UI and API do not exist in production output. Its files are legacy authoring inputs. New posts and projects use the MCP and human review desk; editing a file does not change D1 or publish content. No hosted CMS account or paid infrastructure is required.

An optional authenticated **GitHub mode** is implemented for the local editor. It requires an existing repository and a GitHub App; setup and the hosted-editor tradeoff are documented in [the CMS decision](docs/cms.md). GitHub-backed login cannot be verified until that repository and App are configured. The deployed static website does not offer an unauthenticated content editor.

## Automated tests

CI runs the existing Node content/database checks plus Playwright integration tests in desktop Chromium and mobile WebKit. The integration suite builds the production site and exercises it through Cloudflare's local HTTPS runtime, including navigation, themes, Writing search, referral links, media, slides, and analytics consent. It uses stubbed external services and requires no production credentials.

```sh
npx --no-install playwright install chromium webkit
npm run test:ci
```

Failed browser tests retain screenshots and traces; CI uploads the HTML report and failure artifacts for seven days. See [the testing guide](docs/testing.md) for coverage, debugging commands, and optional Playwright MCP setup.

Production publication first deploys a separate staging Worker and requires seven real server tests before promoting the same assets. Staging has no D1 binding and sends no production analytics. See [staging and deployment](docs/deployment.md).

## Pull request reviews

[CodeRabbit](https://www.coderabbit.ai/oss) provides free automated reviews for public repositories. The GitHub App must be installed on this repository; no API key or Actions secret is needed. Review settings live in [`.coderabbit.yaml`](.coderabbit.yaml): assertive feedback, automatic reviews of ready pull requests and subsequent commits, and no automatic approvals. Draft pull requests are skipped. The npm lockfile is explicitly included in dependency reviews.

The review guidance protects original publication text and dates, private consulting details, database revision safety, and production deployment guards. CodeRabbit feedback supplements the existing verification workflow. It does not publish content or deploy the website.

## Cloudflare deployment

This project uses **Cloudflare Workers Static Assets** and **D1**. No Cloudflare Astro adapter or SSR runtime is required. The small Worker in `worker/index.ts` handles referral redirects; static assets bypass it. `CONTENT_DB` binds the content database for future authenticated content tools; public page requests do not query it.

The [GitHub Actions workflow](.github/workflows/verify.yml) verifies every pull request and push to `main`. This public source repository runs verification and skips deployment. Deployment is restricted to `alext-avi/ajt-website` on `main`, after verification succeeds, using the lockfile-pinned Wrangler CLI. The workflow can also be run manually on `main`; the same repository guard applies. Deployment requires the `CLOUDFLARE_API_TOKEN` repository Actions secret; see [deployment setup](docs/deployment.md).

Pull requests, other branches, and copies of this repository cannot run the deployment job. Only the production job receives the Cloudflare token, for reading the D1 snapshot and deploying verified output. Production deployments are serialized, and an outdated commit is skipped if a newer commit is already on `main`. Failed verification leaves the existing website live.

Repository variables `SITE_URL` and `PUBLIC_GA4_MEASUREMENT_ID` supply the build configuration. Keep `SITE_URL` consistent with the primary domain, and redeploy after changing either variable. The workflow does not require GitHub environments.

For a manual deployment:

```sh
npx wrangler login
npm run deploy
```

The deploy script first pulls published content from D1, checks the complete build, and rejects an unset, placeholder, non-HTTPS, or mismatched canonical origin. The canonical origin and account/database identifiers are configuration, not credentials. Authentication is handled by Wrangler; no Cloudflare token is embedded in this repository. If the embedded browser cannot complete Cloudflare sign-in, perform authorization in Safari or Chrome.

Do not connect a second automatic deployment service to the same production Worker while GitHub Actions is responsible for deployment.

Official references, checked October 24, 2026:

- [Astro Cloudflare deployment](https://docs.astro.build/en/guides/deploy/cloudflare/)
- [Cloudflare Astro framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static asset billing and limits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare deployment from GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

## Project map

```text
src/
  components/       Shared layout, cards, illustrations, Writing React island
  content/          Versioned posts, projects, talks
  content.config.ts Strongly typed content schemas
  layouts/          Metadata, navigation, site shell
  lib/              Contact settings, content visibility and formatting
  pages/            Static pages, detail routes, tags, RSS, robots
  styles/           Design tokens and responsive styles
public/
  images/           Source SVGs, technical diagram, social card
  uploads/          Keystatic-managed images
  _headers          Cloudflare security and cache headers
data/               Versioned published D1 content snapshot
migrations/         Versioned D1 schema and history triggers
worker/             Referral redirects, static asset fallback, D1 binding
scripts/            Route and analytics tests, build contracts, deployment guard
docs/               Editing, CMS choice, deployment, and source manifests
```

## Design and operation

The design uses self-hosted fonts, a midnight-blue background, white headings, warm gold accents, original vector illustrations, and content-first layouts. Dark mode is the default. The header toggle offers a warm-ivory light theme and saves the choice in local storage under `ajt.theme`; a small head script restores it before the page paints. The same regular-weight Manrope “-AT” mark appears in the header, footer, homepage illustration, bylines, favicon, and sharing image. Fonts and images are local. GA4 loads only in configured production builds after visitors allow optional analytics. See [referral links and analytics](docs/referrals-and-analytics.md) for URL conventions, reporting, and setup. Local video players preload no video data. LinkedIn players load only after the visitor presses their load button; original creator links remain available without JavaScript. Speaking recordings open through ordinary links. Navigation and content work without JavaScript; search and filter controls use a single React island.

SEO includes canonical URLs, Open Graph and Twitter metadata, a local social image, Person and BlogPosting structured data, sitemap, RSS, and configurable indexing. Accessibility includes a skip link, visible keyboard focus, labeled inputs, meaningful headings, descriptive image alternatives, mobile navigation with Escape support, and reduced-motion behavior.

The `undici` override in `package.json` keeps Cloudflare’s development tooling on a patched compatible release. Recheck its need when upgrading Wrangler; do not resolve advisory reports by downgrading to an obsolete framework tool or forcing incompatible peer dependencies.

Dependabot checks npm packages and GitHub Actions weekly. TypeScript 7.x is temporarily excluded because `@astrojs/check` only supports TypeScript 5/6; TypeScript 6 updates remain enabled. Remove the exclusion when the checker supports TypeScript 7, as tracked in [the compatibility issue](https://github.com/alext-avi/ajt-website-source/issues/10), and validate a clean install, type checks, and integration tests. This exclusion also prevents a security update available only in 7.x, so review TypeScript security alerts manually during the hold.

## License

The website implementation is MIT licensed. Personal content and media are excluded from that grant; see [CONTENT-LICENSE.md](CONTENT-LICENSE.md). Preserve [third-party notices](NOTICE.md).

This is a clean source release with no private Git history. The current production identifiers are public configuration, not credentials; replace them before deploying your own copy. Automatic deployment is guarded to the original production repository and requires its Cloudflare Actions secret.
