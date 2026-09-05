PRAGMA foreign_keys = ON;

CREATE TABLE deliveries (
  github_delivery_id TEXT PRIMARY KEY,
  body_sha256 TEXT NOT NULL,
  invocation_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL UNIQUE,
  accepted_at TEXT NOT NULL
);

CREATE TABLE invocations (
  invocation_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  github_delivery_id TEXT NOT NULL UNIQUE,
  github_installation_id TEXT NOT NULL,
  github_repository_id TEXT NOT NULL,
  github_repository_full_name TEXT NOT NULL,
  github_issue_number INTEGER NOT NULL,
  github_issue_title TEXT NOT NULL,
  github_issue_body TEXT NOT NULL,
  github_comment_id TEXT NOT NULL UNIQUE,
  github_comment_body TEXT NOT NULL,
  github_actor TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  invocation_id TEXT NOT NULL UNIQUE REFERENCES invocations(invocation_id),
  state TEXT NOT NULL CHECK (state = 'pending'),
  flow_id TEXT NOT NULL CHECK (flow_id = 'analyze'),
  flow_version_id TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE domain_events (
  event_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  stream_kind TEXT NOT NULL CHECK (stream_kind IN ('invocation', 'job')),
  stream_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (stream_kind, stream_id, revision)
);

CREATE INDEX domain_events_stream_order
  ON domain_events(stream_kind, stream_id, revision);

CREATE TRIGGER deliveries_are_immutable
BEFORE UPDATE ON deliveries
BEGIN
  SELECT RAISE(ABORT, 'deliveries are immutable');
END;

CREATE TRIGGER deliveries_are_not_deleted
BEFORE DELETE ON deliveries
BEGIN
  SELECT RAISE(ABORT, 'deliveries are immutable');
END;

CREATE TRIGGER invocations_are_immutable
BEFORE UPDATE ON invocations
BEGIN
  SELECT RAISE(ABORT, 'invocations are immutable');
END;

CREATE TRIGGER invocations_are_not_deleted
BEFORE DELETE ON invocations
BEGIN
  SELECT RAISE(ABORT, 'invocations are immutable');
END;

CREATE TRIGGER domain_events_are_immutable
BEFORE UPDATE ON domain_events
BEGIN
  SELECT RAISE(ABORT, 'domain_events are append-only');
END;

CREATE TRIGGER domain_events_are_not_deleted
BEFORE DELETE ON domain_events
BEGIN
  SELECT RAISE(ABORT, 'domain_events are append-only');
END;
