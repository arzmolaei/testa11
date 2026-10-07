-- Immutable UTF-8 chunks keep each row under D1's 2 MB row limit.
CREATE TABLE IF NOT EXISTS seo_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  snapshot_id TEXT
);
INSERT OR IGNORE INTO seo_meta (id, revision, snapshot_id) VALUES (1, 0, NULL);

CREATE TABLE IF NOT EXISTS seo_chunks (
  snapshot_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, chunk_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS seo_chunks_created_at ON seo_chunks (created_at);

CREATE TABLE IF NOT EXISTS seo_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_start INTEGER NOT NULL
) WITHOUT ROWID;
