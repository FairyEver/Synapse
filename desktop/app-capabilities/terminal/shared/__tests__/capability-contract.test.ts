import { describe, expect, it } from "vitest"

import {
  TERMINAL_CAPABILITY_CATALOG,
  TERMINAL_MCP_TOOL_ACTIONS,
} from "../capability"
import { buildTerminalMcpTools } from "../mcp-tools"
import { terminalCreateSessionOverrideInputSchema } from "../contract-schema"

describe("Terminal capability contract", () => {
  it("publishes the consolidated capability baseline from one catalog", () => {
    expect(TERMINAL_CAPABILITY_CATALOG).toHaveLength(43)

    const ids = new Set<string>()
    const toolNames = new Set<string>()
    for (const item of TERMINAL_CAPABILITY_CATALOG) {
      expect(item.id.split(".")).toHaveLength(4)
      expect(item.id.startsWith("app.terminal.")).toBe(true)
      expect(item.toolName).toBe(item.id.replaceAll(".", "_"))
      expect(TERMINAL_MCP_TOOL_ACTIONS[item.toolName]).toBe(item.id)
      ids.add(item.id)
      toolNames.add(item.toolName)
    }
    expect(ids.size).toBe(TERMINAL_CAPABILITY_CATALOG.length)
    expect(toolNames.size).toBe(TERMINAL_CAPABILITY_CATALOG.length)
  })

  it("generates one strict MCP input schema for every capability", () => {
    const tools = buildTerminalMcpTools()
    expect(tools).toHaveLength(TERMINAL_CAPABILITY_CATALOG.length)
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object")
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.inputSchema.properties.contractVersion).toBeUndefined()
      expect(tool.description).not.toContain("DEPRECATED")
    }
  })

  it("requires foreground evidence after accepted command input", () => {
    const commandTool = buildTerminalMcpTools()
      .find((tool) => tool.name === "app_terminal_session_input_command")

    expect(commandTool?.description).toContain("accepted result only proves PTY byte delivery")
    expect(commandTool?.description).toContain("observe fresh output or a rendered view")
  })

  it("allows one-time session overrides to unset inherited environment variables", () => {
    expect(terminalCreateSessionOverrideInputSchema.parse({
      overrides: { environment: { INHERITED_SECRET: null } },
      idempotencyKey: "019f8a39-0000-7000-8000-000000000101",
    }).overrides.environment).toEqual({ INHERITED_SECRET: null })
  })
})
