import type { SynapseUserProfile } from "../types/identity"

export function resolveDisplayName(
  userId: string,
  profileMap: ReadonlyMap<string, SynapseUserProfile>,
  snapshotFallback?: string,
): string {
  const profile = profileMap.get(userId)

  if (profile && profile.displayName.trim().length > 0) {
    return profile.displayName
  }

  if (snapshotFallback && snapshotFallback.trim().length > 0) {
    return snapshotFallback.trim()
  }

  return "未命名用户"
}
