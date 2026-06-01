-- Skill-scoped staff channels (same class, separate thread per skill subject).

ALTER TABLE class_teacher_messages ADD COLUMN IF NOT EXISTS skill_subject TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_class_messages_room;
CREATE INDEX IF NOT EXISTS idx_class_messages_room
  ON class_teacher_messages (class_level, stream, skill_subject, created_at);
