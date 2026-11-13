import { z } from "zod"
const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback)
export function cloudTableConfig(source: Record<string, unknown> = process.env) {
  const v = z.object({
    CLOUD_TABLE_CONCURRENCY: positive(8), CLOUD_TABLE_OWNER_CONCURRENCY: positive(2),
    CLOUD_TABLE_TABLE_CONCURRENCY: positive(2),
    CLOUD_TABLE_OWNER_QUEUE: positive(32), CLOUD_TABLE_GLOBAL_QUEUE: positive(128),
    CLOUD_TABLE_TABLE_QUEUE: positive(16),
    CLOUD_TABLE_QUEUE_BYTES: positive(16 * 1024 * 1024), CLOUD_TABLE_WAIT_MS: positive(5000),
    CLOUD_TABLE_SQL_MS: positive(2000), CLOUD_TABLE_LOCK_MS: positive(250),
    CLOUD_TABLE_MAINTENANCE_MS: positive(1000),
    CLOUD_TABLE_AUTH_CONCURRENCY: positive(4), CLOUD_TABLE_INSTANCES: z.coerce.number().int().min(1).max(1).default(1),
  }).parse(source)
  if (v.CLOUD_TABLE_OWNER_CONCURRENCY > v.CLOUD_TABLE_CONCURRENCY) throw new Error("云表单账号并发不能超过全局并发。")
  return { concurrency: v.CLOUD_TABLE_CONCURRENCY, ownerConcurrency: v.CLOUD_TABLE_OWNER_CONCURRENCY, tableConcurrency: v.CLOUD_TABLE_TABLE_CONCURRENCY, ownerQueue: v.CLOUD_TABLE_OWNER_QUEUE, tableQueue: v.CLOUD_TABLE_TABLE_QUEUE, globalQueue: v.CLOUD_TABLE_GLOBAL_QUEUE, bytes: v.CLOUD_TABLE_QUEUE_BYTES, waitMs: v.CLOUD_TABLE_WAIT_MS, sqlMs: v.CLOUD_TABLE_SQL_MS, lockMs: v.CLOUD_TABLE_LOCK_MS, authConcurrency: v.CLOUD_TABLE_AUTH_CONCURRENCY, maintenanceMs: v.CLOUD_TABLE_MAINTENANCE_MS }
}
