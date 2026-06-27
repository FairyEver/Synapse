import type { SynapseSystemAppId, SynapseSystemAppManifest } from "./types"
import { isSystemAppId } from "./types"

export const DEFAULT_DOCK_APP_IDS = [
  "agent",
  "drive",
  "automation",
  "workflow",
  "terminal",
  "settings",
  "launcher",
] as const satisfies readonly SynapseSystemAppId[]

export const REQUIRED_DOCK_APP_ID = "launcher" as const satisfies SynapseSystemAppId

export type DockMoveDirection = "up" | "down"

export function seedDefaultDockAppIds(): SynapseSystemAppId[] {
  return [...DEFAULT_DOCK_APP_IDS]
}

export function restoreDefaultDockAppIds(): SynapseSystemAppId[] {
  return seedDefaultDockAppIds()
}

export function normalizeDockAppIds(values: readonly unknown[] | undefined): SynapseSystemAppId[] {
  if (values === undefined) {
    return seedDefaultDockAppIds()
  }

  const next: SynapseSystemAppId[] = []
  for (const value of values) {
    if (typeof value !== "string" || !isSystemAppId(value)) {
      continue
    }
    if (next.includes(value)) {
      continue
    }
    next.push(value)
  }

  if (!next.includes(REQUIRED_DOCK_APP_ID)) {
    next.push(REQUIRED_DOCK_APP_ID)
  }

  return next
}

export function insertDockAppId(
  values: readonly unknown[] | undefined,
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values).filter((value) => value !== appId)
  const launcherIndex = current.indexOf(REQUIRED_DOCK_APP_ID)
  const insertIndex = launcherIndex >= 0 ? launcherIndex : current.length

  return [
    ...current.slice(0, insertIndex),
    appId,
    ...current.slice(insertIndex),
  ]
}

export function removeDockAppId(
  values: readonly unknown[] | undefined,
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  if (appId === REQUIRED_DOCK_APP_ID) {
    return normalizeDockAppIds(values)
  }

  return normalizeDockAppIds(values).filter((value) => value !== appId)
}

export function moveDockAppId(
  values: readonly unknown[] | undefined,
  appId: SynapseSystemAppId,
  direction: DockMoveDirection,
): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values)
  const index = current.indexOf(appId)
  if (index < 0) {
    return current
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= current.length) {
    return current
  }

  const next = [...current]
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

export function reorderDockAppIds(
  values: readonly unknown[] | undefined,
  activeId: string,
  overId: string,
): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values)
  const activeIndex = current.indexOf(activeId as SynapseSystemAppId)
  const overIndex = current.indexOf(overId as SynapseSystemAppId)
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return current
  }

  const next = [...current]
  const [item] = next.splice(activeIndex, 1)
  next.splice(overIndex, 0, item)
  return next
}

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

export function listAddableDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const pinned = new Set(normalizeDockAppIds(options.dockAppIds))

  return apps
    .filter((app) => app.id !== REQUIRED_DOCK_APP_ID)
    .filter((app) => app.window.openable)
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
    .filter((app) => !pinned.has(app.id))
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
