CREATE TABLE IF NOT EXISTS student_subject_weekly_band (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  week_no SMALLINT NOT NULL CHECK (week_no >= 1 AND week_no <= 11),
  band TEXT NOT NULL CHECK (band IN ('strong', 'average', 'weak')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, subject, term, week_no)
);

CREATE INDEX IF NOT EXISTS idx_weekly_band_lookup
  ON student_subject_weekly_band (student_id, subject, term, week_no);
