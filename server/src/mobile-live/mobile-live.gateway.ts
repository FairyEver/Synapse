import { randomUUID } from "node:crypto"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveMobileClientMessage,
  type LiveMobileClientMessage,
  type LiveMobileServerMessage,
} from "@synapse/shared"
import { RawData, WebSocket, WebSocketServer } from "ws"
import { UserAuthService } from "../auth/user-auth.service"
import { LiveClientRegistry } from "../live/live-client-registry"
import type { LiveClientInstance } from "../live/live.types"
import { MobileLiveRelayService } from "./mobile-live-relay.service"
import {
  MOBILE_CLIENT_REGISTRY,
  MOBILE_DETACH_REASON_CLOSED,
  MOBILE_DETACH_REASON_SHUTDOWN,
  MOBILE_DETACH_REASON_TIMEOUT,
  MOBILE_LIVE_HEARTBEAT_INTERVAL_MS,
  MOBILE_LIVE_HEARTBEAT_TIMEOUT_MS,
  MOBILE_LIVE_MAX_PAYLOAD_BYTES,
  MOBILE_LIVE_RATE_MESSAGES_PER_WINDOW,
  MOBILE_LIVE_RATE_WINDOW_MS,
  type MobileLiveFanout,
} from "./mobile-live.types"

export const mobileLivePath = "/api/live/mobile"

type ConnectedPhone = {
  readonly connectionId: string
  readonly userId: string
  clientInstanceId: string | null
  messageWindowStartedAtMs: number
  messageCount: number
}

/**
 * The phone-facing socket.
 *
 * Phones speak the desktop handshake (hello/welcome/ping/pong) plus the terminal
 * intent family, so there is one connection lifecycle to reason about across both
 * clients. What differs is the traffic shape: a phone sends little and, once it
 * has attached, receives a bounded stream for exactly one terminal.
 */
@Injectable()
export class MobileLiveGateway implements OnModuleInit, OnApplicationShutdown, MobileLiveFanout {
  private readonly logger = new Logger(MobileLiveGateway.name)
  private readonly socketsByConnectionId = new Map<string, WebSocket>()
  private server: WebSocketServer | null = null
  private staleInterval: NodeJS.Timeout | null = null

  constructor(
    private readonly auth: UserAuthService,
    @Inject(MOBILE_CLIENT_REGISTRY) private readonly registry: LiveClientRegistry,
    private readonly relay: MobileLiveRelayService,
  ) {}

  onModuleInit(): void {
    this.relay.setFanout(this)
  }

  attach(httpServer: HttpServer): void {
    if (this.server) return

    this.server = new WebSocketServer({ noServer: true, maxPayload: MOBILE_LIVE_MAX_PAYLOAD_BYTES })
    this.staleInterval = setInterval(() => {
      this.sweepStaleClients()
    }, MOBILE_LIVE_HEARTBEAT_TIMEOUT_MS)
    this.staleInterval.unref?.()

    httpServer.on("upgrade", (request, socket, head) => {
      if (upgradePath(request) !== mobileLivePath) return

      void this.authenticateUpgrade(request)
        .then((authResult) => {
          if (!authResult) {
            this.logger.warn({ reason: "unauthenticated" }, "Mobile websocket upgrade rejected")
            rejectUpgrade(socket)
            return
          }
          this.server?.handleUpgrade(request, socket, head, (webSocket) => {
            this.bindAuthenticatedSocket(webSocket, authResult)
          })
        })
        .catch((error: unknown) => {
          // A failing auth backend is not an authentication decision. The desktop
          // channel collapses this into 401, which leaves a client unable to tell
          // "refresh your token" from "back off"; phones reconnect far more often,
          // so the distinction is worth preserving here.
          this.logger.warn({
            errorName: error instanceof Error ? error.name : typeof error,
          }, "Mobile websocket upgrade failed")
          rejectUpgrade(socket, 503)
        })
    })
  }

  onApplicationShutdown(): void {
    const sockets = [...this.socketsByConnectionId.entries()]
    this.socketsByConnectionId.clear()
    if (this.staleInterval) {
      clearInterval(this.staleInterval)
      this.staleInterval = null
    }
    for (const [connectionId, socket] of sockets) {
      const client = this.registry.markDisconnected({
        connectionId,
        now: new Date(),
        reason: MOBILE_DETACH_REASON_SHUTDOWN,
      })
      if (client) this.relay.handleMobileDisconnect(client.userId, client.clientInstanceId, MOBILE_DETACH_REASON_SHUTDOWN)
      try {
        socket.close(1012, MOBILE_DETACH_REASON_SHUTDOWN)
        socket.terminate()
      } catch {
        // Shutdown is best effort; a socket that refuses to close is not actionable.
      }
    }
    try {
      this.server?.close()
    } catch {
      // Same.
    }
    this.server = null
  }

