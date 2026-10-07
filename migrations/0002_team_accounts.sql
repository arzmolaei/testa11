-- Account passwords are salted PBKDF2 hashes. The existing APP_PASSWORD secret
-- bootstraps the first owner after a successful login; it is never seeded here.
CREATE TABLE IF NOT EXISTS seo_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  password_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at INTEGER NOT NULL
);
