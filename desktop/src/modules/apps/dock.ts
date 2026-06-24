import type { SynapseSystemAppId, SynapseSystemAppManifest } from "./types"

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly userPinnedAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const userPinnedAppIds = new Set(options.userPinnedAppIds ?? [])
  const dockApps = apps
    .filter((app) => app.dock.pinnedByDefault || userPinnedAppIds.has(app.id))
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)

  return [...dockApps].sort((left, right) => left.dock.order - right.dock.order)
}
