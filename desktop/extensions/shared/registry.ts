import { createExtensionRegistry } from "../../electron/runtime/extension"
import type { CapabilityDefinition, McpToolDefinition } from "../../synapse-capabilities/shared/types"
import { portalHeadlessCapability, portalHeadlessTool } from "../portal-headless/shared/capability"

/** 扩展与 App 分开贡献工具；后续扩展注册到同一个 ExtensionPoint。 */
const registry = createExtensionRegistry()
const point = registry.definePoint<{
  id: string
  capabilities: readonly CapabilityDefinition[]
  tools: readonly McpToolDefinition[]
}>("extend.capabilities")
point.register({ id: "portal-headless", capabilities: [portalHeadlessCapability], tools: [portalHeadlessTool] })
export const EXTEND_DOMAIN = { id: "extend", capabilities: point.list().flatMap((entry) => entry.capabilities) }
export const EXTEND_TOOLS = point.list().flatMap((entry) => entry.tools)
export const EXTEND_MCP_TOOL_ACTIONS = Object.fromEntries(point.list().flatMap((entry) =>
  entry.capabilities.map((capability, index) => [entry.tools[index].name, capability.id]),
))
