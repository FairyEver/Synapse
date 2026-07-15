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
  const toolNameReplacements = tools
    .map((tool) => [
      tool.name,
      primaryToolNameForLegacy(tool.name, options.legacyPrefix, options.primaryPrefix),
    ] as const)
    .sort(([left], [right]) => right.length - left.length)
  const primaryTools = tools.map((tool) => ({
    ...tool,
    name: primaryToolNameForLegacy(tool.name, options.legacyPrefix, options.primaryPrefix),
    description: rewriteLegacyToolReferences(tool.description, toolNameReplacements),
    inputSchema: rewriteLegacyToolReferences(tool.inputSchema, toolNameReplacements),
  }) as T)
  const legacyTools = primaryTools.map((tool) => ({
    ...tool,
    name: legacyToolNameForPrimary(tool.name, options.legacyPrefix, options.primaryPrefix),
    description: `Legacy alias for ${tool.name}. ${tool.description}`,
  }) as T)

  return [...primaryTools, ...legacyTools]
}

function rewriteLegacyToolReferences<T>(
  value: T,
  toolNameReplacements: readonly (readonly [string, string])[],
): T {
  if (typeof value === "string") {
    return toolNameReplacements.reduce<string>(
      (rewritten, [legacyName, primaryName]) => rewritten.replaceAll(legacyName, primaryName),
      value,
    ) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteLegacyToolReferences(item, toolNameReplacements)) as T
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewriteLegacyToolReferences(entry, toolNameReplacements),
      ]),
    ) as T
  }
  return value
}
