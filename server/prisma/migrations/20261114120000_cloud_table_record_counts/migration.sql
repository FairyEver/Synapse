BEGIN;

CREATE TABLE "CloudTableStats" (
    "tableId" TEXT NOT NULL,
    "recordCount" BIGINT NOT NULL DEFAULT 0 CHECK ("recordCount" >= 0),
    CONSTRAINT "CloudTableStats_pkey" PRIMARY KEY ("tableId"),
    CONSTRAINT "CloudTableStats_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "CloudTable"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 一次性回填与安装触发器之间不能漏掉写入；列表始终只读元数据。
LOCK TABLE "CloudTableRecord" IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO "CloudTableStats" ("tableId", "recordCount")
SELECT t."id", COALESCE(r."count", 0)
FROM "CloudTable" t
LEFT JOIN (
    SELECT "tableId", COUNT(*) AS "count"
    FROM "CloudTableRecord" WHERE "deletedAt" IS NULL GROUP BY "tableId"
) r ON r."tableId" = t."id";

-- 批量新增只按表合并一次增量，不逐条写计数行。
CREATE FUNCTION cloud_table_stats_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "CloudTableStats" ("tableId", "recordCount")
    SELECT "tableId", COUNT(*) FILTER (WHERE "deletedAt" IS NULL)
    FROM inserted_records GROUP BY "tableId" ORDER BY "tableId"
    ON CONFLICT ("tableId") DO UPDATE
    SET "recordCount" = "CloudTableStats"."recordCount" + EXCLUDED."recordCount";
    RETURN NULL;
END;
$$;

CREATE TRIGGER cloud_table_stats_insert
AFTER INSERT ON "CloudTableRecord"
REFERENCING NEW TABLE AS inserted_records
FOR EACH STATEMENT EXECUTE FUNCTION cloud_table_stats_insert();

-- 普通 values/version 修改不运行触发器；仅软删除和恢复改变计数。
CREATE FUNCTION cloud_table_stats_visibility() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "CloudTableStats"
    SET "recordCount" = "recordCount" + CASE WHEN NEW."deletedAt" IS NULL THEN 1 ELSE -1 END
    WHERE "tableId" = NEW."tableId";
    RETURN NULL;
END;
$$;

CREATE TRIGGER cloud_table_stats_visibility
AFTER UPDATE OF "deletedAt" ON "CloudTableRecord"
FOR EACH ROW
WHEN ((OLD."deletedAt" IS NULL) IS DISTINCT FROM (NEW."deletedAt" IS NULL))
EXECUTE FUNCTION cloud_table_stats_visibility();

-- 已软删除记录清理不再减计数；整表级联删除时不重建统计或父表。
CREATE FUNCTION cloud_table_stats_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "CloudTableStats" s
    SET "recordCount" = s."recordCount" - r."count"
    FROM (
        SELECT "tableId", COUNT(*) AS "count"
        FROM deleted_records WHERE "deletedAt" IS NULL GROUP BY "tableId"
    ) r
    WHERE s."tableId" = r."tableId";
    RETURN NULL;
END;
$$;

CREATE TRIGGER cloud_table_stats_delete
AFTER DELETE ON "CloudTableRecord"
REFERENCING OLD TABLE AS deleted_records
FOR EACH STATEMENT EXECUTE FUNCTION cloud_table_stats_delete();

COMMIT;
