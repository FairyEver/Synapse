import type { CustomAppSnapshotDto, SynapseAppId } from "@synapse/shared"

import { isSystemAppId } from "@/modules/apps/types"

export function shouldReturnToLauncher(
  activeAppId: SynapseAppId,
  snapshot: CustomAppSnapshotDto | null,
): boolean {
  if (isSystemAppId(activeAppId)) return false
  const activeApp = snapshot?.apps.find((app) => app.id === activeAppId)
  return !activeApp || activeApp.openMode === "window"
}
