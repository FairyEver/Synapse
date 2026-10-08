import type { SynapseSystemAppId, SynapseSystemAppManifest } from "./types"
import { listSystemAppDefinitions } from "./definitions"
import { isSystemAppId } from "./types"
import { isSystemAppEntryVisible } from "./visibility"

export const DEFAULT_DOCK_APP_IDS: readonly SynapseSystemAppId[] =
  listSystemAppDefinitions()
    .filter((app) => app.dock.pinnedByDefault)
    .sort((left, right) => left.dock.order - right.dock.order)
    .map((app) => app.id)

export const REQUIRED_DOCK_APP_ID = "launcher" as const satisfies SynapseSystemAppId

export type DockMigrationOperation =
  | {
      readonly kind: "move-to-end"
      readonly appId: SynapseSystemAppId
    }
  | {
      readonly kind: "insert-before"
      readonly appId: SynapseSystemAppId
      readonly targetAppId: SynapseSystemAppId
    }

export type DockMigration = {
  readonly id: string
  readonly operations: readonly DockMigrationOperation[]
}

/**
 * 旧配置按清单顺序执行未完成迁移，新安装仅记录当前清单，保留默认 Dock。
 * 已发布条目及 ID 不得修改或移除；后续需求在末尾追加新 ID。
 */
export const DOCK_MIGRATIONS: readonly DockMigration[] = [
  {
    id: "dock.mail-introduction.v1",
    operations: [
      { kind: "move-to-end", appId: "launcher" },
      { kind: "insert-before", appId: "mail", targetAppId: "launcher" },
    ],
  },
]

export const DEFAULT_DOCK_MIGRATION_IDS: readonly string[] = DOCK_MIGRATIONS.map((migration) => migration.id)

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

export function normalizeDockMigrationIds(values: readonly unknown[] | undefined): string[] {
  if (values === undefined) {
    return []
  }

  const next: string[] = []
  for (const value of values) {
    if (typeof value !== "string") {
      continue
    }

    const id = value.trim()
    if (!id || next.includes(id)) {
      continue
    }

    next.push(id)
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

export function moveDockAppIdToEnd(
  values: readonly unknown[] | undefined,
  appId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  const current = normalizeDockAppIds(values)
  return current.includes(appId)
    ? [...current.filter((value) => value !== appId), appId]
    : current
}

export function insertDockAppIdBefore(
  values: readonly unknown[] | undefined,
  appId: SynapseSystemAppId,
  targetAppId: SynapseSystemAppId,
): SynapseSystemAppId[] {
  const normalized = normalizeDockAppIds(values)
  if (appId === targetAppId) {
    return normalized
  }
  const current = normalized.filter((value) => value !== appId)
  const targetIndex = current.indexOf(targetAppId)
  if (targetIndex < 0) {
    return [...current, appId]
  }

  return [
    ...current.slice(0, targetIndex),
    appId,
    ...current.slice(targetIndex),
  ]
}

function applyDockMigrationOperation(
  values: readonly SynapseSystemAppId[],
  operation: DockMigrationOperation,
): SynapseSystemAppId[] {
  if (operation.kind === "move-to-end") {
    return moveDockAppIdToEnd(values, operation.appId)
  }

  return insertDockAppIdBefore(values, operation.appId, operation.targetAppId)
}

export function applyDockMigrations(
  values: readonly unknown[] | undefined,
  appliedMigrationIds: readonly unknown[] | undefined,
): { readonly dockAppIds: SynapseSystemAppId[]; readonly appliedMigrationIds: string[] } {
  let dockAppIds = normalizeDockAppIds(values)
  const applied = normalizeDockMigrationIds(appliedMigrationIds)

  for (const migration of DOCK_MIGRATIONS) {
    if (applied.includes(migration.id)) {
      continue
    }

    for (const operation of migration.operations) {
      dockAppIds = applyDockMigrationOperation(dockAppIds, operation)
    }
    applied.push(migration.id)
  }

  return { dockAppIds, appliedMigrationIds: applied }
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
    .filter((app) => isSystemAppEntryVisible(app, options))
}

export function listAddableDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: {
    readonly workflowEntryVisible: boolean
    readonly dockAppIds?: readonly SynapseSystemAppId[]
  },
): readonly SynapseSystemAppManifest[] {
  const pinned = new Set(normalizeDockAppIds(options.dockAppIds))

  return [...apps]
    .filter((app) => app.id !== REQUIRED_DOCK_APP_ID)
    .filter((app) => app.dock.pinnable !== false)
    .filter((app) => isSystemAppEntryVisible(app, options))
    .filter((app) => !pinned.has(app.id))
    .sort((left, right) => left.dock.order - right.dock.order)
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
