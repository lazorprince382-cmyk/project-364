-- One head teacher / head caregiver narrative per learner per term & reporting period (fills export column).

CREATE TABLE IF NOT EXISTS student_head_comments (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term SMALLINT NOT NULL,
  period TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, term, period),
  CONSTRAINT student_head_comments_term_chk CHECK (term >= 1 AND term <= 3),
  CONSTRAINT student_head_comments_period_chk CHECK (period IN ('begin', 'mid', 'end'))
);

CREATE INDEX IF NOT EXISTS idx_student_head_comments_student ON student_head_comments (student_id);
