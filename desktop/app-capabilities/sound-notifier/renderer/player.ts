import {
  SOUND_NOTIFIER_PRESETS,
  type SoundNotifierPreset,
  type SoundNotifierPresetId,
} from "../shared/defaults"

type AudioContextConstructor = typeof AudioContext

let audioContext: AudioContext | null = null

export function playSoundNotifierPreset(input: {
  readonly presetId: SoundNotifierPresetId
  readonly repeatCount: number
  readonly intervalMs: number
}): void {
  const preset = SOUND_NOTIFIER_PRESETS.find((item) => item.id === input.presetId)
  if (!preset) return

  const context = getAudioContext()
  if (!context) return

  if (context.state === "suspended") {
    void context.resume()
  }

  for (let index = 0; index < input.repeatCount; index += 1) {
    playPreset(context, preset, index * input.intervalMs / 1000)
  }
}

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext

  const AudioContextClass = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  if (!AudioContextClass) return null

  audioContext = new AudioContextClass()
  return audioContext
}

function playPreset(context: AudioContext, preset: SoundNotifierPreset, offsetSeconds: number): void {
  const masterGain = context.createGain()
  masterGain.gain.setValueAtTime(1, context.currentTime + offsetSeconds)
  masterGain.connect(context.destination)

  for (const event of preset.events) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime + offsetSeconds + event.startMs / 1000
    const end = start + event.durationMs / 1000
    const targetGain = Math.max(0.0001, event.gain)

    oscillator.type = "sine"
    oscillator.frequency.setValueAtTime(event.frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(targetGain, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(gain)
    gain.connect(masterGain)
    oscillator.start(start)
    oscillator.stop(end + 0.03)
  }
}
