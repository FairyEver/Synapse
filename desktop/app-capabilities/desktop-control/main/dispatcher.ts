import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  DESKTOP_RESTART_CAPABILITY_ID,
  UPDATE_CHECK_CAPABILITY_ID,
  UPDATE_RUN_CAPABILITY_ID,
  UPDATE_STATE_GET_CAPABILITY_ID,
} from "../shared/capability"
import type { DesktopControlService } from "./service"

export function createDesktopControlDispatcher(service: DesktopControlService) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (Object.keys(params).length > 0) {
        return { ok: false, code: "invalid_input", error: "此操作不接受参数。" }
      }
      try {
        switch (action) {
          case UPDATE_STATE_GET_CAPABILITY_ID:
            return { ok: true, data: service.getState() }
          case UPDATE_CHECK_CAPABILITY_ID:
            return { ok: true, data: await service.check(context) }
          case UPDATE_RUN_CAPABILITY_ID:
            return { ok: true, data: await service.runUpdate(context), affected: 1 }
          case DESKTOP_RESTART_CAPABILITY_ID:
            return { ok: true, data: await service.restartDesktop(context), affected: 1 }
          default:
            throw new Error(`Unknown desktop control action: ${action}`)
        }
      } catch (error) {
        return { ok: false, code: "operation_failed", error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
