import { describe, expect, it } from "vitest"
import { DEFAULT_DOCK_APP_IDS } from "../dock"
import { getSystemAppManifest, listLaunchableSystemApps } from "../registry"

describe("System Notifier app registry", () => {
  it("registers the stable launchable app outside the default Dock", () => {
    expect(getSystemAppManifest("system-notifier")).toMatchObject({
      id: "system-notifier",
      namespace: "system_notifier",
      name: "System Notifier",
      windowTitle: "System Notifier",
      dock: { pinnedByDefault: false },
      window: { openable: true },
    })
    expect(listLaunchableSystemApps().map((item) => item.id)).toContain("system-notifier")
    expect(DEFAULT_DOCK_APP_IDS).not.toContain("system-notifier")
  })
})
