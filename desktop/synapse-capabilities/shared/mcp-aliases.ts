import type { CapabilityDefinition, McpToolDefinition } from "./types"
import {
  capabilityIdToMcpTool,
  legacyToolNameForPrimary,
  primaryToolNameForLegacy,
} from "./naming"

type McpAliasOptions = {
  readonly legacyPrefix: string
  readonly primaryPrefix: string
}

export function buildPrimaryAndLegacyMcpToolActions(
  capabilities: readonly CapabilityDefinition[],
  options: McpAliasOptions,
): Record<string, string> {
  return Object.fromEntries(capabilities.flatMap((capability) => {
    const primaryName = capabilityIdToMcpTool(capability.id)
    const legacyName = legacyToolNameForPrimary(
      primaryName,
      options.legacyPrefix,
      options.primaryPrefix,
    )

    return [
      [primaryName, capability.id],
      [legacyName, capability.id],
    ]
  }))
}

export function withPrimaryAndLegacyMcpTools<T extends McpToolDefinition>(
  tools: readonly T[],
  options: McpAliasOptions,
): T[] {
  const primaryTools = tools.map((tool) => ({
    ...tool,
    name: primaryToolNameForLegacy(tool.name, options.legacyPrefix, options.primaryPrefix),
  }) as T)
  const legacyTools = primaryTools.map((tool) => ({
    ...tool,
    name: legacyToolNameForPrimary(tool.name, options.legacyPrefix, options.primaryPrefix),
    description: `Legacy alias for ${tool.name}. ${tool.description}`,
  }) as T)

  return [...primaryTools, ...legacyTools]
}
