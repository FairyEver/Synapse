import { buildPublicDocumentUrl } from "../common/public-document-url"

export const PUBLIC_LINK_DOWNLOAD_SCOPE = "drive.public_link.download"
export const LEGACY_SHARE_LINK_DOWNLOAD_SCOPE = "drive.share_link.download"

export const API_KEY_CAPABILITIES = [
  {
    scope: PUBLIC_LINK_DOWNLOAD_SCOPE,
    name: "获取公共链接文件",
    description: "允许通过开放接口下载 Drive 分享、Drive Site 和公开素材。",
    documentationPath: "/open-api/api/share-link-download",
  },
] as const

export type ApiKeyScope = typeof API_KEY_CAPABILITIES[number]["scope"]

export const API_KEY_SCOPES = API_KEY_CAPABILITIES.map((capability) => capability.scope) as [ApiKeyScope]

export function apiKeyCapabilities(documentPublicUrl: string) {
  return API_KEY_CAPABILITIES.map(({ documentationPath, ...capability }) => ({
    ...capability,
    documentationUrl: buildPublicDocumentUrl(documentPublicUrl, documentationPath),
  }))
}

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPES.includes(value as ApiKeyScope)
}

export function normalizeApiKeyScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => (
    scope === LEGACY_SHARE_LINK_DOWNLOAD_SCOPE ? PUBLIC_LINK_DOWNLOAD_SCOPE : scope
  )))]
}

export function hasPublicLinkDownloadScope(scopes: readonly string[]): boolean {
  return scopes.includes(PUBLIC_LINK_DOWNLOAD_SCOPE)
    || scopes.includes(LEGACY_SHARE_LINK_DOWNLOAD_SCOPE)
}
