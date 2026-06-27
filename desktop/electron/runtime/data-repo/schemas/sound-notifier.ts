import type { SoundNotifierPresetId } from "../../../../app-capabilities/sound-notifier/shared/defaults"
import {
  defaultSoundNotifierSettings,
  soundNotifierSettingsSchema,
} from "../../../../app-capabilities/sound-notifier/shared/schema"
import type { JsonFileEnvelope } from "../backends/json"
import { isEnvelopeShape } from "../envelope"
import { migration } from "../migrations"
import type { Migration, NamespaceSchema } from "../types"

export interface SoundNotifierSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  enabled?: boolean
  selectedPresetId: SoundNotifierPresetId
  volume: number
}

export interface SoundNotifierSettingsEntryV2 extends Record<string, unknown> {
  schemaVersion: 2
  volume: number
}

export interface SoundNotifierSettingsEntryV3 extends Record<string, unknown> {
  schemaVersion: 3
}

const soundNotifierSettingsMigrations: readonly Migration[] = [
  migration<SoundNotifierSettingsEntryV1, SoundNotifierSettingsEntryV2>(
    1,
    2,
    migrateSoundNotifierSettingsEntryV1ToV2,
  ),
  migration<SoundNotifierSettingsEntryV2, SoundNotifierSettingsEntryV3>(
    2,
    3,
    migrateSoundNotifierSettingsEntryV2ToV3,
  ),
]

export const soundNotifierSettingsSchemaDefinition: NamespaceSchema<SoundNotifierSettingsEntryV3> = {
  name: "app.sound-notifier.settings",
  backend: "json",
  currentVersion: 3,
  migrations: soundNotifierSettingsMigrations,
  validate: isSoundNotifierSettingsEntryV3,
  encrypted: false,
  defaults: () => defaultSoundNotifierSettings,
}

function isSoundNotifierSettingsEntryV3(value: unknown): value is SoundNotifierSettingsEntryV3 {
  return soundNotifierSettingsSchema.safeParse(value).success
}

export function reviveSoundNotifierSettingsEnvelope(raw: unknown): JsonFileEnvelope<SoundNotifierSettingsEntryV3> | null {
  if (!isEnvelopeShape<Record<string, unknown>>(raw)) return null
  if (raw.schemaVersion === 3) return raw as JsonFileEnvelope<SoundNotifierSettingsEntryV3>

  if (raw.schemaVersion === 2) {
    const singleton = raw.singleton
    if (singleton !== null && !isSoundNotifierSettingsEntryV2(singleton)) return null
    return {
      schemaVersion: 3,
      singleton: singleton ? migrateSoundNotifierSettingsEntryV2ToV3(singleton) : null,
      items: {},
    }
  }

  if (raw.schemaVersion === 1) {
    const singleton = raw.singleton
    if (singleton !== null && !isSoundNotifierSettingsEntryV1(singleton)) return null
    return {
      schemaVersion: 3,
      singleton: singleton
        ? migrateSoundNotifierSettingsEntryV2ToV3(migrateSoundNotifierSettingsEntryV1ToV2(singleton))
        : null,
      items: {},
    }
  }

  return null
}

function isSoundNotifierSettingsEntryV1(value: unknown): value is SoundNotifierSettingsEntryV1 {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && typeof record.selectedPresetId === "string"
    && typeof record.volume === "number"
}

function isSoundNotifierSettingsEntryV2(value: unknown): value is SoundNotifierSettingsEntryV2 {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 2
    && typeof record.volume === "number"
}

function migrateSoundNotifierSettingsEntryV1ToV2(data: SoundNotifierSettingsEntryV1): SoundNotifierSettingsEntryV2 {
  return {
    schemaVersion: 2,
    volume: Number.isInteger(data.volume) && data.volume >= 0 && data.volume <= 100
      ? data.volume
      : 70,
  }
}

function migrateSoundNotifierSettingsEntryV2ToV3(_data: SoundNotifierSettingsEntryV2): SoundNotifierSettingsEntryV3 {
  return {
    schemaVersion: 3,
  }
}
