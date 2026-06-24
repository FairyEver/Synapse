import type { SynapseSystemAppId, SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

export const DEFAULT_DOCK_APP_IDS = [
  "agent",
  "drive",
  "automation",
  "workflow",
  "settings",
  "launcher",
] as const satisfies readonly SynapseSystemAppId[]

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
    readonly userPinnedAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const dockAppIds = options.dockAppIds
    ?? (options.userPinnedAppIds ?? []).reduce(
      (current, appId) => addDockAppId(current, appId),
      [...DEFAULT_DOCK_APP_IDS] as SynapseSystemAppId[],
    )
  const appById = new Map(apps.map((app) => [app.id, app]))

  return normalizeDockAppIds(dockAppIds)
    .map((appId) => appById.get(appId))
    .filter((app): app is SynapseSystemAppManifest => Boolean(app))
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
}

export function normalizeDockAppIds(values: readonly unknown[] | undefined): SynapseSystemAppId[] {
  if (!values) return [...DEFAULT_DOCK_APP_IDS]

  const seen = new Set<SynapseSystemAppId>()
  const result: SynapseSystemAppId[] = []

  for (const value of values) {
    if (typeof value !== "string" || !isSystemAppId(value) || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }

  if (!seen.has("launcher")) {
    result.push("launcher")
  }

  return result
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

export function addDockAppId(
  appIds: readonly SynapseSystemAppId[],
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  const normalized = normalizeDockAppIds(appIds)
  if (normalized.includes(appId)) return normalized

  const insertIndex = normalized.includes("launcher")
    ? normalized.indexOf("launcher")
    : normalized.length

  return [
    ...normalized.slice(0, insertIndex),
    appId,
    ...normalized.slice(insertIndex),
  ]
}

export function removeDockAppId(
  appIds: readonly SynapseSystemAppId[],
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  if (appId === "launcher") return normalizeDockAppIds(appIds)

  return normalizeDockAppIds(appIds).filter((item) => item !== appId)
}

export function moveDockAppId(
  appIds: readonly SynapseSystemAppId[],
  appId: SynapseSystemAppId,
  beforeAppId?: SynapseSystemAppId,
): SynapseSystemAppId[] {
  const normalized = normalizeDockAppIds(appIds)
  if (appId === beforeAppId || !normalized.includes(appId)) {
    return normalized
  }

  const withoutMoved = normalized.filter((item) => item !== appId)
  const targetIndex = beforeAppId ? withoutMoved.indexOf(beforeAppId) : -1
  const insertIndex = targetIndex >= 0 ? targetIndex : withoutMoved.length

  return [
    ...withoutMoved.slice(0, insertIndex),
    appId,
    ...withoutMoved.slice(insertIndex),
  ]
}
