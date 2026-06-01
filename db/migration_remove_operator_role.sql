-- Remove operator role and accounts from the system.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'school_staff_role_check'
  ) THEN
    ALTER TABLE school_staff DROP CONSTRAINT school_staff_role_check;
  END IF;
END $$;

DELETE FROM staff_direct_message_receipts r
USING staff_direct_messages m, school_staff s
WHERE s.role = 'operator'
  AND (
    (m.sender_staff_id = s.id OR m.recipient_staff_id = s.id)
    AND r.message_id = m.id
  );

DELETE FROM staff_direct_messages m
USING school_staff s
WHERE s.role = 'operator'
  AND (m.sender_staff_id = s.id OR m.recipient_staff_id = s.id);

DELETE FROM staff_group_message_receipts r
USING staff_group_messages m, school_staff s
WHERE s.role = 'operator'
  AND m.sender_staff_id = s.id
  AND r.message_id = m.id;

DELETE FROM staff_group_messages m
USING school_staff s
WHERE s.role = 'operator'
  AND m.sender_staff_id = s.id;

DELETE FROM staff_message_group_members mem
USING school_staff s
WHERE s.role = 'operator'
  AND mem.staff_id = s.id;

DELETE FROM school_staff WHERE role = 'operator';

ALTER TABLE school_staff
  ADD CONSTRAINT school_staff_role_check
  CHECK (role IN ('director', 'head_teacher', 'class_teacher', 'skill_teacher', 'ghost'));
