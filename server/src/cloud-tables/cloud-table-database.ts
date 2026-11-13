import { Injectable, OnModuleDestroy } from "@nestjs/common"
import { Prisma, PrismaClient } from "@prisma/client"
import { cloudTableConfig } from "./cloud-table-config"
import { OpenApiHttpError } from "../open-api/open-api.types"

export function cloudTableDatabaseFailure(error: unknown): OpenApiHttpError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code === "P2024") return new OpenApiHttpError(503, "DB_POOL_TIMEOUT", "数据库连接繁忙，请稍后重试。")
  if (error.code === "P2028") return new OpenApiHttpError(503, "DB_TRANSACTION_TIMEOUT", "数据库事务超时，请稍后重试。")
  if (error.code === "P2034") return new OpenApiHttpError(503, "DB_WRITE_CONFLICT", "数据库写入冲突，请稍后重试。")
  if (error.code !== "P2010") return null
  switch (String(error.meta?.code ?? "")) {
    case "57014": return new OpenApiHttpError(503, "DB_STATEMENT_TIMEOUT", "数据库查询超时，请稍后重试。")
    case "55P03": return new OpenApiHttpError(503, "DB_LOCK_TIMEOUT", "数据库锁等待超时，请稍后重试。")
    case "40P01": return new OpenApiHttpError(503, "DB_DEADLOCK", "数据库写入冲突，请稍后重试。")
    case "40001": return new OpenApiHttpError(503, "DB_SERIALIZATION", "数据库并发冲突，请稍后重试。")
    default: return null
  }
}

@Injectable()
export class CloudTableDatabase extends PrismaClient implements OnModuleDestroy {
  readonly config = cloudTableConfig()
  constructor() {
    const config = cloudTableConfig(), url = new URL(process.env.DATABASE_URL!)
    url.searchParams.set("connection_limit", String(config.concurrency + config.authConcurrency))
    url.searchParams.set("pool_timeout", "5")
    super({ datasources: { db: { url: url.toString() } } })
  }
  async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(this.config.sqlMs)}, true)`
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(this.config.lockMs)}, true)`
        return work(tx)
      }, { maxWait: this.config.waitMs, timeout: this.config.sqlMs + 1000 })
    } catch (e) {
      const failure = cloudTableDatabaseFailure(e)
      if (failure) throw failure
      throw e
    }
  }
  async onModuleDestroy(): Promise<void> { await this.$disconnect() }
}
