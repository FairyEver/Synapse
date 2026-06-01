export type SynapseAccountUser = {
  id: string
  email: string
  displayName: string | null
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

export type SynapseAccountState =
  | { status: "unauthenticated" }
  | { status: "authenticating"; loginUrl?: string }
  | { status: "authenticated"; profile: SynapseAccountProfile }
  | { status: "error"; message: string; profile?: SynapseAccountProfile }

export type SynapseAccountStateChangedEvent = {
  state: SynapseAccountState
}
