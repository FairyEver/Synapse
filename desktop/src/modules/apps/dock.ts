import type { SynapseSystemAppManifest } from "./types"

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: { readonly workflowEntryVisible: boolean },
): readonly SynapseSystemAppManifest[] {
  const dockApps = apps
    .filter((app) => app.dock.pinnedByDefault)
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)

  return [...dockApps].sort((left, right) => left.dock.order - right.dock.order)
}
