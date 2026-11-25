import { ArgumentsHost, CanActivate, Catch, ExceptionFilter, ExecutionContext, HttpException, Injectable, Optional } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { STATE_SYNC_DOC_MAX_BYTES, STATE_SYNC_OPEN_BASE } from "@synapse/shared/state-sync-contracts"
import { PinoLogger } from "nestjs-pino"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import {
  OpenApiHttpError,
  openApiRequestId,
  openApiRetryAfter,
  toOpenApiError,
  type OpenApiRequest,
} from "../open-api/open-api.types"
import { StateSyncHttpError, StateSyncService, type StateSyncActor } from "./state-sync.service"

export { StateSyncHttpError }

export const STATE_SYNC_CONSOLE_BASE = "/api/console/state-sync"
export const STATE_SYNC_MAX_HTTP_BODY_BYTES = STATE_SYNC_DOC_MAX_BYTES

export type StateSyncRequest = Request & { stateSyncActor: StateSyncActor }

export function isStateSyncOpenPath(path: string): boolean {
  const normalized = path.split("?")[0]!.toLowerCase()
  return normalized === STATE_SYNC_OPEN_BASE || normalized.startsWith(`${STATE_SYNC_OPEN_BASE}/`)
}

export function isStateSyncPath(path: string): boolean {
  const normalized = path.split("?")[0]!
  return isStateSyncOpenPath(normalized) || /^\/api\/console\/state-sync(?:\/|$)/iu.test(normalized)
}

export function stateSyncCors(path: string) {
  if (!isStateSyncOpenPath(path)) return null
  return {
    origin: "*",
    credentials: false,
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }
}

export function stateSyncLogRequest(request: Record<string, unknown>): Record<string, unknown> | null {
  const candidate = request.originalUrl ?? request.url
  const raw = request.raw && typeof request.raw === "object" ? request.raw as Record<string, unknown> : undefined
  const path = typeof raw?.path === "string" ? raw.path : typeof request.path === "string" ? request.path : candidate
  if (typeof path !== "string" || !isStateSyncPath(path)) return null
  return {
    method: request.method,
    url: isStateSyncOpenPath(path) ? STATE_SYNC_OPEN_BASE : STATE_SYNC_CONSOLE_BASE,
  }
}

function sendStateSyncJsonError(req: Request, res: Response, status: number, code: string, message: string): void {
  const requestId = openApiRequestId(req as OpenApiRequest)
  if (isStateSyncOpenPath(req.path)) {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
  }
  res.setHeader("X-Request-Id", requestId)
  res.setHeader("Cache-Control", "no-store")
  res.status(status).json({ requestId, error: { code, message } })
}

export function registerStateSyncIngress(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isStateSyncPath(req.path)) {
      next()
      return
    }
    if (isStateSyncOpenPath(req.path)) {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
    }
    const contentLength = Number(req.headers["content-length"] ?? 0)
    if (Number.isFinite(contentLength) && contentLength > STATE_SYNC_MAX_HTTP_BODY_BYTES) {
      sendStateSyncJsonError(req, res, 413, "REQUEST_TOO_LARGE", "状态同步请求体不能超过 256 KiB。")
      return
    }
    next()
  })
}

export function registerStateSyncBodyErrors(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isStateSyncPath(req.path)) {
      next()
      return
    }
    if (req.body !== undefined) {
      const serialized = JSON.stringify(req.body)
      if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > STATE_SYNC_MAX_HTTP_BODY_BYTES) {
        sendStateSyncJsonError(req, res, 413, "REQUEST_TOO_LARGE", "状态同步请求体不能超过 256 KiB。")
        return
      }
    }
    next()
  })

  app.use((error: { status?: number; statusCode?: number; type?: string }, req: Request, res: Response, next: NextFunction) => {
    if (!isStateSyncPath(req.path)) {
      next(error)
      return
    }
    if (error.status === 413 || error.statusCode === 413 || error.type === "entity.too.large") {
      sendStateSyncJsonError(req, res, 413, "REQUEST_TOO_LARGE", "状态同步请求体不能超过 256 KiB。")
      return
    }
    sendStateSyncJsonError(req, res, 400, "INVALID_REQUEST", "请求体必须是有效 JSON。")
  })
}

@Injectable()
@Catch()
export class StateSyncExceptionFilter implements ExceptionFilter {
  constructor(@Optional() private readonly logger?: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<OpenApiRequest>()
    const response = http.getResponse<Response>()
    const requestId = openApiRequestId(request)
    const error = toOpenApiError(exception)

    if (error.statusCode >= 500 && error.code !== "USAGE_LOG_UNAVAILABLE") {
      this.logger?.error({
        requestId,
        errorCode: error.code,
        errorName: exception instanceof Error ? exception.name : typeof exception,
      }, "State Sync API request failed")
    }

    if (response.headersSent) {
      response.destroy(exception instanceof Error ? exception : new Error("State Sync stream failed."))
      return
    }

    response.setHeader("X-Request-Id", requestId)
    if (error instanceof StateSyncHttpError && error.retryAfterSec !== undefined) {
      response.setHeader("Retry-After", String(error.retryAfterSec))
    } else if (error.statusCode === 503) {
      response.setHeader("Retry-After", openApiRetryAfter(error.code))
    }
    response.setHeader("Cache-Control", "no-store")
    response.status(error.statusCode).json({
      requestId,
      error: {
        code: error.code,
        message: error.publicMessage,
        ...(error instanceof StateSyncHttpError && error.currentRev !== undefined
          ? { currentRev: error.currentRev }
          : {}),
      },
    })
  }
}

@Injectable()
export class StateSyncGuard implements CanActivate {
  constructor(
    private readonly stateSync: StateSyncService,
    private readonly userAuth: UserAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StateSyncRequest>()
    const path = req.path ?? req.originalUrl ?? ""

    if (!isStateSyncOpenPath(path)) {
      try {
        const authenticated = await this.userAuth.canActivate(context)
        if (!authenticated) {
          throw new OpenApiHttpError(401, "UNAUTHENTICATED", "未登录或登录已过期。")
        }
      } catch (error) {
        if (error instanceof OpenApiHttpError) throw error
        if (error instanceof HttpException && error.getStatus() === 401) {
          throw new OpenApiHttpError(401, "UNAUTHENTICATED", "未登录或登录已过期。")
        }
        if (error instanceof HttpException && error.getStatus() === 503) {
          throw new OpenApiHttpError(503, "AUTH_SERVICE_BUSY", "认证服务繁忙，请稍后重试。")
        }
        throw error
      }
      const userId = (req as AuthenticatedUserRequest).user?.id
      if (!userId) {
        throw new OpenApiHttpError(401, "UNAUTHENTICATED", "未登录或登录已过期。")
      }
      req.stateSyncActor = { kind: "console", userId }
      return true
    }

    // Open API: strictly ignore cookies and SY login JWTs; accept only Bearer sys_... or syn_sk_...
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : undefined
    const targetSpaceId = req.params?.spaceId ? String(req.params.spaceId) : null
    const actor = await this.stateSync.authenticateOpenCredential(authorization, targetSpaceId)
    if (!actor) {
      throw new OpenApiHttpError(401, "INVALID_CREDENTIAL", "缺少或无效的状态同步凭证。")
    }
    req.stateSyncActor = actor
    return true
  }
}
