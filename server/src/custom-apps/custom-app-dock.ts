import {
  applyCustomAppDockAction,
  normalizeCustomAppDockIds,
  type CustomAppDockAction,
} from "@synapse/shared"

type DockReducerOptions = {
  readonly knownCustomAppIds: ReadonlySet<string>
  readonly appliedMigrationIds?: readonly string[]
}

export function normalizeServerDockLayout(
  dockAppIds: readonly unknown[] | undefined,
  options: Pick<DockReducerOptions, "knownCustomAppIds">,
): string[] {
  return normalizeCustomAppDockIds(dockAppIds, options.knownCustomAppIds)
}

export function applyServerDockAction(
  dockAppIds: readonly unknown[] | undefined,
  action: CustomAppDockAction,
  options: DockReducerOptions,
): { readonly dockAppIds: string[]; readonly dockMigrationIds: string[] } {
  const result = applyCustomAppDockAction(
    dockAppIds,
    action,
    options.knownCustomAppIds,
    options.appliedMigrationIds ?? [],
  )

  if (Array.isArray(result)) {
    return {
      dockAppIds: [...result],
      dockMigrationIds: [...(options.appliedMigrationIds ?? [])],
    }
  }

  return {
    dockAppIds: [...result.appIds],
    dockMigrationIds: [...result.migrationIds],
  }
}
