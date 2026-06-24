import { describe, expect, it } from "vitest"
import {
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  TERMINAL_SESSION_RENAME_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
import {
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
} from "../../app-capabilities/screenshot/shared/capability"
import { APP_DOMAIN, APP_MCP_TOOL_ACTIONS, buildAppTools } from "./app-domain"
import { assertCanonicalCapabilityId, capabilityIdToMcpTool } from "./naming"

describe("App capability domain", () => {
  it("allows terminal session write and stop capability ids", () => {
    expect(() => assertCanonicalCapabilityId("app.terminal.session.write")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.stop")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.rename")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.delete")).not.toThrow()
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

  it("maps public terminal rename and delete tools to their capabilities", () => {
    expect(TERMINAL_SESSION_RENAME_CAPABILITY_ID).toBe("app.terminal.session.rename")
    expect(TERMINAL_SESSION_DELETE_CAPABILITY_ID).toBe("app.terminal.session.delete")
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionRename]).toBe(
      TERMINAL_SESSION_RENAME_CAPABILITY_ID,
    )
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionDelete]).toBe(
      TERMINAL_SESSION_DELETE_CAPABILITY_ID,
    )
  })

  it("marks terminal list tool input schemas as strict empty objects", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupList)?.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false,
    })
    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionList)?.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false,
    })
  })

  it("does not expose session-level agent control in terminal MCP create schema", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))
    const createSchema = tools.get(TERMINAL_MCP_TOOL_NAMES.sessionCreate)?.inputSchema

    expect(createSchema).toMatchObject({
      type: "object",
      properties: expect.not.objectContaining({
        agentControl: expect.anything(),
      }),
    })
  })

  it("defines terminal rename and delete MCP schemas", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionRename)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        sessionId: expect.objectContaining({ type: "string", minLength: 1 }),
        title: expect.objectContaining({ type: "string", minLength: 1, maxLength: 120 }),
      },
      required: ["sessionId", "title"],
    })
    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionDelete)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        sessionId: expect.objectContaining({ type: "string", minLength: 1 }),
      },
      required: ["sessionId"],
    })
  })

  it("registers screenshot capture and file save MCP tools", () => {
    expect(APP_DOMAIN.capabilities.map((capability) => capability.id)).toEqual(expect.arrayContaining([
      SCREENSHOT_CAPTURE_CAPABILITY_ID,
      SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
    ]))
    expect(APP_MCP_TOOL_ACTIONS[SCREENSHOT_CAPTURE_MCP_TOOL_NAME]).toBe(SCREENSHOT_CAPTURE_CAPABILITY_ID)
    expect(APP_MCP_TOOL_ACTIONS[SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME]).toBe(SCREENSHOT_FILE_SAVE_CAPABILITY_ID)
    expect(buildAppTools().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
      SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
    ]))
  })
})
