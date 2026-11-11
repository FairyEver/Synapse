import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"
import { TUNNEL_ACTIONS, TUNNEL_CAPABILITY_IDS } from "../../app-capabilities/tunnel/shared/capability"
const descriptions = [
  "List this account's permanent tunnel links. Offset pagination: default 20, maximum 100; continue with nextOffset until null. Optional clientInstanceId filters device. Other devices are read-only except deletion.",
  "Read an owned tunnel mapping and its current revision/status.",
  "Publish one local HTTP port on this computer at a permanent public HTTPS URL. Anyone holding the URL can access it. Requires user authorization to expose the port. Multiple links can run together. Reuse requestId and identical port after an uncertain response; never silently allocate a replacement.",
  "Change an owned mapping's local port on its original computer, keeping its URL. Read current revision first; on 409 reread instead of overwriting. Existing streams close; visitor requests are never replayed.",
  "Enable or stop one mapping on its original computer. The permanent URL remains reserved. Enabled, locally authorized mappings resume after application restart. Read current revision first; on 409 reread.",
  "Delete an owned mapping and permanently retire its public URL. Can clean up a link belonging to another computer. Requires an unambiguous authorized deletion and current revision. No restore.",
]
export const TUNNEL_DOMAIN: CapabilityDomainDefinition = { id: "tunnel", capabilities: TUNNEL_ACTIONS.map((action, i) => ({ id: TUNNEL_CAPABILITY_IDS[i]!, title: ["查询穿透链接", "读取穿透链接", "申请穿透链接", "修改本机端口", "启停穿透链接", "删除穿透链接"][i]!, description: descriptions[i]!, mutates: !["list", "get"].includes(action) })) }
export const TUNNEL_MCP_TOOL_ACTIONS = Object.fromEntries(TUNNEL_CAPABILITY_IDS.map(id => [id.replaceAll(".", "_"), id]))
const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }
const port = { type: "integer", minimum: 1, maximum: 65535, description: "Local HTTP port; loopback only. No arbitrary hosts, TCP or HTTPS upstream." }
const expectedRevision = { type: "integer", minimum: 1, maximum: 2147483646 }
export function buildTunnelTools(): McpToolDefinition[] {
  return TUNNEL_ACTIONS.map((action, i) => {
    let properties: Record<string, unknown>, required: string[]
    switch (action) {
      case "list": properties = { offset: { type: "integer", minimum: 0, maximum: 2147483647, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 }, clientInstanceId: id }; required = []; break
      case "get": properties = { id }; required = ["id"]; break
      case "create": properties = { port, requestId: { type: "string", format: "uuid", description: "Stable UUID persisted before requesting; reuse for retries of the same allocation." } }; required = ["port", "requestId"]; break
      case "update": properties = { id, port, expectedRevision }; required = ["id", "port", "expectedRevision"]; break
      case "set_enabled": properties = { id, enabled: { type: "boolean" }, expectedRevision }; required = ["id", "enabled", "expectedRevision"]; break
      case "delete": properties = { id, expectedRevision }; required = ["id", "expectedRevision"]; break
    }
    return { name: TUNNEL_CAPABILITY_IDS[i]!.replaceAll(".", "_"), description: descriptions[i]! + " Permissions: network.connect; current signed-in account. No response bodies or transport secrets are returned.", inputSchema: { type: "object", properties, required, additionalProperties: false } }
  })
}
