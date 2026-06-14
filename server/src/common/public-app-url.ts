import type { IncomingHttpHeaders } from "node:http"
import { InternalServerErrorException } from "@nestjs/common"
import { normalizePublicAppUrl } from "@synapse/shared"

type RequestOriginInput = {
  readonly headers: IncomingHttpHeaders
  readonly protocol?: string
  get(name: string): string | undefined
}

function resolvePublicAppUrl(input: {
  readonly configuredPublicAppUrl?: string
  readonly request: RequestOriginInput
}): string {
  const configured = normalizePublicAppUrl(input.configuredPublicAppUrl ?? "")
  if (configured) return configured

  throw new InternalServerErrorException("APP_PUBLIC_URL 未配置，无法生成公开链接。")
}

export { normalizePublicAppUrl, resolvePublicAppUrl }
