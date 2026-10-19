-- SupplyDesk authentication tables.
-- This migration is additive and preserves existing business data.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'manager', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_not_blank
    CHECK (length(trim(email)) > 0)
);

CREATE UNIQUE INDEX users_email_lower_unique
  ON users (lower(email));

CREATE INDEX users_active_role_idx
  ON users (is_active, role);

-- Schema required by connect-pg-simple.
CREATE TABLE user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX user_sessions_expire_idx
  ON user_sessions (expire);