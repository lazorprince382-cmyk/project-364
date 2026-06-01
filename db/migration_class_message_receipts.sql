-- Read receipts: delivered (another teacher loaded thread) and seen (explicit mark).

CREATE TABLE IF NOT EXISTS class_message_receipts (
  message_id INTEGER NOT NULL REFERENCES class_teacher_messages(id) ON DELETE CASCADE,
  reader_label TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, reader_label)
);

CREATE INDEX IF NOT EXISTS idx_class_msg_receipts_msg ON class_message_receipts (message_id);
