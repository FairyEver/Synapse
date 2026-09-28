import type { CapabilityDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"

export const PORTAL_CREDENTIAL_ACTION = "extend.portal-headless.credential.get" as const
export const PORTAL_CREDENTIAL_TOOL = "extend_portal_headless_credential_get"
export const portalHeadlessCapability: CapabilityDefinition = {
  id: PORTAL_CREDENTIAL_ACTION,
  title: "Portal Headless 扩展凭证",
  description: "获取当前用户指定环境的 Portal Headless 连接凭证与短期 SY 扩展授权，供自己的 AI 直接请求扩展后端。",
  mutates: false,
  risk: "high",
}
export const portalHeadlessTool: McpToolDefinition = {
  name: PORTAL_CREDENTIAL_TOOL,
  description: "Get credentials for a connected Portal Headless environment and its full SDK business catalog. Pass environment=prod for production; omitted environment defaults to test. Returns the user's Portal token, tenant, fixed backend URL and short-lived SY extension authorization. Sensitive output: use only for HTTPS requests to the returned extension URL; never quote credentials in answers or logs. Business requests go directly from your HTTP client to that backend, not through this MCP. Permissions: secret.read, network.connect.",
  inputSchema: { type: "object", properties: { environment: { type: "string", enum: ["test", "prod"], description: "Portal environment. Defaults to test when omitted." } }, additionalProperties: false },
}
