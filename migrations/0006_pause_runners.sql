PRAGMA foreign_keys = ON;

CREATE TABLE runner_pauses (
  runner_id TEXT PRIMARY KEY REFERENCES runner_credentials(runner_id),
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  updated_at TEXT NOT NULL
);
