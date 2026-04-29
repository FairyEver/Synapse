import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DATA_STORE_CAPABILITIES, getCliDataCommands } from "../../data-store/shared/capability-registry"
import { MCP_TOOL_ACTIONS, buildTools } from "../../data-store/shared/mcp-tools"

function extractDispatcherActions(): string[] {
  const source = readFileSync(new URL("../../electron/data-store/dispatcher.ts", import.meta.url), "utf-8")
  const body = source.match(/const ACTION_HANDLERS:[\s\S]*?= \{([\s\S]*?)\n\}/)?.[1]
  if (!body) throw new Error("ACTION_HANDLERS not found")
  return [...body.matchAll(/\n\s{2}([A-Za-z0-9_]+):/g)].map((match) => match[1]).sort()
}

describe("Data Store capability parity", () => {
  it("keeps dispatcher actions registered in the shared capability registry", () => {
    const registryActions = DATA_STORE_CAPABILITIES.map((capability) => capability.action).sort()
    expect(registryActions).toEqual(extractDispatcherActions())
  })

  it("keeps MCP tools mapped to registered actions", () => {
    const toolNames = buildTools().map((tool) => tool.name).sort()
    const mappedToolNames = Object.keys(MCP_TOOL_ACTIONS).sort()
    const mappedActions = Object.values(MCP_TOOL_ACTIONS).sort()
    const registryActions = DATA_STORE_CAPABILITIES.map((capability) => capability.action).sort()

    expect(mappedToolNames).toEqual(toolNames)
    expect(mappedActions).toEqual(registryActions)
  })

  it("keeps CLI data commands registered", () => {
    expect(getCliDataCommands().sort()).toEqual([
      "add-column",
      "choice-usage",
      "count",
      "create",
      "delete",
      "delete-where",
      "describe",
      "drop",
      "drop-column",
      "insert",
      "operation-log",
      "overview",
      "query",
      "read-sql",
      "rename-column",
      "rename-table",
      "sql",
      "tables",
      "update",
      "update-column-choices",
      "update-column-description",
      "update-table-description",
      "update-where",
    ])
  })
})
