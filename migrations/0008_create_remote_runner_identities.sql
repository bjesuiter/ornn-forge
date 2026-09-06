PRAGMA foreign_keys = ON;

CREATE TABLE remote_runners (
  runner_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind = 'remote'),
  desired_capacity INTEGER NOT NULL CHECK (desired_capacity BETWEEN 1 AND 32),
  enrollment_state TEXT NOT NULL CHECK (enrollment_state IN ('awaiting_setup', 'enrolled')),
  readiness_state TEXT NOT NULL CHECK (readiness_state IN ('not_ready', 'ready')),
  created_at TEXT NOT NULL
);

INSERT INTO remote_runners (
  runner_id, kind, desired_capacity, enrollment_state, readiness_state, created_at
)
SELECT credential.runner_id, 'remote', COALESCE(profile.capacity, 1), 'enrolled', 'not_ready', credential.created_at
FROM runner_credentials credential
LEFT JOIN runner_profiles profile ON profile.runner_id = credential.runner_id;

CREATE TABLE runner_setup_tokens (
  token_id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL REFERENCES remote_runners(runner_id),
  token_digest TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  consumed_at TEXT,
  replaced_token_id TEXT REFERENCES runner_setup_tokens(token_id)
);

CREATE INDEX runner_setup_tokens_by_runner ON runner_setup_tokens(runner_id, created_at);
