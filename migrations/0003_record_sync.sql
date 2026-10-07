-- Audit data never contains credentials or a full workspace snapshot.
CREATE TABLE IF NOT EXISTS seo_history (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  actor_name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  row_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS seo_history_project_revision ON seo_history(project_id, revision DESC, created_at DESC);
