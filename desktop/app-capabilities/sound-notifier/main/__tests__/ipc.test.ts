import { describe, expect, it, vi } from "vitest"
import { soundNotifierIpcModule } from "../ipc"

describe("soundNotifierIpcModule", () => {
  it("defines stable channels", () => {
    expect(soundNotifierIpcModule.id).toBe("soundNotifier")
    expect(soundNotifierIpcModule.methods.getSettings.channel).toBe("synapse:sound-notifier:settings:get")
    expect(soundNotifierIpcModule.methods.updateSettings.channel).toBe("synapse:sound-notifier:settings:update")
    expect(soundNotifierIpcModule.methods.play.channel).toBe("synapse:sound-notifier:play")
    expect(soundNotifierIpcModule.methods.preview.channel).toBe("synapse:sound-notifier:preview")
    expect(soundNotifierIpcModule.events.changed.channel).toBe("synapse:sound-notifier:changed")
    expect(soundNotifierIpcModule.events.playRequested.channel).toBe("synapse:sound-notifier:play-requested")
  })

  it("resolves the service for settings reads", async () => {
    const service = {
      events: { on: vi.fn() },
      getSettings: vi.fn(async () => ({
        schemaVersion: 1,
        enabled: true,
        selectedPresetId: "soft-chime",
        volume: 70,
      })),
    }
    const windowManager = { broadcast: vi.fn() }
    const ctx = {
      resolve: (id: string) => {
        if (id === "core.sound-notifier") return service
        if (id === "core.window-manager") return windowManager
        throw new Error(id)
      },
    }

    await expect(soundNotifierIpcModule.methods.getSettings.handler(ctx as never, undefined))
      .resolves.toMatchObject({ selectedPresetId: "soft-chime" })
    expect(service.getSettings).toHaveBeenCalled()
    expect(service.events.on).toHaveBeenCalledTimes(2)
  })
})
