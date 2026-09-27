CREATE TABLE runner_lease_checkouts (
  job_id TEXT NOT NULL REFERENCES jobs(job_id),
  runner_id TEXT NOT NULL REFERENCES runner_credentials(runner_id),
  generation INTEGER NOT NULL,
  token_digest TEXT NOT NULL PRIMARY KEY,
  repository TEXT NOT NULL,
  revision TEXT NOT NULL,
  prepared_at TEXT NOT NULL
);

CREATE INDEX runner_lease_checkouts_by_job ON runner_lease_checkouts(job_id, prepared_at);

CREATE TRIGGER runner_lease_checkouts_are_immutable
BEFORE UPDATE ON runner_lease_checkouts
BEGIN
  SELECT RAISE(ABORT, 'runner lease checkouts are immutable');
END;

CREATE TRIGGER runner_lease_checkouts_cannot_be_deleted
BEFORE DELETE ON runner_lease_checkouts
BEGIN
  SELECT RAISE(ABORT, 'runner lease checkouts are immutable');
END;
