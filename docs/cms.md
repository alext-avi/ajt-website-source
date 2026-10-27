# Keystatic decision

For new website posts, use the [MCP draft editor and human publishing desk](content-mcp.md). It includes rendered review and private media upload/replacement. The maintenance tools below do not replace Alex's publication approval.

Reviewed October 24, 2026 against current upstream documentation and installed package peer requirements.

## Implemented

The site uses Keystatic 6 with Astro 7. The current Keystatic integration explicitly supports Astro 5, 6, and 7. The public build uses static output and registers neither `/keystatic/` nor `/api/keystatic/`.

The default editor runs on localhost using filesystem storage. It supports creating and editing posts, projects, and talks, MDX body content, image uploads, draft/published fields, and featured content. The existing Astro dev preview shows saved content. Git commits preserve both content and images.

As of October 25, Alex selected D1 as the production content store. Keystatic remains the local authoring interface; it does not write directly to D1. Push reviewed records with revision checks and export a published snapshot as described in [D1 content storage](d1-content.md). The public deployment stays static and adds no required paid service, hosted authentication service, or public write endpoint. Loopback binding is the access boundary for local filesystem mode; that mode is not an authenticated internet-facing CMS. Do not expose the development server through a public tunnel.

## Optional authenticated GitHub mode

GitHub-backed editing is implemented as a development mode. It lets authorized repository writers sign in through a GitHub App while the editor still runs locally.

1. Push this project to your chosen repository. No remote repository name is assumed by the code.
2. Set `PUBLIC_KEYSTATIC_REPO=owner/repository` in `.env`.
3. Start `npm run dev:github` and open `http://127.0.0.1:4321/keystatic/`.
4. Follow Keystatic’s GitHub App setup for that repository. Install it only on the intended repository and grant the permissions requested by the documented setup.
5. Preserve the generated `KEYSTATIC_GITHUB_CLIENT_ID`, `KEYSTATIC_GITHUB_CLIENT_SECRET`, `KEYSTATIC_SECRET`, and `PUBLIC_KEYSTATIC_GITHUB_APP_SLUG` values in the ignored `.env` file. Never commit secrets.
6. Use the exact localhost callback URL shown by Keystatic. Additional deployment callback URLs must be registered if you later host an editor.
7. Only users with repository write access can edit. Keystatic supports branch selection. Reviewed authoring changes must also be pushed to D1; merging an MDX edit alone does not update the production content source.

GitHub login and remote writes require real repository and App configuration, so they cannot be validated from an unconfigured checkout. No credentials or repository permissions are fabricated by this project.

## Why no hosted editor in this deployment?

Keystatic’s hosted GitHub mode requires server-side API routes and GitHub App secrets. It can run on a compatible server/Worker, but it cannot be added to a pure static asset deployment by copying the admin page into `dist/`.

A separate editor Worker or a mixed static/server Astro deployment is feasible without necessarily requiring paid infrastructure. It introduces an authenticated runtime, secret handling, callbacks, and another deployment surface. For this personal site, the local editor and GitHub-backed source workflow are the simpler initial operating model. That is an architectural choice, not a claim that Cloudflare or Keystatic is incompatible.

The Astro 6 environment-access issue reported in Keystatic #1554 was fixed upstream by #1606 on August 18, 2026. It is not used as a reason to reject current Keystatic.

A hosted editor can be added later if anywhere-in-browser editing is more valuable than keeping this deployment entirely static. Use GitHub mode rather than filesystem mode, protect the editor origin with appropriate authentication, keep secrets in Worker secrets, and test OAuth, repository authorization, previews, media writes, and unpublishing before enabling it. Current production tests deliberately fail if an admin or API route is emitted.

## References

- [Keystatic Astro installation and server requirement](https://keystatic.com/docs/installation-astro)
- [GitHub mode and authentication](https://keystatic.com/docs/github-mode)
- [Disabling production admin routes](https://keystatic.com/docs/recipes/astro-disable-admin-ui-in-production)
- [Astro environment API fix](https://github.com/Thinkmill/keystatic/pull/1606)
