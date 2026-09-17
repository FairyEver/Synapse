import { randomUUID } from "node:crypto"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import { Injectable, Logger, Optional, type OnApplicationShutdown } from "@nestjs/common"
import {
  WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS,
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveDesktopClientMessage,
  type LiveDesktopClientMessage,
  type LiveDesktopServerMessage,
  type MobileFramePayload,
  type MobileIntentResultPayload,
  type MobileSummaryPayload,
  type MobileTransferProgressPayload,
} from "@synapse/shared"
import { RawData, WebSocket, WebSocketServer } from "ws"
import { UserAuthService } from "../auth/user-auth.service"
import { formatAuditError } from "../common/audit-error"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveDeviceService } from "./live-device.service"
import { toPublicDto } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"
import type { LiveClientDisconnectReason, LiveClientInstance } from "./live.types"

interface LiveDesktopGatewayClock {
  readonly randomId: () => string
  readonly now: () => Date
}

interface LiveDesktopGatewayTestInput {
  readonly auth: UserAuthService
  readonly registry: LiveClientRegistry
  readonly streams: LiveStreamService
  readonly clock: LiveDesktopGatewayClock
  readonly devices?: LiveDeviceService
  readonly webhookDeliveryAckHandler?: WebhookDeliveryAckHandler
}

export interface WebhookDeliveryAckHandler {
  readonly recordDeliveryAck: (input: {
    readonly userId: string
    readonly deliveryId: string
    readonly clientInstanceId: string
    readonly deviceName: string
    readonly platform: string
    readonly appVersion: string
    readonly acknowledgedAt: Date
  }) => Promise<void> | void
}

/**
 * Receives the terminal payloads a desktop produces for phones.
 *
 * Installed by the mobile relay at startup. Kept as a setter rather than a
 * constructor dependency because the relay itself depends on this gateway to
 * deliver in the other direction, and the live module must not import it.
 */
export interface LiveMobileRelayHandler {
  readonly handleSummary: (userId: string, payload: MobileSummaryPayload) => void
  readonly handleFrame: (userId: string, payload: MobileFramePayload) => void
  readonly handleIntentResult: (userId: string, payload: MobileIntentResultPayload) => void
  /**
   * A computer's progress fetching a file a phone relayed. Arrives repeatedly
   * between the intent and its result, and is worthless once that result lands.
   */
  readonly handleTransferProgress: (userId: string, payload: MobileTransferProgressPayload) => void
  /**
   * One of the user's computers became reachable, or stopped being reachable.
   * Fired on every change, so it carries the current list rather than a delta.
   */
  readonly handleDesktopPresence: (userId: string, desktopClientInstanceIds: readonly string[]) => void
}

export interface LiveBroadcastClientResult {
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly platform: string
  readonly appVersion: string
  readonly sentAt: string
  readonly status: "sent" | "send_failed"
}

const liveDesktopPath = "/api/live/desktop"
const heartbeatIntervalMs = 20_000
const heartbeatTimeoutMs = 45_000
/** Only a cache of the last list sent; users past this simply get the next change. */
const liveDesktopPresenceCacheLimit = 2_000
/**
 * Ceiling for one message a desktop sends. The summary is the largest of those and
 * the only one that cannot be split — a phone replaces its whole list with whatever
 * arrives — so this is derived from the summary's own budget rather than picked:
 * it must clear `MOBILE_FRAME_LIMITS.maxSummaryBytes` with room for the envelope.
 * That budget lives in `shared/src/mobile-live.ts` and is pinned by a boundary test
 * there; the spec below checks this ceiling still clears it.
 *
 * Do not lower this without lowering that budget first. The two constants have no
 * type-level link, and the failure they guard is quiet: an oversized message is
 * answered by closing the connection, so the desktop simply vanishes from the phone
 * as though it had gone offline.
 */
export const liveDesktopMaxPayloadBytes = 256 * 1024

