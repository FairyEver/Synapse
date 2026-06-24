import { describe, expect, it } from "vitest"
import { listDockApps } from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"

describe("app Dock order", () => {
  it("keeps pinned apps in the requested left-to-right order", () => {
    expect(listDockApps(listSystemApps(), { dockAppIds: undefined, workflowEntryVisible: true }).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "workflow",
      "terminal",
      "settings",
      "launcher",
    ])
  })

  it("hides workflow when the workflow entry is not visible", () => {
    expect(listDockApps(listSystemApps(), { dockAppIds: undefined, workflowEntryVisible: false }).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "terminal",
      "settings",
      "launcher",
    ])
  })

  it("ignores user pinned app order", () => {
    expect(listDockApps(
      listSystemApps(),
      { workflowEntryVisible: false, dockAppIds: ["database", "agent", "launcher"] },
    ).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "terminal",
      "settings",
      "launcher",
    ])
  })
})
