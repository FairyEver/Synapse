import { createRendererLogger } from "@/app-shell/logging"
import deal from "../assets/audio/card-slide-4.ogg?url"
import card from "../assets/audio/card-place-2.ogg?url"
import fold from "../assets/audio/card-shove-4.ogg?url"
import tap from "../assets/audio/chip-lay-1.ogg?url"
import coin1 from "../assets/audio/chips-collide-1.ogg?url"
import coin2 from "../assets/audio/chips-collide-2.ogg?url"
import collect from "../assets/audio/chips-stack-1.ogg?url"
import type { PokerSound, PokerSoundCue } from "./poker-sounds"

const assets: Record<PokerSound, string> = { deal, card, fold, tap, coin1, coin2, collect, turn: tap }
const logger = createRendererLogger("game.poker.audio")

/** Room-scoped, gesture-activated audio. Unready cues are dropped, never replayed. */
export function createPokerAudio() {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let loading: Promise<void> | null = null
  let disposed = false
  const abort = new AbortController()
  const buffers = new Map<string, AudioBuffer>()
  const sources = new Map<AudioBufferSourceNode, GainNode>()

  function stop() {
    for (const [source, gain] of sources) {
      source.onended = null
      try { source.stop() } catch (error) { logger.warn("Unable to stop poker sound", { error }) }
      source.disconnect()
      gain.disconnect()
    }
    sources.clear()
  }

  async function activate() {
    if (disposed || typeof AudioContext === "undefined") return
    try {
      if (!context) {
        context = new AudioContext()
        master = context.createGain()
        // Quiet fixed gain: wager size changes contact count and pace, not volume.
        master.gain.value = 0.35
        master.connect(context.destination)
      }
      const current = context
      if (current.state === "suspended") await current.resume()
      if (disposed) return
      loading ??= Promise.all([...new Set(Object.values(assets))].map(async url => {
        try {
          const response = await fetch(url, { signal: abort.signal })
          if (!response.ok) throw new Error(`Poker sound asset returned ${response.status}`)
          const buffer = await current.decodeAudioData(await response.arrayBuffer())
          if (!disposed) buffers.set(url, buffer)
        } catch (error) {
          if (!abort.signal.aborted) logger.warn("Unable to load bundled poker sound", { error })
        }
      })).then(() => undefined)
      await loading
    } catch (error) {
      if (!disposed && !(error instanceof DOMException && error.name === "NotAllowedError")) {
        logger.warn("Unable to activate poker audio", { error })
      }
    }
  }

  function play(cues: PokerSoundCue[]) {
    stop()
    if (disposed || !context || context.state !== "running" || !master) return
    try {
      for (const cue of cues.slice(0, 40)) {
        const buffer = buffers.get(assets[cue.sound])
        if (!buffer) continue
        const source = context.createBufferSource(), gain = context.createGain()
        source.buffer = buffer
        gain.gain.value = Math.min(0.5, Math.max(0, cue.volume))
        source.connect(gain)
        gain.connect(master)
        sources.set(source, gain)
        source.onended = () => {
          sources.delete(source)
          source.disconnect()
          gain.disconnect()
        }
        try {
          source.start(context.currentTime + cue.delay / 1000)
        } catch (error) {
          sources.delete(source)
          source.disconnect()
          gain.disconnect()
          logger.warn("Unable to play poker sound", { error })
        }
      }
    } catch (error) {
      stop()
      logger.warn("Poker audio device is unavailable", { error })
    }
  }

  async function dispose() {
    disposed = true
    abort.abort()
    stop()
    buffers.clear()
    master?.disconnect()
    try { await context?.close() } catch (error) { logger.warn("Unable to close poker audio", { error }) }
  }
  return { activate, play, stop, dispose }
}
