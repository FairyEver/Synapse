import { useEffect } from "react"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { getSynapseBridge } from "../../../src/lib/electron-bridge"
import { playSoundNotifierPreset } from "./player"

const logger = createRendererLogger("sound-notifier.host")

export function SoundNotifierHost() {
  useEffect(() => {
    const bridge = getSynapseBridge()
    if (!bridge?.soundNotifier) return undefined

    return bridge.soundNotifier.onPlayRequested((event) => {
      try {
        playSoundNotifierPreset(event)
      } catch (error) {
        logger.error("Failed to play sound notifier.", error)
      }
    })
  }, [])

  return null
}