@Injectable()
export class LiveDesktopGateway implements OnApplicationShutdown {
  private readonly logger = new Logger(LiveDesktopGateway.name)
  private readonly socketsByConnectionId = new Map<string, WebSocket>()
  private server: WebSocketServer | null = null
  private staleInterval: NodeJS.Timeout | null = null
  private clock: LiveDesktopGatewayClock = { randomId: randomUUID, now: () => new Date() }
  private webhookDeliveryAckHandler: WebhookDeliveryAckHandler | null = null
  private mobileRelayHandler: LiveMobileRelayHandler | null = null
  /** Last presence list sent per user, so an unchanged one is not re-sent. */
  private readonly presenceByUser = new Map<string, string>()

  constructor(
    private readonly auth: UserAuthService,
    private readonly registry: LiveClientRegistry,
    private readonly streams: LiveStreamService,
    @Optional() private readonly devices?: LiveDeviceService,
  ) {}

  static createForTest(input: LiveDesktopGatewayTestInput): LiveDesktopGateway {
    const gateway = new LiveDesktopGateway(input.auth, input.registry, input.streams, input.devices)
    gateway.clock = input.clock
    gateway.webhookDeliveryAckHandler = input.webhookDeliveryAckHandler ?? null
    return gateway
  }

  setWebhookDeliveryAckHandler(handler: WebhookDeliveryAckHandler): void {
    this.webhookDeliveryAckHandler = handler
  }

  setMobileRelayHandler(handler: LiveMobileRelayHandler): void {
    this.mobileRelayHandler = handler
  }

  /**
   * Delivers one message to a single desktop connection.
   *
   * `offline` is a normal answer, not an error: a phone can ask about a computer
   * that is simply not running, and the caller turns that into a user-facing
   * "desktop offline" rather than retrying.
   */
  sendToClientInstance(input: {
    readonly userId: string
    readonly clientInstanceId: string
    readonly message: LiveDesktopServerMessage
  }): "sent" | "offline" | "send_failed" {
    const client = this.registry
      .listOnlineByUser(input.userId)
      .find((entry) => entry.clientInstanceId === input.clientInstanceId)
    const connectionId = client?.connectionId
    if (!connectionId) return "offline"
    const socket = this.socketsByConnectionId.get(connectionId)
    if (!socket || socket.readyState !== WebSocket.OPEN) return "offline"
    try {
      sendJson(socket, input.message)
      return "sent"
    } catch (error) {
      this.logger.warn({
        clientInstanceId: input.clientInstanceId,
        errorName: error instanceof Error ? error.name : typeof error,
        userId: input.userId,
      }, "Live desktop targeted send failed")
      return "send_failed"
    }
  }

  /** The devices this user can currently reach, for resolving a phone's target. */
  listOnlineClientInstanceIds(userId: string): string[] {
    return this.registry.listOnlineByUser(userId).map((entry) => entry.clientInstanceId)
  }

  /**
   * Tells the user's phones which computers are reachable.
   *
   * Safe to call from every transition, including the heartbeat-driven ones: an
   * unchanged list is dropped, so a desktop that keeps heartbeating does not turn
   * a rare event into a steady stream at the phone.
   */
  private notifyDesktopPresence(userId: string): void {
    const relay = this.mobileRelayHandler
    if (!relay) return
    const clientInstanceIds = this.listOnlineClientInstanceIds(userId)
    const fingerprint = clientInstanceIds.join("\x00")
    if (this.presenceByUser.get(userId) === fingerprint) return
    this.rememberPresence(userId, fingerprint)
    relay.handleDesktopPresence(userId, clientInstanceIds)
  }

  private rememberPresence(userId: string, fingerprint: string): void {
    this.presenceByUser.set(userId, fingerprint)
    if (this.presenceByUser.size <= liveDesktopPresenceCacheLimit) return
    const oldest = this.presenceByUser.keys().next()
    if (!oldest.done) this.presenceByUser.delete(oldest.value)
  }

