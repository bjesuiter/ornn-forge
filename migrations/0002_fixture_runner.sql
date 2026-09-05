PRAGMA foreign_keys = ON;

CREATE TABLE runner_credentials (
  runner_id TEXT PRIMARY KEY,
  credential_digest TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE jobs RENAME TO jobs_v1;
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  invocation_id TEXT NOT NULL UNIQUE REFERENCES invocations(invocation_id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'succeeded')),
  flow_id TEXT NOT NULL CHECK (flow_id = 'analyze'),
  flow_version_id TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  execution_status TEXT,
  execution_completed_at TEXT,
  cleanup_status TEXT CHECK (cleanup_status IN ('pending', 'verified', 'failed')),
  cleanup_updated_at TEXT
);
INSERT INTO jobs (job_id, schema_version, invocation_id, state, flow_id, flow_version_id, policy_version_id, created_at)
  SELECT job_id, schema_version, invocation_id, state, flow_id, flow_version_id, policy_version_id, created_at FROM jobs_v1;
DROP TABLE jobs_v1;

CREATE TABLE runner_leases (
  job_id TEXT PRIMARY KEY REFERENCES jobs(job_id),
  runner_id TEXT NOT NULL REFERENCES runner_credentials(runner_id),
  generation INTEGER NOT NULL,
  token_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE analysis_artifacts (
  job_id TEXT PRIMARY KEY REFERENCES jobs(job_id),
  schema_version INTEGER NOT NULL,
  artifact_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ornn_messages (
  message_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id),
  revision INTEGER NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  github_comment_id TEXT,
  latest_attempt TEXT NOT NULL CHECK (latest_attempt IN ('pending', 'succeeded', 'uncertain', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER runner_credentials_are_immutable
BEFORE UPDATE ON runner_credentials
BEGIN
  SELECT RAISE(ABORT, 'runner credentials are immutable');
END;
