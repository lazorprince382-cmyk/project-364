ALTER TABLE IF EXISTS student_subject_comments
  DROP CONSTRAINT IF EXISTS student_subject_comments_period_check;
ALTER TABLE IF EXISTS student_subject_comments
  ADD CONSTRAINT student_subject_comments_period_check CHECK (period IN ('begin', 'mid', 'end'));

ALTER TABLE IF EXISTS student_subject_marks
  DROP CONSTRAINT IF EXISTS student_subject_marks_period_check;
ALTER TABLE IF EXISTS student_subject_marks
  ADD CONSTRAINT student_subject_marks_period_check CHECK (period IN ('begin', 'mid', 'end'));

ALTER TABLE IF EXISTS student_class_teacher_comments
  DROP CONSTRAINT IF EXISTS student_class_teacher_comments_period_chk;
ALTER TABLE IF EXISTS student_class_teacher_comments
  ADD CONSTRAINT student_class_teacher_comments_period_chk CHECK (period IN ('begin', 'mid', 'end'));

ALTER TABLE IF EXISTS student_head_comments
  DROP CONSTRAINT IF EXISTS student_head_comments_period_chk;
ALTER TABLE IF EXISTS student_head_comments
  ADD CONSTRAINT student_head_comments_period_chk CHECK (period IN ('begin', 'mid', 'end'));

ALTER TABLE IF EXISTS report_audit_log
  DROP CONSTRAINT IF EXISTS report_audit_log_period_check;
ALTER TABLE IF EXISTS report_audit_log
  ADD CONSTRAINT report_audit_log_period_check CHECK (period IN ('begin', 'mid', 'end'));
