import { CanActivate, ExecutionContext, HttpException, Injectable } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { ApiKeyService } from "../api-keys/api-key.service"
import { CloudTableService, type CloudActor } from "./cloud-table.service"
import { OpenApiHttpError, openApiRequestId, type OpenApiRequest } from "../open-api/open-api.types"
import { CLOUD_TABLE_BASE } from "./cloud-table-contract"
import { assertJsonBudget } from "./cloud-table-validation"

export type CloudRequest = Request & { cloudActor: CloudActor }
export function isCloudTableOpenPath(path: string): boolean { const p = path.split("?")[0]!.toLowerCase(); return p === CLOUD_TABLE_BASE || p.startsWith(`${CLOUD_TABLE_BASE}/`) }
export function isCloudTablePath(path: string): boolean { return isCloudTableOpenPath(path) || /^\/api\/console\/tables(?:\/|$)/iu.test(path.split("?")[0]!) }
export function cloudTableCors(path: string) { return isCloudTableOpenPath(path) ? { origin: "*", credentials: false, allowedHeaders: ["Content-Type", "Idempotency-Key"], exposedHeaders: ["X-Request-Id", "Retry-After"], methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] } : null }
function cloudError(req: Request, res: Response, status: number, code: string, message: string): void {
  const requestId = openApiRequestId(req as OpenApiRequest)
  res.setHeader("X-Request-Id", requestId); res.setHeader("Cache-Control", "no-store")
  if (status === 503) res.setHeader("Retry-After", "1")
  res.status(status).json({ requestId, error: { code, message } })
}

@Injectable()
export class CloudTableGuard implements CanActivate {
  constructor(private readonly service: CloudTableService, private readonly keys: ApiKeyService, private readonly users: UserAuthGuard) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CloudRequest>()
    const owner = req.params.id ? this.service.routingOwner(String(req.params.id)) : "root-authentication"
    return this.service.authentication.run(owner, 0, async () => {
      if (!isCloudTableOpenPath(req.path)) {
        try {
          const authenticated = await this.service.db.transaction(async tx => {
            try { return await this.users.canActivate(context, tx, "/api/console/tables") }
            catch (error) { if (error instanceof HttpException && error.getStatus() === 401) return false; throw error }
          })
          if (!authenticated) throw new OpenApiHttpError(401, "UNAUTHENTICATED", "未登录或登录已过期。")
        }
        catch (error) {
          if (error instanceof HttpException && error.getStatus() === 401) throw new OpenApiHttpError(401, "UNAUTHENTICATED", "未登录或登录已过期。")
          if (error instanceof HttpException && error.getStatus() === 503) throw new OpenApiHttpError(503, "SERVER_BUSY", "认证服务繁忙，请稍后重试。")
          throw error
        }
        req.cloudActor = { userId: (req as AuthenticatedUserRequest).user!.id, console: true }
        return true
      }
      const authorization = req.headers.authorization
      if (authorization === undefined) { req.cloudActor = { console: false }; return true }
      const secret = /^Bearer ([^\s]+)$/u.exec(authorization)?.[1]
      const principal = secret ? await this.service.db.transaction(tx => this.keys.verifyOpenApiSecret(secret, tx)) : null
      if (!principal) throw new OpenApiHttpError(401, "INVALID_API_KEY", "API 密钥无效。")
      req.cloudActor = { userId: principal.userId, apiKeyId: principal.apiKeyId, console: false }
      return true
    })
  }
}

/** 在JSON解析前限制并发和保留内存；仅云表路由，finish/close均释放。 */
export function registerCloudTableIngress(app: NestExpressApplication): void {
  const config = app.get(CloudTableService).db.config
  let active = 0, bytes = 0
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isCloudTablePath(req.path)) { next(); return }
    if (isCloudTableOpenPath(req.path)) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After") }
    const bodyExpected = req.headers["transfer-encoding"] !== undefined || !["GET", "HEAD", "OPTIONS"].includes(req.method)
    const wireLength = Number(req.headers["content-length"] ?? (bodyExpected ? 1048576 : 0))
    if (!Number.isSafeInteger(wireLength) || wireLength < 0 || wireLength > 1048576) { cloudError(req, res, 413, "REQUEST_TOO_LARGE", "请求不能超过1 MiB。"); return }
    const encoding = req.headers["content-encoding"]
    const length = encoding && String(encoding).toLowerCase() !== "identity" ? 1048576 : wireLength
    if (active >= config.globalQueue || bytes + length > config.bytes) { cloudError(req, res, 503, "SERVER_BUSY", "服务繁忙，请稍后重试。"); return }
    active++; bytes += length
    let released = false
    const release = () => { if (!released) { released = true; active--; bytes -= length } }
    res.once("finish", release); res.once("close", release); next()
  })
}
export function registerCloudTableBodyErrors(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isCloudTablePath(req.path)) { next(); return }
    try { assertJsonBudget(req.body); next() } catch (error) {
      if (error instanceof OpenApiHttpError) cloudError(req, res, error.statusCode, error.code, error.publicMessage)
      else next(error)
    }
  })
  app.use((error: { status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (!isCloudTablePath(req.path)) { next(error); return }
    cloudError(req, res, error.status === 413 ? 413 : 400, error.status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST", error.status === 413 ? "请求不能超过1 MiB。" : "请求体必须是有效JSON。")
  })
}
