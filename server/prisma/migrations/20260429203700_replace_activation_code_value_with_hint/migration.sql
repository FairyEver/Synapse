-- DropIndex
DROP INDEX IF EXISTS "ActivationCode_code_key";

-- AlterTable
ALTER TABLE "ActivationCode" DROP COLUMN IF EXISTS "code";
ALTER TABLE "ActivationCode" ADD COLUMN "codeHint" TEXT;
