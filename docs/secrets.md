# Credentials and deployment configuration

GitHub Actions secrets are encrypted settings, separate from repository files and Git history. Publishing the source does not publish those values. A workflow with access can still disclose a secret, so only trusted deployment jobs receive them. The independent public source repository has no deployment secrets and never deploys. Never use `pull_request_target` to run contributed code with production credentials.

## Inventory

| Purpose                    | Canonical location                                                         | Access                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare CI deployment   | Private repo Actions secret `CLOUDFLARE_API_TOKEN`                         | Editor on the two existing website Workers; D1 Read for content snapshots. No content writes, migrations, media uploads, DNS, billing, or token management. |
| B2 delivery key            | Private repo Actions secrets `B2_MEDIA_KEY_ID`, `B2_MEDIA_APPLICATION_KEY` | Read-only, single private bucket and `assets/` prefix.                                                                                                      |
| B2 endpoint and bucket     | Private repo Actions variables `B2_MEDIA_ENDPOINT`, `B2_MEDIA_BUCKET`      | Non-secret configuration.                                                                                                                                   |
| Local B2 delivery          | Ignored `.dev.vars`, mode `0600`                                           | Same read-only delivery bindings; not loaded into the site build.                                                                                           |
| Local media authoring      | Ignored `.wrangler/content-media/b2.json`, mode `0600`, parent `0700`      | Separate bucket/prefix-scoped read/write key. Never copy this key into CI.                                                                                  |
| Local Cloudflare authoring | Wrangler's protected OAuth credential store                                | Interactive local D1 authoring and human-approved publication. Never copy OAuth refresh tokens into GitHub.                                                 |
| GA4 reporting              | GitHub OIDC → dedicated Google service account → GA4 Viewer                | Short-lived read-only token; no downloaded service-account key. IDs and provider paths are Actions variables.                                               |
| Site configuration         | `.env` locally; Actions variables in CI                                    | Canonical/staging URLs, GA4 measurement ID, repository name. These are public configuration. Never give a secret a `PUBLIC_` prefix.                        |

## Deployment behavior

Only a push/manual run on private production `main` enters the deployment job, after verification passes. Dependency installation and PR tests receive no deployment secrets. The deploy step receives Cloudflare's token plus the read-only B2 values. Missing or malformed media configuration fails before the content pull or upload; a missing Cloudflare token retains the existing explicit activation-pending notice.

`scripts/deploy.mjs` removes deployment and media credentials from build/test subprocess environments. Only cloud operations receive the Cloudflare token. It writes the four read-only Worker bindings to a temporary owner-only file outside the checkout, passes its path through Wrangler's `deploy --secrets-file`, and removes it after success or failure. The key values never enter shell arguments, static assets, release manifests, logs, or uploaded reports. Wrangler attaches them to the same version as the code; there is no separate `secret bulk` deployment that could bypass staging. Staging and production receive the same captured binding values, and production still waits for the real staging gate and artifact checks.

For local deployment, copy `.dev.vars.example` to `.dev.vars`, set the four **read-only** values, and run `chmod 600 .dev.vars`. The deployment script requires a regular file owned by the current user. Full process environment values take precedence; incomplete values fail rather than silently mixing credential sets. CI requires explicit environment input and never falls back to a local file. Keep the authoring key in its separate protected file so normal site builds do not load it.

Do not put credentials into `.env.example`, `wrangler.jsonc` vars, issues, PR descriptions, chat, command history, or GitHub Actions variables. `.dev.vars` and `.env*` are ignored except their empty templates. GitHub cannot return a saved secret's plaintext; validate it by a real authorized operation and rotate by replacing it.

## Initial Cloudflare credential

In the signed-in Cloudflare account, open **Manage account → Account API tokens** and create `ajt-website-github-actions`. Grant Workers Editor only for `alexander-thomas` and `alexander-thomas-staging`, plus D1 Read for `ajt-website-content`. Review the actual scopes; if the dashboard cannot express them, do not silently broaden access. Save its one-time value directly as `CLOUDFLARE_API_TOKEN` in the private repository's Actions secrets. No Cloudflare CI token is needed locally; local authoring retains Wrangler OAuth. Do not paste the token into chat.

An environment with a main-only deployment policy would add server-enforced branch restrictions if the account plan supports private-repository environments. Do not upgrade the account to enable this. The current workflow enforces repository/event/branch conditions; anyone permitted to modify trusted main workflows can use its repository secrets. Keep write access limited to trusted maintainers.

## Rotation and recovery

Create a replacement scoped read-only B2 key, update both private GitHub secrets and local `.dev.vars`, and run the normal deployment. Confirm the staged and promoted media checks before revoking the old key. Keep the old key active until both Workers are updated; existing deployed versions retain their prior bindings. Rotate the separate authoring key only in its local protected file.

Replace an expiring Cloudflare token in the private GitHub secret and verify a successful deployment before revoking the old token. Never store a master key or a token-provisioning credential merely to automate rotation. Cloudflare token creation/expiry remains an account-owner task. GA4's short-lived credentials are renewed through OIDC each run.

Sources: [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Cloudflare secrets with code deployment](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code), [granular Worker access](https://developers.cloudflare.com/workers/authorization/workers/).
