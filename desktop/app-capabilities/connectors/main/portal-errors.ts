export const portalErrors = {
  login_required: "请先登录 Synapse。",
  invalid_callback: "Portal 回调无效，请重新连接。",
  attempt_expired: "连接已过期，请重新连接。",
  credential_invalid: "登录凭据已失效，请重新连接。",
  tenant_unavailable: "当前企业不可用，请重新连接。",
  tenant_mismatch: "当前账号不属于所选企业，请重新连接。",
  identity_mismatch: "Portal 账号已变化，请重新连接。",
  permission_denied: "没有权限完成连接。",
  network_error: "网络连接失败，请重试。",
  verification_timeout: "验证超时，请重试。",
  invalid_response: "Portal 返回的数据无效，请重试。",
  redirect_not_allowed: "Portal 返回了不允许的重定向。",
  storage_error: "无法安全保存或清理连接，请重试。",
  browser_failed: "无法打开浏览器，请重新连接。",
  authorization_failed: "Portal 授权失败，请重新连接。",
  cancelled: "连接已取消。",
} as const
export type PortalErrorCode = keyof typeof portalErrors
export class PortalConnectionError extends Error {
  constructor(readonly code: PortalErrorCode) { super(portalErrors[code]); this.name = "PortalConnectionError" }
}
