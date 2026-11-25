import { STATE_SYNC_CLOSE_CODES, StateSyncError } from "./errors"

export type WsConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed"

export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener?(type: string, listener: (event: any) => void): void
  onopen?: ((event: any) => void) | null
  onmessage?: ((event: any) => void) | null
  onclose?: ((event: any) => void) | null
  onerror?: ((event: any) => void) | null
}

export interface WebSocketLikeConstructor {
  new (url: string): WebSocketLike
}

export interface WsTransportOptions {
  readonly url: string
  readonly WebSocketCtor: WebSocketLikeConstructor
  readonly heartbeatIntervalMs?: number
  readonly reconnectBaseDelayMs?: number
  readonly reconnectMaxDelayMs?: number
  readonly onOpen: (isReconnect: boolean) => void
  readonly onMessage: (frame: Record<string, unknown>) => void
  readonly onClose: (info: { readonly code: number; readonly reason: string; readonly willReconnect: boolean }) => void
  readonly onStatusChange: (status: WsConnectionStatus) => void
}

const WS_READY_STATE_OPEN = 1
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500
const DEFAULT_RECONNECT_MAX_DELAY_MS = 15_000

const NON_RETRYABLE_CLOSE_CODES = new Set<number>([
  STATE_SYNC_CLOSE_CODES.NORMAL,
  STATE_SYNC_CLOSE_CODES.AUTH_FAILED,
  STATE_SYNC_CLOSE_CODES.REVOKED,
])

function decodeFrameData(data: unknown): string | null {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data))
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  return null
}

export class WsTransport {
  private readonly url: string
  private readonly WebSocketCtor: WebSocketLikeConstructor
  private readonly heartbeatIntervalMs: number
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly onOpenCb: (isReconnect: boolean) => void
  private readonly onMessageCb: (frame: Record<string, unknown>) => void
  private readonly onCloseCb: (info: { readonly code: number; readonly reason: string; readonly willReconnect: boolean }) => void
  private readonly onStatusChangeCb: (status: WsConnectionStatus) => void

  private ws: WebSocketLike | null = null
  private status: WsConnectionStatus = "connecting"
  private hasAuthenticatedOnce = false
  private manuallyClosed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private missedPongs = 0

  constructor(options: WsTransportOptions) {
    this.url = options.url
    this.WebSocketCtor = options.WebSocketCtor
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS
    this.onOpenCb = options.onOpen
    this.onMessageCb = options.onMessage
    this.onCloseCb = options.onClose
    this.onStatusChangeCb = options.onStatusChange
  }

  getStatus(): WsConnectionStatus {
    return this.status
  }

  connect(): void {
    if (this.manuallyClosed) return
    this.clearReconnectTimer()
    this.openSocket(false)
  }

  markAuthenticated(): void {
    this.hasAuthenticatedOnce = true
    this.reconnectAttempt = 0
    this.missedPongs = 0
    this.setStatus("connected")
    this.startHeartbeat()
  }

  recordPong(): void {
    this.missedPongs = 0
  }

  send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WS_READY_STATE_OPEN) {
      throw new StateSyncError("NOT_CONNECTED", "WebSocket 连接尚未就绪。")
    }
    this.ws.send(JSON.stringify(payload))
  }

  close(code: number = STATE_SYNC_CLOSE_CODES.NORMAL, reason = "Client closed"): void {
    if (this.manuallyClosed) return
    this.manuallyClosed = true
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.setStatus("closed")

    const active = this.ws
    this.ws = null
    if (active) {
      try {
        active.close(code, reason)
      } catch (error) {
        void error
      }
    }
    this.onCloseCb({ code, reason, willReconnect: false })
  }

  private openSocket(isReconnect: boolean): void {
    this.stopHeartbeat()
    this.setStatus(isReconnect ? "reconnecting" : "connecting")

    let socket: WebSocketLike
    try {
      socket = new this.WebSocketCtor(this.url)
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法建立 WebSocket 连接。"
      this.handleSocketClose(null, 1006, message)
      return
    }
    this.ws = socket

    const handleOpen = (): void => {
      if (this.ws !== socket || this.manuallyClosed) return
      this.onOpenCb(isReconnect)
    }

    const handleMessage = (event: unknown): void => {
      if (this.ws !== socket || this.manuallyClosed) return
      this.missedPongs = 0
      const rawData = event && typeof event === "object" && "data" in event ? (event as { data: unknown }).data : event
      const text = decodeFrameData(rawData)
      if (!text) return
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        void error
        return
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.onMessageCb(parsed as Record<string, unknown>)
      }
    }

    const handleClose = (event: unknown): void => {
      const code =
        event && typeof event === "object" && "code" in event && typeof (event as { code: unknown }).code === "number"
          ? (event as { code: number }).code
          : 1006
      const reason =
        event && typeof event === "object" && "reason" in event && typeof (event as { reason: unknown }).reason === "string"
          ? (event as { reason: string }).reason
          : ""
      this.handleSocketClose(socket, code, reason)
    }

    const handleError = (): void => {
      // Browsers and ws emit a subsequent close event after error; ignore duplicate handling here.
    }

    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("open", handleOpen)
      socket.addEventListener("message", handleMessage)
      socket.addEventListener("close", handleClose)
      socket.addEventListener("error", handleError)
    } else {
      socket.onopen = handleOpen
      socket.onmessage = handleMessage
      socket.onclose = handleClose
      socket.onerror = handleError
    }
  }

  private handleSocketClose(socket: WebSocketLike | null, code: number, reason: string): void {
    if (socket !== null && this.ws !== socket) return
    this.ws = null
    this.stopHeartbeat()

    if (this.manuallyClosed) return

    const shouldReconnect = this.hasAuthenticatedOnce && !NON_RETRYABLE_CLOSE_CODES.has(code)
    if (!shouldReconnect) {
      this.setStatus("closed")
      this.onCloseCb({ code, reason, willReconnect: false })
      return
    }

    this.setStatus("reconnecting")
    this.onCloseCb({ code, reason, willReconnect: true })
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    const exponent = Math.min(this.reconnectAttempt, 10)
    const rawDelay = Math.min(this.reconnectMaxDelayMs, this.reconnectBaseDelayMs * Math.pow(2, exponent))
    const jitter = Math.floor(rawDelay * Math.random() * 0.2)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.manuallyClosed) return
      this.openSocket(true)
    }, rawDelay + jitter)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatIntervalMs <= 0) return
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WS_READY_STATE_OPEN) return
      if (this.missedPongs >= 2) {
        try {
          this.ws.close(STATE_SYNC_CLOSE_CODES.TIMEOUT_OR_SLOW, "Heartbeat timeout")
        } catch (error) {
          void error
        }
        return
      }
      this.missedPongs += 1
      try {
        this.ws.send(JSON.stringify({ type: "ping" }))
      } catch (error) {
        void error
      }
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setStatus(next: WsConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    this.onStatusChangeCb(next)
  }
}
