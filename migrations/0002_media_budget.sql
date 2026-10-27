-- Conservative authoring limits. Reservations survive uncertain uploads so retries
-- cannot hide storage growth. Reconciliation/removal is a separate human action.
CREATE TABLE IF NOT EXISTS media_storage_budget (
  id INTEGER PRIMARY KEY CHECK (id=1),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes BETWEEN 0 AND 8000000000)
);
INSERT INTO media_storage_budget(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS media_storage_reservations (
  filename TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 104857600),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS media_storage_ceiling BEFORE INSERT ON media_storage_reservations
WHEN NOT EXISTS(SELECT 1 FROM media_storage_reservations WHERE filename=NEW.filename)
 AND (SELECT reserved_bytes FROM media_storage_budget WHERE id=1) + NEW.bytes > 8000000000
BEGIN SELECT RAISE(ABORT,'Media storage safety limit reached (8 GB)'); END;
CREATE TRIGGER IF NOT EXISTS media_storage_reserve AFTER INSERT ON media_storage_reservations
BEGIN UPDATE media_storage_budget SET reserved_bytes=reserved_bytes+NEW.bytes WHERE id=1; END;
CREATE TABLE IF NOT EXISTS media_operation_budget (
  month TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('put','get')),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  PRIMARY KEY(month,operation)
);
-- Account for objects already cataloged when upgrading an existing installation.
INSERT INTO media_storage_reservations(filename,bytes)
SELECT substr(url,8),json_extract(metadata_json,'$.bytes') FROM media_assets
WHERE url GLOB '/media/*' AND json_extract(metadata_json,'$.storage')='r2'
ON CONFLICT(filename) DO NOTHING;
