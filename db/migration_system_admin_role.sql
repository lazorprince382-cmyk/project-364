-- Rename hidden superuser role ghost → system_admin (display: System admin).

UPDATE school_staff SET role = 'system_admin' WHERE role = 'ghost';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_staff_role_check'
  ) THEN
    ALTER TABLE school_staff DROP CONSTRAINT school_staff_role_check;
  END IF;
END $$;

ALTER TABLE school_staff
  ADD CONSTRAINT school_staff_role_check
  CHECK (role IN ('director', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin'));
