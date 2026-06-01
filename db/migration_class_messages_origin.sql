-- Track which class dashboard sent a note when posting to another class's staff inbox.

ALTER TABLE class_teacher_messages ADD COLUMN IF NOT EXISTS origin_class_level TEXT NOT NULL DEFAULT '';
ALTER TABLE class_teacher_messages ADD COLUMN IF NOT EXISTS origin_stream TEXT NOT NULL DEFAULT '';
