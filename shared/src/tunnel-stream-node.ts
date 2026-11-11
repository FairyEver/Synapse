import { Duplex, type DuplexOptions } from "node:stream"
import { TUNNEL_LIMITS } from "./tunnel-contracts.js"

/** Both endpoints charge only outstanding writes, never the complete HTTP body. */
export class TunnelByteBudget {
  private bytes = 0
  constructor(readonly maximum: number = TUNNEL_LIMITS.globalBufferedBytes) {}
  get used(): number { return this.bytes }
  reserve(size: number): boolean { if (this.bytes + size > this.maximum) return false; this.bytes += size; return true }
  release(size: number): void { this.bytes = Math.max(0, this.bytes - size) }
}
class TunnelStream extends Duplex {
  private timer?: ReturnType<typeof setTimeout>
  private timeoutMs = 0
  constructor(private readonly wire: Duplex, private readonly budget: TunnelByteBudget) {
    super({ readableHighWaterMark: TUNNEL_LIMITS.dataMessageBytes, writableHighWaterMark: TUNNEL_LIMITS.dataMessageBytes, allowHalfOpen: false } satisfies DuplexOptions)
    wire.on("data", (chunk: Buffer) => { this.touch(); if (!this.push(chunk)) wire.pause() })
    wire.on("end", () => this.push(null))
    wire.on("close", () => this.destroy())
    wire.on("error", error => this.destroy(error))
  }
  private touch(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.timeoutMs) { this.timer = setTimeout(() => this.emit("timeout"), this.timeoutMs); this.timer.unref() }
  }
  setTimeout(ms: number, listener?: () => void): this { this.timeoutMs = ms; if (listener) this.once("timeout", listener); this.touch(); return this }
  setNoDelay(): this { return this }
  setKeepAlive(): this { return this }
  override _read(): void { this.wire.resume() }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (chunk.length > TUNNEL_LIMITS.streamBufferedBytes) { callback(new Error("TUNNEL_WRITE_LIMIT")); return }
    let offset = 0
    const write = () => {
      if (this.destroyed) { callback(new Error("TUNNEL_CLOSED")); return }
      if (offset >= chunk.length) { callback(); return }
      const part = chunk.subarray(offset, Math.min(offset + TUNNEL_LIMITS.dataMessageBytes, chunk.length))
      if (!this.budget.reserve(part.length)) { callback(new Error("TUNNEL_BUFFER_CAPACITY")); return }
      offset += part.length; this.touch()
      this.wire.write(part, error => { this.budget.release(part.length); if (error) callback(error); else write() })
    }
    write()
  }
  override _final(callback: (error?: Error | null) => void): void { this.wire.end(callback) }
  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    if (this.timer) clearTimeout(this.timer)
    this.wire.destroy(error ?? undefined); callback(error)
  }
}
export function boundedTunnelStream(wire: Duplex, budget: TunnelByteBudget): Duplex { return new TunnelStream(wire, budget) }
