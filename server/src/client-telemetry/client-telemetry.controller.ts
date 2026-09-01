import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request } from "express"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"
import { AuditLogService, auditActors } from "../common/audit-log.service"
import {
  parseClientTelemetryBatch,
  parseClientTelemetryStatsQuery,
} from "./client-telemetry.schemas"
import { ClientTelemetryService } from "./client-telemetry.service"

@Controller("api/client-telemetry")
export class ClientTelemetryController {
  constructor(
    private readonly service: ClientTelemetryService,
    private readonly auth: UserAuthService,
  ) {}

  @Post("events")
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Header("Cache-Control", "no-store")
  async ingest(@Req() request: Request) {
    const events = parseClientTelemetryBatch(request.body)
    const authorization = request.headers.authorization
    const token = readBearerToken(authorization)
    if (authorization && !token) throw new UnauthorizedException("认证信息无效。")
    const userId = token ? (await this.auth.verifyAccessToken(token)).userId : null
    return this.service.ingest(userId, events)
  }
}

@Controller("api/admin/telemetry")
@UseGuards(AdminAuthGuard)
export class ClientTelemetryAdminController {
  constructor(
    private readonly service: ClientTelemetryService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get("stats")
  @Header("Cache-Control", "no-store")
  async stats(
    @Query() query: Record<string, unknown>,
    @Req() request: AdminRequest,
  ) {
    const parsed = parseClientTelemetryStatsQuery(query)
    const result = await this.service.getStats(parsed)
    const sessionId = request.admin?.sessionId ?? "unknown"
    await this.auditLog.record({
      actor: auditActors.platformAdmin(sessionId),
      action: "admin.telemetry.stats",
      targetType: "client_telemetry",
      targetId: "stats",
      detail: {
        from: parsed.from.toISOString(),
        to: parsed.to.toISOString(),
        identity: parsed.identity,
        filteredByUser: Boolean(parsed.userId),
      },
      ipAddress: request.ip ?? "unknown",
    })
    return result
  }
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, token, ...rest] = header.trim().split(/\s+/u)
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) return null
  return token
}
