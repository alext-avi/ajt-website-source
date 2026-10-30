# GitHub Actions deployment

The workflow in `.github/workflows/verify.yml` runs Astro diagnostics, a production build, and all contract/routing tests. Only a successful push to `alext-avi/ajt-website` on `main`, or a manual run on `main`, can proceed to production deployment. Pull requests only verify.

The deployment job installs dependencies from the same lockfile and runs `npm run deploy`. It pulls published D1 records, validates and tests the snapshot build with the production variables, deploys a separate staging Worker, and requires real Playwright browser/HTTP tests against that server before uploading the same static artifact to production. Pull-request verification uses the committed snapshot and needs no Cloudflare access. No separate deployment action or unpinned Wrangler download is needed. GitHub actions are pinned to full commit SHAs. The GitHub token has read-only repository access and is not persisted in the checkout.

Release subprocesses always use `NODE_ENV=production` and `CONTENT_SOURCE=d1`, including when publication starts inside the local Astro development review desk. Development review settings and `VITE_USER_NODE_ENV` are removed before builds, tests or Cloudflare commands run. This keeps legacy file previews and draft/example content out of releases while retaining the existing credential isolation.

## Staging and promotion

Staging is `https://alexander-thomas-staging.alexander-jt.workers.dev`, configured in `wrangler.jsonc` under `env.staging`. It is a separate Worker with no D1 binding. It serves only the validated published content snapshot; drafts and private source files are excluded by the normal publication checks. It is publicly viewable, with noindex response headers; noindex is not access control. Production GA4 only initializes on the canonical production origin, including when staging has a saved consent choice.

Use `npm run stage` to prepare, deploy, and test a candidate without changing production. Use `npm run deploy` to perform that staging gate and then promote the tested static assets. Both commands use existing local Wrangler authorization or the configured CI token. Install the matching Playwright Chromium/WebKit browsers before running locally.

`scripts/deploy.mjs` records the source revision and an artifact SHA-256 in `dist/release.json`. The hash covers every static asset and the Worker/referral source and Wrangler configuration. After the staging tests pass, it checks that the local artifact is unchanged and staging still serves that identity. It never rebuilds between staging and production. A test failure or identity mismatch stops publication. Stage reports, actual server response IDs, screenshots, and the manifest are retained as `staging-playwright-results` in CI.

After the deploy stage, the production-checks job exercises the public website and its real Google Analytics tag with Playwright. It uses no Cloudflare credentials. If deployment was skipped because the token is absent, the job explicitly tests the existing production deployment; a passing test does not claim that the current source revision was uploaded. Failed deployments and outdated queued uploads do not run live checks. See [testing.md](testing.md) for the campaign markers and network evidence.

## One-time authorization

First complete [private Backblaze B2 setup](b2-media.md). Run `npm run setup:github` to audit and `npm run setup:github -- --apply` to configure the private repository's main-only `production` environment and migrate the read-only delivery secrets `B2_MEDIA_KEY_ID` and `B2_MEDIA_APPLICATION_KEY` into it. The script sets `B2_MEDIA_ENDPOINT` and `B2_MEDIA_BUCKET` as non-secret repository Actions variables. The deploy job uses that environment; PRs and the public mirror cannot enter it. `scripts/deploy.mjs` attaches the bindings to each Worker version through `--secrets-file`. Staging and production receive the same binding values; no separate secret deployment bypasses the staging gate. Local deployment uses an ignored owner-only `.dev.vars` file instead. See [secrets.md](secrets.md) for the full inventory, setup, isolation, and rotation procedure.

New uploads live in the private bucket rather than in Git; the staging gate verifies every referenced storage object's hash before promotion. R2 is inactive and no R2 binding or subscription is required. The local publisher and CI both refresh published content directly from D1, so a clean runner needs neither the author's media cache nor manually copied uploads.

Wrangler's local OAuth login cannot authenticate a GitHub-hosted runner. Use a separate account-owned Cloudflare API token for CI:

1. In the Cloudflare account containing `alexander-thomas`, open **Manage account → Account API tokens → Create Token**.
2. Name the token `ajt-website-github-actions`. The custom form used during setup has **Account → Workers Scripts → Edit** and **Account → D1 → Read**, with Account Resources **Include → Specific account → the website account**. These are account-wide permissions; they do not limit the token to two Workers or one database. This broader scope was disclosed to Alex before token creation. A role-based interface may instead offer per-Worker Editor access; use it when available, but do not substitute role names into the custom form. CI itself deploys only the configured production/staging Workers and reads published D1 content; it does not apply migrations, seed records, or edit drafts. No R2, DNS, billing, or API-token management permissions are required.
3. Save the token in **Settings → Environments → production → Environment secrets**, named **CLOUDFLARE_API_TOKEN**, or run `npm run setup:github -- --apply --prompt-cloudflare-token` in a terminal and use the hidden GitHub CLI prompt. Do not put it in an issue, chat, workflow file, command history, or `.env.example`.
4. Set repository Actions variables:
   - `SITE_URL`: `https://alexander-thomas.alexander-jt.workers.dev`
   - `PUBLIC_GA4_MEASUREMENT_ID`: `G-JLX8RLTRH4`
   - `STAGING_URL`: `https://alexander-thomas-staging.alexander-jt.workers.dev` (also the deployment script's default)
5. Run **Verify and deploy website** from the repository's Actions tab on `main`. Check both jobs and the production URL. Future pushes to `main` deploy automatically.

The account ID and Worker name are already in `wrangler.jsonc`; they are configuration, not secret credentials. The token belongs only in GitHub's encrypted Actions secrets. Local deployments continue to use Wrangler's protected OAuth credential store and the read-only bindings in `.dev.vars`.

If the secret is missing, the workflow still verifies the website and explicitly skips deployment with a notice and job summary. This avoids repeated failure notifications for an unconfigured deployment. Once the secret exists, pushes deploy automatically. Invalid, expired, or revoked credentials cause a real deployment failure and remain visible; they do not remove the currently deployed site. Rotate the token by replacing the GitHub secret and revoking the old token after a successful deployment.

## Ordering and recovery

Production main workflows share a concurrency group across verification, staging, deployment, and live checks, and do not interrupt a run already in progress. A later deployment cannot replace staging or production while an earlier run is checking it. PRs and the public source repo use independent groups. The deployment script checks its commit against the current `main` tip before staging upload and again after staging passes. An outdated queued release skips promotion, so it cannot replace a newer build. Avoid running manual deployments concurrently with a CI release; release identity checks fail closed if staging is replaced.

To retry a transient failure, re-run the workflow for the current `main` commit or use **Run workflow** on `main`. To roll back code, revert the relevant commit and push the revert to `main`. Content requires a separately reviewed restoration of its D1 revision: every deployment pulls D1 again, so a Git revert alone does not undo database publication. A manual run from an old commit is intentionally skipped once `main` has moved forward. Retain historical media objects so a rollback's referenced bytes remain available.

Deployment uses private environment secrets, a main-only `production` environment policy, and explicit repository/event/branch conditions. The setup script audits first, preserves existing review protections, refuses unexpected allowed refs, and verifies stored secret names before removing repository-wide duplicates. Contributors should submit pull requests; only trusted maintainers should have write access to `main` or workflows.

## References

- [Cloudflare: GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare: granular Wrangler permissions](https://developers.cloudflare.com/workers/authorization/)
- [Cloudflare: account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
