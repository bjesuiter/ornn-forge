ALTER TABLE remote_runners ADD COLUMN decommissioned_at TEXT;
ALTER TABLE remote_runners ADD COLUMN decommission_mode TEXT CHECK (decommission_mode IN ('normal', 'force'));

CREATE INDEX remote_runners_active
  ON remote_runners (runner_id)
  WHERE decommissioned_at IS NULL;
