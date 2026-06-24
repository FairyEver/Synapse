import { describe, expect, it } from "vitest"
import {
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_CAPTURE_MCP_TOOL_NAME,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME,
} from "../../app-capabilities/screenshot/shared/capability"
import { APP_DOMAIN, APP_MCP_TOOL_ACTIONS, buildAppTools } from "./app-domain"

describe("app-domain screenshot tools", () => {
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
