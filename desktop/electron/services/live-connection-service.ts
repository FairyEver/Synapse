import os from "node:os"
import { app } from "electron"
import WebSocket from "ws"
import type { SynapseAccountState } from "../../src/types/account"
import type { SynapseLiveState } from "../../src/types/live"
import type { EventBus } from "../runtime/event-bus"
import type { AccountService } from "./account-service"
import { LiveClientIdStore } from "./live-client-id-store"
import { createLiveReconnectDelay } from "./live-reconnect-policy"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.live")
const defaultHeartbeatIntervalMs = 20_000
const liveProtocolPromise = import("@synapse/shared")

type LiveSocket = Pick<WebSocket, "on" | "send" | "close" | "readyState">

type LiveConnectionServiceDeps = {
  readonly accountService: AccountService
  readonly clientIdStore?: Pick<LiveClientIdStore, "getOrCreate">
  readonly createSocket?: (url: string, options: { headers: Record<string, string> }) => LiveSocket
  readonly setTimeout?: (callback: () => void, delay: number) => NodeJS.Timeout
  readonly clearTimeout?: (timer: NodeJS.Timeout) => void
  readonly reconnectDelay?: (attempt: number) => number
  readonly now?: () => Date
  readonly appVersion?: () => string
  readonly platform?: () => string
  readonly deviceName?: () => string
}

export class LiveConnectionService {
  private readonly accountService: AccountService
  private readonly clientIdStore: Pick<LiveClientIdStore, "getOrCreate">
  private readonly createSocket: (url: string, options: { headers: Record<string, string> }) => LiveSocket
  private readonly setTimer: (callback: () => void, delay: number) => NodeJS.Timeout
  private readonly clearTimer: (timer: NodeJS.Timeout) => void
  private readonly reconnectDelay: (attempt: number) => number
  private readonly now: () => Date
  private readonly appVersion: () => string
  private readonly platform: () => string
  private readonly deviceName: () => string
  private eventBus: EventBus | null = null
  private socket: LiveSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private connectionGeneration = 0
  private closedIntentionally = false
  private state: SynapseLiveState = {
    status: "unauthenticated",
    clientInstanceId: null,
    connectedAt: null,
    lastSeenAt: null,
    lastError: null,
  }

  constructor(deps: LiveConnectionServiceDeps) {
    this.accountService = deps.accountService
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.createSocket = deps.createSocket ?? ((url, options) => new WebSocket(url, options))
    this.setTimer = deps.setTimeout ?? setTimeout
    this.clearTimer = deps.clearTimeout ?? clearTimeout
    this.reconnectDelay = deps.reconnectDelay ?? ((attempt) => createLiveReconnectDelay({ attempt }))
    this.now = deps.now ?? (() => new Date())
    this.appVersion = deps.appVersion ?? (() => app.getVersion())
    this.platform = deps.platform ?? (() => `${process.platform}-${process.arch}`)
    this.deviceName = deps.deviceName ?? (() => os.hostname())
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  getState(): SynapseLiveState {
    return this.state
  }

  handleAccountState(state: SynapseAccountState): void {
    if (state.status !== "authenticated") {
      this.closeSocket("unauthenticated")
      this.setState({
        status: "unauthenticated",
        clientInstanceId: null,
        connectedAt: null,
        lastSeenAt: null,
        lastError: null,
      })
      return
    }

    void this.connect()
  }

  async connect(): Promise<void> {
    const generation = this.nextConnectionGeneration()
    let token = this.accountService.getAccessTokenForLive()
    if (!token) {
      await this.accountService.refreshFromStorage()
      if (!this.isCurrentGeneration(generation)) return
      token = this.accountService.getAccessTokenForLive()
      if (!token) {
        this.closeSocket("unauthenticated")
        this.setState({
          ...this.state,
          status: "unauthenticated",
          lastError: "账号未登录",
        })
        return
      }
    }

    const clientInstanceId = await this.clientIdStore.getOrCreate()
    if (!this.isCurrentGeneration(generation)) return

    const socketUrl = liveSocketUrl(this.accountService.getApiBaseUrlForLive())
    this.closeCurrentSocket("reconnect")
    this.closedIntentionally = false
    this.setState({
      ...this.state,
      status: "reconnecting",
      clientInstanceId,
      connectedAt: null,
      lastSeenAt: null,
      lastError: null,
    })

    const socket = this.createSocket(socketUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })
    this.socket = socket

    socket.on("open", () => {
      void this.sendHello(socket, clientInstanceId).catch((error: unknown) => {
        this.logLiveMessageError(error)
      })
    })

    socket.on("message", (payload: unknown) => {
      void this.handleMessage(String(payload), clientInstanceId).catch((error: unknown) => {
        this.logLiveMessageError(error)
      })
    })

    socket.on("close", () => {
      if (this.socket === socket) {
        this.scheduleReconnect("连接已断开")
      }
    })

    socket.on("error", (error: unknown) => {
      logger.warn("Live socket error.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
      if (this.socket === socket && isAuthHandshakeError(error)) {
        this.refreshAfterAuthFailure()
        return
      }
      if (this.socket === socket) {
        this.scheduleReconnect("连接失败")
      }
    })
  }

  close(): void {
    this.closeSocket("closed")
    this.setState({
      ...this.state,
      status: "disconnected",
      lastError: null,
    })
  }

  private async handleMessage(payload: string, clientInstanceId: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      logger.warn("Live socket message ignored.", { messageType: "invalid_json" })
      return
    }

    const { LIVE_MESSAGE_TYPES, isLiveDesktopServerMessage } = await liveProtocolPromise
    if (!isLiveDesktopServerMessage(parsed)) {
      const messageType = parsed && typeof parsed === "object" && "type" in parsed
        ? (parsed as { readonly type?: unknown }).type
        : typeof parsed
      logger.warn("Live socket message ignored.", {
        messageType: typeof messageType === "string" ? messageType : "malformed",
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.welcome) {
      const welcome = parsed.payload
      const seenAt = this.now().toISOString()
      const intervalMs = welcome.heartbeatIntervalMs > 0
        ? welcome.heartbeatIntervalMs
        : defaultHeartbeatIntervalMs
      this.reconnectAttempt = 0
      this.startHeartbeat(intervalMs)
      this.setState({
        status: "connected",
        clientInstanceId,
        connectedAt: seenAt,
        lastSeenAt: seenAt,
        lastError: null,
      })
      return
    }

    if (parsed.type === LIVE_MESSAGE_TYPES.pong) {
      this.setState({
        ...this.state,
        status: "connected",
        lastSeenAt: this.now().toISOString(),
        lastError: null,
      })
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat()
    this.heartbeatTimer = this.setTimer(() => {
      this.heartbeatTimer = null
      void this.sendHeartbeat(intervalMs).catch((error: unknown) => {
        this.logLiveMessageError(error)
      })
    }, intervalMs)
  }

  private async sendHello(socket: LiveSocket, clientInstanceId: string): Promise<void> {
    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await liveProtocolPromise
    if (this.socket !== socket) {
      return
    }

    const sentAt = this.now().toISOString()
    socket.send(JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.hello, {
      clientInstanceId,
      appVersion: this.appVersion(),
      platform: this.platform(),
      deviceName: this.deviceName(),
    }, { id: this.createMessageId(), sentAt })))
  }

  private async sendHeartbeat(intervalMs: number): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return
    }

