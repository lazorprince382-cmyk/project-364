-- Per-class progress for skill subjects (skill teacher dashboard).
CREATE TABLE IF NOT EXISTS skill_class_progress (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  class_level TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT '',
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  progress_percent SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  summary TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject, class_level, stream, term)
);

CREATE INDEX IF NOT EXISTS idx_skill_progress_subject ON skill_class_progress (subject);
