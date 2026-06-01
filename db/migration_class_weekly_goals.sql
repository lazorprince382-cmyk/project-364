-- Term + weekly goals and dynamic weekly ratings for class subjects

CREATE TABLE IF NOT EXISTS class_subject_term_goals (
  id SERIAL PRIMARY KEY,
  class_level TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  academic_year INTEGER NOT NULL,
  goal_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_level, stream, subject, term, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_class_subject_term_goals_lookup
  ON class_subject_term_goals (class_level, stream, subject, term, academic_year);

CREATE TABLE IF NOT EXISTS class_subject_weekly_goals (
  id SERIAL PRIMARY KEY,
  class_level TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  week_no SMALLINT NOT NULL CHECK (week_no >= 1 AND week_no <= 11),
  academic_year INTEGER NOT NULL,
  goal_text TEXT NOT NULL DEFAULT '',
  rating_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_level, stream, subject, term, week_no, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_class_subject_weekly_goals_lookup
  ON class_subject_weekly_goals (class_level, stream, subject, term, week_no, academic_year);

ALTER TABLE student_subject_weekly_band
  DROP CONSTRAINT IF EXISTS student_subject_weekly_band_band_check;
