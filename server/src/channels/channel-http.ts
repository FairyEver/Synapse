import { CanActivate, ExecutionContext, HttpException, Injectable } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { CHANNEL_OPEN_BASE } from "@synapse/shared/channel-contracts"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { OpenApiHttpError, openApiRequestId, type OpenApiRequest } from "../open-api/open-api.types"
import { ChannelService, type ChannelActor } from "./channel.service"

export type ChannelRequest = Request & { channelActor: ChannelActor }

export function isChannelOpenPath(path: string): boolean {
  const normalized = path.split("?")[0]!.toLowerCase()
  return normalized === CHANNEL_OPEN_BASE || normalized.startsWith(`${CHANNEL_OPEN_BASE}/`)
}

export function isChannelPath(path: string): boolean {
  const normalized = path.split("?")[0]!
  return isChannelOpenPath(normalized) || /^\/api\/console\/channels(?:\/|$)/iu.test(normalized)
}

export function channelCors(path: string) {
  if (!isChannelOpenPath(path)) return null
  return {
    origin: "*",
    credentials: false,
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }
}

export function channelLogRequest(request: Record<string, unknown>): Record<string, unknown> | null {
  const candidate = request.originalUrl ?? request.url
  const raw = request.raw && typeof request.raw === "object" ? request.raw as Record<string, unknown> : undefined
  const path = typeof raw?.path === "string" ? raw.path : typeof request.path === "string" ? request.path : candidate
  if (typeof path !== "string" || !isChannelPath(path)) return null
  return { method: request.method, url: isChannelOpenPath(path) ? CHANNEL_OPEN_BASE : "/api/console/channels" }
}

function sendChannelJsonError(req: Request, res: Response, status: number, code: string, message: string): void {
  const requestId = openApiRequestId(req as OpenApiRequest)
  res.setHeader("X-Request-Id", requestId)
  res.setHeader("Cache-Control", "no-store")
  res.status(status).json({ requestId, error: { code, message } })
}

export function registerChannelIngress(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isChannelPath(req.path)) {
      next()
      return
    }
    if (isChannelOpenPath(req.path)) {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After")
    }
    const contentLength = Number(req.headers["content-length"] ?? 0)
    if (Number.isFinite(contentLength) && contentLength > 131072) {
      sendChannelJsonError(req, res, 413, "REQUEST_TOO_LARGE", "频道请求体不能超过 128 KiB。")
      return
    }
    next()
  })
}

export function registerChannelBodyErrors(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isChannelPath(req.path)) {
      next()
      return
    }
    if (req.body !== undefined) {
      const serialized = JSON.stringify(req.body)
      if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > 131072) {
        sendChannelJsonError(req, res, 413, "REQUEST_TOO_LARGE", "频道请求体不能超过 128 KiB。")
        return
      }
    }
    next()
  })

  app.use((error: { status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (!isChannelPath(req.path)) {
      next(error)
      return
    }
    if (error.status === 413) {
      sendChannelJsonError(req, res, 413, "REQUEST_TOO_LARGE", "频道请求体不能超过 128 KiB。")
      return
    }
    sendChannelJsonError(req, res, 400, "INVALID_REQUEST", "请求体必须是有效 JSON。")
  })
}

@Injectable()
export class ChannelGuard implements CanActivate {
  constructor(
    private readonly channels: ChannelService,
    private readonly userAuth: UserAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ChannelRequest>()
    const path = req.path ?? req.originalUrl ?? ""

    if (!isChannelOpenPath(path)) {
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
        throw error
      }
      const userId = (req as AuthenticatedUserRequest).user?.id
      if (!userId) throw new OpenApiHttpError(401, "UNAUTHENTICATED", "未登录或登录已过期。")
      req.channelActor = { kind: "console", userId }
      return true
    }

    // Open API: strictly ignore cookies and SY login sessions; require Bearer credential.
    const authorization = req.headers.authorization
    const secret = typeof authorization === "string" ? /^Bearer ([^\s]+)$/u.exec(authorization)?.[1] : undefined
    if (!secret) {
      throw new OpenApiHttpError(401, "INVALID_CREDENTIAL", "缺少或无效的频道凭证。")
    }
    const targetChannelId = req.params?.channelId ? String(req.params.channelId) : null
    const actor = await this.channels.authenticateOpenBearer(secret, targetChannelId)
    if (!actor) {
      throw new OpenApiHttpError(401, "INVALID_CREDENTIAL", "频道凭证或 API 密钥无效。")
    }
    req.channelActor = actor
    return true
  }
}
