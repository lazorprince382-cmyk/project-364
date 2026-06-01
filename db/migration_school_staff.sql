-- Staff accounts for director dashboard and future dashboard sign-in.

CREATE TABLE IF NOT EXISTS school_staff (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('director', 'operator', 'head_teacher', 'class_teacher', 'skill_teacher')),
  class_level TEXT,
  stream TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_staff_role ON school_staff (role) WHERE active = TRUE;
