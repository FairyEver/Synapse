import { describe, expect, it, vi } from "vitest"
import { soundNotifierIpcModule } from "../ipc"

describe("soundNotifierIpcModule", () => {
  it("defines stable channels", () => {
    expect(soundNotifierIpcModule.id).toBe("soundNotifier")
    expect(soundNotifierIpcModule.methods.getSettings.operationId).toBe("app.sound_notifier.settings.get")
    expect(soundNotifierIpcModule.methods.updateSettings.operationId).toBe("app.sound_notifier.settings.update")
    expect(soundNotifierIpcModule.methods.play.operationId).toBe("app.sound_notifier.sound.play")
    expect(soundNotifierIpcModule.methods.preview.operationId).toBe("app.sound_notifier.sound.preview")
    expect(soundNotifierIpcModule.events.changed.operationId).toBe("app.sound_notifier.operation.changed")
    expect(soundNotifierIpcModule.events.playRequested.operationId).toBe("app.sound_notifier.operation.play_requested")
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
