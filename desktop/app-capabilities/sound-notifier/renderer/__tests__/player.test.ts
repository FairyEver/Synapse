/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("playSoundNotifierPreset", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("schedules repeated playback by repeat count and start-to-start interval", async () => {
    const starts: number[] = []
    const context = createAudioContextHarness(starts)
    class FakeAudioContext {
      constructor() {
        return context
      }
    }
    ;(window as unknown as { AudioContext: typeof AudioContext }).AudioContext = FakeAudioContext as typeof AudioContext

    const { playSoundNotifierPreset } = await import("../player")

    playSoundNotifierPreset({
      presetId: "soft-chime",
      repeatCount: 3,
      intervalMs: 1500,
    })

    expect(starts).toEqual([
      10,
      10.13,
      11.5,
      11.63,
      13,
      13.13,
    ])
  })
})

function createAudioContextHarness(starts: number[]): AudioContext {
  return {
    currentTime: 10,
    state: "running",
    resume: vi.fn(),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    })),
    createOscillator: vi.fn(() => ({
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn((time: number) => {
        starts.push(Number(time.toFixed(2)))
      }),
      stop: vi.fn(),
    })),
    destination: {},
  } as unknown as AudioContext
}