    const { LIVE_MESSAGE_TYPES, createLiveEnvelope } = await liveProtocolPromise
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return
    }

    const sentAt = this.now().toISOString()
    this.socket.send(JSON.stringify(createLiveEnvelope(LIVE_MESSAGE_TYPES.ping, {
      sentAt,
    }, { id: this.createMessageId(), sentAt })))
    this.startHeartbeat(intervalMs)
  }

  private scheduleReconnect(error: string): void {
    if (this.closedIntentionally || this.state.status === "unauthenticated") {
      return
    }

    this.socket = null
    this.clearHeartbeat()
    const delay = this.reconnectDelay(this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.setState({
      ...this.state,
      status: "reconnecting",
      lastError: error,
    })
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private closeSocket(reason: string): void {
    this.nextConnectionGeneration()
    this.closeCurrentSocket(reason)
  }

  private closeCurrentSocket(reason: string): void {
    this.closedIntentionally = true
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearHeartbeat()
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.close(1000, reason)
    }
  }

  private refreshAfterAuthFailure(): void {
    this.socket = null
    this.clearHeartbeat()
    const generation = this.nextConnectionGeneration()
    this.setState({
      ...this.state,
      status: "reconnecting",
      lastError: "登录已过期，正在重新连接",
    })

    void this.accountService.refreshFromStorage()
      .then(() => {
        if (!this.isCurrentGeneration(generation)) return
        if (!this.accountService.getAccessTokenForLive()) {
          this.closeSocket("unauthenticated")
          this.setState({
            ...this.state,
            status: "unauthenticated",
            lastError: "账号未登录",
          })
          return
        }
        void this.connect()
      })
      .catch((error: unknown) => {
        logger.warn("Live auth refresh failed.", {
          errorName: error instanceof Error ? error.name : typeof error,
        })
        if (!this.isCurrentGeneration(generation)) return
        this.closeSocket("unauthenticated")
        this.setState({
          ...this.state,
          status: "unauthenticated",
          lastError: "账号未登录",
        })
      })
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.clearTimer(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private setState(nextState: SynapseLiveState): void {
    this.state = nextState
    this.eventBus?.emit({
      domain: "live",
      type: "live.stateChanged",
      payload: { state: nextState },
      timestamp: this.now().toISOString(),
    })
  }

  private nextConnectionGeneration(): number {
    this.connectionGeneration += 1
    return this.connectionGeneration
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.connectionGeneration === generation
  }

  private createMessageId(): string {
    return `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }

  private logLiveMessageError(error: unknown): void {
    logger.warn("Live socket message handling failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
    })
  }
}

function liveSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/live/desktop`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function isAuthHandshakeError(error: unknown): boolean {
  const statusCode = typeof error === "object" && error
    ? (error as { readonly statusCode?: unknown }).statusCode
    : undefined
  if (statusCode === 401 || statusCode === 403) {
    return true
  }

  const message = error instanceof Error ? error.message : ""
  return /\b(?:401|403)\b/u.test(message)
}
