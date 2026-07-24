import { describe, expect, it } from "vitest"
import { DEFAULT_DOCK_APP_IDS } from "../dock"
import {
  getSystemAppManifest,
  listLaunchableSystemApps,
} from "../registry"

describe("quick input app registry", () => {
  it("registers Quick Input as a launchable system app outside the default Dock", () => {
    const app = getSystemAppManifest("quick-input")

    expect(app).toMatchObject({
      id: "quick-input",
      namespace: "quick_input",
      name: "快捷输入",
      windowTitle: "快捷输入",
      dock: { pinnedByDefault: false },
      window: { openable: true },
    })
    expect(listLaunchableSystemApps().map((item) => item.id)).toContain("quick-input")
    expect(DEFAULT_DOCK_APP_IDS).not.toContain("quick-input")
  })
})
