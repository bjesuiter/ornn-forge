PRAGMA foreign_keys = ON;

CREATE TABLE runner_profiles (
  runner_id TEXT PRIMARY KEY REFERENCES runner_credentials(runner_id),
  release TEXT NOT NULL,
  platform TEXT NOT NULL,
  architecture TEXT NOT NULL,
  runtime TEXT NOT NULL,
  executor TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 32),
  updated_at TEXT NOT NULL
);

CREATE TABLE runner_error_states (
  runner_id TEXT PRIMARY KEY REFERENCES runner_credentials(runner_id),
  code TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
