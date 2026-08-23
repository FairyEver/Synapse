import { InternalServerErrorException } from "@nestjs/common"
import { normalizePublicAppUrl } from "@synapse/shared"

type PublicDocumentUrlInput = {
  readonly configuredDocumentPublicUrl?: string
  readonly configuredPublicAppUrl?: string
}

function resolvePublicDocumentUrl(input: PublicDocumentUrlInput): string {
  const configuredDocumentUrl = normalizePublicAppUrl(input.configuredDocumentPublicUrl ?? "")
  if (configuredDocumentUrl) return configuredDocumentUrl

  const configuredAppUrl = normalizePublicAppUrl(input.configuredPublicAppUrl ?? "")
  if (configuredAppUrl) return `${configuredAppUrl}/document`

  throw new InternalServerErrorException("DOCUMENT_PUBLIC_URL 或 APP_PUBLIC_URL 未配置，无法生成文档链接。")
}

function buildPublicDocumentUrl(documentPublicUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), `${normalizePublicAppUrl(documentPublicUrl)}/`).toString()
}

export { buildPublicDocumentUrl, resolvePublicDocumentUrl }
