import { describe, expect, it } from "vitest"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { listSystemApps } from "../registry"
import {
  addDockAppId,
  DEFAULT_DOCK_APP_IDS,
  listDockApps,
  moveDockAppId,
  normalizeDockAppIds,
  removeDockAppId,
  resolveDefaultDockAppId,
} from "../dock"

describe("app Dock model", () => {
  it("seeds the default Dock with workflow before launcher", () => {
    expect(DEFAULT_DOCK_APP_IDS).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "settings",
      "launcher",
    ])
  })

  it("normalizes stored Dock ids while keeping launcher fixed", () => {
    expect(normalizeDockAppIds(["database", "ghost", "database"])).toEqual(["database", "launcher"])
    expect(normalizeDockAppIds([])).toEqual(["launcher"])
    expect(normalizeDockAppIds(undefined)).toEqual(DEFAULT_DOCK_APP_IDS)
  })

  it("filters hidden workflow from the visible Dock without deleting it from config", () => {
    const dockAppIds = ["workflow", "database", "launcher"] as const

    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: false }).map((app) => app.id))
      .toEqual(["database", "launcher"])
    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: true }).map((app) => app.id))
      .toEqual(["workflow", "database", "launcher"])
  })

  it("resolves the default app from the first visible Dock item", () => {
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

  it("adds, removes, and moves Dock apps without duplicates", () => {
    expect(addDockAppId(["agent", "launcher"], "database")).toEqual(["agent", "database", "launcher"])
    expect(addDockAppId(["agent", "database", "launcher"], "database")).toEqual(["agent", "database", "launcher"])
    expect(removeDockAppId(["agent", "launcher"], "agent")).toEqual(["launcher"])
    expect(removeDockAppId(["agent", "launcher"], "launcher")).toEqual(["agent", "launcher"])
    expect(moveDockAppId(["agent", "drive", "launcher"], "drive", "agent")).toEqual(["drive", "agent", "launcher"])
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
})
