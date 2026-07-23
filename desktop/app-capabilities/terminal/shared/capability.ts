import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const TERMINAL_APP_ID = "terminal" as const

export const TERMINAL_PERMISSION_FAMILIES = [
  "discover",
  "state.read",
  "metadata.read",
  "output.read",
  "command.read",
  "command.launch",
  "session.create",
  "session.override.create",
  "session.control",
  "session.rawInput",
  "session.resize",
  "session.stop",
  "session.forceStop",
  "metadata.manage",
  "group.manage",
  "command.manage",
  "session.delete",
  "group.delete",
] as const

export type TerminalPermissionFamily = typeof TERMINAL_PERMISSION_FAMILIES[number]
export type TerminalCapabilityRisk = "normal" | "high"
export type TerminalCapabilitySupport = "supported" | "degraded" | "unsupported"

export type TerminalCapabilityMetadata = {
  readonly id: CapabilityId
  readonly toolName: string
  readonly title: string
  readonly description: string
  readonly mutates: boolean
  readonly risk: TerminalCapabilityRisk
  readonly permissions: readonly TerminalPermissionFamily[]
  readonly support: TerminalCapabilitySupport
}

type TerminalCapabilitySeed = Omit<
  TerminalCapabilityMetadata,
  "id" | "toolName" | "support"
> & {
  readonly id: `app.terminal.${string}.${string}`
  readonly support?: TerminalCapabilitySupport
}

function defineTerminalCapability(seed: TerminalCapabilitySeed): TerminalCapabilityMetadata {
  const segments = seed.id.split(".")
  if (segments.length !== 4 || segments[0] !== "app" || segments[1] !== "terminal") {
    throw new Error(`Invalid Terminal capability id: ${seed.id}`)
  }
  return Object.freeze({
    ...seed,
    id: seed.id as CapabilityId,
    toolName: seed.id.replaceAll(".", "_"),
    support: seed.support ?? "supported",
  })
}

const C = defineTerminalCapability

