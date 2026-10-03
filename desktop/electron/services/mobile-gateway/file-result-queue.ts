type FileResultSocket = {
  readonly readyState: number
  readonly bufferedAmount: number
  send(payload: string): void
}

type QueueEntry = {
  readonly payload: string
  readonly bytes: number
  readonly expiresAt: number
  readonly socket: FileResultSocket
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly priority: boolean
}

export type FileResultQueueLimits = {
  readonly maxEnvelopeBytes: number
  readonly maxQueuedPages: number
  readonly maxQueuedBytes: number
  readonly sendQueueTtlMs: number
  readonly maxSocketBufferedBytes: number
}

/** File pages cannot use the terminal frame sender's drop-and-replace behavior. */
export class MobileFileResultQueue {
  private readonly queue: QueueEntry[] = []
  private queuedBytes = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: {
    readonly socket: () => FileResultSocket | null
    readonly limits: FileResultQueueLimits
    readonly now: () => number
    readonly setTimeout: (callback: () => void, delay: number) => NodeJS.Timeout
    readonly clearTimeout: (timer: NodeJS.Timeout) => void
  }) {}

  send(payload: string, priority = false): Promise<void> {
    const bytes = Buffer.byteLength(payload, "utf8")
    const socket = this.deps.socket()
    if (bytes > this.deps.limits.maxEnvelopeBytes) return Promise.reject(new Error("limit_exceeded"))
    if (!socket || socket.readyState !== 1) return Promise.reject(new Error("desktop_offline"))
    if ((priority || this.queue.length === 0) && this.canSend(socket, bytes)) {
      try {
        socket.send(payload)
        return Promise.resolve()
      } catch {
        return Promise.reject(new Error("relay_failed"))
      }
    }
    if (priority) {
      // A close/cancel reply may displace a waiting read, which fails explicitly.
      while (this.queue.length >= this.deps.limits.maxQueuedPages || this.queuedBytes + bytes > this.deps.limits.maxQueuedBytes) {
        const index = this.queue.findLastIndex(entry => !entry.priority)
        if (index < 0) break
        const [entry] = this.queue.splice(index, 1)
        if (entry) { this.queuedBytes -= entry.bytes; entry.reject(new Error("transport_backpressure")) }
      }
    }
    if (this.queue.length >= this.deps.limits.maxQueuedPages
      || this.queuedBytes + bytes > this.deps.limits.maxQueuedBytes) {
      return Promise.reject(new Error("transport_backpressure"))
    }
    return new Promise<void>((resolve, reject) => {
      const entry = { payload, bytes, socket, priority, expiresAt: this.deps.now() + this.deps.limits.sendQueueTtlMs, resolve, reject }
      if (priority) this.queue.unshift(entry)
      else this.queue.push(entry)
      this.queuedBytes += bytes
      this.scheduleDrain()
    })
  }

  reset(): void {
    if (this.timer) this.deps.clearTimeout(this.timer)
    this.timer = null
    while (this.queue.length > 0) this.removeFirst()?.reject(new Error("desktop_offline"))
  }

  facts(): { readonly pages: number; readonly bytes: number } {
    return { pages: this.queue.length, bytes: this.queuedBytes }
  }

  private canSend(socket: FileResultSocket, bytes: number): boolean {
    return socket.bufferedAmount + bytes <= this.deps.limits.maxSocketBufferedBytes
  }

  private removeFirst(): QueueEntry | undefined {
    const entry = this.queue.shift()
    if (entry) this.queuedBytes -= entry.bytes
    return entry
  }

  private scheduleDrain(): void {
    if (this.timer || this.queue.length === 0) return
    // Only file pages wait here; frames, input acknowledgements and control bypass it.
    this.timer = this.deps.setTimeout(() => {
      this.timer = null
      this.drain()
    }, 50)
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const entry = this.queue[0]!
      const current = this.deps.socket()
      if (entry.socket !== current || current?.readyState !== 1) {
        this.removeFirst()?.reject(new Error("desktop_offline"))
        continue
      }
      if (this.deps.now() >= entry.expiresAt) {
        this.removeFirst()?.reject(new Error("transport_backpressure"))
        continue
      }
      if (!this.canSend(current, entry.bytes)) break
      this.removeFirst()
      try {
        current.send(entry.payload)
        entry.resolve()
      } catch {
        entry.reject(new Error("relay_failed"))
      }
    }
    this.scheduleDrain()
  }
}
