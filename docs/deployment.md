# GitHub Actions deployment

The workflow in `.github/workflows/verify.yml` runs Astro diagnostics, a production build, and all contract/routing tests. Only a successful push to `alext-avi/ajt-website` on `main`, or a manual run on `main`, can proceed to production deployment. Pull requests only verify.

The deployment job installs dependencies from the same lockfile, pulls published D1 records, validates and tests the snapshot build with the production variables, checks its canonical origin, and runs the installed Wrangler CLI. Pull-request verification uses the committed snapshot and needs no Cloudflare access. No separate deployment action or unpinned Wrangler download is needed. GitHub actions are pinned to full commit SHAs. The GitHub token has read-only repository access and is not persisted in the checkout.

After the deploy stage, the production-checks job exercises the public website and its real Google Analytics tag with Playwright. It uses no Cloudflare credentials. If deployment was skipped because the token is absent, the job explicitly tests the existing production deployment; a passing test does not claim that the current source revision was uploaded. Failed deployments and outdated queued uploads do not run live checks. See [testing.md](testing.md) for the campaign markers and network evidence.

## One-time authorization

Wrangler's local OAuth login cannot authenticate a GitHub-hosted runner. Use a separate account-owned Cloudflare API token for CI:

1. In the Cloudflare account containing `alexander-thomas`, open **Manage account → Account API tokens → Create Token**.
2. Name the token `ajt-website-github-actions`. Grant **Workers → Editor** access scoped to the existing **alexander-thomas** Worker and **D1 → Read** for the content database. CI reads content but does not apply migrations, seed records, or edit drafts. Do not grant account administration, API-token management, DNS, billing, or access to unrelated products. Cloudflare's granular permissions allow an Editor to deploy an existing Worker without permission to create/delete Workers. If that scope is unavailable in the dashboard, review the actual alternative before granting broader access.
3. Copy the token directly into the repository's **Settings → Secrets and variables → Actions → New repository secret**, named **CLOUDFLARE_API_TOKEN**. Do not put it in an issue, chat, workflow file, command history, or `.env.example`.
4. Set repository Actions variables:
   - `SITE_URL`: `https://alexander-thomas.alexander-jt.workers.dev`
   - `PUBLIC_GA4_MEASUREMENT_ID`: `G-JLX8RLTRH4`
5. Run **Verify and deploy website** from the repository's Actions tab on `main`. Check both jobs and the production URL. Future pushes to `main` deploy automatically.

The account ID and Worker name are already in `wrangler.jsonc`; they are configuration, not secret credentials. The token belongs only in GitHub's encrypted Actions secrets. Local deployments continue to use Wrangler's encrypted OAuth credential store.

If the secret is missing, the workflow still verifies the website and explicitly skips deployment with a notice and job summary. This avoids repeated failure notifications for an unconfigured deployment. Once the secret exists, pushes deploy automatically. Invalid, expired, or revoked credentials cause a real deployment failure and remain visible; they do not remove the currently deployed site. Rotate the token by replacing the GitHub secret and revoking the old token after a successful deployment.

## Ordering and recovery

Production jobs share a concurrency group and do not interrupt a deployment already in progress. Immediately before upload, the job compares its commit to the current `main` tip. An outdated queued job skips its upload, so it cannot replace a newer build.

To retry a transient failure, re-run the workflow for the current `main` commit or use **Run workflow** on `main`. To roll back site content through this pipeline, revert the relevant commit and push the revert to `main`. A manual run from an old commit is intentionally skipped once `main` has moved forward.

GitHub environments and private branch protection are unavailable on this repository's current GitHub plan. Deployment therefore uses a repository secret and explicit repository/event/branch conditions. If the repository becomes public, branch protection and a production environment can be configured then. Contributors should submit pull requests; only trusted maintainers should have write access to `main` or workflows.

## References

- [Cloudflare: GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare: granular Wrangler permissions](https://developers.cloudflare.com/workers/authorization/)
- [Cloudflare: account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)
