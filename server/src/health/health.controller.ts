import { Controller, Get, ServiceUnavailableException } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import { PrismaService } from "../prisma/prisma.service"

@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("/healthz")
  async check() {
    const db = await this.prisma.isHealthy()
    if (!db) {
      throw new ServiceUnavailableException("数据库连接异常。")
    }
    return { status: "ok" }
  }
}
