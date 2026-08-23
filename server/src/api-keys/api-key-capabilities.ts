export const API_KEY_CAPABILITIES = [
  {
    scope: "drive.share_link.download",
    name: "获取分享链接文件",
    description: "允许通过开放接口下载分享文件、文件夹、站点和公开素材。",
    documentationUrl: "/document/open-api/api/share-link-download",
  },
] as const

export type ApiKeyScope = typeof API_KEY_CAPABILITIES[number]["scope"]

export const API_KEY_SCOPES = API_KEY_CAPABILITIES.map((capability) => capability.scope) as [ApiKeyScope]

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPES.includes(value as ApiKeyScope)
}
