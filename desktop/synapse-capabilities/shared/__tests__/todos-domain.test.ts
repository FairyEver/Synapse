import { describe, expect, it } from "vitest"
import { buildTodoTools } from "../todos-domain"
import { getActionDomainId, MCP_TOOL_ACTIONS } from "../registry"
import { SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS } from "../../../electron/services/agent-runtime/synapse-tool-router"

describe("Todo MCP surface", () => {
  it("indexes six canonical actions while keeping only search/invoke public", () => {
    const tools = buildTodoTools()
    expect(tools).toHaveLength(6)
    for (const tool of tools) {
      const action = MCP_TOOL_ACTIONS[tool.name]
      expect(getActionDomainId(action!)).toBe("todos")
      expect(action?.replaceAll(".", "_")).toBe(tool.name)
    }
    expect(SYNAPSE_TOOL_ROUTER_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(["search", "invoke"])
  })
  it("describes real offset pagination and excludes UI subscriptions", () => {
    expect(buildTodoTools()[0]?.description).toMatch(/Pagination: offset-based.*nextOffset/u)
    expect(buildTodoTools().some((tool) => /changed|reset/u.test(tool.name))).toBe(false)
  })
})
