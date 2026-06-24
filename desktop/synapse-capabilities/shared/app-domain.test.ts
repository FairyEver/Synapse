import { describe, expect, it } from "vitest"
import {
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
import { APP_MCP_TOOL_ACTIONS, buildAppTools } from "./app-domain"
import { assertCanonicalCapabilityId, capabilityIdToMcpTool } from "./naming"

describe("App capability domain", () => {
  it("allows terminal session write and stop capability ids", () => {
    expect(() => assertCanonicalCapabilityId("app.terminal.session.write")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.stop")).not.toThrow()
  })

  it("maps the terminal session resize capability to the public resize tool name", () => {
    expect(TERMINAL_SESSION_RESIZE_CAPABILITY_ID).toBe("app.terminal.session.resize")
    expect(() => assertCanonicalCapabilityId(TERMINAL_SESSION_RESIZE_CAPABILITY_ID)).not.toThrow()
    expect(capabilityIdToMcpTool(TERMINAL_SESSION_RESIZE_CAPABILITY_ID)).toBe(
      TERMINAL_MCP_TOOL_NAMES.sessionResize,
    )
  })

  it("lists terminal MCP tools with their public names", () => {
    const names = buildAppTools().map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(Object.values(TERMINAL_MCP_TOOL_NAMES)))
  })

  it("maps the public terminal resize tool to the resize capability", () => {
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionResize]).toBe(
      TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
    )
  })
})
