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
      getSettings: vi.fn(async () => ({
        schemaVersion: 3,
      })),
    }
    const ctx = {
      resolve: (id: string) => {
        if (id === "core.sound-notifier") return service
        throw new Error(id)
      },
    }

    await expect(soundNotifierIpcModule.methods.getSettings.handler(ctx as never, undefined))
      .resolves.toMatchObject({ schemaVersion: 3 })
    expect(service.getSettings).toHaveBeenCalled()
  })
})
