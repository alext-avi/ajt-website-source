# GA4 API round-trip verification

The production browser tests verify that real Cloudflare pages work and that the deployed Google tag delivers their page views. The subsequent GA4 API step independently checks that Google's Realtime reporting system contains those same visits. It queries the Data API directly; no MCP server or third-party analytics connector runs in CI.

## Correlating a real test run

The referral URL labels the visit with source playwright-ci, medium testing, campaign production-checks, and a unique browser run ID in utm_content. The workflow ID receives a -d suffix for desktop Chromium and -m for mobile Safari. After analytics consent, the site sends that browser ID as the ci_run_id user property on its normal page-view events. No additional events are fabricated or submitted through Measurement Protocol.

Only that explicit campaign can create the marker. It must start with gha- or local- and fit the 36-character user-property value limit; workflow IDs are limited to 34 characters to reserve the browser suffix. It persists in session storage for navigation within the test tab and clears when analytics consent is withdrawn. Other campaigns and ordinary visitors receive no new user property. Existing consent, Do Not Track, and Global Privacy Control behavior is preserved.

The Realtime API supports registered user-scoped custom dimensions, but does not expose page_location or campaign UTM parameters. Register a **User-scoped** custom dimension with user property **ci_run_id** in this GA4 property. An event-scoped definition will not work. Custom definitions can require time to become available; verify that registration is ready before expecting the first API check to pass.

## Read-only CI identity

Use a dedicated Google service account with **Viewer** access to this GA4 property only. It needs no Google Cloud project roles, Analytics editor role, account-wide GA4 access, or downloaded service-account key.

Enable the Analytics Data API, IAM Service Account Credentials API, and Security Token Service API in the selected Google Cloud project. Configure GitHub Workload Identity Federation through the service account. Restrict the provider to the numeric repository and owner IDs for the private production repo, refs/heads/main, push/workflow_dispatch events, and the verify.yml workflow on main. Grant that principal only Workload Identity User on this service account.

The pinned Google authentication action requests a short-lived access token with the analytics.readonly scope after browser tests have finished. It writes no credential file. The token is passed only to the API step, and is not saved in reports or made available to the browser. Only the production-checks job can request a GitHub OIDC token. Public-repo runs and pull requests cannot enter that job.

Configure these non-secret Actions variables on the private production repo:

| Variable | Value |
| --- | --- |
| GA4_PROPERTY_ID | 560723382 |
| GA4_STREAM_ID | 16200089700 |
| GA4_GOOGLE_CLOUD_PROJECT | Selected Google Cloud project ID |
| GA4_WORKLOAD_IDENTITY_PROVIDER | Full projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER resource |
| GA4_SERVICE_ACCOUNT | Dedicated service account email |

## What makes the check pass

Each completed browser journey writes a JSON manifest under test-results-production with its run ID, target, measurement ID, device category, successfully checked paths, and actual page titles. Failed, missing, or stale journey manifests are rejected.

The API is an ingestion smoke check, while Playwright and its network assertions verify the full journeys. The page report filters the configured stream and browser markers and must contain the desktop landing-page view for this exact run. A separate event report then requires enough page_view events to account for the desktop page rows and zero screen_view events. A screen_view substitute cannot satisfy the combined check. Both completed desktop and mobile journey manifests remain mandatory. Each API phase polls for up to three minutes; authentication/schema errors fail immediately.

The artifact separately records observed reporting coverage across all 16 journey page/browser pairs, including any missing rows. A passing ingestion probe does not claim that GA4 captured every automated visit. Google can omit bot traffic and delay processing, so aggregate analytics is not used as a complete server request log.

Realtime limits each request to four dimensions, including dimensions referenced only in filters, and does not permit event names with page titles in the same report. Each query uses three compatible dimensions: browser run ID and stream ID, plus either page title or event name. Browser identity comes from each completed Playwright project's unique marker; it does not depend on GA4's inferred device category. Browsers use their standard Playwright device-profile user agents. CI traffic remains explicitly labelled through its campaign and browser markers.

The production-playwright-results artifact retains the manifests, the API query, selected returned rows and counts, missing page/device pairs, attempt count, and timestamps for seven days. Authentication headers, cookies, and client/session IDs are not written to the JSON evidence. Failure traces can contain the test browser's anonymous network and storage state.

The job summary explicitly says whether API ingestion was verified. Missing credentials, unavailable custom dimensions, permission errors, or reporting delays are failures, not successful round trips. Testing the current live site still does not prove that this workflow's source revision was deployed when the Cloudflare deployment token is absent.

For an authenticated local read-back, set the same target, measurement ID, property, stream, and run ID used by a completed live test, provide a short-lived GA4_ACCESS_TOKEN through the environment, and run npm run ga4:verify. Never place a token in chat, source code, shell command text, or committed configuration.

## References

- [Google Realtime API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-api-schema)
- [Realtime report endpoint](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport)
- [Google user-property limits](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference#user_properties)
- [GitHub-to-Google authentication](https://github.com/google-github-actions/auth)
- [Official Google Analytics MCP](https://developers.google.com/analytics/devguides/MCP)
