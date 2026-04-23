import type { WebContents } from "electron"

function sendToRenderer<T>(sender: WebContents, channel: string, payload: T): void {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload)
  }
}

export { sendToRenderer }
