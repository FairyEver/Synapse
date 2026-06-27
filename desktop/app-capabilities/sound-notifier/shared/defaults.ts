export const SOUND_NOTIFIER_PRESETS = [
  {
    id: "soft-chime",
    name: "Soft Chime",
    events: [
      { frequency: 880, startMs: 0, durationMs: 120, gain: 0.58 },
      { frequency: 1175, startMs: 130, durationMs: 150, gain: 0.48 },
    ],
  },
  {
    id: "done",
    name: "Done",
    events: [
      { frequency: 660, startMs: 0, durationMs: 90, gain: 0.55 },
      { frequency: 880, startMs: 90, durationMs: 130, gain: 0.5 },
      { frequency: 1320, startMs: 220, durationMs: 160, gain: 0.42 },
    ],
  },
  {
    id: "attention",
    name: "Attention",
    events: [
      { frequency: 784, startMs: 0, durationMs: 110, gain: 0.58 },
      { frequency: 784, startMs: 190, durationMs: 110, gain: 0.58 },
    ],
  },
  {
    id: "error",
    name: "Error",
    events: [
      { frequency: 440, startMs: 0, durationMs: 140, gain: 0.52 },
      { frequency: 330, startMs: 150, durationMs: 190, gain: 0.5 },
    ],
  },
  {
    id: "long-done",
    name: "Long Done",
    events: [
      { frequency: 523, startMs: 0, durationMs: 100, gain: 0.48 },
      { frequency: 659, startMs: 100, durationMs: 100, gain: 0.48 },
      { frequency: 784, startMs: 200, durationMs: 110, gain: 0.46 },
      { frequency: 1047, startMs: 340, durationMs: 180, gain: 0.38 },
    ],
  },
] as const

export const SOUND_NOTIFIER_PRESET_IDS = SOUND_NOTIFIER_PRESETS.map((preset) => preset.id) as [
  "soft-chime",
  "done",
  "attention",
  "error",
  "long-done",
]

export const SOUND_NOTIFIER_DEFAULT_PRESET_ID = "soft-chime" as const
export const SOUND_NOTIFIER_DEFAULT_VOLUME = 70

export type SoundNotifierPreset = typeof SOUND_NOTIFIER_PRESETS[number]
export type SoundNotifierPresetId = typeof SOUND_NOTIFIER_PRESET_IDS[number]

export function isSoundNotifierPresetId(value: string): value is SoundNotifierPresetId {
  return (SOUND_NOTIFIER_PRESET_IDS as readonly string[]).includes(value)
}
