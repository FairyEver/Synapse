import { getSynapseBridge } from "@/lib/electron-bridge"

export function installHeartbeatResponder(): () => void {
  const bridge = getSynapseBridge()
  if (!bridge?.diagnostics) {
    return () => {}
  }

  const unsubscribe = bridge.diagnostics.onPing(() => {
    bridge.diagnostics!.pong()
  })

  return unsubscribe
}
