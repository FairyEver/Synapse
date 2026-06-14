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
} from "@synapse/shared"
import { RawData, WebSocket, WebSocketServer } from "ws"
import { UserAuthService } from "../auth/user-auth.service"
import { formatAuditError } from "../common/audit-error"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveDeviceService } from "./live-device.service"
import { toPublicDto } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"
import type { LiveClientInstance } from "./live.types"

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
export const liveDesktopMaxPayloadBytes = 16 * 1024

@Injectable()
export class LiveDesktopGateway implements OnApplicationShutdown {
  private readonly logger = new Logger(LiveDesktopGateway.name)
  private readonly socketsByConnectionId = new Map<string, WebSocket>()
  private server: WebSocketServer | null = null
  private staleInterval: NodeJS.Timeout | null = null
  private clock: LiveDesktopGatewayClock = { randomId: randomUUID, now: () => new Date() }
  private webhookDeliveryAckHandler: WebhookDeliveryAckHandler | null = null

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
      const client = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "server_shutdown",
      })
      if (client) {
        this.publish(client)
      }
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
      const client = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "socket_close",
      })
      if (client) {
        this.publish(client)
      }
    })

    socket.on("error", (error) => {
      this.socketsByConnectionId.delete(connectionId)
      this.logger.warn({
        connectionId,
        errorName: error instanceof Error ? error.name : typeof error,
        userId: auth.userId,
      }, "Live desktop websocket error")
      const client = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "socket_error",
      })
      if (client) {
        this.publish(client)
      }
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
    }
  }

  disconnectUser(userId: string): void {
    const clients = this.registry.listOnlineByUser(userId)

    for (const client of clients) {
      if (!client.connectionId) continue

      const connectionId = client.connectionId
      const socket = this.socketsByConnectionId.get(connectionId)
      this.socketsByConnectionId.delete(connectionId)

      const disconnected = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "user_disabled",
      })
      if (disconnected) {
        this.publish(disconnected)
      }

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
