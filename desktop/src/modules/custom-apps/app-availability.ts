import type { CustomAppSnapshotDto, SynapseAppId } from "@synapse/shared"

import { isSystemAppId } from "@/modules/apps/types"

export function shouldReturnToLauncher(
  activeAppId: SynapseAppId,
  snapshot: CustomAppSnapshotDto | null,
): boolean {
  return !isSystemAppId(activeAppId)
    && !snapshot?.apps.some((app) => app.id === activeAppId)
}
