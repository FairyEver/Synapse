export type SynapseAccountUser = {
  id: string
  email: string
  handle: string
  status: "active" | "disabled"
}

export type SynapseAccountTeam = {
  id: string
  name: string
  membershipId: string
  membershipRole: "owner" | "member"
}

export type SynapseAccountProfile = {
  user: SynapseAccountUser
  teams: SynapseAccountTeam[]
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

export function hasAccountProfile(state: SynapseAccountState): boolean {
  return "profile" in state && Boolean(state.profile)
}

export function isAccountOnline(state: SynapseAccountState): boolean {
  return state.status === "authenticated" && state.connectivity === "online"
}

export function isAccountUnavailable(state: SynapseAccountState): boolean {
  return !isAccountOnline(state)
}
