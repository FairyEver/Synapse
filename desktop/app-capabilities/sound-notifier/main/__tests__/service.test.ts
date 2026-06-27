import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { SoundNotifierSettingsEntryV1 } from "../../../../electron/runtime/data-repo/schemas/sound-notifier"
import { SOUND_NOTIFIER_DEFAULT_PRESET_ID } from "../../shared/defaults"
import { createSoundNotifierService } from "../service"

describe("SoundNotifierService", () => {
  it("loads default settings when the store is empty", async () => {
    const service = createSoundNotifierService(createHarness().deps)

    await expect(service.getSettings()).resolves.toEqual({
      schemaVersion: 1,
      enabled: true,
      selectedPresetId: SOUND_NOTIFIER_DEFAULT_PRESET_ID,
      volume: 70,
    })
  })

  it("updates settings and emits a changed event", async () => {
    const harness = createHarness()
    const service = createSoundNotifierService(harness.deps)
    const changed = vi.fn()
    service.events.on("changed", changed)

    await service.updateSettings({
      enabled: false,
      selectedPresetId: "done",
      volume: 35,
    })

    expect(await service.getSettings()).toMatchObject({
      enabled: false,
      selectedPresetId: "done",
      volume: 35,
    })
    expect(changed).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        enabled: false,
        selectedPresetId: "done",
        volume: 35,
      }),
    })
  })

  it("queues the selected preset for MCP playback", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 1,
        enabled: true,
        selectedPresetId: "attention",
        volume: 45,
      },
    }).deps)
    const playRequested = vi.fn()
    service.events.on("playRequested", playRequested)

    await expect(service.play({})).resolves.toEqual({
      played: true,
      presetId: "attention",
      volume: 45,
    })

    expect(playRequested).toHaveBeenCalledWith({
      presetId: "attention",
      volume: 45,
    })
  })

  it("does not queue MCP playback when disabled", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 1,
        enabled: false,
        selectedPresetId: "done",
        volume: 60,
      },
    }).deps)
    const playRequested = vi.fn()
    service.events.on("playRequested", playRequested)

    await expect(service.play({ presetId: "done" })).resolves.toEqual({
      played: false,
      presetId: "done",
      volume: 60,
      reason: "disabled",
    })

    expect(playRequested).not.toHaveBeenCalled()
  })

  it("previews a preset even when MCP playback is disabled", async () => {
    const service = createSoundNotifierService(createHarness({
      singleton: {
        schemaVersion: 1,
        enabled: false,
        selectedPresetId: "done",
        volume: 20,
      },
    }).deps)
    const playRequested = vi.fn()
    service.events.on("playRequested", playRequested)

    await expect(service.preview({ presetId: "soft-chime", volume: 80 })).resolves.toEqual({
      played: true,
      presetId: "soft-chime",
      volume: 80,
    })

    expect(playRequested).toHaveBeenCalledWith({
      presetId: "soft-chime",
      volume: 80,
    })
  })
})

type HarnessOptions = {
  readonly singleton?: SoundNotifierSettingsEntryV1 | null
}

function createHarness(options: HarnessOptions = {}) {
  const settings = createMemoryNamespace<SoundNotifierSettingsEntryV1>({
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
