import { buildPublicDocumentUrl } from "../common/public-document-url"

export const PUBLIC_LINK_DOWNLOAD_SCOPE = "drive.public_link.download"
export const PUBLIC_LINK_MESSAGE_CREATE_SCOPE = "drive.public_link.message.create"
export const NOTIFICATION_SEND_SCOPE = "notification.send"
export const LEGACY_SHARE_LINK_DOWNLOAD_SCOPE = "drive.share_link.download"

export const API_KEY_CAPABILITIES = [
  ...([
    ["tables.manage", "管理云端数据表"],
    ["tables.records.read", "查询云表记录"],
    ["tables.records.create", "新增云表记录"],
    ["tables.records.update", "修改云表记录"],
    ["tables.records.delete", "删除云表记录"],
  ] as const).map(([scope, name]) => ({ scope, name, description: "仅在明确授权的表资源和当前表权限内执行。", documentationPath: "/open-api/api/cloud-tables" })),
  {
    scope: PUBLIC_LINK_DOWNLOAD_SCOPE,
    name: "获取公共链接文件",
    description: "允许通过开放接口下载 Drive 分享、Drive Site 和公开素材。",
    documentationPath: "/open-api/api/share-link-download",
  },
  {
    scope: PUBLIC_LINK_MESSAGE_CREATE_SCOPE,
    name: "给分享文章留言",
    description: "允许通过开放接口给分享的 Markdown 文章添加文末留言。",
    documentationPath: "/open-api/api/article-message-create",
  },
  {
    scope: NOTIFICATION_SEND_SCOPE,
    name: "发送通知",
    description: "允许通过开放接口向账号设备发送通知。",
    documentationPath: "/open-api/api/notification-send",
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
