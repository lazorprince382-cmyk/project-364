-- Hidden superuser role (not listed in staff directories).

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

ALTER TABLE school_staff
  ADD CONSTRAINT school_staff_role_check
  CHECK (role IN ('director', 'operator', 'head_teacher', 'class_teacher', 'skill_teacher', 'ghost'));
