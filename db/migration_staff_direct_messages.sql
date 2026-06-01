-- Private 1-to-1 staff direct messages (head teacher, director, teachers, etc.)

CREATE TABLE IF NOT EXISTS staff_direct_messages (
  id SERIAL PRIMARY KEY,
  sender_staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  recipient_staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  body TEXT,
  attachment_path TEXT,
  attachment_original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sender_staff_id <> recipient_staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_dm_sender_recipient
  ON staff_direct_messages (sender_staff_id, recipient_staff_id, created_at);

CREATE INDEX IF NOT EXISTS idx_staff_dm_recipient_sender
  ON staff_direct_messages (recipient_staff_id, sender_staff_id, created_at);

CREATE TABLE IF NOT EXISTS staff_direct_message_receipts (
  message_id INT NOT NULL REFERENCES staff_direct_messages(id) ON DELETE CASCADE,
  reader_staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, reader_staff_id)
);
