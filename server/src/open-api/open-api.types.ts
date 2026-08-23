import type { Request } from "express"
import { randomUUID } from "node:crypto"
import type { OpenApiPrincipal } from "../api-keys/api-key.service"

export const OPEN_API_DOWNLOAD_SCOPE = "drive.share_link.download"

export type OpenApiRequest = Request & {
  readonly id?: string | number | (() => string)
  openApiRequestId?: string
  openApiPrincipal?: OpenApiPrincipal
}

export class OpenApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage)
    this.name = "OpenApiHttpError"
  }
}

export function openApiRequestId(request: OpenApiRequest): string {
  if (request.openApiRequestId) return request.openApiRequestId
  const requestId = `req_${randomUUID().replace(/-/gu, "")}`
  request.openApiRequestId = requestId
  return requestId
}

export function requireOpenApiPrincipal(request: OpenApiRequest): OpenApiPrincipal {
  const principal = request.openApiPrincipal
  if (!principal) throw new OpenApiHttpError(401, "INVALID_API_KEY", "API 密钥无效。")
  return principal
}

export function requireOpenApiScope(principal: OpenApiPrincipal, scope: string): void {
  if (!principal.scopes.includes(scope)) {
    throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少所需权限。")
  }
}

export function toOpenApiError(error: unknown): OpenApiHttpError {
  return error instanceof OpenApiHttpError
    ? error
    : new OpenApiHttpError(500, "INTERNAL_ERROR", "服务器内部错误。")
}
