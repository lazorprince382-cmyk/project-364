-- Ensure school_staff.role CHECK allows system_admin (idempotent on repeat db:init).

ALTER TABLE school_staff DROP CONSTRAINT IF EXISTS school_staff_role_check;

UPDATE school_staff SET role = 'system_admin' WHERE role = 'ghost';

UPDATE school_staff SET role = 'director' WHERE role = 'operator';

UPDATE school_staff
SET role = 'director'
WHERE role IS NULL
   OR TRIM(role) NOT IN ('director', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin');

ALTER TABLE school_staff DROP CONSTRAINT IF EXISTS school_staff_role_check;

ALTER TABLE school_staff
  ADD CONSTRAINT school_staff_role_check
  CHECK (role IN ('director', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin'));
