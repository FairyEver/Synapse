export const SOUND_NOTIFIER_EVENT_TYPES = [
  "message",
  "input-required",
  "success",
  "long-running-complete",
  "error",
] as const

export const SOUND_NOTIFIER_PRESETS = [
  {
    id: "soft-chime",
    eventType: "message",
    name: "普通消息",
    description: "普通消息或进度提示。",
    events: [
      { frequency: 880, startMs: 0, durationMs: 120, gain: 0.58 },
      { frequency: 1175, startMs: 130, durationMs: 150, gain: 0.48 },
    ],
  },
  {
    id: "attention",
    eventType: "input-required",
    name: "需要输入",
    description: "需要用户输入、授权或确认。",
    events: [
      { frequency: 784, startMs: 0, durationMs: 110, gain: 0.58 },
      { frequency: 784, startMs: 190, durationMs: 110, gain: 0.58 },
    ],
  },
  {
    id: "done",
    eventType: "success",
    name: "任务完成",
    description: "普通任务完成，可以回来看结果。",
    events: [
      { frequency: 660, startMs: 0, durationMs: 90, gain: 0.55 },
      { frequency: 880, startMs: 90, durationMs: 130, gain: 0.5 },
      { frequency: 1320, startMs: 220, durationMs: 160, gain: 0.42 },
    ],
  },
  {
    id: "long-done",
    eventType: "long-running-complete",
    name: "长任务完成",
    description: "构建、测试、安装等长任务完成。",
    events: [
      { frequency: 523, startMs: 0, durationMs: 100, gain: 0.48 },
      { frequency: 659, startMs: 100, durationMs: 100, gain: 0.48 },
      { frequency: 784, startMs: 200, durationMs: 110, gain: 0.46 },
      { frequency: 1047, startMs: 340, durationMs: 180, gain: 0.38 },
    ],
  },
  {
    id: "error",
    eventType: "error",
    name: "错误提醒",
    description: "失败、阻塞或需要处理。",
    events: [
      { frequency: 392, startMs: 0, durationMs: 95, gain: 0.44 },
      { frequency: 349, startMs: 120, durationMs: 130, gain: 0.4 },
    ],
  },
] as const

export const SOUND_NOTIFIER_PRESET_IDS = SOUND_NOTIFIER_PRESETS.map((preset) => preset.id) as [
  "soft-chime",
  "attention",
  "done",
  "long-done",
  "error",
]

export const SOUND_NOTIFIER_DEFAULT_EVENT_TYPE = "message" as const
export const SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT = 1
export const SOUND_NOTIFIER_DEFAULT_INTERVAL_MS = 1000
export const SOUND_NOTIFIER_MIN_REPEAT_COUNT = 1
export const SOUND_NOTIFIER_MAX_REPEAT_COUNT = 10
export const SOUND_NOTIFIER_MIN_INTERVAL_MS = 100
export const SOUND_NOTIFIER_MAX_INTERVAL_MS = 60000

export type SoundNotifierPreset = typeof SOUND_NOTIFIER_PRESETS[number]
export type SoundNotifierPresetId = typeof SOUND_NOTIFIER_PRESET_IDS[number]
export type SoundNotifierEventType = typeof SOUND_NOTIFIER_EVENT_TYPES[number]

export function isSoundNotifierPresetId(value: string): value is SoundNotifierPresetId {
  return (SOUND_NOTIFIER_PRESET_IDS as readonly string[]).includes(value)
}

export function getSoundNotifierPresetByEventType(eventType: SoundNotifierEventType): SoundNotifierPreset {
  return SOUND_NOTIFIER_PRESETS.find((preset) => preset.eventType === eventType)
    ?? SOUND_NOTIFIER_PRESETS[0]
}

export function getSoundNotifierPresetById(presetId: SoundNotifierPresetId): SoundNotifierPreset {
  return SOUND_NOTIFIER_PRESETS.find((preset) => preset.id === presetId)
    ?? SOUND_NOTIFIER_PRESETS[0]
}
