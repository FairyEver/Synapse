import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const TERMINAL_APP_ID = "terminal" as const

export const TERMINAL_GROUP_CREATE_CAPABILITY_ID =
  "app.terminal.group.create" as CapabilityId
export const TERMINAL_GROUP_LIST_CAPABILITY_ID =
  "app.terminal.group.list" as CapabilityId
export const TERMINAL_GROUP_RENAME_CAPABILITY_ID =
  "app.terminal.group.rename" as CapabilityId
export const TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID =
  "app.terminal.group.updateSettings" as CapabilityId
export const TERMINAL_GROUP_DELETE_CAPABILITY_ID =
  "app.terminal.group.delete" as CapabilityId
export const TERMINAL_SESSION_CREATE_CAPABILITY_ID =
  "app.terminal.session.create" as CapabilityId
export const TERMINAL_SESSION_LIST_CAPABILITY_ID =
  "app.terminal.session.list" as CapabilityId
export const TERMINAL_SESSION_GET_CAPABILITY_ID =
  "app.terminal.session.get" as CapabilityId
export const TERMINAL_SESSION_READ_CAPABILITY_ID =
  "app.terminal.session.read" as CapabilityId
export const TERMINAL_SESSION_RENAME_CAPABILITY_ID =
  "app.terminal.session.rename" as CapabilityId
export const TERMINAL_SESSION_WRITE_CAPABILITY_ID =
  "app.terminal.session.write" as CapabilityId
export const TERMINAL_SESSION_RESIZE_CAPABILITY_ID =
  "app.terminal.session.resize" as CapabilityId
export const TERMINAL_SESSION_DELETE_CAPABILITY_ID =
  "app.terminal.session.delete" as CapabilityId
export const TERMINAL_SESSION_STOP_CAPABILITY_ID =
  "app.terminal.session.stop" as CapabilityId

export const TERMINAL_MCP_TOOL_NAMES = {
  groupCreate: "app_terminal_group_create",
  groupList: "app_terminal_group_list",
  groupRename: "app_terminal_group_rename",
  groupUpdateSettings: "app_terminal_group_update_settings",
  groupDelete: "app_terminal_group_delete",
  sessionCreate: "app_terminal_session_create",
  sessionList: "app_terminal_session_list",
  sessionGet: "app_terminal_session_get",
  sessionRead: "app_terminal_session_read",
  sessionRename: "app_terminal_session_rename",
  sessionWrite: "app_terminal_session_write",
  sessionResize: "app_terminal_session_resize",
  sessionDelete: "app_terminal_session_delete",
  sessionStop: "app_terminal_session_stop",
} as const
