import { randomUUID } from "node:crypto"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import { Injectable, Logger } from "@nestjs/common"
import { RawData, WebSocket, WebSocketServer } from "ws"
import { UserAuthService } from "../auth/user-auth.service"
import { LiveClientRegistry } from "./live-client-registry"
import { toPublicDto } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"
import type {
  LiveClientInstance,
  LiveDesktopClientMessage,
  LiveDesktopHello,
  LiveDesktopServerMessage,
} from "./live.types"

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

      if (message.type === "hello") {
        if (registered) {
          socket.close(1008, "hello_already_received")
          return
        }

        const client = this.registry.register({
          userId: auth.userId,
          clientInstanceId: message.clientInstanceId,
          connectionId,
          appVersion: message.appVersion,
          platform: message.platform,
          deviceName: message.deviceName,
          now: this.clock.now(),
          onSupersede: (oldConnectionId) => {
            this.socketsByConnectionId.get(oldConnectionId)?.close(1000, "superseded")
            this.socketsByConnectionId.delete(oldConnectionId)
          },
        })
        registered = true
        this.publish(client)
        sendJson(socket, {
          type: "welcome",
          connectionId,
          serverTime: this.clock.now().toISOString(),
          heartbeatIntervalMs,
          heartbeatTimeoutMs,
        })
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
      sendJson(socket, { type: "pong", serverTime: this.clock.now().toISOString() })
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
    for (const client of this.registry.markStaleClients(this.clock.now())) {
      this.publish(client)
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

  const record = parsed as Record<string, unknown>
  if (record.type === "ping" && typeof record.sentAt === "string" && record.sentAt.trim()) {
    return { type: "ping", sentAt: record.sentAt }
  }

  if (record.type !== "hello") {
    return null
  }

  const hello = {
    type: "hello",
    clientInstanceId: stringField(record.clientInstanceId),
    appVersion: stringField(record.appVersion),
    platform: stringField(record.platform),
    deviceName: stringField(record.deviceName),
  } satisfies LiveDesktopHello

  return hello.clientInstanceId && hello.appVersion && hello.platform && hello.deviceName ? hello : null
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

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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

function rejectUpgrade(socket: NodeJS.WritableStream & { readonly destroy: () => unknown }): void {
  socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
  socket.destroy()
}
