export type SynapseUserIdentity = {
  schemaVersion: 1
  userId: string
  displayName: string
  generatedAt: string
}

export type SynapseIdentityState =
  | {
      status: "ready"
      identity: SynapseUserIdentity
    }
  | {
      status: "needs-onboarding"
      identity: SynapseUserIdentity
    }
  | {
      status: "needs-recovery"
      invalidUserId: string | null
    }
