# Content storage options

Reviewed October 25, 2026. Alex selected D1. See [the implemented storage and publication workflow](d1-content.md); the comparison below records the alternatives considered.

Local MDX collections provide authoring inputs and private draft previews. D1 holds production records; a versioned snapshot drives static pages, so readers do not depend on database availability. D1 also provides a foundation for structured research and channel-specific welcomes. A hosted editor or agent still needs a separately implemented authenticated tool layer.

| Option        | Current free allowance                                                              | Fit and limits                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare D1 | 500 MB per database, 5 GB total; 5 million rows read and 100,000 rows written daily | Recommended for structured content in the existing Worker. SQLite semantics; free queries fail after daily allowances are exhausted.       |
| Supabase      | 500 MB Postgres database, 1 GB file storage, 5 GB egress                            | Useful when managed auth and storage are wanted alongside Postgres. Two active free projects; projects pause after one week of inactivity. |
| Neon          | 1 GB Postgres storage and 100 CU-hours monthly per project; 5 GB object storage     | Portable Postgres with branching and scale to zero after five idle minutes. Free restore history is limited.                               |

If a database becomes useful, keep content and media metadata in it while serving image/PDF files from static assets or object storage. Build published snapshots from approved records; retain original publication dates, source links, and draft status. Private research should remain separate from published content. Reader-facing pages can stay static while the editor and research inventory evolve.

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Supabase pricing](https://supabase.com/pricing), [Neon pricing](https://neon.com/pricing).
