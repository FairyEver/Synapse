import { z } from "zod"
import {
  SOUND_NOTIFIER_DEFAULT_PRESET_ID,
  SOUND_NOTIFIER_DEFAULT_VOLUME,
  SOUND_NOTIFIER_PRESET_IDS,
  SOUND_NOTIFIER_PRESETS,
} from "./defaults"

export const soundNotifierPresetIdSchema = z.enum(SOUND_NOTIFIER_PRESET_IDS)

const soundNotifierVolumeSchema = z.number().int().min(0).max(100)

export const soundNotifierToneEventSchema = z.object({
  frequency: z.number().positive(),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().positive(),
  gain: z.number().min(0).max(1),
})

export const soundNotifierPresetSchema = z.object({
  id: soundNotifierPresetIdSchema,
  name: z.string().min(1),
  events: z.array(soundNotifierToneEventSchema).min(1),
})

export const soundNotifierSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  selectedPresetId: soundNotifierPresetIdSchema,
  volume: soundNotifierVolumeSchema,
})

export const soundNotifierSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  selectedPresetId: soundNotifierPresetIdSchema.optional(),
  volume: soundNotifierVolumeSchema.optional(),
})

export const soundNotifierPlayInputSchema = z.object({
  presetId: soundNotifierPresetIdSchema.optional(),
  volume: soundNotifierVolumeSchema.optional(),
})

export const soundNotifierPlayResultSchema = z.object({
  played: z.boolean(),
  presetId: soundNotifierPresetIdSchema,
  volume: soundNotifierVolumeSchema,
  reason: z.literal("disabled").optional(),
})

export const soundNotifierChangedEventSchema = z.object({
  settings: soundNotifierSettingsSchema,
})

export const soundNotifierPlayRequestedEventSchema = z.object({
  presetId: soundNotifierPresetIdSchema,
  volume: soundNotifierVolumeSchema,
})

export const soundNotifierPresetListSchema = z.array(soundNotifierPresetSchema)

export const defaultSoundNotifierSettings = {
  schemaVersion: 1,
  enabled: true,
  selectedPresetId: SOUND_NOTIFIER_DEFAULT_PRESET_ID,
  volume: SOUND_NOTIFIER_DEFAULT_VOLUME,
} as const satisfies SoundNotifierSettings

export const soundNotifierPresets = SOUND_NOTIFIER_PRESETS

export type SoundNotifierSettings = z.infer<typeof soundNotifierSettingsSchema>
export type SoundNotifierSettingsPatch = z.infer<typeof soundNotifierSettingsPatchSchema>
export type SoundNotifierPlayInput = z.infer<typeof soundNotifierPlayInputSchema>
export type SoundNotifierPlayResult = z.infer<typeof soundNotifierPlayResultSchema>
export type SoundNotifierChangedEvent = z.infer<typeof soundNotifierChangedEventSchema>
export type SoundNotifierPlayRequestedEvent = z.infer<typeof soundNotifierPlayRequestedEventSchema>
