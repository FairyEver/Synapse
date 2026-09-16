export type SynapseAccountUser = {
  id: string
  email: string
  handle: string
  status: "active" | "disabled"
}

export type SynapseAccountProfile = {
  user: SynapseAccountUser
  syncedAt: string
}

export type SynapseAccountOfflineReason =
  | "network_error"
  | "server_unavailable"
  | "profile_sync_failed"

export type SynapseAccountRetryState = {
  attempt: number
  nextRetryAt?: string
}

export type SynapseAccountState =
  | { status: "unauthenticated" }
  | { status: "authenticating"; loginUrl?: string }
  | {
      status: "authenticated"
      connectivity: "online" | "offline"
      profile: SynapseAccountProfile
      offlineReason?: SynapseAccountOfflineReason
      retry?: SynapseAccountRetryState
    }
  | { status: "error"; message: string; profile?: SynapseAccountProfile }

export type SynapseAccountStateChangedEvent = {
  state: SynapseAccountState
}

/**
 * What one `startLogin` call actually did, so a caller can tell "I started a login"
 * apart from "there was nothing to do" without inferring it from the state alone.
 */
export type SynapseAccountLoginOutcome =
  /** A new attempt was persisted and the browser was opened on it. */
  | "opened"
  /** A login was already in flight; its URL was reopened and its attempt left alone. */
  | "reused_attempt"
  /** The account is signed in and online. Nothing was touched. */
  | "already_authenticated"
  /** The attempt is live but the browser could not be opened; the URL is still returned. */
  | "open_failed"
  /** No attempt was established — persistence failed, or a newer call superseded this one. */
  | "start_failed"

export type SynapseAccountLoginResult = {
  readonly state: SynapseAccountState
  /** Absent only when no attempt exists, which is the `already_authenticated` case. */
  readonly loginUrl?: string
  readonly outcome: SynapseAccountLoginOutcome
}

export function hasAccountProfile(state: SynapseAccountState): boolean {
  return "profile" in state && Boolean(state.profile)
}

export function isAccountOnline(state: SynapseAccountState): boolean {
  return state.status === "authenticated" && state.connectivity === "online"
}

export function isAccountUnavailable(state: SynapseAccountState): boolean {
  return !isAccountOnline(state)
}
