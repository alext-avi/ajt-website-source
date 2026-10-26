# Referral links and analytics

## Public URL contract

`/r/*` is a wildcard handled by a small Cloudflare Worker. New source slugs do not require route files, registration, or a rebuild.

| Shared URL                                          | Landing campaign parameters                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/r/linkedin`                                       | `utm_source=linkedin&utm_medium=referral&utm_campaign=shared-link`            |
| `/r/apex`                                           | `utm_source=apex&utm_medium=referral&utm_campaign=shared-link`                |
| `/r/linkedin/agentic-sdlc`                          | `utm_source=linkedin&utm_medium=referral&utm_campaign=agentic-sdlc`           |
| `/r/linkedin?utm_medium=social&utm_content=profile` | Source `linkedin`, medium `social`, campaign `shared-link`, content `profile` |

Use short, lowercase source names. The first path segment after `/r/` is the source. Up to three optional following segments form a campaign name. Segments support letters, numbers, dots, underscores, and hyphens, with a maximum of 64 characters each and 128 characters for the combined campaign suffix. Case is normalized. One trailing slash is accepted. There is no source allowlist.

The destination is currently the homepage on the same origin. Only the documented campaign parameters are forwarded; `utm_source` always comes from the path. Arbitrary destination/redirect parameters, click identifiers, and unrelated query strings are not forwarded. Do not put names, email addresses, or other personal information into these public links.

Redirects use HTTP 302 and `Cache-Control: no-store`. This keeps the namespace available for channel-specific welcome pages later, without browsers retaining permanent redirects. The route sets `X-Robots-Tag: noindex, follow`. Normal pages remain static assets. No referral cookie, visitor database, or custom event-ingestion backend is used.

`npm run dev` serves Astro pages and the editor. Use `npm run cf:preview` to exercise the referral Worker and production headers. The edge route is tested independently with Node tests as well.

## GA4 integration

Set `PUBLIC_GA4_MEASUREMENT_ID` to the website stream’s `G-...` ID in `.env`. Also set the matching GitHub repository variable for CI and any future remote build environment. It is a public configuration ID, not a credential. Rebuild and deploy after changing it.

The tag is enabled only in production builds with a valid ID and an indexable production origin. Development and unpublished draft previews do not load it. If the ID is absent, analytics is disabled.

The Google tag waits for a visitor’s affirmative choice. No Google Analytics script or measurement request is sent before that choice. Do Not Track and Global Privacy Control keep the tag off. Visitors can reopen their choice from the footer. Declining removes this site’s `_ga` cookies; declining after activation also reloads the page to remove the active tag. The local-storage choice is browser-specific. The Google tag’s cookie expiration is set to 90 days.

Google signals and advertising personalization are disabled in the site configuration. Alex chose to keep enhanced measurement enabled, including its automatic interaction events. On-site search terms, scrolls, outbound clicks, and other supported interactions may therefore be measured after consent. The client’s filtered page address does not claim to filter all parameters of Google’s automatic events. The page address supplied to GA4 includes only the path and validated campaign parameters, excluding Writing search text, fragments, and unrelated parameters. External referring addresses are reduced to their origin. The public `/privacy/` page explains the choices.

Use GA4 **Reports → Acquisition → Traffic acquisition**, with **Session source / medium** or **Session campaign**, to compare links. Standard campaign attribution carries the landing source into subsequent activity; do not add campaign tags to the site’s internal navigation. Visits with analytics declined, disabled JavaScript, or blocked tracking are not measured. Initial test visits may appear in the property. Standard reports can take time to populate; use Realtime for the first check.

The production web stream uses measurement ID `G-JLX8RLTRH4`, stream ID `16200089700`, account `413341899`, and property `560723382`. These identifiers are public configuration, not credentials. The property is available at https://analytics.google.com/analytics/web/#/a413341899p560723382/reports/intelligenthome.

## Provider decision, October 25, 2026

Alex selected GA4 after comparing these hosted options:

- **GA4:** free standard service, campaign attribution and conversion reports. Selected for the current site.
- **Umami Cloud:** free Hobby plan, one site, 100,000 events/month, six-month retention; a simpler alternative for basic traffic reporting.
- **PostHog:** one million analytics events/month on its free plan, plus product analytics, feature flags, and experiments. Broader than the current need.
- **Cloudflare Web Analytics:** free basic analytics, but currently no UTM parameter reporting or custom events, so it does not meet the campaign requirement by itself.

References checked October 25, 2026:

- https://marketingplatform.google.com/about/analytics/
- https://support.google.com/analytics/answer/10917952
- https://developers.google.com/tag-platform/gtagjs/configure
- https://developers.google.com/tag-platform/security/guides/consent
- https://developers.google.com/tag-platform/security/guides/csp
- https://umami.is/pricing
- https://posthog.com/pricing
- https://developers.cloudflare.com/web-analytics/faq/
- https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
