import { EventEmitter } from "node:events"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { SoundNotifierSettingsEntryV1 } from "../../../electron/runtime/data-repo/schemas/sound-notifier"
import {
  defaultSoundNotifierSettings,
  soundNotifierPlayInputSchema,
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
  readonly settings: DataNamespace<SoundNotifierSettingsEntryV1>
  readonly logger: SoundNotifierLogger
}

type SoundNotifierServiceEvents = {
  changed: [payload: { settings: SoundNotifierSettings }]
  playRequested: [payload: { presetId: SoundNotifierSettings["selectedPresetId"]; volume: number }]
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
    return await deps.settings.getSingleton() ?? defaultSoundNotifierSettings
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
    const parsed = soundNotifierPlayInputSchema.parse(input)
    const settings = await getSettings()
    const presetId = parsed.presetId ?? settings.selectedPresetId
    const volume = parsed.volume ?? settings.volume

    if (!settings.enabled) {
      return { played: false, presetId, volume, reason: "disabled" }
    }

    emitPlayRequested(presetId, volume)
    return { played: true, presetId, volume }
  }

  async function preview(input: SoundNotifierPlayInput): Promise<SoundNotifierPlayResult> {
    const parsed = soundNotifierPlayInputSchema.parse(input)
    const settings = await getSettings()
    const presetId = parsed.presetId ?? settings.selectedPresetId
    const volume = parsed.volume ?? settings.volume

    emitPlayRequested(presetId, volume)
    return { played: true, presetId, volume }
  }

  function emitPlayRequested(
    presetId: SoundNotifierSettings["selectedPresetId"],
    volume: number,
  ): void {
    events.emit("playRequested", { presetId, volume })
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
