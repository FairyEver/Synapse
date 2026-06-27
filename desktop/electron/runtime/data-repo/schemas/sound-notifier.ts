import {
  type SoundNotifierSettings,
  defaultSoundNotifierSettings,
  soundNotifierSettingsSchema,
} from "../../../../app-capabilities/sound-notifier/shared/schema"
import type { Migration, NamespaceSchema } from "../types"

export interface SoundNotifierSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  enabled: boolean
  selectedPresetId: SoundNotifierSettings["selectedPresetId"]
  volume: number
}

const noMigrations: readonly Migration[] = []

export const soundNotifierSettingsSchemaDefinition: NamespaceSchema<SoundNotifierSettingsEntryV1> = {
  name: "app.sound-notifier.settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isSoundNotifierSettingsEntryV1,
  encrypted: false,
  defaults: () => defaultSoundNotifierSettings,
}

function isSoundNotifierSettingsEntryV1(value: unknown): value is SoundNotifierSettingsEntryV1 {
  return soundNotifierSettingsSchema.safeParse(value).success
}
