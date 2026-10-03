import { randomUUID } from "node:crypto"
import { createLiveEnvelope, LIVE_MESSAGE_TYPES, MOBILE_WORKSPACE_FILES_LIMITS as LIMITS, type LiveMobileServerMessage } from "@synapse/shared"

type Socket = { readonly readyState: number; readonly bufferedAmount?: number; send(payload: string): void }
type Queued = { readonly text: string; readonly bytes: number; readonly expiresAt: number; readonly message: LiveMobileServerMessage }
type Queue = { readonly items: Queued[]; bytes: number; timer: NodeJS.Timeout | null }
/** A bounded queue for reliable file replies; normal terminal traffic bypasses it. */
export class WorkspaceFilesSendQueue {
  private readonly queues = new Map<Socket, Queue>()
  send(socket: Socket, message: LiveMobileServerMessage): "sent" | "queued" | "offline" | "send_failed" | "backpressure" {
    if (socket.readyState !== 1) return "offline"
    const text = JSON.stringify(message)
    const bytes = Buffer.byteLength(text, "utf8")
    if (bytes > LIMITS.maxEnvelopeBytes) return "backpressure"
    const queue = this.queues.get(socket)
    const control = isControl(message)
    if ((control || !queue?.items.length) && this.fits(socket, bytes)) return this.write(socket, text) ? "sent" : "send_failed"
    const state = queue ?? { items: [], bytes: 0, timer: null }
    while (control && (state.items.length >= LIMITS.maxQueuedPages || state.bytes + bytes > LIMITS.maxQueuedBytes)) {
      let index = state.items.length - 1
      while (index >= 0 && isControl(state.items[index]!.message)) index--
      if (index < 0) break
      const [displaced] = state.items.splice(index, 1)
      state.bytes -= displaced!.bytes
      this.failure(socket, displaced!.message)
    }
    if (state.items.length >= LIMITS.maxQueuedPages || state.bytes + bytes > LIMITS.maxQueuedBytes) {
      this.failure(socket, message)
      return "backpressure"
    }
    const item = { text, bytes, expiresAt: Date.now() + LIMITS.sendQueueTtlMs, message }
    if (control) state.items.unshift(item); else state.items.push(item)
    state.bytes += bytes
    this.queues.set(socket, state)
    this.schedule(socket, state)
    return "queued"
  }
  remove(socket: Socket): void {
    const state = this.queues.get(socket)
    if (state?.timer) clearTimeout(state.timer)
    this.queues.delete(socket)
  }
  dispose(): void { for (const socket of this.queues.keys()) this.remove(socket) }
  private schedule(socket: Socket, state: Queue): void {
    if (state.timer) return
    state.timer = setTimeout(() => { state.timer = null; this.drain(socket, state) }, 25)
    state.timer.unref?.()
  }
  private drain(socket: Socket, state: Queue): void {
    if (socket.readyState !== 1) { this.remove(socket); return }
    while (state.items.length) {
      const first = state.items[0]!
      if (first.expiresAt <= Date.now()) {
        state.items.shift(); state.bytes -= first.bytes
        this.failure(socket, first.message)
        continue
      }
      if (!this.fits(socket, first.bytes)) break
      state.items.shift(); state.bytes -= first.bytes
      if (!this.write(socket, first.text)) { this.remove(socket); return }
    }
    if (state.items.length) this.schedule(socket, state); else this.remove(socket)
  }
  private fits(socket: Socket, bytes: number): boolean { return (socket.bufferedAmount ?? 0) + bytes <= LIMITS.maxSocketBufferedBytes }
  private write(socket: Socket, text: string): boolean {
    try { socket.send(text); return true } catch { return false }
  }
  private failure(socket: Socket, original: LiveMobileServerMessage): void {
    if (original.type !== LIVE_MESSAGE_TYPES.mobileIntentResult) return
    const payload = original.payload
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.mobileIntentResult, {
      mobileClientInstanceId: payload.mobileClientInstanceId,
      ...(payload.desktopClientInstanceId ? { desktopClientInstanceId: payload.desktopClientInstanceId } : {}),
      result: { intentId: payload.result.intentId, outcome: "rejected" as const, code: "transport_backpressure", ...(payload.result.sessionId ? { sessionId: payload.result.sessionId } : {}) },
    }, { id: randomUUID(), sentAt: new Date().toISOString() })
    const text = JSON.stringify(message)
    if (this.fits(socket, Buffer.byteLength(text, "utf8"))) this.write(socket, text)
    // No capacity for even an error: the caller's bounded pending timeout is the final signal.
  }
}
function isControl(message: LiveMobileServerMessage): boolean { return message.type === LIVE_MESSAGE_TYPES.mobileIntentResult && (message.payload.result.workspaceFiles?.operation === "cancel" || message.payload.result.workspaceFiles?.operation === "close") }
