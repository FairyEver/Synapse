import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  TERMINAL_GROUP_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../shared/capability"
import {
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalReadSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalStopSessionInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"
import type { TerminalService } from "./service"

export type TerminalCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createTerminalCapabilityDispatcher(deps: {
  readonly service: TerminalService
}): TerminalCapabilityDispatcher {
  return {
    async dispatch(action, params) {
      if (action === TERMINAL_GROUP_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createGroup(terminalCreateGroupInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_GROUP_LIST_CAPABILITY_ID) {
        return { ok: true, data: deps.service.listGroups(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createSession(terminalCreateSessionInputSchema.parse(params)), affected: 1 }
      }
      if (action === TERMINAL_SESSION_LIST_CAPABILITY_ID) {
        return { ok: true, data: deps.service.listSessions(), affected: 0 }
      }
      if (action === TERMINAL_SESSION_GET_CAPABILITY_ID) {
        return { ok: true, data: deps.service.getSession(terminalSessionIdInputSchema.parse(params)), affected: 0 }
      }
      if (action === TERMINAL_SESSION_READ_CAPABILITY_ID) {
        return { ok: true, data: deps.service.readSession(terminalReadSessionInputSchema.parse(params)), affected: 0 }
      }
      if (action === TERMINAL_SESSION_WRITE_CAPABILITY_ID) {
        deps.service.writeSession({ ...terminalWriteSessionInputSchema.parse(params), actor: "mcp" })
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_RESIZE_CAPABILITY_ID) {
        await deps.service.resizeSession(terminalResizeSessionInputSchema.parse(params))
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      if (action === TERMINAL_SESSION_STOP_CAPABILITY_ID) {
        await deps.service.stopSession({ ...terminalStopSessionInputSchema.parse(params), actor: "mcp" })
        return { ok: true, data: { ok: true }, affected: 1 }
      }
      throw new Error(`Unknown terminal action: ${action}`)
    },
  }
}
