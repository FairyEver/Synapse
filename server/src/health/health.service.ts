import { Injectable, Logger } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { PrismaService } from "../prisma/prisma.service"

export type DependencyCheck = {
  readonly name: string
  readonly ok: boolean
  readonly detail?: string
}

export type ReadinessResult = {
  readonly status: "ok" | "degraded"
  readonly checks: readonly DependencyCheck[]
}

/** 单个依赖的探测上限。读接口不该被慢依赖拖住，超时即判不可用。 */
const probeTimeoutMs = 5_000

/**
 * 就绪探测（readiness），与 `/healthz` 的存活探测（liveness）刻意分开：
 *
 * - `/healthz` 只查数据库，供容器 healthcheck 使用。外部依赖挂掉时重启容器
 *   解决不了任何问题，只会变成重启循环，所以它不该看外部依赖。
 * - `/readyz` 查全部外部依赖，供监控与人工诊断使用。它回答的是
 *   「现在有哪些功能是坏的」，而不是「这个进程还活着吗」。
 *
 * 没有这一层时，COS 或 PDF renderer 挂掉不会有任何信号——容器照样 healthy。
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)

  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<ReadinessResult> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkPdfRenderer(),
      this.checkObjectStorage(),
    ])
    return { status: checks.every((check) => check.ok) ? "ok" : "degraded", checks }
  }

  private async checkDatabase(): Promise<DependencyCheck> {
    const ok = await this.prisma.isHealthy()
    return ok ? { name: "database", ok } : { name: "database", ok, detail: "query failed" }
  }

  private async checkPdfRenderer(): Promise<DependencyCheck> {
    const env = loadEnv(process.env)
    if (!env.pdfRendererUrl) return { name: "pdfRenderer", ok: true, detail: "not configured" }
    return this.probe("pdfRenderer", `${env.pdfRendererUrl.replace(/\/+$/u, "")}/healthz`)
  }

  private async checkObjectStorage(): Promise<DependencyCheck> {
    const env = loadEnv(process.env)
    if (!env.driveCosBucket || !env.driveCosRegion) {
      return { name: "objectStorage", ok: true, detail: "local storage" }
    }
    // 这里只判断「对象存储服务是否可达」。未签名的请求会被拒（403/404），
    // 但拿到任何一个 HTTP 响应就说明网络与服务本身是活的——那正是要探的东西。
    // 真正意义上的写入权限由业务路径各自验证，不在健康探测里做。
    return this.probe("objectStorage", `https://${env.driveCosBucket}.cos.${env.driveCosRegion}.myqcloud.com/`)
  }

  private async probe(name: string, url: string): Promise<DependencyCheck> {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(probeTimeoutMs),
        redirect: "manual",
      })
      return { name, ok: true, detail: `HTTP ${response.status}` }
    } catch (error) {
      // 底层错误（含 URL、主机名、堆栈）只进结构化日志，不进 HTTP 响应。
      this.logger.warn({ event: "health.probe_failed", dependency: name }, "依赖探测失败")
      const timedOut = error instanceof Error && error.name === "TimeoutError"
      return { name, ok: false, detail: timedOut ? "timeout" : "unreachable" }
    }
  }
}
