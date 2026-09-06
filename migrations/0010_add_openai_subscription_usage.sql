-- This is a deliberately narrow, singleton store. The reusable credential is
-- an application-layer AES-GCM ciphertext; the D1 schema never receives a
-- plaintext token, account identifier, or OpenAI response payload.
CREATE TABLE openai_subscription_credentials (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  encrypted_record TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The dashboard can read this snapshot without touching the credential.
CREATE TABLE openai_subscription_usage_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  plan TEXT,
  credits REAL,
  primary_used_percent REAL,
  primary_resets_at TEXT,
  secondary_used_percent REAL,
  secondary_resets_at TEXT,
  checked_at TEXT NOT NULL
);

-- Device authorization is short lived and becomes useless after the OAuth
-- exchange. It contains no access token, refresh token, or account id.
CREATE TABLE openai_subscription_device_authorizations (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  device_auth_id TEXT NOT NULL,
  user_code TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
