import { describe, expect, it } from "vitest"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { listSystemApps } from "../registry"
import {
  DEFAULT_DOCK_APP_IDS,
  insertDockAppId,
  listAddableDockApps,
  listDockApps,
  moveDockAppId,
  normalizeDockAppIds,
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
    expect(normalizeDockAppIds(["database", "ghost", "database"])).toEqual(["database", "launcher"])
    expect(normalizeDockAppIds(["launcher", "agent"])).toEqual(["launcher", "agent"])
  })

  it("inserts newly pinned apps before launcher", () => {
    expect(insertDockAppId(["agent", "launcher"], "database")).toEqual(["agent", "database", "launcher"])
    expect(insertDockAppId(["launcher", "agent"], "database")).toEqual(["database", "launcher", "agent"])
    expect(insertDockAppId(["agent", "launcher"], "agent")).toEqual(["agent", "launcher"])
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
