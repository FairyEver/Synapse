import { EventEmitter } from "node:events"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { SoundNotifierSettingsEntryV3 } from "../../../electron/runtime/data-repo/schemas/sound-notifier"
import {
  getSoundNotifierPresetByEventType,
  getSoundNotifierPresetById,
  type SoundNotifierEventType,
  type SoundNotifierPresetId,
} from "../shared/defaults"
import {
  defaultSoundNotifierSettings,
  defaultSoundNotifierEventType,
  soundNotifierPlayInputSchema,
  soundNotifierSettingsSchema,
  soundNotifierSettingsPatchSchema,
  type SoundNotifierPlayInput,
  type SoundNotifierPlayResult,
  type SoundNotifierSettings,
  type SoundNotifierSettingsPatch,
} from "../shared/schema"

type SoundNotifierLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type SoundNotifierServiceDeps = {
  readonly settings: DataNamespace<SoundNotifierSettingsEntryV3>
  readonly logger: SoundNotifierLogger
}

type SoundNotifierServiceEvents = {
  changed: [payload: { settings: SoundNotifierSettings }]
  playRequested: [payload: {
    eventType: SoundNotifierEventType
    presetId: SoundNotifierPresetId
    repeatCount: number
    intervalMs: number
  }]
}

class TypedSoundNotifierEventEmitter extends EventEmitter {
  override on<K extends keyof SoundNotifierServiceEvents>(
    eventName: K,
    listener: (...args: SoundNotifierServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof SoundNotifierServiceEvents>(
    eventName: K,
    ...args: SoundNotifierServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

export function createSoundNotifierService(deps: SoundNotifierServiceDeps) {
  const events = new TypedSoundNotifierEventEmitter()

  async function getSettings(): Promise<SoundNotifierSettings> {
    const stored = await deps.settings.getSingleton()
    return stored ? soundNotifierSettingsSchema.parse(stored) : defaultSoundNotifierSettings
  }

  async function updateSettings(input: SoundNotifierSettingsPatch): Promise<SoundNotifierSettings> {
    const patch = soundNotifierSettingsPatchSchema.parse(input)
    const nextSettings = {
      ...await getSettings(),
      ...patch,
    }

    await deps.settings.setSingleton(nextSettings)
    events.emit("changed", { settings: nextSettings })
    return nextSettings
  }

  async function play(input: SoundNotifierPlayInput): Promise<SoundNotifierPlayResult> {
    const playback = resolvePlayback(input)

    emitPlayRequested(playback)
    return { played: true, ...playback }
  }

  async function preview(input: SoundNotifierPlayInput): Promise<SoundNotifierPlayResult> {
    const playback = resolvePlayback(input)

    emitPlayRequested(playback)
    return { played: true, ...playback }
  }

  function resolvePlayback(input: SoundNotifierPlayInput): {
    eventType: SoundNotifierEventType
    presetId: SoundNotifierPresetId
    repeatCount: number
    intervalMs: number
  } {
    const parsed = soundNotifierPlayInputSchema.parse(input)
    const preset = parsed.presetId
      ? getSoundNotifierPresetById(parsed.presetId)
      : getSoundNotifierPresetByEventType(parsed.eventType ?? defaultSoundNotifierEventType)
    return {
      eventType: preset.eventType,
      presetId: preset.id,
      repeatCount: parsed.repeatCount,
      intervalMs: parsed.intervalMs,
    }
  }

  function emitPlayRequested(payload: {
    eventType: SoundNotifierEventType
    presetId: SoundNotifierPresetId
    repeatCount: number
    intervalMs: number
  }): void {
    events.emit("playRequested", payload)
  }

  return {
    events,
    getSettings,
    updateSettings,
    play,
    preview,
  }
}

export type SoundNotifierService = ReturnType<typeof createSoundNotifierService>
