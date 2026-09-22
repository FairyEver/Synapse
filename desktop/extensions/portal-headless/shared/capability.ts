import type { CapabilityDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"

export const PORTAL_CREDENTIAL_ACTION = "extend.portal-headless.credential.get" as const
export const PORTAL_CREDENTIAL_TOOL = "extend_portal_headless_credential_get"
export const portalHeadlessCapability: CapabilityDefinition = {
  id: PORTAL_CREDENTIAL_ACTION,
  title: "Portal Headless 扩展凭证",
  description: "获取当前用户 Portal Headless Test 连接的 Portal 凭证与短期 SY 扩展授权，供自己的 AI 直接请求扩展后端。",
  mutates: false,
  risk: "high",
}
export const portalHeadlessTool: McpToolDefinition = {
  name: PORTAL_CREDENTIAL_TOOL,
  description: "Get credentials for the Portal Headless extension (Portal 会议室、双赢协议). Returns the connected user's Portal token, tenant, fixed backend URL and short-lived SY extension authorization. Sensitive output: use only for HTTPS requests to the returned extension URL; never quote credentials in answers or logs. Business requests go directly from your HTTP client to that backend, not through this MCP. Permissions: secret.read, network.connect.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}
