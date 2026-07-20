import type { CapabilityDefinition, McpToolDefinition } from "./types"
import { capabilityIdToMcpTool } from "./naming"

type McpPrimaryNameOptions = {
  readonly sourcePrefix: string
  readonly primaryPrefix: string
}

export function buildPrimaryMcpToolActions(
  capabilities: readonly CapabilityDefinition[],
): Record<string, string> {
  return Object.fromEntries(capabilities.map((capability) => [
    capabilityIdToMcpTool(capability.id),
    capability.id,
  ]))
}

export function withPrimaryMcpTools<T extends McpToolDefinition>(
  tools: readonly T[],
  options: McpPrimaryNameOptions,
): T[] {
  const toolNameReplacements = tools
    .map((tool) => [
      tool.name,
      replaceToolPrefix(tool.name, options.sourcePrefix, options.primaryPrefix),
    ] as const)
    .sort(([left], [right]) => right.length - left.length)
  return tools.map((tool) => ({
    ...tool,
    name: replaceToolPrefix(tool.name, options.sourcePrefix, options.primaryPrefix),
    description: rewriteToolReferences(tool.description, toolNameReplacements),
    inputSchema: rewriteToolReferences(tool.inputSchema, toolNameReplacements),
  }) as T)
}

function replaceToolPrefix(toolName: string, sourcePrefix: string, primaryPrefix: string): string {
  if (!toolName.startsWith(`${sourcePrefix}_`)) {
    throw new Error(`MCP tool ${toolName} does not start with ${sourcePrefix}_`)
  }
  return `${primaryPrefix}_${toolName.slice(sourcePrefix.length + 1)}`
}

function rewriteToolReferences<T>(
  value: T,
  toolNameReplacements: readonly (readonly [string, string])[],
): T {
  if (typeof value === "string") {
    return toolNameReplacements.reduce<string>(
      (rewritten, [sourceName, primaryName]) => rewritten.replaceAll(sourceName, primaryName),
      value,
    ) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteToolReferences(item, toolNameReplacements)) as T
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewriteToolReferences(entry, toolNameReplacements),
      ]),
    ) as T
  }
  return value
}
