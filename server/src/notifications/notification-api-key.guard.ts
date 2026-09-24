import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common"
import type { Request } from "express"
import { ApiKeyService } from "../api-keys/api-key.service"
import { OpenApiHttpError, type OpenApiRequest } from "../open-api/open-api.types"

/**
 * 通知接口的密钥随请求携带，而不是 `Authorization: Bearer`。
 *
 * 三种发送形状都从 `key` 取值：路径段里的 `key`，或请求体里的 `key` 字段。这样一条 URL
 * 或一次表单提交就足以发消息，不需要调用方组装请求头。
 */
@Injectable()
export class NotificationApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OpenApiRequest>()
    const secret = readRequestSecret(request)
    const principal = secret ? await this.apiKeys.verifyOpenApiSecret(secret) : null
    if (!principal) throw new OpenApiHttpError(401, "INVALID_API_KEY", "API 密钥无效。")
    request.openApiPrincipal = principal
    void this.apiKeys.touchLastUsed(principal.apiKeyId)
    return true
  }
}

function readRequestSecret(request: OpenApiRequest & Request): string | null {
  const fromPath = (request.params as Record<string, unknown> | undefined)?.key
  if (typeof fromPath === "string" && fromPath.length > 0) return fromPath
  const fromBody = (request.body as { readonly key?: unknown } | undefined)?.key
  return typeof fromBody === "string" && fromBody.length > 0 ? fromBody : null
}
