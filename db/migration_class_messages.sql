-- Staff messages per class (teachers share a channel per class/stream).

CREATE TABLE IF NOT EXISTS class_teacher_messages (
  id SERIAL PRIMARY KEY,
  class_level TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT '',
  sender_label TEXT NOT NULL DEFAULT 'Teacher',
  body TEXT NOT NULL DEFAULT '',
  attachment_path TEXT,
  attachment_original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_class_messages_room ON class_teacher_messages (class_level, stream, created_at);
