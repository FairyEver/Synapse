import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import {
  TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_GROUP_RENAME_CAPABILITY_ID,
  TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RENAME_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../shared/capability"
import {
  terminalCreateGroupCommandInputSchema,
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalDeleteGroupCommandInputSchema,
  terminalDeleteGroupInputSchema,
  terminalDeleteSessionInputSchema,
  terminalEmptyInputSchema,
  terminalLaunchGroupCommandInputSchema,
  terminalReadSessionInputSchema,
  terminalRenameGroupInputSchema,
  terminalRenameSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalStopSessionInputSchema,
  terminalUpdateGroupCommandInputSchema,
  terminalUpdateGroupSettingsInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"
import type { TerminalService } from "./service"

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const TERMINAL_CONTROL_PERMISSION_ACTION: PermissionAction = "shell.exec"

export type TerminalCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createTerminalCapabilityDispatcher(deps: {
  readonly service: TerminalService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}): TerminalCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action === TERMINAL_GROUP_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createGroup(terminalCreateGroupInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_GROUP_LIST_CAPABILITY_ID) {
        terminalEmptyInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_LIST_CAPABILITY_ID,
          resource: "terminal:groups",
          boundary: "terminal.mcp.listGroups",
        })
        return { ok: true, data: deps.service.listGroups(), affected: 0 }
      }
      if (action === TERMINAL_GROUP_RENAME_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.renameGroup(terminalRenameGroupInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID) {
        const parsed = terminalUpdateGroupSettingsInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
          resource: parsed.groupId,
          boundary: "terminal.mcp.updateGroupSettings",
          groupId: parsed.groupId,
          byteCount: parsed.settings?.startupCommand === undefined
            ? 0
            : Buffer.byteLength(parsed.settings.startupCommand),
        })
        return {
          ok: true,
          data: await deps.service.updateGroupSettings(parsed),
          affected: 1,
        }
      }
      if (action === TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID) {
        const parsed = terminalCreateGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
          resource: parsed.groupId,
          boundary: "terminal.mcp.createGroupCommand",
          groupId: parsed.groupId,
          byteCount: Buffer.byteLength(parsed.command),
        })
        return { ok: true, data: await deps.service.createGroupCommand(parsed), affected: 1 }
      }
      if (action === TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID) {
        const parsed = terminalUpdateGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_UPDATE_CAPABILITY_ID,
          resource: parsed.commandId,
          boundary: "terminal.mcp.updateGroupCommand",
          groupId: parsed.groupId,
          commandId: parsed.commandId,
          byteCount: Buffer.byteLength(parsed.command),
        })
        return { ok: true, data: await deps.service.updateGroupCommand(parsed), affected: 1 }
      }
      if (action === TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID) {
        const parsed = terminalDeleteGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_DELETE_CAPABILITY_ID,
          resource: parsed.commandId,
          boundary: "terminal.mcp.deleteGroupCommand",
          groupId: parsed.groupId,
          commandId: parsed.commandId,
        })
        await deps.service.deleteGroupCommand(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID) {
        const parsed = terminalLaunchGroupCommandInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
          resource: parsed.commandId,
          boundary: "terminal.mcp.launchGroupCommand",
          groupId: parsed.groupId,
          commandId: parsed.commandId,
        })
        return { ok: true, data: await deps.service.launchGroupCommand(parsed), affected: 1 }
      }
      if (action === TERMINAL_GROUP_DELETE_CAPABILITY_ID) {
        const parsed = terminalDeleteGroupInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_GROUP_DELETE_CAPABILITY_ID,
          resource: parsed.groupId,
          boundary: "terminal.mcp.deleteGroup",
          groupId: parsed.groupId,
        })
        await deps.service.deleteGroup(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_CREATE_CAPABILITY_ID) {
        const parsed = terminalCreateSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
          resource: parsed.groupId ?? "terminal:session",
          boundary: "terminal.mcp.createSession",
          groupId: parsed.groupId,
          cols: parsed.cols,
          rows: parsed.rows,
          cwdProvided: parsed.cwd !== undefined,
        })
        return { ok: true, data: await deps.service.createSession(parsed), affected: 1 }
      }
      if (action === TERMINAL_SESSION_LIST_CAPABILITY_ID) {
        terminalEmptyInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_LIST_CAPABILITY_ID,
          resource: "terminal:sessions",
          boundary: "terminal.mcp.listSessions",
        })
        return { ok: true, data: deps.service.listSessions(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_GET_CAPABILITY_ID) {
        const parsed = terminalSessionIdInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_GET_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.getSession",
          sessionId: parsed.sessionId,
        })
        return { ok: true, data: deps.service.getSession(parsed), affected: 0 }
      }
      if (action === TERMINAL_SESSION_READ_CAPABILITY_ID) {
        const parsed = terminalReadSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_READ_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.readSession",
          sessionId: parsed.sessionId,
          afterSeq: parsed.afterSeq,
          limitBytes: parsed.limitBytes,
        })
        return { ok: true, data: deps.service.readSession(parsed), affected: 0 }
      }
      if (action === TERMINAL_SESSION_RENAME_CAPABILITY_ID) {
        const parsed = terminalRenameSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_RENAME_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.renameSession",
          sessionId: parsed.sessionId,
        })
        return { ok: true, data: await deps.service.renameSession(parsed), affected: 1 }
      }
      if (action === TERMINAL_SESSION_WRITE_CAPABILITY_ID) {
        const parsed = terminalWriteSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.writeSession",
          sessionId: parsed.sessionId,
          byteCount: Buffer.byteLength(parsed.data),
        })
        deps.service.writeSession(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_RESIZE_CAPABILITY_ID) {
        const parsed = terminalResizeSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.resizeSession",
          sessionId: parsed.sessionId,
          cols: parsed.cols,
          rows: parsed.rows,
        })
        await deps.service.resizeSession(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_DELETE_CAPABILITY_ID) {
        const parsed = terminalDeleteSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_DELETE_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.deleteSession",
          sessionId: parsed.sessionId,
        })
        await deps.service.deleteSession(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_STOP_CAPABILITY_ID) {
        const parsed = terminalStopSessionInputSchema.parse(params)
        await authorizeTerminalControl(deps, context, {
          capabilityAction: TERMINAL_SESSION_STOP_CAPABILITY_ID,
          resource: parsed.sessionId,
          boundary: "terminal.mcp.stopSession",
          sessionId: parsed.sessionId,
          force: Boolean(parsed.force),
        })
        await deps.service.stopSession(parsed)
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      throw new Error(`Unknown terminal action: ${action}`)
    },
  }
}

