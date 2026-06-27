import { z } from "zod"
import {
  SOUND_NOTIFIER_DEFAULT_EVENT_TYPE,
  SOUND_NOTIFIER_DEFAULT_INTERVAL_MS,
  SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT,
  SOUND_NOTIFIER_EVENT_TYPES,
  SOUND_NOTIFIER_MAX_INTERVAL_MS,
  SOUND_NOTIFIER_MAX_REPEAT_COUNT,
  SOUND_NOTIFIER_MIN_INTERVAL_MS,
  SOUND_NOTIFIER_MIN_REPEAT_COUNT,
  SOUND_NOTIFIER_PRESET_IDS,
  SOUND_NOTIFIER_PRESETS,
} from "./defaults"

export const soundNotifierEventTypeSchema = z.enum(SOUND_NOTIFIER_EVENT_TYPES)
export const soundNotifierPresetIdSchema = z.enum(SOUND_NOTIFIER_PRESET_IDS)

const soundNotifierRepeatCountSchema = z.number().int()
  .min(SOUND_NOTIFIER_MIN_REPEAT_COUNT)
  .max(SOUND_NOTIFIER_MAX_REPEAT_COUNT)
const soundNotifierIntervalMsSchema = z.number().int()
  .min(SOUND_NOTIFIER_MIN_INTERVAL_MS)
  .max(SOUND_NOTIFIER_MAX_INTERVAL_MS)

export const soundNotifierToneEventSchema = z.object({
  frequency: z.number().positive(),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().positive(),
  gain: z.number().min(0).max(1),
})

export const soundNotifierPresetSchema = z.object({
  id: soundNotifierPresetIdSchema,
  eventType: soundNotifierEventTypeSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  events: z.array(soundNotifierToneEventSchema).min(1),
})

export const soundNotifierSettingsSchema = z.object({
  schemaVersion: z.literal(3),
}).strict()

export const soundNotifierSettingsPatchSchema = z.object({}).strict()

export const soundNotifierPlayInputSchema = z.object({
  eventType: soundNotifierEventTypeSchema.optional(),
  presetId: soundNotifierPresetIdSchema.optional(),
  repeatCount: soundNotifierRepeatCountSchema.default(SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT),
  intervalMs: soundNotifierIntervalMsSchema.default(SOUND_NOTIFIER_DEFAULT_INTERVAL_MS),
}).strict().refine((input) => !(input.eventType && input.presetId), {
  message: "eventType and presetId cannot be used together.",
  path: ["presetId"],
})

export const soundNotifierPlayResultSchema = z.object({
  played: z.boolean(),
  eventType: soundNotifierEventTypeSchema,
  presetId: soundNotifierPresetIdSchema,
  repeatCount: soundNotifierRepeatCountSchema,
  intervalMs: soundNotifierIntervalMsSchema,
})

export const soundNotifierChangedEventSchema = z.object({
  settings: soundNotifierSettingsSchema,
})

export const soundNotifierPlayRequestedEventSchema = z.object({
  eventType: soundNotifierEventTypeSchema,
  presetId: soundNotifierPresetIdSchema,
  repeatCount: soundNotifierRepeatCountSchema,
  intervalMs: soundNotifierIntervalMsSchema,
})

export const soundNotifierPresetListSchema = z.array(soundNotifierPresetSchema)

export const defaultSoundNotifierSettings = {
  schemaVersion: 3,
} as const satisfies SoundNotifierSettings

export const defaultSoundNotifierEventType = SOUND_NOTIFIER_DEFAULT_EVENT_TYPE
export const soundNotifierPresets = SOUND_NOTIFIER_PRESETS

export type SoundNotifierEventType = z.infer<typeof soundNotifierEventTypeSchema>
export type SoundNotifierSettings = z.infer<typeof soundNotifierSettingsSchema>
export type SoundNotifierSettingsPatch = z.infer<typeof soundNotifierSettingsPatchSchema>
export type SoundNotifierPlayInput = z.input<typeof soundNotifierPlayInputSchema>
export type SoundNotifierPlayResult = z.infer<typeof soundNotifierPlayResultSchema>
export type SoundNotifierChangedEvent = z.infer<typeof soundNotifierChangedEventSchema>
export type SoundNotifierPlayRequestedEvent = z.infer<typeof soundNotifierPlayRequestedEventSchema>
