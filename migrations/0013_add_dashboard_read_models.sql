CREATE INDEX deliveries_dashboard_recent
  ON deliveries (accepted_at DESC, github_delivery_id DESC);

CREATE TABLE runner_recent_results (
  job_id TEXT PRIMARY KEY REFERENCES jobs(job_id),
  runner_id TEXT NOT NULL REFERENCES remote_runners(runner_id),
  github_repository_full_name TEXT NOT NULL,
  github_issue_number INTEGER NOT NULL,
  github_issue_title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX runner_recent_results_by_runner_completed
  ON runner_recent_results (runner_id, completed_at DESC, job_id DESC);

INSERT INTO runner_recent_results (
  job_id, runner_id, github_repository_full_name, github_issue_number,
  github_issue_title, started_at, completed_at
)
SELECT job_id, runner_id, github_repository_full_name, github_issue_number,
  github_issue_title, started_at, completed_at
FROM (
  SELECT lease.job_id, lease.runner_id, invocation.github_repository_full_name,
    invocation.github_issue_number, invocation.github_issue_title,
    lease.created_at AS started_at, job.execution_completed_at AS completed_at,
    ROW_NUMBER() OVER (
      PARTITION BY lease.runner_id
      ORDER BY job.execution_completed_at DESC, lease.job_id DESC
    ) AS position
  FROM runner_leases lease
  JOIN jobs job ON job.job_id = lease.job_id
  JOIN invocations invocation ON invocation.invocation_id = job.invocation_id
  WHERE job.state = 'succeeded' AND job.execution_completed_at IS NOT NULL
)
WHERE position <= 5;
