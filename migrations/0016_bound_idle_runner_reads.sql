CREATE INDEX jobs_pending_oldest
  ON jobs (created_at, job_id)
  WHERE state = 'pending';

CREATE INDEX jobs_unverified_reservation
  ON jobs (job_id)
  WHERE cleanup_status IS NOT 'verified';

CREATE INDEX jobs_outstanding_command
  ON jobs (force_quit_command_id)
  WHERE force_quit_requested_at IS NOT NULL AND force_quit_completed_at IS NULL;
