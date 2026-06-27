import { describe, expect, it } from "vitest"
import { DEFAULT_DOCK_APP_IDS } from "../dock"
import {
  getSystemAppManifest,
  listLaunchableSystemApps,
} from "../registry"

describe("Sound Notifier app registry", () => {
  it("registers Sound Notifier as a launchable system app outside the default Dock", () => {
    const app = getSystemAppManifest("sound-notifier")

    expect(app).toMatchObject({
      id: "sound-notifier",
      namespace: "sound_notifier",
      name: "Sound Notifier",
      windowTitle: "Sound Notifier",
      dock: { pinnedByDefault: false },
      window: { openable: true },
      capabilities: {
        primaryMcpPrefix: "app_sound_notifier",
      },
    })
    expect(listLaunchableSystemApps().map((item) => item.id)).toContain("sound-notifier")
    expect(DEFAULT_DOCK_APP_IDS).not.toContain("sound-notifier")
  })
})