export const TERMINAL_CAPABILITY_CATALOG = [
  C({ id: "app.terminal.capabilities.get", title: "Get terminal capabilities", description: "Read the Terminal contract, limits, platform support, and degradation without object data.", mutates: false, risk: "normal", permissions: [] }),
  C({ id: "app.terminal.diagnostics.get", title: "Get terminal diagnostics", description: "Read bounded diagnostics for Terminal objects already visible to the caller.", mutates: false, risk: "normal", permissions: ["discover", "state.read"] }),
  C({ id: "app.terminal.group.list", title: "List terminal groups", description: "List bounded Terminal group summaries.", mutates: false, risk: "normal", permissions: ["discover"] }),
  C({ id: "app.terminal.group.get", title: "Get terminal group", description: "Read one Terminal group summary by immutable id.", mutates: false, risk: "normal", permissions: ["discover"] }),
  C({ id: "app.terminal.group.create", title: "Create terminal group", description: "Create a Terminal group.", mutates: true, risk: "normal", permissions: ["group.manage"] }),
  C({ id: "app.terminal.group.rename", title: "Rename terminal group", description: "Rename a Terminal group with revision conflict protection.", mutates: true, risk: "normal", permissions: ["group.manage"] }),
  C({ id: "app.terminal.group.delete", title: "Delete empty terminal group", description: "Delete an empty Terminal group; non-empty groups require preview and commit.", mutates: true, risk: "high", permissions: ["group.delete"] }),
  C({ id: "app.terminal.group_launch.get", title: "Get terminal launch settings", description: "Read sensitive launch settings and their launch revision.", mutates: false, risk: "high", permissions: ["metadata.read"] }),
  C({ id: "app.terminal.group_launch.update", title: "Update terminal launch settings", description: "Update launch-semantic settings using the launch revision.", mutates: true, risk: "high", permissions: ["group.manage"] }),
  C({ id: "app.terminal.group_delete.preview", title: "Preview terminal group deletion", description: "Create a bounded, expiring deletion plan for a non-empty group.", mutates: false, risk: "high", permissions: ["group.delete"] }),
  C({ id: "app.terminal.group_delete.commit", title: "Commit terminal group deletion", description: "Commit an unchanged deletion plan for terminal sessions, commands, output, and group metadata.", mutates: true, risk: "high", permissions: ["group.delete"] }),
  C({ id: "app.terminal.group_command.list", title: "List terminal group commands", description: "List bounded saved-command summaries without command bodies.", mutates: false, risk: "normal", permissions: ["discover"] }),
  C({ id: "app.terminal.group_command.get", title: "Get terminal group command", description: "Read one saved terminal input sequence body.", mutates: false, risk: "high", permissions: ["command.read"] }),
  C({ id: "app.terminal.group_command.create", title: "Create terminal group command", description: "Create an encrypted saved terminal input sequence.", mutates: true, risk: "high", permissions: ["command.manage"] }),
  C({ id: "app.terminal.group_command.update", title: "Update terminal group command", description: "Update a saved terminal input sequence with revision conflict protection.", mutates: true, risk: "high", permissions: ["command.manage"] }),
  C({ id: "app.terminal.group_command.delete", title: "Delete terminal group command", description: "Delete a saved terminal input sequence with revision conflict protection.", mutates: true, risk: "high", permissions: ["command.manage"] }),
  C({ id: "app.terminal.group_command.launch", title: "Launch terminal group command", description: "Create a session and submit an authorized saved input sequence without revealing its body.", mutates: true, risk: "high", permissions: ["command.launch"] }),
  C({ id: "app.terminal.session.list", title: "List terminal sessions", description: "List bounded non-state Terminal session summaries.", mutates: false, risk: "normal", permissions: ["discover"] }),
  C({ id: "app.terminal.session_summary.get", title: "Get terminal session summary", description: "Read one non-state Terminal session summary.", mutates: false, risk: "normal", permissions: ["discover"] }),
  C({ id: "app.terminal.session_state.list", title: "List terminal session states", description: "List bounded lifecycle, attention, lease occupancy, and watermarks without output text.", mutates: false, risk: "normal", permissions: ["discover", "state.read"] }),
  C({ id: "app.terminal.session_state.get", title: "Get terminal session state", description: "Read lifecycle, attention, visible lease state, and watermarks without output text.", mutates: false, risk: "normal", permissions: ["state.read"] }),
  C({ id: "app.terminal.session_metadata.get", title: "Get terminal session metadata", description: "Read cwd, shell, and redacted launch facts.", mutates: false, risk: "high", permissions: ["metadata.read"] }),
  C({ id: "app.terminal.session.create", title: "Create terminal session", description: "Create a session from the same resolved default or group launch snapshot used by the UI.", mutates: true, risk: "high", permissions: ["session.create"] }),
  C({ id: "app.terminal.session_override.create", title: "Create terminal session with overrides", description: "Create a session with explicit audited launch overrides.", mutates: true, risk: "high", permissions: ["session.override.create"] }),
  C({ id: "app.terminal.session_metadata.rename", title: "Rename terminal session", description: "Rename a Terminal session with metadata revision protection.", mutates: true, risk: "normal", permissions: ["metadata.manage"] }),
  C({ id: "app.terminal.session.observe", title: "Observe terminal session state", description: "Wait for bounded state or output-watermark changes without returning output bytes.", mutates: false, risk: "normal", permissions: ["state.read"] }),
  C({ id: "app.terminal.session_output.read", title: "Read terminal output", description: "Read a bounded retained raw PTY output interval with explicit gaps.", mutates: false, risk: "high", permissions: ["output.read"] }),
  C({ id: "app.terminal.session_output.observe", title: "Observe terminal state and output", description: "Wait for a state change and return a bounded raw output increment in a fixed response shape.", mutates: false, risk: "high", permissions: ["state.read", "output.read"] }),
  C({ id: "app.terminal.session_view.get", title: "Get terminal rendered view", description: "Read a bounded rendered screen or scrollback view derived by the core emulator.", mutates: false, risk: "high", permissions: ["output.read"] }),
  C({ id: "app.terminal.session_control.acquire", title: "Acquire terminal control", description: "Immediately acquire the single automation-writer lease for a running session.", mutates: true, risk: "high", permissions: ["session.control"] }),
  C({ id: "app.terminal.session_control.renew", title: "Renew terminal control", description: "Renew a still-valid lease held by the transport-assigned controller instance.", mutates: true, risk: "high", permissions: ["session.control"] }),
  C({ id: "app.terminal.session_control.release", title: "Release terminal control", description: "Idempotently release a lease held by the transport-assigned controller instance.", mutates: true, risk: "high", permissions: ["session.control"] }),
  C({ id: "app.terminal.session_input.send", title: "Send semantic terminal input", description: "Send bounded ordered text and key actions under an input revision and lease.", mutates: true, risk: "high", permissions: ["session.control"] }),
  C({ id: "app.terminal.session_input.command", title: "Send terminal command", description: "Send one control-free text value followed by Enter under the semantic input contract. An accepted result only proves PTY byte delivery; observe fresh output or a rendered view before claiming the foreground program submitted it.", mutates: true, risk: "high", permissions: ["session.control"] }),
  C({ id: "app.terminal.session_input.paste", title: "Paste terminal text", description: "Submit bounded UTF-8 text only when fresh core evidence confirms bracketed-paste mode.", mutates: true, risk: "high", permissions: ["session.control"] }),
  C({ id: "app.terminal.session_input.raw", title: "Send raw terminal input", description: "Send one bounded Base64 payload using only platform-proven node-pty byte semantics.", mutates: true, risk: "high", permissions: ["session.control", "session.rawInput"] }),
  C({ id: "app.terminal.session.resize", title: "Resize terminal session", description: "Resize a running PTY under the control lease and size revision.", mutates: true, risk: "high", permissions: ["session.resize", "session.control"] }),
  C({ id: "app.terminal.session.stop", title: "Normally stop terminal session", description: "Request platform-supported normal termination without automatic force escalation.", mutates: true, risk: "high", permissions: ["session.stop"] }),
  C({ id: "app.terminal.session.force_stop", title: "Force stop terminal session", description: "Explicitly request a distinct platform-supported forced termination path.", mutates: true, risk: "high", permissions: ["session.forceStop"] }),
  C({ id: "app.terminal.operation.get", title: "Get terminal operation", description: "Read a termination or deletion operation through authorization to its original resource.", mutates: false, risk: "normal", permissions: ["state.read"] }),
  C({ id: "app.terminal.session.delete", title: "Delete terminal session", description: "Delete a terminal-state session and retained data; running and stopping sessions conflict.", mutates: true, risk: "high", permissions: ["session.delete"] }),
] as const

