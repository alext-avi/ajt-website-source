# GitHub Actions deployment

The workflow in `.github/workflows/verify.yml` runs Astro diagnostics, a production build, and all contract/routing tests. Only a successful push to `alext-avi/ajt-website` on `main`, or a manual run on `main`, can proceed to production deployment. Pull requests only verify.

The deployment job installs dependencies from the same lockfile and runs `npm run deploy`. It pulls published D1 records, validates and tests the snapshot build with the production variables, deploys a separate staging Worker, and requires real Playwright browser/HTTP tests against that server before uploading the same static artifact to production. Pull-request verification uses the committed snapshot and needs no Cloudflare access. No separate deployment action or unpinned Wrangler download is needed. GitHub actions are pinned to full commit SHAs. The GitHub token has read-only repository access and is not persisted in the checkout.

## Staging and promotion

Staging is `https://alexander-thomas-staging.alexander-jt.workers.dev`, configured in `wrangler.jsonc` under `env.staging`. It is a separate Worker with no D1 binding. It serves only the validated published content snapshot; drafts and private source files are excluded by the normal publication checks. It is publicly viewable, with noindex response headers; noindex is not access control. Production GA4 only initializes on the canonical production origin, including when staging has a saved consent choice.

Use `npm run stage` to prepare, deploy, and test a candidate without changing production. Use `npm run deploy` to perform that staging gate and then promote the tested static assets. Both commands use existing local Wrangler authorization or the configured CI token. Install the matching Playwright Chromium/WebKit browsers before running locally.

`scripts/deploy.mjs` records the source revision and an artifact SHA-256 in `dist/release.json`. The hash covers every static asset and the Worker/referral source and Wrangler configuration. After the staging tests pass, it checks that the local artifact is unchanged and staging still serves that identity. It never rebuilds between staging and production. A test failure or identity mismatch stops publication. Stage reports, actual server response IDs, screenshots, and the manifest are retained as `staging-playwright-results` in CI.

After the deploy stage, the production-checks job exercises the public website and its real Google Analytics tag with Playwright. It uses no Cloudflare credentials. If deployment was skipped because the token is absent, the job explicitly tests the existing production deployment; a passing test does not claim that the current source revision was uploaded. Failed deployments and outdated queued uploads do not run live checks. See [testing.md](testing.md) for the campaign markers and network evidence.

## One-time authorization

First complete [private R2 media setup](r2-media.md). Both Workers require the existing `ajt-website-media` bucket. New uploads live there rather than in Git; the staging gate verifies every referenced R2 object's hash before promotion. The local publisher and CI both refresh published content directly from D1, so a clean runner needs neither the author's media cache nor manually copied uploads.

Wrangler's local OAuth login cannot authenticate a GitHub-hosted runner. Use a separate account-owned Cloudflare API token for CI:

1. In the Cloudflare account containing `alexander-thomas`, open **Manage account → Account API tokens → Create Token**.
2. Name the token `ajt-website-github-actions`. Grant **Workers → Editor** access scoped to the existing **alexander-thomas** and **alexander-thomas-staging** Workers and **D1 → Read** for the content database. Confirm permission to attach the existing media bucket binding; CI does not need to upload objects or create buckets. CI reads content but does not apply migrations, seed records, or edit drafts. Do not grant account administration, API-token management, DNS, billing, or access to unrelated products. Cloudflare's granular permissions allow an Editor to deploy existing Workers without permission to create/delete Workers. If that scope is unavailable in the dashboard, review the actual alternative before granting broader access.
3. Copy the token directly into the repository's **Settings → Secrets and variables → Actions → New repository secret**, named **CLOUDFLARE_API_TOKEN**. Do not put it in an issue, chat, workflow file, command history, or `.env.example`.
4. Set repository Actions variables:
   - `SITE_URL`: `https://alexander-thomas.alexander-jt.workers.dev`
   - `PUBLIC_GA4_MEASUREMENT_ID`: `G-JLX8RLTRH4`
   - `STAGING_URL`: `https://alexander-thomas-staging.alexander-jt.workers.dev` (also the deployment script's default)
5. Run **Verify and deploy website** from the repository's Actions tab on `main`. Check both jobs and the production URL. Future pushes to `main` deploy automatically.

The account ID and Worker name are already in `wrangler.jsonc`; they are configuration, not secret credentials. The token belongs only in GitHub's encrypted Actions secrets. Local deployments continue to use Wrangler's encrypted OAuth credential store.

If the secret is missing, the workflow still verifies the website and explicitly skips deployment with a notice and job summary. This avoids repeated failure notifications for an unconfigured deployment. Once the secret exists, pushes deploy automatically. Invalid, expired, or revoked credentials cause a real deployment failure and remain visible; they do not remove the currently deployed site. Rotate the token by replacing the GitHub secret and revoking the old token after a successful deployment.

## Ordering and recovery

Production main workflows share a concurrency group across verification, staging, deployment, and live checks, and do not interrupt a run already in progress. A later deployment cannot replace staging or production while an earlier run is checking it. PRs and the public source repo use independent groups. The deployment script checks its commit against the current `main` tip before staging upload and again after staging passes. An outdated queued release skips promotion, so it cannot replace a newer build. Avoid running manual deployments concurrently with a CI release; release identity checks fail closed if staging is replaced.

To retry a transient failure, re-run the workflow for the current `main` commit or use **Run workflow** on `main`. To roll back code, revert the relevant commit and push the revert to `main`. Content requires a separately reviewed restoration of its D1 revision: every deployment pulls D1 again, so a Git revert alone does not undo database publication. A manual run from an old commit is intentionally skipped once `main` has moved forward. Retain historical R2 objects so a rollback's referenced bytes remain available.

GitHub environments and private branch protection are unavailable on this repository's current GitHub plan. Deployment therefore uses a repository secret and explicit repository/event/branch conditions. If the repository becomes public, branch protection and a production environment can be configured then. Contributors should submit pull requests; only trusted maintainers should have write access to `main` or workflows.

## References

- [Cloudflare: GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare: granular Wrangler permissions](https://developers.cloudflare.com/workers/authorization/)
- [Cloudflare: account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
