import type { PinoLogger } from "nestjs-pino"
import type { Prisma } from "@prisma/client"
import { CloudTableDatabase } from "./cloud-table-database"
import { CloudTableScheduler } from "./cloud-table-scheduler"

/** 每个时间片由有限批次组成；有积压时继续调度，不把保留期变成固定删除速率。 */
export class CloudTableMaintenance {
  private running = false
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  constructor(private readonly db: CloudTableDatabase, private readonly scheduler: CloudTableScheduler, private readonly logger?: PinoLogger) {}
  close(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer) }
  async cleanup(now = new Date()): Promise<void> {
    if (this.running || this.stopped) return
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    this.running = true
    let logs = true, data = true
    const deadline = performance.now() + this.db.config.maintenanceMs
    try {
      for (let round = 0; round < 32 && performance.now() < deadline && (logs || data) && !this.stopped; round++) {
        if (logs) logs = await this.scheduler.run("__maintenance__", 0, () => this.db.transaction(async tx => {
          const a = await tx.$executeRaw`DELETE FROM "CloudTableOperationLog" WHERE "id" IN (SELECT "id" FROM "CloudTableOperationLog" WHERE "createdAt" < ${new Date(now.getTime() - 30 * 86400000)} ORDER BY "createdAt" LIMIT 500)`
          const b = await tx.$executeRaw`DELETE FROM "CloudTableReceipt" WHERE "id" IN (SELECT "id" FROM "CloudTableReceipt" WHERE "createdAt" < ${new Date(now.getTime() - 86400000)} ORDER BY "createdAt" LIMIT 500)`
          return a + b > 0
        }), undefined, 10)
        // 独立事务避免某张表的锁/大记录问题回滚已完成的日志清理。
        if (data) data = await this.scheduler.run("__maintenance__", 0, () => this.db.transaction(tx => this.pruneData(tx, now)), undefined, 10)
      }
    } catch (error) { this.logger?.warn({ errorName: error instanceof Error ? error.name : typeof error }, "Cloud table maintenance deferred") }
    finally {
      this.running = false
      if (!this.stopped && (logs || data)) { this.timer = setTimeout(() => void this.cleanup(), 1000); this.timer.unref() }
    }
  }
  private async pruneData(tx: Prisma.TransactionClient, now: Date): Promise<boolean> {
    const cutoff = new Date(now.getTime() - 30 * 86400000); let changed = 0
    const table = await tx.cloudTable.findFirst({ where: { deletedAt: { lt: cutoff } }, select: { id: true }, orderBy: { deletedAt: "asc" } })
    if (table) {
      await tx.$queryRaw`SELECT "id" FROM "CloudTable" WHERE "id" = ${table.id} FOR UPDATE`
      changed += await tx.$executeRaw`DELETE FROM "CloudTableRecord" WHERE "id" IN (SELECT "id" FROM "CloudTableRecord" WHERE "tableId" = ${table.id} LIMIT 100)`
      changed += await tx.$executeRaw`DELETE FROM "CloudTableReceipt" WHERE "id" IN (SELECT "id" FROM "CloudTableReceipt" WHERE "tableId" = ${table.id} LIMIT 100)`
      const hasRows = await tx.cloudTableRecord.findFirst({ where: { tableId: table.id }, select: { id: true } })
      const hasReceipts = await tx.cloudTableReceipt.findFirst({ where: { tableId: table.id }, select: { id: true } })
      if (!hasRows && !hasReceipts) { await tx.cloudTable.delete({ where: { id: table.id } }); changed++ }
    }
    changed += await tx.$executeRaw`DELETE FROM "CloudTableRecord" WHERE "id" IN (SELECT "id" FROM "CloudTableRecord" WHERE "deletedAt" < ${cutoff} ORDER BY "deletedAt" LIMIT 100)`
    const field = await tx.cloudTableField.findFirst({ where: { archivedAt: { lt: cutoff } }, orderBy: { archivedAt: "asc" } })
    if (field) {
      await tx.$queryRaw`SELECT "id" FROM "CloudTable" WHERE "id" = ${field.tableId} FOR UPDATE`
      changed += await tx.$executeRaw`UPDATE "CloudTableRecord" SET "values" = "values" - ${field.key} WHERE "id" IN (SELECT "id" FROM "CloudTableRecord" WHERE "tableId" = ${field.tableId} AND "values" ? ${field.key} LIMIT 100)`
      const remaining = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CloudTableRecord" WHERE "tableId" = ${field.tableId} AND "values" ? ${field.key} LIMIT 1`
      if (!remaining.length) { await tx.cloudTableField.delete({ where: { id: field.id } }); changed++ }
    }
    return changed > 0
  }
}
