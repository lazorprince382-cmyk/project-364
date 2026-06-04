-- Hidden superuser role (system_admin; legacy DB value was ghost).

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

UPDATE school_staff SET role = 'system_admin' WHERE role = 'ghost';

ALTER TABLE school_staff
  ADD CONSTRAINT school_staff_role_check
  CHECK (role IN ('director', 'operator', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin'));