  /**
   * The single way a desktop stops being online.
   *
   * Presence has to fire on every one of them — socket close, socket error,
   * server shutdown, a disabled account — and any path that forgets leaves phones
   * showing a computer that is gone. Routing them all through here is what makes
   * that impossible to get wrong one call site at a time.
   */
  private markDesktopOffline(input: {
    readonly connectionId: string
    readonly reason: LiveClientDisconnectReason
  }): LiveClientInstance | undefined {
    const client = this.registry.markDisconnected({
      connectionId: input.connectionId,
      now: this.clock.now(),
      reason: input.reason,
    })
    if (!client) return undefined
    this.publish(client)
    this.notifyDesktopPresence(client.userId)
    return client
  }

  attach(httpServer: HttpServer): void {
    if (this.server) {
      return
    }

    this.server = this.createWebSocketServer()
    this.staleInterval = setInterval(() => {
      this.sweepStaleClients()
    }, heartbeatTimeoutMs)
    this.staleInterval.unref?.()

    httpServer.on("upgrade", (request, socket, head) => {
      if (upgradePath(request) !== liveDesktopPath) {
        return
      }

      void this.authenticateUpgrade(request)
        .then((authResult) => {
          if (!authResult) {
            this.logger.warn({
              path: upgradePath(request),
              reason: "missing_token",
            }, "Live desktop websocket upgrade rejected")
            rejectUpgrade(socket)
            return
          }

          this.server?.handleUpgrade(request, socket, head, (webSocket) => {
            this.bindAuthenticatedSocket(webSocket, authResult)
          })
        })
        .catch((error) => {
          this.logger.warn({
            errorName: error instanceof Error ? error.name : typeof error,
            path: upgradePath(request),
          }, "Live desktop websocket upgrade failed")
          rejectUpgrade(socket)
        })
    })
  }

  createWebSocketServer(): WebSocketServer {
    return new WebSocketServer({
      noServer: true,
      maxPayload: liveDesktopMaxPayloadBytes,
    })
  }

