-- Content is private to the bound Worker and Cloudflare's authenticated APIs.
-- Metadata is validated against the same schemas used by Astro and the importer.
CREATE TABLE content_items (
  collection TEXT NOT NULL CHECK (collection IN ('posts', 'projects', 'talks')),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 160 AND slug NOT GLOB '*[^a-z0-9-]*'),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  body_markdown TEXT NOT NULL,
  title TEXT GENERATED ALWAYS AS (json_extract(metadata_json, '$.title')) VIRTUAL,
  is_draft INTEGER GENERATED ALWAYS AS (coalesce(json_extract(metadata_json, '$.draft'), 1)) VIRTUAL,
  published_on TEXT GENERATED ALWAYS AS (
    CASE WHEN collection = 'posts' THEN json_extract(metadata_json, '$.date') END
  ) VIRTUAL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT NOT NULL DEFAULT 'initial-import',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (collection, slug),
  CHECK (json_type(metadata_json, '$.title') = 'text'),
  CHECK (json_type(metadata_json, '$.draft') IN ('true', 'false'))
);
CREATE INDEX content_publication ON content_items(collection, is_draft, published_on DESC);

-- Keep a complete revision history for future editor/agent operations.
CREATE TABLE content_revisions (
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  revision INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (collection, slug, revision)
);
CREATE TRIGGER content_insert_history AFTER INSERT ON content_items BEGIN
  INSERT INTO content_revisions VALUES (
    NEW.collection, NEW.slug, NEW.revision, NEW.metadata_json,
    NEW.body_markdown, NEW.updated_by, NEW.updated_at
  );
END;
CREATE TRIGGER content_update_history AFTER UPDATE ON content_items BEGIN
  INSERT INTO content_revisions VALUES (
    NEW.collection, NEW.slug, NEW.revision, NEW.metadata_json,
    NEW.body_markdown, NEW.updated_by, NEW.updated_at
  );
END;

CREATE TABLE media_assets (
  url TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'slides')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Optional channel configuration; /r/* continues to accept unregistered sources.
-- These fields reserve a home for future personalized welcomes, without tracking visitors.
CREATE TABLE referral_channels (
  slug TEXT PRIMARY KEY CHECK (length(slug) BETWEEN 1 AND 64 AND slug NOT GLOB '*[^a-z0-9._-]*'),
  display_name TEXT NOT NULL,
  welcome_text TEXT,
  featured_content_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(featured_content_json) AND json_type(featured_content_json) = 'array'),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO referral_channels(slug, display_name) VALUES ('linkedin', 'LinkedIn'), ('apex', 'Apex');
