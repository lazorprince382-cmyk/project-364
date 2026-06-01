ALTER TABLE student_subject_comments
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;
ALTER TABLE student_subject_marks
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;
ALTER TABLE student_head_comments
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;
ALTER TABLE student_class_teacher_comments
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;

UPDATE student_subject_comments
SET academic_year = EXTRACT(YEAR FROM updated_at)::int
WHERE academic_year IS NULL;
UPDATE student_subject_marks
SET academic_year = EXTRACT(YEAR FROM updated_at)::int
WHERE academic_year IS NULL;
UPDATE student_head_comments
SET academic_year = EXTRACT(YEAR FROM updated_at)::int
WHERE academic_year IS NULL;
UPDATE student_class_teacher_comments
SET academic_year = EXTRACT(YEAR FROM updated_at)::int
WHERE academic_year IS NULL;

ALTER TABLE student_subject_comments
  ALTER COLUMN academic_year SET NOT NULL;
ALTER TABLE student_subject_marks
  ALTER COLUMN academic_year SET NOT NULL;
ALTER TABLE student_head_comments
  ALTER COLUMN academic_year SET NOT NULL;
ALTER TABLE student_class_teacher_comments
  ALTER COLUMN academic_year SET NOT NULL;

ALTER TABLE student_subject_comments
  DROP CONSTRAINT IF EXISTS student_subject_comments_student_id_subject_term_period_key;
ALTER TABLE student_subject_marks
  DROP CONSTRAINT IF EXISTS student_subject_marks_student_id_subject_term_period_key;
ALTER TABLE student_head_comments
  DROP CONSTRAINT IF EXISTS student_head_comments_student_id_term_period_key;
ALTER TABLE student_class_teacher_comments
  DROP CONSTRAINT IF EXISTS student_class_teacher_comments_student_id_term_period_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_subject_comments_slot_year
  ON student_subject_comments (student_id, subject, term, period, academic_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_subject_marks_slot_year
  ON student_subject_marks (student_id, subject, term, period, academic_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_head_comments_slot_year
  ON student_head_comments (student_id, term, period, academic_year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_class_teacher_comments_slot_year
  ON student_class_teacher_comments (student_id, term, period, academic_year);
