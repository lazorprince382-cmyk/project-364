-- Primary subject marks + configurable grading scale (AGG + remark per % band; DIV on marks is overall, recomputed from aggregates)

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defaults: UNEB-style subject grades 1 (best)–9; remarks for CA/% context.
INSERT INTO app_settings (key, value)
VALUES (
  'primary_grading_scale',
  '[
    {"min":90,"max":100,"agg":"1","remark":"Excellent"},
    {"min":80,"max":89,"agg":"2","remark":"Very good"},
    {"min":70,"max":79,"agg":"3","remark":"Good"},
    {"min":65,"max":69,"agg":"4","remark":"Credit"},
    {"min":60,"max":64,"agg":"5","remark":"Satisfactory"},
    {"min":55,"max":59,"agg":"6","remark":"Fair"},
    {"min":50,"max":54,"agg":"7","remark":"Pass"},
    {"min":40,"max":49,"agg":"8","remark":"Weak"},
    {"min":0,"max":39,"agg":"9","remark":"Below minimum standard"}
  ]'::jsonb
)
ON CONFLICT (key) DO NOTHING;

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
CREATE INDEX IF NOT EXISTS idx_subject_marks_class ON student_subject_marks (subject, term, period);
