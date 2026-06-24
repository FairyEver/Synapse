import { describe, expect, it } from "vitest"
import {
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
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
})
