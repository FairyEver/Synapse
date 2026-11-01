import { Injectable, OnModuleDestroy } from "@nestjs/common"
import { Prisma, PrismaClient } from "@prisma/client"
import { cloudTableConfig } from "./cloud-table-config"
import { OpenApiHttpError } from "../open-api/open-api.types"

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
      if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2028", "P2034", "P2010"].includes(e.code)) {
        const dbCode = String(e.meta?.code ?? "")
        if (e.code !== "P2010" || ["57014", "55P03", "40P01", "40001"].includes(dbCode)) throw new OpenApiHttpError(503, "SERVER_BUSY", "数据库繁忙，请稍后重试。")
      }
      throw e
    }
  }
  async onModuleDestroy(): Promise<void> { await this.$disconnect() }
}
