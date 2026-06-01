CREATE TABLE IF NOT EXISTS skill_term_goals (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  class_level TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT '',
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  academic_year INTEGER NOT NULL,
  goal_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject, class_level, stream, term, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_skill_term_goals_lookup
  ON skill_term_goals (subject, class_level, stream, term, academic_year);

CREATE TABLE IF NOT EXISTS student_skill_lesson_progress (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  academic_year INTEGER NOT NULL,
  lesson_no SMALLINT NOT NULL CHECK (lesson_no >= 1 AND lesson_no <= 40),
  lesson_date DATE,
  status TEXT NOT NULL CHECK (status IN ('needs_support', 'progressing', 'on_track', 'goal_met')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, subject, term, academic_year, lesson_no)
);

CREATE INDEX IF NOT EXISTS idx_student_skill_lesson_progress_lookup
  ON student_skill_lesson_progress (student_id, subject, term, academic_year, lesson_no);
