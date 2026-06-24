import type { SynapseSystemAppManifest } from "./types"

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: { readonly workflowEntryVisible: boolean },
): readonly SynapseSystemAppManifest[] {
  return apps
    .filter((app) => app.dock.pinnedByDefault)
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
    .toSorted((left, right) => left.dock.order - right.dock.order)
}
