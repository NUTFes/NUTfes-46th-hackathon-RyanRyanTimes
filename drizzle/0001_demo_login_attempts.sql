CREATE TABLE demo_login_attempts (
  ip TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  failures INTEGER NOT NULL
);
CREATE INDEX demo_login_attempts_expires ON demo_login_attempts (expires_at);
