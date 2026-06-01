CREATE TABLE IF NOT EXISTS student_class_history (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('promote', 'demote', 'transfer')),
  from_class_level TEXT NOT NULL,
  from_stream TEXT NOT NULL DEFAULT '',
  to_class_level TEXT NOT NULL,
  to_stream TEXT NOT NULL DEFAULT '',
  from_year INTEGER,
  to_year INTEGER,
  actor_role TEXT NOT NULL DEFAULT '',
  actor_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_class_history_student
  ON student_class_history (student_id, created_at DESC);
