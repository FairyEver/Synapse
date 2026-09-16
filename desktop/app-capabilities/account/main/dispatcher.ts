import type { DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { SynapseAccountLoginResult, SynapseAccountState } from "../../../src/types/account"
import {
  ACCOUNT_LOGIN_START_CAPABILITY_ID,
  ACCOUNT_STATE_GET_CAPABILITY_ID,
} from "../shared/capability"

/** Only the surface this capability needs, so a test double stays honest and small. */
export type AccountCapabilityService = {
  getState(): SynapseAccountState
  startLogin(): Promise<SynapseAccountLoginResult>
}

export type AccountCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>): Promise<DispatchResult>
}

export function createAccountCapabilityDispatcher(deps: {
  readonly service: AccountCapabilityService
}): AccountCapabilityDispatcher {
  return {
    async dispatch(action) {
      switch (action) {
        case ACCOUNT_STATE_GET_CAPABILITY_ID:
          return { ok: true, data: deps.service.getState() }
        case ACCOUNT_LOGIN_START_CAPABILITY_ID: {
          // The whole result, not just the state: `outcome` is what tells a caller whether
          // it started anything, resumed something, or had nothing to do, and `loginUrl`
          // is what it can hand over when the browser did not open.
          const result = await deps.service.startLogin()
          if (result.outcome === "start_failed") {
            // Nothing was established, so there is nothing for a caller to poll or hand
            // over. An `open_failed` attempt is different and stays a success: the URL is
            // usable even though this process could not hand it to a browser.
            return { ok: false, code: "login_unavailable", error: "无法发起登录。", data: result }
          }
          const started = result.outcome === "opened" || result.outcome === "reused_attempt"
          return { ok: true, data: result, ...(started ? { affected: 1 } : {}) }
        }
        default:
          throw new Error(`Unknown account action: ${action}`)
      }
    },
  }
}
