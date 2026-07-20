import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DATABASE_CAPABILITIES } from "../../database/shared/capability-registry"
import { MCP_TOOL_ACTIONS, buildTools } from "../../database/shared/mcp-tools"
import { capabilityIdToMcpTool } from "../../synapse-capabilities/shared/naming"

function extractDispatcherActions(): string[] {
  const source = readFileSync(new URL("../../electron/database/dispatcher.ts", import.meta.url), "utf-8")
  const body = source.match(/const ACTION_HANDLERS:[\s\S]*?= \{([\s\S]*?)\n\}/)?.[1]
  if (!body) throw new Error("ACTION_HANDLERS not found")
  return [...body.matchAll(/\n\s{2}(?:"([^"]+)"|([A-Za-z0-9_]+)):/g)]
    .map((match) => match[1] ?? match[2])
    .sort()
}

describe("Database capability parity", () => {
  it("keeps dispatcher actions registered in the shared capability registry", () => {
    const registryActions = DATABASE_CAPABILITIES.map((capability) => capability.id).sort()
    const dispatcherActions = extractDispatcherActions()
    expect(registryActions).toEqual(dispatcherActions)
  })

  it("keeps MCP tools mapped to registered actions", () => {
    const toolNames = buildTools().map((tool) => tool.name).sort()
    const mappedToolNames = Object.keys(MCP_TOOL_ACTIONS).sort()
    const mappedActions = [...new Set(Object.values(MCP_TOOL_ACTIONS))].sort()
    const registryActions = DATABASE_CAPABILITIES.map((capability) => capability.id).sort()
    const registryToolNames = DATABASE_CAPABILITIES.map((capability) => capabilityIdToMcpTool(capability.id)).sort()

    expect(mappedToolNames).toEqual(toolNames)
    expect(toolNames).toEqual(expect.arrayContaining(registryToolNames))
    expect(mappedActions).toEqual(registryActions)
  })
})
