import type { SynapseSystemAppId, SynapseSystemAppManifest } from "./types"

export const DEFAULT_DOCK_APP_IDS = [
  "agent",
  "drive",
  "automation",
  "workflow",
  "terminal",
  "settings",
  "launcher",
] as const satisfies readonly SynapseSystemAppId[]

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const appById = new Map(apps.map((app) => [app.id, app]))

  return normalizeDockAppIds(options.dockAppIds)
    .map((appId) => appById.get(appId))
    .filter((app): app is SynapseSystemAppManifest => Boolean(app))
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
}

export function normalizeDockAppIds(values: readonly unknown[] | undefined): SynapseSystemAppId[] {
  void values
  return [...DEFAULT_DOCK_APP_IDS]
}

export function resolveDefaultDockAppId(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
  },
): SynapseSystemAppId {
  return listDockApps(apps, options)[0]?.id ?? "launcher"
}
