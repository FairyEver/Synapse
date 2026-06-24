import { describe, expect, it } from "vitest"
import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import { listSystemApps } from "../registry"
import {
  DEFAULT_DOCK_APP_IDS,
  listDockApps,
  normalizeDockAppIds,
  resolveDefaultDockAppId,
} from "../dock"

describe("app Dock model", () => {
  it("seeds the fixed default Dock with terminal before settings", () => {
    expect(DEFAULT_DOCK_APP_IDS).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "terminal",
      "settings",
      "launcher",
    ])
  })

  it("ignores stored custom Dock ids and returns the fixed default", () => {
    expect(normalizeDockAppIds(["database", "ghost", "database"])).toEqual(DEFAULT_DOCK_APP_IDS)
    expect(normalizeDockAppIds([])).toEqual(DEFAULT_DOCK_APP_IDS)
    expect(normalizeDockAppIds(undefined)).toEqual(DEFAULT_DOCK_APP_IDS)
  })

  it("filters hidden workflow from the fixed visible Dock", () => {
    const dockAppIds = ["workflow", "database", "launcher"] as const

    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: false }).map((app) => app.id))
      .toEqual(["agent", "drive", "automation", "terminal", "settings", "launcher"])
    expect(listDockApps(listSystemApps(), { dockAppIds, workflowEntryVisible: true }).map((app) => app.id))
      .toEqual(DEFAULT_DOCK_APP_IDS)
  })

  it("resolves the default app from the fixed visible Dock", () => {
    expect(resolveDefaultDockAppId(listSystemApps(), {
      dockAppIds: ["workflow", "drive", "launcher"],
      workflowEntryVisible: false,
    })).toBe("agent")
    expect(resolveDefaultDockAppId(listSystemApps(), {
      dockAppIds: ["workflow", "drive", "launcher"],
      workflowEntryVisible: true,
    })).toBe("agent")
    expect(resolveDefaultDockAppId(listSystemApps(), {
      dockAppIds: ["launcher"],
      workflowEntryVisible: false,
    })).toBe("agent")
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
