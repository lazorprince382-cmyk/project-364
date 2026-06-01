-- Learner comments per subject / term / period (beginning, mid, or end of term).
CREATE TABLE IF NOT EXISTS student_subject_comments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  period TEXT NOT NULL CHECK (period IN ('begin', 'mid', 'end')),
  body TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'class_teacher' CHECK (author_role IN ('skill_teacher', 'class_teacher')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, subject, term, period)
);

CREATE INDEX IF NOT EXISTS idx_comments_student ON student_subject_comments (student_id);
CREATE INDEX IF NOT EXISTS idx_comments_class_subject ON student_subject_comments (subject, term, period);
