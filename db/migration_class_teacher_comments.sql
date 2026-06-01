-- Class teacher overall comment per learner per term & reporting period (export column).

CREATE TABLE IF NOT EXISTS student_class_teacher_comments (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term SMALLINT NOT NULL,
  period TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, term, period),
  CONSTRAINT student_class_teacher_comments_term_chk CHECK (term >= 1 AND term <= 3),
  CONSTRAINT student_class_teacher_comments_period_chk CHECK (period IN ('begin', 'mid', 'end'))
);

CREATE INDEX IF NOT EXISTS idx_student_class_teacher_comments_student ON student_class_teacher_comments (student_id);
