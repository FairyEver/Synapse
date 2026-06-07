import { randomUUID } from "node:crypto"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import { Injectable, Logger } from "@nestjs/common"
import {
  LIVE_MESSAGE_TYPES,
  createLiveEnvelope,
  isLiveDesktopClientMessage,
  type LiveDesktopClientMessage,
  type LiveDesktopServerMessage,
} from "@synapse/shared"
import { RawData, WebSocket, WebSocketServer } from "ws"
import { UserAuthService } from "../auth/user-auth.service"
import { LiveClientRegistry } from "./live-client-registry"
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
}

const liveDesktopPath = "/api/live/desktop"
const heartbeatIntervalMs = 20_000
const heartbeatTimeoutMs = 45_000

@Injectable()
export class LiveDesktopGateway {
  private readonly logger = new Logger(LiveDesktopGateway.name)
  private readonly socketsByConnectionId = new Map<string, WebSocket>()
  private server: WebSocketServer | null = null
  private staleInterval: NodeJS.Timeout | null = null
  private clock: LiveDesktopGatewayClock = { randomId: randomUUID, now: () => new Date() }

  constructor(
    private readonly auth: UserAuthService,
    private readonly registry: LiveClientRegistry,
    private readonly streams: LiveStreamService,
  ) {}

  static createForTest(input: LiveDesktopGatewayTestInput): LiveDesktopGateway {
    const gateway = new LiveDesktopGateway(input.auth, input.registry, input.streams)
    gateway.clock = input.clock
    return gateway
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
    return new WebSocketServer({ noServer: true })
  }

  bindAuthenticatedSocket(socket: WebSocket, auth: { readonly userId: string }): void {
    const connectionId = this.clock.randomId()
    let registered = false
    this.socketsByConnectionId.set(connectionId, socket)

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
        const client = this.registry.register({
          userId: auth.userId,
          clientInstanceId: hello.clientInstanceId,
          connectionId,
          appVersion: hello.appVersion,
          platform: hello.platform,
          deviceName: hello.deviceName,
          now: this.clock.now(),
          onSupersede: (oldConnectionId) => {
            this.socketsByConnectionId.get(oldConnectionId)?.close(1000, "superseded")
            this.socketsByConnectionId.delete(oldConnectionId)
          },
        })
        registered = true
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

      const client = this.registry.touch(connectionId, this.clock.now())
      if (client) {
        this.publish(client)
      }
      const serverTime = this.clock.now().toISOString()
      sendJson(socket, createLiveEnvelope(LIVE_MESSAGE_TYPES.pong, {
        serverTime,
      }, { id: message.id, sentAt: serverTime }))
    })

    socket.on("close", () => {
      this.socketsByConnectionId.delete(connectionId)
      const client = this.registry.markDisconnected({
        connectionId,
        now: this.clock.now(),
        reason: "socket_close",
      })
      if (client) {
        this.publish(client)
      }
    })

    socket.on("error", () => {
      this.socketsByConnectionId.delete(connectionId)
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
      if (client.status === "offline") {
        const connectionId = connectionIdsByClient.get(liveClientKey(client))
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
  } {
    const clients = this.registry.listOnlineByUser(userId)
    let sentClientCount = 0
    let failedClientCount = 0

    for (const client of clients) {
      if (!client.connectionId) continue
      const socket = this.socketsByConnectionId.get(client.connectionId)
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        failedClientCount += 1
        continue
      }

      try {
        sendJson(socket, message)
        sentClientCount += 1
      } catch (error) {
        failedClientCount += 1
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
