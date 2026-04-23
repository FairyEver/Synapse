export type SynapseLocalIdentity = {
  schemaVersion: 2
  userId: string
  generatedAt: string
}

export type SynapseLocalIdentityState =
  | {
      status: "ready"
      identity: SynapseLocalIdentity
    }
  | {
      status: "needs-recovery"
      invalidUserId: string | null
    }

export type SynapseUserProfile = {
  schemaVersion: 1
  userId: string
  displayName: string
  updatedAt: string
}

export type SynapseRepoProfileState =
  | {
      status: "ready"
      profile: SynapseUserProfile
    }
  | {
      status: "needs-onboarding"
      repoId: string
      userId: string
    }
