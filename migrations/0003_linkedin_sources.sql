-- Private provenance for repeatable LinkedIn imports. Never included in a public snapshot.
CREATE TABLE IF NOT EXISTS linkedin_sources (
  source_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  original_date TEXT NOT NULL,
  original_text TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  date_evidence TEXT NOT NULL,
  initial_metadata_json TEXT NOT NULL CHECK (json_valid(initial_metadata_json) AND json_extract(initial_metadata_json, '$.draft') = 1 AND substr(json_extract(initial_metadata_json, '$.date'), 1, 10) = original_date AND json_extract(initial_metadata_json, '$.linkedinUrl') = source_url),
  initial_body_markdown TEXT NOT NULL
);

-- One insert claims the source identifier and creates a draft. Failure rolls both back.
CREATE TRIGGER IF NOT EXISTS linkedin_import_draft AFTER INSERT ON linkedin_sources BEGIN
  INSERT INTO content_items(collection,slug,metadata_json,body_markdown,updated_by)
    VALUES ('posts', NEW.slug, NEW.initial_metadata_json, NEW.initial_body_markdown, 'linkedin-import');
END;

CREATE TRIGGER IF NOT EXISTS linkedin_sources_immutable BEFORE UPDATE ON linkedin_sources BEGIN
  SELECT RAISE(ABORT, 'LinkedIn captures are immutable');
END;
CREATE TRIGGER IF NOT EXISTS linkedin_sources_no_delete BEFORE DELETE ON linkedin_sources BEGIN
  SELECT RAISE(ABORT, 'LinkedIn captures are immutable');
END;
