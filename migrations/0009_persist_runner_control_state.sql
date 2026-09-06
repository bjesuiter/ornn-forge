PRAGMA foreign_keys = ON;

ALTER TABLE runner_profiles ADD COLUMN logical_cpu_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runner_profiles ADD COLUMN memory_limit_bytes INTEGER NOT NULL DEFAULT 134217728;

CREATE TABLE runner_commands (
  command_id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL REFERENCES remote_runners(runner_id),
  command_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE runner_command_journal (
  runner_id TEXT NOT NULL REFERENCES remote_runners(runner_id),
  command_id TEXT NOT NULL REFERENCES runner_commands(command_id),
  state TEXT NOT NULL CHECK (state IN ('accepted', 'completed', 'failed')),
  reported_at TEXT NOT NULL,
  PRIMARY KEY (runner_id, command_id)
);
