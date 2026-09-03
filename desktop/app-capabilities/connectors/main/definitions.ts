import type { BuiltinConnectorDefinition } from "./types"

export const figmaConnector = {
  id: "figma",
  name: "Figma",
  description: "连接 Figma Desktop MCP",
  documentationUrl: "https://synapse.d2.pub/document/connectors/figma",
  skillPackageId: "figma-skill",
  integration: {
    kind: "mcp-streamable-http",
    endpoint: "http://127.0.0.1:3845/mcp",
    requiredTools: ["get_design_context", "get_screenshot"],
  },
} as const satisfies BuiltinConnectorDefinition

export const builtinConnectors = [figmaConnector] as const satisfies readonly BuiltinConnectorDefinition[]

const definitionsById = new Map<string, BuiltinConnectorDefinition>()
for (const definition of builtinConnectors) {
  if (definitionsById.has(definition.id)) {
    throw new Error(`Duplicate builtin connector id: ${definition.id}`)
  }
  definitionsById.set(definition.id, definition)
}

export function getBuiltinConnectorDefinition(id: string): BuiltinConnectorDefinition | undefined {
  return definitionsById.get(id)
}
