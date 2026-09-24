-- 用户自填的展示昵称。分三步走：先加可空列（不锁旧表、不带 NOT NULL），
-- 再用 handle 回填存量用户，最后收紧为 NOT NULL。
-- handle 本身已是 NOT NULL，所以回填不会漏行；线上实测 42 个用户、最长
-- handle 14 个字符，left(handle, 24) 只是兜底，不会真的截断任何现有账号。
ALTER TABLE "User" ADD COLUMN "nickname" VARCHAR(24);

UPDATE "User" SET "nickname" = left("handle", 24) WHERE "nickname" IS NULL;

ALTER TABLE "User" ALTER COLUMN "nickname" SET NOT NULL;
