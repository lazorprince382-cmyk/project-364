-- Ocean School — PostgreSQL schema
-- Run once: psql $DATABASE_URL -f db/schema.sql
-- Or: npm run db:init (uses DATABASE_URL from .env)

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  reg_no TEXT NOT NULL UNIQUE,
  class_level TEXT NOT NULL,
  stream TEXT,
  passport_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students (class_level, stream);

CREATE TABLE IF NOT EXISTS class_documents (
  id SERIAL PRIMARY KEY,
  document_scope TEXT NOT NULL DEFAULT 'class' CHECK (document_scope IN ('class', 'all_classes')),
  class_level TEXT,
  stream TEXT,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  subject TEXT,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('scheme', 'work')),
  title TEXT,
  file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_class ON class_documents (class_level, stream, term);

-- Teacher-rated learner standing per subject (strong / average / weak)
CREATE TABLE IF NOT EXISTS student_subject_band (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  band TEXT NOT NULL CHECK (band IN ('strong', 'average', 'weak')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_subject_band_subject ON student_subject_band (subject);

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

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_subject_marks (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term >= 1 AND term <= 3),
  period TEXT NOT NULL CHECK (period IN ('begin', 'mid', 'end')),
  full_marks NUMERIC NOT NULL DEFAULT 100 CHECK (full_marks > 0 AND full_marks <= 1000),
  marks_scored NUMERIC CHECK (marks_scored IS NULL OR marks_scored >= 0),
  agg TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  initials TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, subject, term, period)
);

CREATE INDEX IF NOT EXISTS idx_subject_marks_student ON student_subject_marks (student_id);
CREATE INDEX IF NOT EXISTS idx_subject_marks_lookup ON student_subject_marks (subject, term, period);