  /**
   * Implements the relay's outbound side. Returns `offline` rather than throwing:
   * a phone that dropped mid-frame is the normal case, and the desktop should not
   * see an error for it.
   */
  sendToMobile(input: {
    readonly userId: string
    readonly clientInstanceId: string
    readonly message: LiveMobileServerMessage
  }): "sent" | "offline" | "send_failed" {
    const outcome = this.writeToPhones({
      userId: input.userId,
      clientInstanceIds: [input.clientInstanceId],
      message: input.message,
    })
    if (outcome.sent > 0) return "sent"
    return outcome.failed > 0 ? "send_failed" : "offline"
  }

  sendToMobileClients(input: {
    readonly userId: string
    readonly message: LiveMobileServerMessage
  }): void {
    this.writeToPhones({
      userId: input.userId,
      clientInstanceIds: null,
      message: input.message,
    })
  }

  /**
   * The one place a message reaches a phone, so the addressed send above and the
   * fanout beside it cannot drift apart.
   *
   * The registry is read once for the whole batch — turning a `clientInstanceId`
   * into a connection is what used to make a summary cost one full-registry scan
   * per phone — and the payload is serialized once for all of them: a summary can
   * approach the desktop's payload ceiling, so serializing per recipient would
   * multiply a large string construction by the phone count. One recipient's
   * failure never reaches the next.
   */
  private writeToPhones(input: {
    readonly userId: string
    /** `null` addresses every phone of the account, which is the fanout case. */
    readonly clientInstanceIds: readonly string[] | null
    readonly message: LiveMobileServerMessage
  }): { readonly sent: number; readonly failed: number } {
    const connectionIdsByClientInstance = new Map<string, string>()
    for (const client of this.registry.listOnlineByUser(input.userId)) {
      if (client.connectionId) connectionIdsByClientInstance.set(client.clientInstanceId, client.connectionId)
    }
    const recipients = input.clientInstanceIds ?? [...connectionIdsByClientInstance.keys()]
    let payload: string | null = null
    let sent = 0
    let failed = 0
    for (const clientInstanceId of recipients) {
      const socket = this.openSocket(connectionIdsByClientInstance.get(clientInstanceId))
      if (!socket) continue
      try {
        // Serialized on the first reachable recipient and shared from there: an
        // unreachable phone costs no serialization at all.
        payload ??= JSON.stringify(input.message)
        socket.send(payload)
        sent += 1
      } catch (error) {
        failed += 1
        this.logger.warn({
          clientInstanceId,
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Mobile send failed")
      }
    }
    return { sent, failed }
  }

  private openSocket(connectionId: string | undefined): WebSocket | null {
    if (!connectionId) return null
    const socket = this.socketsByConnectionId.get(connectionId)
    return socket && socket.readyState === WebSocket.OPEN ? socket : null
  }

  /** Public, like the desktop gateway's, so tests can drive a connection directly. */
  bindAuthenticatedSocket(socket: WebSocket, auth: { readonly userId: string }): void {
    const entry: ConnectedPhone = {
      connectionId: randomUUID(),
      userId: auth.userId,
      clientInstanceId: null,
      messageWindowStartedAtMs: Date.now(),
      messageCount: 0,
    }
    let registeredClient: LiveClientInstance | null = null
    this.socketsByConnectionId.set(entry.connectionId, socket)

    socket.on("message", (payload) => {
      if (!this.acceptMessage(entry)) {
        socket.close(1008, "rate_limited")
        return
      }
      void this.handleMessage(socket, entry, payload, (client) => {
        registeredClient = client
      })
    })

    socket.on("close", () => {
      const client = this.finishConnection(socket, entry, registeredClient, MOBILE_DETACH_REASON_CLOSED)
      if (client) this.relay.handleMobileDisconnect(client.userId, client.clientInstanceId, MOBILE_DETACH_REASON_CLOSED)
    })

    socket.on("error", (error) => {
      this.logger.warn({
        connectionId: entry.connectionId,
        errorName: error instanceof Error ? error.name : typeof error,
        userId: auth.userId,
      }, "Mobile websocket error")
      const client = this.finishConnection(socket, entry, registeredClient, "socket_error")
      if (client) this.relay.handleMobileDisconnect(client.userId, client.clientInstanceId, "socket_error")
    })
  }

  private async handleMessage(
    socket: WebSocket,
    entry: ConnectedPhone,
    payload: RawData,
    rememberClient: (client: LiveClientInstance) => void,
  ): Promise<void> {
    const message = parseMobileMessage(payload)
    if (!message) {
      socket.close(1003, "invalid_message")
      return
    }

    if (message.type === LIVE_MESSAGE_TYPES.hello) {
      if (entry.clientInstanceId) {
        socket.close(1008, "hello_already_received")
        return
      }
      const hello = message.payload
      const now = new Date()
      const client = this.registry.register({
        userId: entry.userId,
        clientInstanceId: hello.clientInstanceId,
        connectionId: entry.connectionId,
        appVersion: hello.appVersion,
        platform: hello.platform,
        deviceName: hello.deviceName,
        now,
        onSupersede: (oldConnectionId) => {
          this.socketsByConnectionId.get(oldConnectionId)?.close(1000, "superseded")
          this.socketsByConnectionId.delete(oldConnectionId)
        },
      })
      entry.clientInstanceId = hello.clientInstanceId
      rememberClient(client)
      this.logger.log({
        clientInstanceId: client.clientInstanceId,
        connectionId: entry.connectionId,
        platform: client.platform,
        userId: entry.userId,
      }, "Mobile client registered")
      sendJson(socket, envelope(LIVE_MESSAGE_TYPES.welcome, {
        connectionId: entry.connectionId,
        serverTime: now.toISOString(),
        heartbeatIntervalMs: MOBILE_LIVE_HEARTBEAT_INTERVAL_MS,
        heartbeatTimeoutMs: MOBILE_LIVE_HEARTBEAT_TIMEOUT_MS,
      }))
      return
    }

    if (!entry.clientInstanceId) {
      socket.close(1008, "hello_required")
      return
    }
    const touched = this.registry.touch(entry.connectionId, new Date())
    if (touched) rememberClient(touched)

    if (message.type === LIVE_MESSAGE_TYPES.ping) {
      sendJson(socket, envelope(LIVE_MESSAGE_TYPES.pong, { serverTime: new Date().toISOString() }))
      return
    }

    if (message.type !== LIVE_MESSAGE_TYPES.mobileIntent) return

    const intentPayload = message.payload
    const outcome = await this.relay.deliverIntent({
      userId: entry.userId,
      mobileClientInstanceId: intentPayload.mobileClientInstanceId,
      desktopClientInstanceId: intentPayload.desktopClientInstanceId,
      intent: intentPayload.intent,
    })
    if (outcome.delivery.status === "sent") return

    // Report delivery failure directly so the phone does not wait on a result
    // that can never arrive.
    sendJson(socket, envelope(LIVE_MESSAGE_TYPES.mobileIntentResult, {
      mobileClientInstanceId: intentPayload.mobileClientInstanceId,
      result: {
        intentId: intentPayload.intent.intentId,
        outcome: "rejected",
        code: outcome.delivery.status === "desktop_offline" ? "desktop_offline" : "relay_failed",
        message: "电脑当前离线。",
      },
    }))
  }

  private acceptMessage(entry: ConnectedPhone): boolean {
    const nowMs = Date.now()
    if (nowMs - entry.messageWindowStartedAtMs >= MOBILE_LIVE_RATE_WINDOW_MS) {
      entry.messageWindowStartedAtMs = nowMs
      entry.messageCount = 0
    }
    entry.messageCount += 1
    return entry.messageCount <= MOBILE_LIVE_RATE_MESSAGES_PER_WINDOW
  }

  private finishConnection(
    socket: WebSocket,
    entry: ConnectedPhone,
    registeredClient: LiveClientInstance | null,
    reason: string,
  ): LiveClientInstance | null {
    if (!this.socketsByConnectionId.delete(entry.connectionId)) return null
    const client = this.registry.markDisconnected({
      connectionId: entry.connectionId,
      now: new Date(),
      reason: reason === "socket_error" ? "socket_error" : "socket_close",
    })
    try {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, reason)
    } catch {
      // Already gone.
    }
    return client ?? registeredClient
  }

  private sweepStaleClients(): void {
    const now = new Date()
    for (const client of this.registry.markStaleClients(now)) {
      if (client.status !== "offline" || !client.connectionId) continue
      const socket = this.socketsByConnectionId.get(client.connectionId)
      this.socketsByConnectionId.delete(client.connectionId)
      try {
        socket?.close(1000, MOBILE_DETACH_REASON_TIMEOUT)
      } catch {
        // Already gone.
      }
      this.relay.handleMobileDisconnect(client.userId, client.clientInstanceId, MOBILE_DETACH_REASON_TIMEOUT)
    }
  }

  private async authenticateUpgrade(request: IncomingMessage): Promise<{ readonly userId: string } | null> {
    const token = readBearerToken(request.headers.authorization)
    if (!token) return null
    const result = await this.auth.verifyAccessToken(token)
    return { userId: result.userId }
  }
}

export function parseMobileMessage(payload: RawData | string): LiveMobileClientMessage | null {
  const text = typeof payload === "string" ? payload : rawDataToText(payload)
  try {
    const parsed: unknown = JSON.parse(text)
    return isLiveMobileClientMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}

function envelope(type: string, payload: unknown): LiveMobileServerMessage {
  return createLiveEnvelope(type as never, payload, {
    id: randomUUID(),
    sentAt: new Date().toISOString(),
  }) as LiveMobileServerMessage
}

function sendJson(socket: WebSocket, message: LiveMobileServerMessage): void {
  socket.send(JSON.stringify(message))
}

function rawDataToText(payload: RawData): string {
  if (Array.isArray(payload)) return Buffer.concat(payload).toString("utf8")
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString("utf8")
  return payload.toString("utf8")
}

function readBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  const [scheme, token] = value?.split(/\s+/, 2) ?? []
  return scheme?.toLowerCase() === "bearer" && token ? token : null
}

function upgradePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname
  } catch {
    return "/"
  }
}

function rejectUpgrade(
  socket: NodeJS.WritableStream & { readonly destroy: () => unknown },
  status = 401,
): void {
  socket.write(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Service Unavailable"}\r\n\r\n`)
  socket.destroy()
}
