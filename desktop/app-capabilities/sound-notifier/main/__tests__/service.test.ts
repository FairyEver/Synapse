import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { SoundNotifierSettingsEntryV3 } from "../../../../electron/runtime/data-repo/schemas/sound-notifier"
import { createSoundNotifierService } from "../service"

describe("SoundNotifierService", () => {
  it("loads v3 default settings when the store is empty", async () => {
    const service = createSoundNotifierService(createHarness().deps)

    await expect(service.getSettings()).resolves.toEqual({
      schemaVersion: 3,
    })
  })

  it("queues message playback when no event type is provided", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 3,
      },
    }).deps)
    const playRequested = vi.fn()
    service.events.on("playRequested", playRequested)

    await expect(service.play({})).resolves.toEqual({
      played: true,
      eventType: "message",
      presetId: "soft-chime",
      repeatCount: 1,
      intervalMs: 1000,
    })

    expect(playRequested).toHaveBeenCalledWith({
      eventType: "message",
      presetId: "soft-chime",
      repeatCount: 1,
      intervalMs: 1000,
    })
  })

  it("queues playback by semantic event type", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 3,
      },
    }).deps)
    const playRequested = vi.fn()
    service.events.on("playRequested", playRequested)

    await expect(service.play({
      eventType: "input-required",
      repeatCount: 3,
      intervalMs: 1500,
    })).resolves.toEqual({
      played: true,
      eventType: "input-required",
      presetId: "attention",
      repeatCount: 3,
      intervalMs: 1500,
    })

    expect(playRequested).toHaveBeenCalledWith({
      eventType: "input-required",
      presetId: "attention",
      repeatCount: 3,
      intervalMs: 1500,
    })
  })

  it("keeps legacy preset id playback compatible", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 3,
      },
    }).deps)

    await expect(service.play({ presetId: "done" })).resolves.toEqual({
      played: true,
      eventType: "success",
      presetId: "done",
      repeatCount: 1,
      intervalMs: 1000,
    })
  })

  it("rejects playback requests that mix event type and preset id", async () => {
    const service = createSoundNotifierService(createHarness().deps)

    await expect(service.play({ eventType: "success", presetId: "done" }))
      .rejects.toThrow()
  })

  it("rejects repeat options outside the supported range", async () => {
    const service = createSoundNotifierService(createHarness().deps)

    await expect(service.play({ repeatCount: 0 })).rejects.toThrow()
    await expect(service.play({ repeatCount: 11 })).rejects.toThrow()
    await expect(service.play({ intervalMs: 99 })).rejects.toThrow()
    await expect(service.play({ intervalMs: 60001 })).rejects.toThrow()
  })

  it("previews a preset", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 3,
      },
    }).deps)
    const playRequested = vi.fn()
    service.events.on("playRequested", playRequested)

    await expect(service.preview({
      eventType: "long-running-complete",
      repeatCount: 2,
      intervalMs: 2500,
    })).resolves.toEqual({
      played: true,
      eventType: "long-running-complete",
      presetId: "long-done",
      repeatCount: 2,
      intervalMs: 2500,
    })

    expect(playRequested).toHaveBeenCalledWith({
      eventType: "long-running-complete",
      presetId: "long-done",
      repeatCount: 2,
      intervalMs: 2500,
    })
  })
})

type HarnessOptions = {
  readonly singleton?: SoundNotifierSettingsEntryV3 | null
}

function createHarness(options: HarnessOptions = {}) {
  const settings = createMemoryNamespace<SoundNotifierSettingsEntryV3>({
    singleton: options.singleton ?? null,
  })

  return {
    settings,
    deps: {
      settings,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function createMemoryNamespace<T extends Record<string, unknown>>(options: {
  readonly singleton?: T | null
} = {}) {
  const events = new EventEmitter()
  let singleton = options.singleton ?? null
  const namespace: DataNamespace<T> = {
    name: "memory",
    schemaVersion: 1,
    backend: "json",
    async getSingleton() { return singleton },
    async setSingleton(value) { singleton = value },
    async clearSingleton() { singleton = null },
    async list() { return [] },
    async count() { return 0 },
    async get() { return null },
    async upsert() {},
    async remove() {},
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
  return namespace
}
