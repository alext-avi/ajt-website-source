-- Public reads never select from the working copy or revision history.
CREATE TABLE IF NOT EXISTS published_content (
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json) AND json_extract(metadata_json,'$.draft')=0),
  body_markdown TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY(collection,slug)
);
-- Preserve only content that has already been approved. No draft is promoted.
INSERT OR IGNORE INTO published_content
 SELECT collection,slug,metadata_json,body_markdown,revision,updated_by,updated_at
 FROM content_items WHERE is_draft=0 AND coalesce(json_extract(metadata_json,'$.example'),0)=0;
CREATE TRIGGER IF NOT EXISTS content_publish_snapshot AFTER UPDATE ON content_items
 WHEN NEW.is_draft=0 AND coalesce(json_extract(NEW.metadata_json,'$.example'),0)=0
 BEGIN
  INSERT OR REPLACE INTO published_content VALUES(NEW.collection,NEW.slug,NEW.metadata_json,NEW.body_markdown,NEW.revision,NEW.updated_by,NEW.updated_at);
 END;
CREATE TRIGGER IF NOT EXISTS content_publish_initial AFTER INSERT ON content_items
 WHEN NEW.is_draft=0 AND coalesce(json_extract(NEW.metadata_json,'$.example'),0)=0
 BEGIN
  INSERT OR REPLACE INTO published_content VALUES(NEW.collection,NEW.slug,NEW.metadata_json,NEW.body_markdown,NEW.revision,NEW.updated_by,NEW.updated_at);
 END;
CREATE TABLE IF NOT EXISTS authoring_previews (
 token_hash TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 collection TEXT NOT NULL CHECK(collection IN ('posts','projects')),
 slug TEXT NOT NULL,
 revision INTEGER NOT NULL,
 digest TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','posted')),
 published_at TEXT
);
CREATE INDEX IF NOT EXISTS preview_expiry ON authoring_previews(owner_id,expires_at);
CREATE TRIGGER IF NOT EXISTS content_complete_preview AFTER UPDATE ON content_items
 WHEN NEW.is_draft=0 AND OLD.is_draft=1
 BEGIN
  UPDATE authoring_previews SET status='posted',published_at=NEW.updated_at
   WHERE collection=NEW.collection AND slug=NEW.slug AND revision=OLD.revision AND status='ready';
 END;
CREATE TABLE IF NOT EXISTS published_media (
 collection TEXT NOT NULL, slug TEXT NOT NULL, revision INTEGER NOT NULL, url TEXT NOT NULL,
 PRIMARY KEY(collection,slug,revision,url)
);
-- Before runtime rollout, run scripts/backfill-published-media.mjs --remote.
-- Its shared Markdown parser registers references from already-approved bodies;
-- SQL alone cannot safely parse Markdown. It never changes content approval.
-- Short-lived upload chunks only; complete objects live in private B2.
CREATE TABLE IF NOT EXISTS authoring_uploads (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 26214400), received INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','finishing'))
);
CREATE TABLE IF NOT EXISTS authoring_upload_chunks (
 upload_id TEXT NOT NULL REFERENCES authoring_uploads(id) ON DELETE CASCADE,
 offset INTEGER NOT NULL, data BLOB NOT NULL,
 PRIMARY KEY(upload_id,offset)
);