export const TERMINAL_CAPABILITY_IDS = TERMINAL_CAPABILITY_CATALOG.map((item) => item.id)
export const TERMINAL_CAPABILITY_BY_ID = new Map(TERMINAL_CAPABILITY_CATALOG.map((item) => [item.id, item]))
export const TERMINAL_MCP_TOOL_ACTIONS = Object.fromEntries(
  TERMINAL_CAPABILITY_CATALOG.map((item) => [item.toolName, item.id]),
) as Readonly<Record<string, CapabilityId>>

function capabilityId(id: typeof TERMINAL_CAPABILITY_CATALOG[number]["id"]): CapabilityId {
  return id
}

// Convenience exports used by the UI and internal capability registration.
export const TERMINAL_GROUP_CREATE_CAPABILITY_ID = capabilityId("app.terminal.group.create")
export const TERMINAL_GROUP_LIST_CAPABILITY_ID = capabilityId("app.terminal.group.list")
export const TERMINAL_GROUP_RENAME_CAPABILITY_ID = capabilityId("app.terminal.group.rename")
export const TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID = capabilityId("app.terminal.group_launch.update")
export const TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID = capabilityId("app.terminal.group_command.create")
export const TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID = capabilityId("app.terminal.group_command.update")
export const TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID = capabilityId("app.terminal.group_command.delete")
export const TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID = capabilityId("app.terminal.group_command.launch")
export const TERMINAL_GROUP_DELETE_CAPABILITY_ID = capabilityId("app.terminal.group.delete")
export const TERMINAL_SESSION_CREATE_CAPABILITY_ID = capabilityId("app.terminal.session.create")
export const TERMINAL_SESSION_LIST_CAPABILITY_ID = capabilityId("app.terminal.session.list")
export const TERMINAL_SESSION_GET_CAPABILITY_ID = capabilityId("app.terminal.session_state.get")
export const TERMINAL_SESSION_READ_CAPABILITY_ID = capabilityId("app.terminal.session_output.read")
export const TERMINAL_SESSION_RENAME_CAPABILITY_ID = capabilityId("app.terminal.session_metadata.rename")
export const TERMINAL_SESSION_WRITE_CAPABILITY_ID = capabilityId("app.terminal.session_input.raw")
export const TERMINAL_SESSION_RESIZE_CAPABILITY_ID = capabilityId("app.terminal.session.resize")
export const TERMINAL_SESSION_DELETE_CAPABILITY_ID = capabilityId("app.terminal.session.delete")
export const TERMINAL_SESSION_STOP_CAPABILITY_ID = capabilityId("app.terminal.session.stop")

export const TERMINAL_MCP_TOOL_NAMES = Object.freeze({
  ...Object.fromEntries(TERMINAL_CAPABILITY_CATALOG.map((item) => [
    item.id.slice("app.terminal.".length).replaceAll(".", "_"),
    item.toolName,
  ])),
  groupCreate: "app_terminal_group_create",
  groupList: "app_terminal_group_list",
  groupRename: "app_terminal_group_rename",
  groupUpdateSettings: "app_terminal_group_launch_update",
  groupCommandCreate: "app_terminal_group_command_create",
  groupCommandUpdate: "app_terminal_group_command_update",
  groupCommandDelete: "app_terminal_group_command_delete",
  groupCommandLaunch: "app_terminal_group_command_launch",
  groupDelete: "app_terminal_group_delete",
  sessionCreate: "app_terminal_session_create",
  sessionList: "app_terminal_session_list",
  sessionGet: "app_terminal_session_state_get",
  sessionRead: "app_terminal_session_output_read",
  sessionRename: "app_terminal_session_metadata_rename",
  sessionWrite: "app_terminal_session_input_raw",
  sessionResize: "app_terminal_session_resize",
  sessionDelete: "app_terminal_session_delete",
  sessionStop: "app_terminal_session_stop",
}) as Readonly<Record<string, string>>
