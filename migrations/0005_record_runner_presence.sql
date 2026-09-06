PRAGMA foreign_keys = ON;

CREATE TABLE runner_presence (
  runner_id TEXT PRIMARY KEY REFERENCES runner_credentials(runner_id),
  last_seen_at TEXT NOT NULL
);
