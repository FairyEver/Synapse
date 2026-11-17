BEGIN;

ALTER TYPE "TodoPriority" RENAME TO "TodoPriority_old";
CREATE TYPE "TodoPriority" AS ENUM ('p0', 'p1', 'p2', 'p3');

ALTER TABLE "TodoItem"
  ALTER COLUMN "priority" TYPE "TodoPriority"
  USING (
    CASE "priority"::text
      WHEN 'high' THEN 'p0'
      WHEN 'medium' THEN 'p1'
      WHEN 'low' THEN 'p2'
    END
  )::"TodoPriority";

DROP TYPE "TodoPriority_old";

COMMIT;
