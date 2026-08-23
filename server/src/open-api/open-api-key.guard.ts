import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common"
import type { Request } from "express"
import { ApiKeyService } from "../api-keys/api-key.service"
import { OpenApiHttpError, type OpenApiRequest } from "./open-api.types"

@Injectable()
export class OpenApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OpenApiRequest>()
    const secret = readBearerSecret(request)
    const principal = secret ? await this.apiKeys.verifyOpenApiSecret(secret) : null
    if (!principal) throw new OpenApiHttpError(401, "INVALID_API_KEY", "API 密钥无效。")
    request.openApiPrincipal = principal
    void this.apiKeys.touchLastUsed(principal.apiKeyId)
    return true
  }
}

function readBearerSecret(request: Request): string | null {
  const value = request.headers.authorization
  if (!value || Array.isArray(value)) return null
  const match = /^Bearer ([^\s]+)$/u.exec(value)
  return match?.[1] ?? null
}
