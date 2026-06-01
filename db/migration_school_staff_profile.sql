-- Staff profile photo URL (display name already on school_staff).

ALTER TABLE school_staff ADD COLUMN IF NOT EXISTS avatar_url TEXT;
