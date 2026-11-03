BEGIN;

CREATE TYPE "TodoPriority" AS ENUM ('high', 'medium', 'low');

ALTER TABLE "TodoItem" ADD COLUMN "priority" "TodoPriority";

COMMIT;
