import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SCREENSHOT_APP_ID = "screenshot" as const
export const SCREENSHOT_CAPTURE_CAPABILITY_ID =
  "app.screenshot.capture" as CapabilityId
export const SCREENSHOT_FILE_SAVE_CAPABILITY_ID =
  "app.screenshot.file.save" as CapabilityId
export const SCREENSHOT_CAPTURE_MCP_TOOL_NAME = "app_screenshot_capture" as const
export const SCREENSHOT_FILE_SAVE_MCP_TOOL_NAME = "app_screenshot_file_save" as const
export const SCREENSHOT_WORKFLOW_NODE_TYPE = "screenshot_capture" as const
