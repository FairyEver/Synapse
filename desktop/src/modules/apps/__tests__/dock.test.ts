import { describe, expect, it } from "vitest"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { listSystemApps } from "../registry"
import {
  applyDockMigrations,
  DEFAULT_DOCK_APP_IDS,
  DEFAULT_DOCK_MIGRATION_IDS,
  insertDockAppIdBefore,
  insertDockAppId,
  listAddableDockApps,
  listDockApps,
  moveDockAppId,
  moveDockAppIdToEnd,
  normalizeDockAppIds,
  normalizeDockMigrationIds,
  removeDockAppId,
  reorderDockAppIds,
  resolveDefaultDockAppId,
  restoreDefaultDockAppIds,
  seedDefaultDockAppIds,
} from "../dock"

describe("app Dock model", () => {
  it("derives the default Dock from registered metadata", () => {
    expect(DEFAULT_DOCK_APP_IDS).toEqual(
      [...listSystemApps()]
        .filter((app) => app.dock.pinnedByDefault)
        .sort((left, right) => left.dock.order - right.dock.order)
        .map((app) => app.id),
    )
  })

  it("seeds the default Dock with terminal before settings", () => {
    expect(seedDefaultDockAppIds()).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "terminal",
      "settings",
      "launcher",
    ])
    expect(restoreDefaultDockAppIds()).toEqual(DEFAULT_DOCK_APP_IDS)
  })

  it("normalizes stored Dock ids without restoring removed defaults", () => {
    expect(normalizeDockAppIds(undefined)).toEqual(DEFAULT_DOCK_APP_IDS)
    expect(normalizeDockAppIds([])).toEqual(["launcher"])
    expect(normalizeDockAppIds(["database", "system-notifier", "ghost", "database"]))
      .toEqual(["database", "launcher"])
    expect(normalizeDockAppIds(["launcher", "agent"])).toEqual(["launcher", "agent"])
  })

  it("inserts newly pinned apps before launcher", () => {
    expect(insertDockAppId(["agent", "launcher"], "database")).toEqual(["agent", "database", "launcher"])
    expect(insertDockAppId(["launcher", "agent"], "database")).toEqual(["database", "launcher", "agent"])
    expect(insertDockAppId(["agent", "launcher"], "agent")).toEqual(["agent", "launcher"])
  })

  it("supports moving an app to the end and inserting another app before it", () => {
    expect(moveDockAppIdToEnd(["launcher", "agent"], "launcher")).toEqual(["agent", "launcher"])
    expect(insertDockAppIdBefore(["agent", "launcher"], "mail", "launcher"))
      .toEqual(["agent", "mail", "launcher"])
    expect(insertDockAppIdBefore(["agent", "mail", "launcher"], "mail", "launcher"))
      .toEqual(["agent", "mail", "launcher"])
  })

  it("applies each Dock migration once and preserves the applied ids", () => {
    const migrated = applyDockMigrations(["launcher", "agent"], [])

    expect(migrated.dockAppIds).toEqual(["agent", "mail", "launcher"])
    expect(migrated.appliedMigrationIds).toEqual([...DEFAULT_DOCK_MIGRATION_IDS])
    expect(applyDockMigrations(migrated.dockAppIds, migrated.appliedMigrationIds)).toEqual(migrated)
  })

  it("keeps other apps in user order and moves an existing Mail without duplication", () => {
    expect(applyDockMigrations(["mail", "database", "launcher", "workflow", "agent"], []).dockAppIds)
      .toEqual(["database", "workflow", "agent", "mail", "launcher"])
    expect(applyDockMigrations([], []).dockAppIds).toEqual(["mail", "launcher"])
  })

  it("does not move launcher or reintroduce Mail after the migration was recorded", () => {
    const userDock = ["launcher", "database", "agent"]
    const applied = [...DEFAULT_DOCK_MIGRATION_IDS, "future-migration"]
    expect(applyDockMigrations(userDock, applied)).toEqual({
      dockAppIds: userDock,
      appliedMigrationIds: applied,
    })
  })

  it("normalizes migration records without discarding unknown ids", () => {
    expect(normalizeDockMigrationIds([" future-migration ", "", 42, "future-migration"]))
      .toEqual(["future-migration"])
  })

  it("does not remove launcher", () => {
    expect(removeDockAppId(["agent", "launcher"], "agent")).toEqual(["launcher"])
    expect(removeDockAppId(["agent", "launcher"], "launcher")).toEqual(["agent", "launcher"])
  })

  it("moves pinned apps with bounds protection", () => {
    expect(moveDockAppId(["agent", "drive", "launcher"], "drive", "up")).toEqual(["drive", "agent", "launcher"])
    expect(moveDockAppId(["agent", "drive", "launcher"], "drive", "down")).toEqual(["agent", "launcher", "drive"])
    expect(moveDockAppId(["agent", "drive", "launcher"], "agent", "up")).toEqual(["agent", "drive", "launcher"])
  })

  it("reorders pinned apps by active and over ids", () => {
    expect(reorderDockAppIds(["agent", "drive", "launcher"], "agent", "launcher")).toEqual(["drive", "launcher", "agent"])
    expect(reorderDockAppIds(["agent", "drive", "launcher"], "missing", "drive")).toEqual(["agent", "drive", "launcher"])
  })

  it("filters hidden workflow from visible Dock without dropping persisted order", () => {
    const dockAppIds = ["workflow", "database", "launcher"] as const

    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: false }).map((app) => app.id))
      .toEqual(["database", "launcher"])
    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: true }).map((app) => app.id))
      .toEqual(["workflow", "database", "launcher"])
  })

  it("resolves the default app from the visible Dock", () => {
    expect(resolveDefaultDockAppId(listSystemApps(), {
      dockAppIds: ["workflow", "drive", "launcher"],
      workflowEntryVisible: false,
    })).toBe("drive")
    expect(resolveDefaultDockAppId(listSystemApps(), {
      dockAppIds: ["workflow", "drive", "launcher"],
      workflowEntryVisible: true,
    })).toBe("workflow")
    expect(resolveDefaultDockAppId(listSystemApps(), {
      dockAppIds: ["launcher"],
      workflowEntryVisible: false,
    })).toBe("launcher")
  })

  it("treats workflow visibility as a cheat-code controlled capability", () => {
    expect(listDockApps(listSystemApps(), {
      dockAppIds: DEFAULT_DOCK_APP_IDS,
      workflowEntryVisible: false,
    }).map((app) => app.id)).not.toContain("workflow")
    expect(listDockApps(listSystemApps(), {
      dockAppIds: DEFAULT_DOCK_APP_IDS,
      workflowEntryVisible: { [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true }[WORKFLOW_ENTRY_CHEAT_CODE_NAME],
    }).map((app) => app.id)).toContain("workflow")
  })

  it("lists addable apps from launchable visible apps only", () => {
    expect(listAddableDockApps(listSystemApps(), {
      dockAppIds: ["agent", "launcher"],
      workflowEntryVisible: false,
    }).map((app) => app.id)).not.toContain("workflow")
    expect(listAddableDockApps(listSystemApps(), {
      dockAppIds: ["agent", "launcher"],
      workflowEntryVisible: { [WORKFLOW_ENTRY_CHEAT_CODE_NAME]: true }[WORKFLOW_ENTRY_CHEAT_CODE_NAME],
    }).map((app) => app.id)).toContain("workflow")
  })
})
