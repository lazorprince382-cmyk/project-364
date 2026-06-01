CREATE TABLE IF NOT EXISTS report_audit_log (
  id BIGSERIAL PRIMARY KEY,
  class_level TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT '',
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  term SMALLINT CHECK (term >= 1 AND term <= 3),
  period TEXT CHECK (period IN ('begin', 'mid', 'end')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  subject TEXT,
  old_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT NOT NULL DEFAULT 'class_teacher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_audit_lookup
  ON report_audit_log (student_id, term, period, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_audit_class
  ON report_audit_log (class_level, stream, term, period, created_at DESC);
