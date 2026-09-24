import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const UPDATE_STATE_GET_CAPABILITY_ID = "app.update.state.get" as CapabilityId
export const UPDATE_CHECK_CAPABILITY_ID = "app.update.check.execute" as CapabilityId
export const UPDATE_RUN_CAPABILITY_ID = "app.update.install.execute" as CapabilityId
export const DESKTOP_RESTART_CAPABILITY_ID = "app.desktop.restart.execute" as CapabilityId

export const DESKTOP_CONTROL_CAPABILITY_IDS = [
  UPDATE_STATE_GET_CAPABILITY_ID,
  UPDATE_CHECK_CAPABILITY_ID,
  UPDATE_RUN_CAPABILITY_ID,
  DESKTOP_RESTART_CAPABILITY_ID,
] as const

export const UPDATE_STATE_GET_MCP_TOOL_NAME = "app_update_state_get"
export const UPDATE_CHECK_MCP_TOOL_NAME = "app_update_check"
export const UPDATE_RUN_MCP_TOOL_NAME = "app_update_run"
export const DESKTOP_RESTART_MCP_TOOL_NAME = "app_desktop_restart"
