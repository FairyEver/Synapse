import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const ACCOUNT_APP_ID = "account" as const
export const ACCOUNT_NAMESPACE = "account" as const

/**
 * Reading the account state is what lets a caller ask "is anyone signed in" before
 * deciding anything, and then ask again until the answer changes — a login completes in
 * the browser, long after the call that started it returned.
 */
export const ACCOUNT_STATE_GET_CAPABILITY_ID = "app.account.state.get" as CapabilityId
export const ACCOUNT_STATE_GET_MCP_TOOL_NAME = "app_account_state_get" as const

/**
 * The equivalent of pressing the account panel's sign-in button: opens the browser on
 * the login page and does not wait. Only the sign-in is exposed — `logout` stays a
 * user-only action, since an Agent signing the user out would end a session nobody
 * asked it to end.
 */
export const ACCOUNT_LOGIN_START_CAPABILITY_ID = "app.account.login.start" as CapabilityId
export const ACCOUNT_LOGIN_START_MCP_TOOL_NAME = "app_account_login_start" as const

export const ACCOUNT_CAPABILITY_IDS = [
  ACCOUNT_STATE_GET_CAPABILITY_ID,
  ACCOUNT_LOGIN_START_CAPABILITY_ID,
] as const
