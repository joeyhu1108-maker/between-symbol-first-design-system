CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  cards_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'generating', 'ready', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  enqueued_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS jobs_recovery ON jobs(status, enqueued_at, lease_until);
