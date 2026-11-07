-- This shares a timestamp with the table-creation migration and sorts first.
-- Fresh databases get the column from the create migration; existing databases
-- without it are upgraded here.
ALTER TABLE IF EXISTS "UserCustomApp"
ADD COLUMN IF NOT EXISTS "openMode" VARCHAR(16) NOT NULL DEFAULT 'window';
