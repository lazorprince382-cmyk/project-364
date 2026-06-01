-- Staff group chats (members-only visibility).

CREATE TABLE IF NOT EXISTS staff_message_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by_staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_message_group_members (
  group_id INT NOT NULL REFERENCES staff_message_groups(id) ON DELETE CASCADE,
  staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_group_members_staff ON staff_message_group_members (staff_id);

CREATE TABLE IF NOT EXISTS staff_group_messages (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL REFERENCES staff_message_groups(id) ON DELETE CASCADE,
  sender_staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  body TEXT,
  attachment_path TEXT,
  attachment_original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_group_messages_group_created
  ON staff_group_messages (group_id, created_at);

CREATE TABLE IF NOT EXISTS staff_group_message_receipts (
  message_id INT NOT NULL REFERENCES staff_group_messages(id) ON DELETE CASCADE,
  reader_staff_id INT NOT NULL REFERENCES school_staff(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, reader_staff_id)
);
