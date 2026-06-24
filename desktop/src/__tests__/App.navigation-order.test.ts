import { describe, expect, it } from "vitest"
import { listDockApps } from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"

describe("app Dock order", () => {
  it("keeps pinned apps in the requested left-to-right order", () => {
    expect(listDockApps(listSystemApps(), { workflowEntryVisible: true }).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "settings",
      "launcher",
    ])
  })

  it("hides workflow when the workflow entry is not visible", () => {
    expect(listDockApps(listSystemApps(), { workflowEntryVisible: false }).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "settings",
      "launcher",
    ])
  })

  it("merges user pinned apps into Dock order without duplicates", () => {
    expect(listDockApps(
      listSystemApps(),
      { workflowEntryVisible: false, userPinnedAppIds: ["database", "agent"] },
    ).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "settings",
      "launcher",
      "database",
    ])
  })
})
