import type { CapabilityDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"
import { PORTAL_LINK_CREDENTIAL_CAPABILITY_ID, PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID } from "./capability"

export const portalCredentialCapabilities: readonly CapabilityDefinition[] = [
  { id: PORTAL_LINK_CREDENTIAL_CAPABILITY_ID, title: "Portal Link 凭证", description: "读取本机正式环境 Portal 连接凭证与身份信息。", mutates: false, risk: "high" },
  { id: PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID, title: "Portal Link Test 凭证", description: "读取本机测试环境 Portal 连接凭证与身份信息。", mutates: false, risk: "high" },
]
export const portalCredentialToolActions = {
  app_connectors_portal_link_credential_get: PORTAL_LINK_CREDENTIAL_CAPABILITY_ID,
  app_connectors_portal_link_test_credential_get: PORTAL_LINK_TEST_CREDENTIAL_CAPABILITY_ID,
}
export function buildPortalCredentialTools(): McpToolDefinition[] {
  const output = "Returns environment, baseUrl (the Portal API address), language, token, tenantId, portalUserId, and optional displayName and tenantName. Reads this computer only. Sensitive output: never quote or log tokens or save them in documents. Permissions: secret.read."
  return [
    { name: "app_connectors_portal_link_credential_get", description: `Read credentials and verified identity from the connected production Portal Link connector. Use for Portal information when no test environment is requested. Chinese intent: 我的 Portal 信息, Portal Link 凭证, Portal 正式环境身份. ${output}`, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "app_connectors_portal_link_test_credential_get", description: `Read credentials and verified identity from the connected test Portal Link Test connector. Chinese intent: Portal 测试环境凭证, Portal Link Test 凭证, Portal 测试身份. ${output}`, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  ]
}