  onApplicationShutdown(signal?: string): void {
    const sockets = Array.from(this.socketsByConnectionId.entries())
    this.socketsByConnectionId.clear()
    if (this.staleInterval) {
      clearInterval(this.staleInterval)
      this.staleInterval = null
    }
    for (const [connectionId, socket] of sockets) {
      this.markDesktopOffline({ connectionId, reason: "server_shutdown" })
      try {
        socket.close(1012, "server_shutdown")
        socket.terminate()
      } catch (error) {
        this.logger.warn({
          connectionId,
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Live desktop shutdown socket close failed")
      }
    }
    if (this.server) {
      try {
        this.server.close()
      } catch (error) {
        this.logger.warn({
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Live desktop websocket server close failed")
      }
      this.server = null
    }
    if (sockets.length > 0) {
      this.logger.warn({
        ...(signal ? { signal } : {}),
        socketCount: sockets.length,
      }, "Live desktop sockets closed for server shutdown")
    }
  }

  bindAuthenticatedSocket(socket: WebSocket, auth: { readonly userId: string }): void {
    const connectionId = this.clock.randomId()
    let registered = false
    let registeredClient: LiveClientInstance | null = null
    this.socketsByConnectionId.set(connectionId, socket)
    this.logger.log({
      connectionId,
      userId: auth.userId,
    }, "Live desktop websocket authenticated")

    socket.on("message", (payload) => {
      const message = parseLiveDesktopMessage(payload)
      if (!message) {
        socket.close(1003, "invalid_message")
        return
      }

      if (message.type === LIVE_MESSAGE_TYPES.hello) {
        if (registered) {
          socket.close(1008, "hello_already_received")
          return
        }

        const hello = message.payload
        const seenAt = this.clock.now()
        const client = this.registry.register({
          userId: auth.userId,
          clientInstanceId: hello.clientInstanceId,
          connectionId,
          appVersion: hello.appVersion,
          platform: hello.platform,
          deviceName: hello.deviceName,
          now: seenAt,
          onSupersede: (oldConnectionId) => {
            this.socketsByConnectionId.get(oldConnectionId)?.close(1000, "superseded")
            this.socketsByConnectionId.delete(oldConnectionId)
            this.logger.warn({
              clientInstanceId: hello.clientInstanceId,
              connectionId: oldConnectionId,
              newConnectionId: connectionId,
              userId: auth.userId,
            }, "Live desktop websocket superseded")
          },
        })
        registeredClient = client
        registered = true
        this.logger.log({
          appVersion: client.appVersion,
          clientInstanceId: client.clientInstanceId,
          connectionId,
          deviceName: client.deviceName,
          platform: client.platform,
          userId: auth.userId,
        }, "Live desktop client registered")
        this.upsertDeviceMetadata(client, seenAt)
        this.publish(client)
        // A computer signing in is the whole point: a phone that was already open
        // and showing "电脑离线" learns about it here, not by asking again.
        this.notifyDesktopPresence(client.userId)
        const serverTime = this.clock.now().toISOString()
        sendJson(socket, createLiveEnvelope(LIVE_MESSAGE_TYPES.welcome, {
          connectionId,
          serverTime,
          heartbeatIntervalMs,
          heartbeatTimeoutMs,
        }, { id: connectionId, sentAt: serverTime }))
        return
      }

      if (!registered) {
        socket.close(1008, "hello_required")
        return
      }

      const now = this.clock.now()
      const client = this.registry.touch(connectionId, now)
      if (client) {
        registeredClient = client
        this.publish(client)
        // A client that missed its heartbeat window is off the reachable list
        // until it speaks again, so this is also how it comes back.
        this.notifyDesktopPresence(client.userId)
      }
      if (message.type === LIVE_MESSAGE_TYPES.webhookDeliveryAck) {
        const ackClient = client ?? registeredClient
        if (!ackClient) {
          socket.close(1008, "hello_required")
          return
        }
        void Promise.resolve(this.webhookDeliveryAckHandler?.recordDeliveryAck({
          userId: auth.userId,
          deliveryId: message.payload.deliveryId,
          clientInstanceId: ackClient.clientInstanceId,
          deviceName: ackClient.deviceName,
          platform: ackClient.platform,
          appVersion: ackClient.appVersion,
          acknowledgedAt: now,
        })).catch((error: unknown) => {
          this.logger.warn({
            clientInstanceId: ackClient.clientInstanceId,
            deliveryId: message.payload.deliveryId,
            errorName: error instanceof Error ? error.name : typeof error,
            userId: auth.userId,
          }, "Live webhook delivery acknowledgement failed")
        })
        return
      }
      if (message.type === LIVE_MESSAGE_TYPES.mobileSummary
        || message.type === LIVE_MESSAGE_TYPES.mobileFrame
        || message.type === LIVE_MESSAGE_TYPES.mobileIntentResult
        || message.type === LIVE_MESSAGE_TYPES.mobileTransferProgress) {
        // Terminal payloads for phones go to the relay, not back to the sender.
        // Without a relay installed they are dropped rather than answered.
        this.handleMobileRelayMessage(auth.userId, message)
        return
      }

      const serverTime = this.clock.now().toISOString()
      sendJson(socket, createLiveEnvelope(LIVE_MESSAGE_TYPES.pong, {
        serverTime,
      }, { id: message.id, sentAt: serverTime }))
    })

    socket.on("close", (code?: number, reason?: Buffer) => {
      this.socketsByConnectionId.delete(connectionId)
      this.logger.warn({
        ...(code !== undefined ? { closeCode: code } : {}),
        ...closeReasonLogMeta(reason),
        connectionId,
        userId: auth.userId,
      }, "Live desktop websocket closed")
      this.markDesktopOffline({ connectionId, reason: "socket_close" })
    })

    socket.on("error", (error) => {
      this.socketsByConnectionId.delete(connectionId)
      this.logger.warn({
        connectionId,
        errorName: error instanceof Error ? error.name : typeof error,
        userId: auth.userId,
      }, "Live desktop websocket error")
      this.markDesktopOffline({ connectionId, reason: "socket_error" })
    })
  }

  sweepStaleClients(): void {
    const connectionIdsByClient = new Map<string, string>()
    for (const client of this.registry.listAll()) {
      if (client.connectionId) {
        connectionIdsByClient.set(liveClientKey(client), client.connectionId)
      }
    }

    for (const client of this.registry.markStaleClients(this.clock.now())) {
      const connectionId = connectionIdsByClient.get(liveClientKey(client))
      this.logger.warn({
        clientInstanceId: client.clientInstanceId,
        ...(connectionId ? { connectionId } : {}),
        ...(client.disconnectReason ? { disconnectReason: client.disconnectReason } : {}),
        status: client.status,
        userId: client.userId,
      }, "Live desktop client heartbeat stale")
      if (client.status === "offline") {
        if (connectionId) {
          this.closeStaleSocket(connectionId, client)
        }
      }
      this.publish(client)
      // This path marks clients offline through the registry rather than through
      // `markDesktopOffline`, so it has to report presence itself. Both "stale"
      // and "offline" drop the client off the reachable list.
      this.notifyDesktopPresence(client.userId)
    }
  }

  disconnectUser(userId: string): void {
    const clients = this.registry.listOnlineByUser(userId)

    for (const client of clients) {
      if (!client.connectionId) continue

      const connectionId = client.connectionId
      const socket = this.socketsByConnectionId.get(connectionId)
      this.socketsByConnectionId.delete(connectionId)

      this.markDesktopOffline({ connectionId, reason: "user_disabled" })

      if (!socket) continue

      try {
        socket.close(1008, "user_disabled")
      } catch (error) {
        this.logger.warn({
          connectionId,
          errorName: error instanceof Error ? error.name : typeof error,
          userId,
        }, "Live user disconnect failed")
      }
    }
  }

  broadcastToUser(userId: string, message: LiveDesktopServerMessage): {
    readonly onlineClientCount: number
    readonly sentClientCount: number
    readonly failedClientCount: number
    readonly clientResults: readonly LiveBroadcastClientResult[]
  } {
    const clients = this.registry.listOnlineByUser(userId)
    let sentClientCount = 0
    let failedClientCount = 0
    const clientResults: LiveBroadcastClientResult[] = []

    for (const client of clients) {
      const sentAt = this.clock.now().toISOString()
      if (!client.connectionId) continue
      const socket = this.socketsByConnectionId.get(client.connectionId)
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        failedClientCount += 1
        clientResults.push(toBroadcastClientResult(client, sentAt, WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sendFailed))
        continue
      }

      try {
        sendJson(socket, message)
        sentClientCount += 1
        clientResults.push(toBroadcastClientResult(client, sentAt, WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sent))
      } catch (error) {
        failedClientCount += 1
        clientResults.push(toBroadcastClientResult(client, sentAt, WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sendFailed))
        this.logger.warn({
          connectionId: client.connectionId,
          errorName: error instanceof Error ? error.name : typeof error,
          userId,
        }, "Live user broadcast failed")
      }
    }

    return {
      onlineClientCount: clients.length,
      sentClientCount,
      failedClientCount,
      clientResults,
    }
  }

  private async authenticateUpgrade(request: IncomingMessage): Promise<{ readonly userId: string } | null> {
    const token = readBearerToken(request.headers.authorization)
    if (!token) {
      return null
    }

    const result = await this.auth.verifyAccessToken(token)
    return { userId: result.userId }
  }

  private publish(client: LiveClientInstance): void {
    this.streams.publish({
      type: "live.client.changed",
      occurredAt: this.clock.now().toISOString(),
      client: toPublicDto(client, { includeUserId: true }),
    })
  }

  private handleMobileRelayMessage(userId: string, message: LiveDesktopClientMessage): void {
    const relay = this.mobileRelayHandler
    if (!relay) {
      this.logger.warn({ messageType: message.type }, "Live mobile relay message dropped")
      return
    }
    try {
      if (message.type === LIVE_MESSAGE_TYPES.mobileSummary) {
        relay.handleSummary(userId, message.payload)
        return
      }
      if (message.type === LIVE_MESSAGE_TYPES.mobileFrame) {
        relay.handleFrame(userId, message.payload)
        return
      }
      if (message.type === LIVE_MESSAGE_TYPES.mobileTransferProgress) {
        relay.handleTransferProgress(userId, message.payload)
        return
      }
      if (message.type === LIVE_MESSAGE_TYPES.mobileIntentResult) {
        relay.handleIntentResult(userId, message.payload)
        return
      }
      // Named rather than cast into the last handler that happens to accept this
      // shape: a type added to the union without a branch here would otherwise be
      // delivered as something it is not.
      this.logger.warn({ messageType: message.type, userId }, "Unhandled mobile relay message")
    } catch (error) {
      // A relay failure must not tear down the desktop's own connection.
      this.logger.warn({
        messageType: message.type,
        errorName: error instanceof Error ? error.name : typeof error,
        userId,
      }, "Live mobile relay message failed")
    }
  }

  private closeStaleSocket(connectionId: string, client: LiveClientInstance): void {
    const socket = this.socketsByConnectionId.get(connectionId)
    this.socketsByConnectionId.delete(connectionId)
    if (!socket) return

    try {
      socket.close(1000, "heartbeat_timeout")
    } catch (error) {
      this.logger.warn({
        clientInstanceId: client.clientInstanceId,
        connectionId,
        errorName: error instanceof Error ? error.name : typeof error,
        userId: client.userId,
      }, "Live stale socket close failed")
    }
  }

  private upsertDeviceMetadata(client: LiveClientInstance, seenAt: Date): void {
    void this.devices?.upsertFromHello({
      userId: client.userId,
      clientInstanceId: client.clientInstanceId,
      deviceName: client.deviceName,
      platform: client.platform,
      appVersion: client.appVersion,
      seenAt,
    }).catch((error: unknown) => {
      this.logger.warn({
        clientInstanceId: client.clientInstanceId,
        errorName: error instanceof Error ? error.name : typeof error,
        userId: client.userId,
      }, "Live desktop device metadata upsert failed")
    })
  }
}

export function createLiveDesktopGatewayForTest(input: LiveDesktopGatewayTestInput): LiveDesktopGateway {
  return LiveDesktopGateway.createForTest(input)
}

export function parseLiveDesktopMessage(payload: RawData | string): LiveDesktopClientMessage | null {
  const text = rawDataToText(payload)
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") {
    return null
  }

  return isLiveDesktopClientMessage(parsed) ? parsed : null
}

function toBroadcastClientResult(
  client: LiveClientInstance,
  sentAt: string,
  status: LiveBroadcastClientResult["status"],
): LiveBroadcastClientResult {
  return {
    clientInstanceId: client.clientInstanceId,
    deviceName: client.deviceName,
    platform: client.platform,
    appVersion: client.appVersion,
    sentAt,
    status,
  }
}

function sendJson(socket: WebSocket, message: LiveDesktopServerMessage): void {
  socket.send(JSON.stringify(message))
}

function rawDataToText(payload: RawData | string): string {
  if (typeof payload === "string") {
    return payload
  }

  if (Array.isArray(payload)) {
    return Buffer.concat(payload).toString("utf8")
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload).toString("utf8")
  }

  return payload.toString("utf8")
}

function readBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  const [scheme, token] = value?.split(/\s+/, 2) ?? []
  return scheme?.toLowerCase() === "bearer" && token ? token : null
}

function liveClientKey(client: Pick<LiveClientInstance, "clientInstanceId" | "userId">): string {
  return `${client.userId}:${client.clientInstanceId}`
}

function closeReasonLogMeta(reason: Buffer | undefined): { readonly closeReason?: string } {
  const closeReason = reason?.toString("utf8")
  return closeReason ? { closeReason: formatAuditError(closeReason) } : {}
}

function upgradePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname
  } catch {
    return "/"
  }
}

function rejectUpgrade(socket: NodeJS.WritableStream & { readonly destroy: () => unknown }): void {
  socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
  socket.destroy()
}
