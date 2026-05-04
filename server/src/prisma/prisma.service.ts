import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"
import { loadEnv } from "../config/env"

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const env = loadEnv(process.env)
    const url = new URL(env.databaseUrl)
    url.searchParams.set("connection_limit", String(env.databasePoolSize))
    super({ datasources: { db: { url: url.toString() } } })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000))
    await Promise.race([this.$disconnect(), timeout])
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`
      return true
    } catch {
      return false
    }
  }
}
