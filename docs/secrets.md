# Credentials and deployment configuration

GitHub Actions secrets are encrypted settings, separate from repository files and Git history. Publishing the source does not publish those values. A workflow with access can still disclose a secret, so only trusted deployment jobs receive them. The independent public source repository has no deployment secrets and never deploys. Never use `pull_request_target` to run contributed code with production credentials.

## Inventory

| Purpose                    | Canonical location                                                                          | Access                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare CI deployment   | Private repo `production` environment secret `CLOUDFLARE_API_TOKEN`                         | Custom form: Account → Workers Scripts → Edit, plus Account → D1 → Read, restricted to the website account. These permissions cover that account's Workers and D1 databases. CI deploys only the two configured Workers and reads published content. |
| B2 delivery key            | Private repo `production` environment secrets `B2_MEDIA_KEY_ID`, `B2_MEDIA_APPLICATION_KEY` | Read-only, single private bucket and `assets/` prefix.                                                                                                                                                                                               |
| B2 endpoint and bucket     | Private repo Actions variables `B2_MEDIA_ENDPOINT`, `B2_MEDIA_BUCKET`                       | Non-secret configuration.                                                                                                                                                                                                                            |
| Local B2 delivery          | Ignored `.dev.vars`, mode `0600`                                                            | Same read-only delivery bindings; not loaded into the site build.                                                                                                                                                                                    |
| Local media authoring      | Ignored `.wrangler/content-media/b2.json`, mode `0600`, parent `0700`                       | Separate bucket/prefix-scoped read/write key. Never copy this key into CI.                                                                                                                                                                           |
| Local Cloudflare authoring | Wrangler's protected OAuth credential store                                                 | Interactive local D1 authoring and human-approved publication. Never copy OAuth refresh tokens into GitHub.                                                                                                                                          |
| GA4 reporting              | GitHub OIDC → dedicated Google service account → GA4 Viewer                                 | Short-lived read-only token; no downloaded service-account key. IDs and provider paths are Actions variables.                                                                                                                                        |
| Site configuration         | `.env` locally; Actions variables in CI                                                     | Canonical/staging URLs, GA4 measurement ID, repository name. These are public configuration. Never give a secret a `PUBLIC_` prefix.                                                                                                                 |

## Deployment behavior

Only a push/manual run on private production `main` enters the deployment job, after verification passes. That job uses GitHub environment `production`, whose deployment branch rule permits only branch `main`; tags and PR branches are excluded. Dependency installation and PR tests receive no deployment secrets. The deploy step receives Cloudflare's token plus the read-only B2 values. Missing or malformed media configuration fails before the content pull or upload; a missing Cloudflare token retains the existing explicit activation-pending notice.

`scripts/deploy.mjs` removes deployment and media credentials from build/test subprocess environments. Only cloud operations receive the Cloudflare token. It writes the four read-only Worker bindings to a temporary owner-only file outside the checkout, passes its path through Wrangler's `deploy --secrets-file`, and removes it after success or failure. The key values never enter shell arguments, static assets, release manifests, logs, or uploaded reports. Wrangler attaches them to the same version as the code; there is no separate `secret bulk` deployment that could bypass staging. Staging and production receive the same captured binding values, and production still waits for the real staging gate and artifact checks.

For local deployment, copy `.dev.vars.example` to `.dev.vars`, set the four **read-only** values, and run `chmod 600 .dev.vars`. The deployment script requires a regular file owned by the current user. Full process environment values take precedence; incomplete values fail rather than silently mixing credential sets. CI requires explicit environment input and never falls back to a local file. Keep the authoring key in its separate protected file so normal site builds do not load it.

Do not put credentials into `.env.example`, `wrangler.jsonc` vars, issues, PR descriptions, chat, command history, or GitHub Actions variables. `.dev.vars` and `.env*` are ignored except their empty templates. GitHub cannot return a saved secret's plaintext; validate it by a real authorized operation and rotate by replacing it.

## Initial Cloudflare credential

In the signed-in Cloudflare account, open **Manage account → Account API tokens** and create `ajt-website-github-actions`. On the custom form shown during setup, use **Account → Workers Scripts → Edit** and **Account → D1 → Read**. Set Account Resources to **Include → Specific account → the website account**. This form grants account-wide Workers management and D1 read access; it does not restrict the token to two Workers or one database. Alex was informed of that scope before creating the token. Prefer per-Worker Editor access for `alexander-thomas` and `alexander-thomas-staging` if a role-based interface offers it, but do not confuse those role labels with this form's permission names. No DNS, billing, R2, or token-management permission is required.

Save the one-time value directly as `CLOUDFLARE_API_TOKEN` in the private repository's **production environment**, or enter it through the script's interactive prompt below. No Cloudflare CI token is needed locally; local authoring retains Wrangler OAuth. Do not paste the token into chat. Leave the client-IP filter empty for standard GitHub-hosted runners, whose outbound IPs change; a 90-day expiry is a suggested rotation interval, not a required permission.

## Repeatable GitHub setup

Run locally with Node 24, `npm ci`, an authenticated GitHub CLI, and the protected read-only `.dev.vars` file:

```sh
# Read-only audit and exact migration plan (the default).
npm run setup:github
# Apply the main-only policy and migrate B2 delivery credentials.
npm run setup:github -- --apply
# Also enter or rotate the limited Cloudflare token through gh's hidden prompt.
npm run setup:github -- --apply --prompt-cloudflare-token
```

The script is deliberately fixed to the private `alext-avi/ajt-website` repository and requires administrator access. It verifies the main-only branch rule before storing secrets. It never resets an existing environment's reviewer/wait protections, and refuses unexpected branch/tag rules or a different policy rather than broadening access. Repository-wide duplicates are removed only after the environment secret names are confirmed. Failures before that confirmation retain the old copies so setup can be inspected and retried. Re-running the script does not duplicate the branch rule.

The Cloudflare token may instead be supplied through an already populated `CLOUDFLARE_API_TOKEN` process environment variable. Never type its value as a shell argument or assignment into command history. The script disables GitHub debug logging, sends secret values through stdin, and reports only configuration and secret names. It never retrieves a stored secret, copies Wrangler OAuth credentials, creates a master token, deploys the website, or publishes content. Without a Cloudflare token, B2/environment setup can finish and the report explicitly leaves CI activation pending. A repository-only Cloudflare token must be re-entered because GitHub cannot return its plaintext.

GitHub supports the environment on the current account without an upgrade. Keep write access to main/workflows limited to trusted maintainers: someone who can change trusted deployment code can still misuse credentials. The setup script never runs in CI and does not give a runner repository-administration credentials. The first actual CI deployment validates the Cloudflare token and deployed media; a successful setup report proves the stored names and branch policy, not the validity or permissions of an opaque saved token.

## Rotation and recovery

Create a replacement scoped read-only B2 key, update both private GitHub secrets and local `.dev.vars`, and run the normal deployment. Confirm the staged and promoted media checks before revoking the old key. Keep the old key active until both Workers are updated; existing deployed versions retain their prior bindings. Rotate the separate authoring key only in its local protected file.

Replace an expiring Cloudflare token in the private GitHub secret and verify a successful deployment before revoking the old token. Never store a master key or a token-provisioning credential merely to automate rotation. Cloudflare token creation/expiry remains an account-owner task. GA4's short-lived credentials are renewed through OIDC each run.

Sources: [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Cloudflare secrets with code deployment](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code), [granular Worker access](https://developers.cloudflare.com/workers/authorization/workers/), [custom-token permission names](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [D1 query permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [GitHub runner IPs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).
