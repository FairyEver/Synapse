import { Controller, Get, ServiceUnavailableException } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import { PrismaService } from "../prisma/prisma.service"
import { HealthService } from "./health.service"

@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  /** 存活探测：只关心进程与数据库。容器 healthcheck 用它，因此刻意不查外部依赖。 */
  @Get("/healthz")
  async check() {
    const db = await this.prisma.isHealthy()
    if (!db) {
      throw new ServiceUnavailableException("数据库连接异常。")
    }
    return { status: "ok" }
  }

  /** 就绪探测：查全部外部依赖，供监控与诊断。任一不可用即 503，并在 checks 里逐项说明。 */
  @Get("/readyz")
  async ready() {
    const result = await this.health.readiness()
    if (result.status !== "ok") {
      throw new ServiceUnavailableException(result)
    }
    return result
  }
}
