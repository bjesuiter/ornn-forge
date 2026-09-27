ALTER TABLE jobs ADD COLUMN force_quit_requested_at TEXT;
ALTER TABLE jobs ADD COLUMN force_quit_completed_at TEXT;
ALTER TABLE jobs ADD COLUMN force_quit_command_id TEXT;
