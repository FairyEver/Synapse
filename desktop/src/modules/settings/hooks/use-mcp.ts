import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { McpRegistrationInfo, McpServerStatus, McpTarget } from "@/types/mcp"

async function mcpServerGet(): Promise<McpServerStatus> {
  return requireSynapseBridge().mcp.server.get()
}

async function mcpRegistrationsList(): Promise<McpRegistrationInfo[]> {
  return requireSynapseBridge().mcp.registration.list()
}

async function mcpRegistrationOpenSettings(
  target: McpTarget,
): Promise<{ success: boolean; error?: string }> {
  return requireSynapseBridge().mcp.registration.openSettings(target)
}

async function mcpRegistrationRegister(
  target: McpTarget,
): Promise<{ success: boolean; error?: string }> {
  return requireSynapseBridge().mcp.registration.register(target)
}

export {
  mcpRegistrationOpenSettings,
  mcpRegistrationRegister,
  mcpRegistrationsList,
  mcpServerGet,
}
