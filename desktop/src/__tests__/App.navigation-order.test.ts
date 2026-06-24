import { describe, expect, it } from "vitest"
import { listDockApps } from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"

describe("app Dock order", () => {
  it("keeps pinned apps in the requested left-to-right order", () => {
    expect(listDockApps(listSystemApps(), { workflowEntryVisible: true }).map((app) => app.id)).toEqual([
      "agent",
      "workflow",
      "drive",
      "automation",
      "launcher",
      "settings",
    ])
  })

  it("hides workflow when the workflow entry is not visible", () => {
    expect(listDockApps(listSystemApps(), { workflowEntryVisible: false }).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "launcher",
      "settings",
    ])
  })
})