async function authorizeTerminalControl(
  deps: {
    readonly permissionGuard?: PermissionGuard
    readonly auditSink?: AuditSink
    readonly actor?: ActorIdentity
  },
  context: DispatchContext,
  input: {
    readonly capabilityAction: string
    readonly resource: string
    readonly boundary: string
    readonly groupId?: string
    readonly commandId?: string
    readonly sessionId?: string
    readonly byteCount?: number
    readonly force?: boolean
    readonly afterSeq?: number
    readonly limitBytes?: number
    readonly cols?: number
    readonly rows?: number
    readonly cwdProvided?: boolean
  },
): Promise<void> {
  if (!deps.permissionGuard) return
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    capabilityAction: input.capabilityAction,
    boundary: input.boundary,
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.commandId ? { commandId: input.commandId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.byteCount === undefined ? {} : { byteCount: input.byteCount }),
    ...(input.force === undefined ? {} : { force: input.force }),
    ...(input.afterSeq === undefined ? {} : { afterSeq: input.afterSeq }),
    ...(input.limitBytes === undefined ? {} : { limitBytes: input.limitBytes }),
    ...(input.cols === undefined ? {} : { cols: input.cols }),
    ...(input.rows === undefined ? {} : { rows: input.rows }),
    ...(input.cwdProvided === undefined ? {} : { cwdProvided: input.cwdProvided }),
  }
  const permission = await deps.permissionGuard.check({
    action: TERMINAL_CONTROL_PERMISSION_ACTION,
    actor,
    resource: input.resource,
    context: metadata,
  })
  deps.auditSink?.record({
    action: TERMINAL_CONTROL_PERMISSION_ACTION,
    actor,
    resource: input.resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? metadata
      : { ...metadata, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}
