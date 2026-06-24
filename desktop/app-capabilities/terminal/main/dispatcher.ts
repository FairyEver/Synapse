import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import {
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
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
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalDeleteSessionInputSchema,
  terminalEmptyInputSchema,
  terminalReadSessionInputSchema,
  terminalRenameSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalStopSessionInputSchema,
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
        return { ok: true, data: deps.service.listGroups(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createSession(terminalCreateSessionInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_SESSION_LIST_CAPABILITY_ID) {
        terminalEmptyInputSchema.parse(params)
        return { ok: true, data: deps.service.listSessions(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_GET_CAPABILITY_ID) {
        return { ok: true, data: deps.service.getSession(terminalSessionIdInputSchema.parse(params)), affected: 0 }
      }
      if (action === TERMINAL_SESSION_READ_CAPABILITY_ID) {
        return { ok: true, data: deps.service.readSession(terminalReadSessionInputSchema.parse(params)), affected: 0 }
      }
      if (action === TERMINAL_SESSION_RENAME_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.renameSession(terminalRenameSessionInputSchema.parse(params)), affected: 1 }
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
        await deps.service.resizeSession(terminalResizeSessionInputSchema.parse(params))
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
    readonly sessionId?: string
    readonly byteCount?: number
    readonly force?: boolean
  },
): Promise<void> {
  if (!deps.permissionGuard) return
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    capabilityAction: input.capabilityAction,
    boundary: input.boundary,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.byteCount === undefined ? {} : { byteCount: input.byteCount }),
    ...(input.force === undefined ? {} : { force: input.force }),
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
