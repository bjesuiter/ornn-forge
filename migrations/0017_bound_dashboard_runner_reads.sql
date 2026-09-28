CREATE INDEX jobs_dashboard_reservations
  ON jobs (job_id)
  WHERE state IS NOT 'pending' AND cleanup_status IS NOT 'verified';
