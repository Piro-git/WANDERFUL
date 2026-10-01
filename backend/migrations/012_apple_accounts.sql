-- Account data is isolated from route, preparation and App Attest records.
CREATE TABLE IF NOT EXISTS apple_accounts (
  account_id uuid PRIMARY KEY,
  apple_subject_hash text NOT NULL UNIQUE,
  email_ciphertext text,
  refresh_token_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS apple_account_sessions (
  session_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES apple_accounts(account_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS apple_account_sessions_active_idx
  ON apple_account_sessions (account_id, expires_at) WHERE revoked_at IS NULL;

REVOKE ALL ON apple_accounts, apple_account_sessions FROM PUBLIC;
