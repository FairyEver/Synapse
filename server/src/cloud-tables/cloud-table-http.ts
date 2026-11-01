import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { ApiKeyService } from "../api-keys/api-key.service"
import { CloudTableService, type CloudActor } from "./cloud-table.service"
import { OpenApiHttpError, openApiRequestId, type OpenApiRequest } from "../open-api/open-api.types"
import { CLOUD_TABLE_BASE } from "./cloud-table-contract"
import { assertJsonBudget } from "./cloud-table-validation"

export type CloudRequest = Request & { cloudActor: CloudActor }
export function isCloudTableOpenPath(path: string): boolean { const p = path.split("?")[0]!; return p === CLOUD_TABLE_BASE || p.startsWith(`${CLOUD_TABLE_BASE}/`) }
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
        await this.users.canActivate(context)
        req.cloudActor = { userId: (req as AuthenticatedUserRequest).user!.id, console: true }
        return true
      }
      const authorization = req.headers.authorization
      if (authorization === undefined) { req.cloudActor = { console: false }; return true }
      const secret = /^Bearer ([^\s]+)$/u.exec(authorization)?.[1]
      const principal = secret ? await this.keys.verifyOpenApiSecret(secret) : null
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
    if (!isCloudTableOpenPath(req.path) && !/^\/api\/console\/tables(?:\/|$)/u.test(req.path)) { next(); return }
    if (isCloudTableOpenPath(req.path)) { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Retry-After") }
    const length = Number(req.headers["content-length"] ?? (["GET", "HEAD", "OPTIONS"].includes(req.method) ? 0 : 1048576))
    if (!Number.isSafeInteger(length) || length < 0 || length > 1048576) { cloudError(req, res, 413, "REQUEST_TOO_LARGE", "请求不能超过1 MiB。"); return }
    if (active >= config.globalQueue || bytes + length > config.bytes) { cloudError(req, res, 503, "SERVER_BUSY", "服务繁忙，请稍后重试。"); return }
    active++; bytes += length
    let released = false
    const release = () => { if (!released) { released = true; active--; bytes -= length } }
    res.once("finish", release); res.once("close", release); next()
  })
}
export function registerCloudTableBodyErrors(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isCloudTableOpenPath(req.path) && !/^\/api\/console\/tables(?:\/|$)/u.test(req.path)) { next(); return }
    try { assertJsonBudget(req.body); next() } catch { cloudError(req, res, 400, "JSON_TOO_COMPLEX", "JSON超过32层或50000节点，请拆分请求。") }
  })
  app.use((error: { status?: number }, req: Request, res: Response, next: NextFunction) => {
    if (!isCloudTableOpenPath(req.path) && !/^\/api\/console\/tables(?:\/|$)/u.test(req.path)) { next(error); return }
    cloudError(req, res, error.status === 413 ? 413 : 400, error.status === 413 ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST", error.status === 413 ? "请求不能超过1 MiB。" : "请求体必须是有效JSON。")
  })
}
