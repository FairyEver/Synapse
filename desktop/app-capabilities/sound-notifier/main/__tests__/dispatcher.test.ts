import { describe, expect, it, vi } from "vitest"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "../../shared/capability"
import { createSoundNotifierCapabilityDispatcher } from "../dispatcher"

describe("createSoundNotifierCapabilityDispatcher", () => {
  it("dispatches the play action to the service", async () => {
    const service = {
      play: vi.fn(async () => ({
        played: true,
        presetId: "done",
        volume: 70,
      })),
    }
    const dispatcher = createSoundNotifierCapabilityDispatcher({ service })

    await expect(dispatcher.dispatch(
      SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
      { presetId: "done", volume: 70 },
      { source: "mcp-http" },
    )).resolves.toEqual({
      ok: true,
      data: {
        played: true,
        presetId: "done",
        volume: 70,
      },
      affected: 1,
    })

    expect(service.play).toHaveBeenCalledWith({ presetId: "done", volume: 70 })
  })

  it("rejects unknown sound notifier actions", async () => {
    const dispatcher = createSoundNotifierCapabilityDispatcher({
      service: {
        play: vi.fn(),
      },
    })

    await expect(dispatcher.dispatch("app.sound_notifier.unknown.play", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown sound notifier action")
  })
})
