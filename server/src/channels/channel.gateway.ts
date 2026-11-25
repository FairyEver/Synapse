import { Injectable, Logger, type OnApplicationShutdown, type OnModuleDestroy } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import {
  CHANNEL_WS_CLOSE_CODES,
  channelWsClientFrameSchema,
  type ChannelEventSender,
  type ChannelWsClientFrame,
} from "@synapse/shared/channel-contracts"
import { RawData, WebSocket, WebSocketServer } from "ws"
import { OpenApiHttpError } from "../open-api/open-api.types"
import type { ChannelSocketAdapter, LiveChannelConnection } from "./channel-hub"
import { ChannelService, type ResolvedWsCredential } from "./channel.service"

const CHANNEL_WS_PATH_REGEX = /^\/api\/open\/v1\/channels\/([A-Za-z0-9_-]+)\/ws\/?$/iu
const FORBIDDEN_QUERY_CREDENTIAL_KEYS = new Set([
  "token",
  "access_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "auth",
  "authorization",
])
const MAX_CONSECUTIVE_RATE_VIOLATIONS = 5

type ActiveSocketState = {
  readonly ws: WebSocket
  readonly channelId: string
  authTimer: NodeJS.Timeout | null
  authenticating: boolean
  connection: LiveChannelConnection | null
  missedPongs: number
  consecutiveRateViolations: number
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string, body: string): void {
  if (!socket.destroyed) {
    socket.write(
      `HTTP/1.1 ${statusCode} ${statusText}\r\n`
      + "Connection: close\r\n"
      + "Content-Type: text/plain; charset=utf-8\r\n"
      + `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`
      + body,
    )
    socket.destroy()
  }
}

function parseUpgradeTarget(request: IncomingMessage): { readonly channelId: string; readonly hasForbiddenQuerySecret: boolean } | null {
  let url: URL
  try {
    url = new URL(request.url ?? "/", "http://localhost")
  } catch (error) {
    void error
    return null
  }
  const match = CHANNEL_WS_PATH_REGEX.exec(url.pathname)
  if (!match?.[1]) return null

  let hasForbiddenQuerySecret = false
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_CREDENTIAL_KEYS.has(key.toLowerCase())) {
      hasForbiddenQuerySecret = true
      break
    }
  }
  return { channelId: match[1], hasForbiddenQuerySecret }
}

function extractUpgradeBearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (typeof header !== "string") return null
  return /^Bearer ([^\s]+)$/u.exec(header)?.[1] ?? null
}

function createWsAdapter(ws: WebSocket): ChannelSocketAdapter {
  return {
    get bufferedAmount() {
      return ws.bufferedAmount
    },
    send(data: string) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open")
      ws.send(data)
    },
    close(code: number, reason: string) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason)
      }
    },
  }
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

@Injectable()
export class ChannelGateway implements OnApplicationShutdown, OnModuleDestroy {
  private readonly logger = new Logger(ChannelGateway.name)
  private server: WebSocketServer | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private readonly activeSockets = new Set<ActiveSocketState>()

  constructor(private readonly channels: ChannelService) {}

  attach(httpServer: HttpServer): void {
    if (this.server) return
    const limits = this.channels.hub.getLimits()
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: limits.maxWsFrameBytes,
    })

    this.heartbeatTimer = setInterval(() => {
      this.sweepHeartbeats()
    }, limits.heartbeatIntervalMs)
    this.heartbeatTimer.unref?.()

    httpServer.on("upgrade", (request, socket, head) => {
      const target = parseUpgradeTarget(request)
      if (!target) return

      if (target.hasForbiddenQuerySecret) {
        rejectUpgrade(socket, 400, "Bad Request", "Credentials must not be passed in URL query parameters.")
        return
      }

      const bearer = extractUpgradeBearer(request)
      if (bearer) {
        void this.channels.authenticateWsCredential(bearer, target.channelId)
          .then((credential) => {
            if (!credential) {
              rejectUpgrade(socket, 401, "Unauthorized", "Invalid channel credential.")
              return
            }
            this.server?.handleUpgrade(request, socket, head, (ws) => {
              this.bindSocket(ws, target.channelId, credential)
            })
          })
          .catch((error: unknown) => {
            this.logger.warn({
              channelId: target.channelId,
              errorName: error instanceof Error ? error.name : typeof error,
            }, "Channel WebSocket upgrade authentication failed")
            rejectUpgrade(socket, 503, "Service Unavailable", "Authentication service unavailable.")
          })
        return
      }

      // Standard browser flow: upgrade first, require first-frame `auth` within authTimeoutMs.
      this.server?.handleUpgrade(request, socket, head, (ws) => {
        this.bindSocket(ws, target.channelId, null)
      })
    })
  }

  onApplicationShutdown(): void {
    this.shutdown()
  }

  onModuleDestroy(): void {
    this.shutdown()
  }

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    for (const state of [...this.activeSockets]) {
      if (state.authTimer) {
        clearTimeout(state.authTimer)
        state.authTimer = null
      }
      if (!state.connection) {
        if (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING) {
          state.ws.close(CHANNEL_WS_CLOSE_CODES.GOING_AWAY, "Server shutting down")
        }
      }
    }
    this.channels.hub.shutdownAll()
    this.activeSockets.clear()
    if (this.server) {
      const closing = this.server
      this.server = null
      closing.close()
    }
  }

  private bindSocket(ws: WebSocket, channelId: string, preAuthenticated: ResolvedWsCredential | null): void {
    const limits = this.channels.hub.getLimits()
    const state: ActiveSocketState = {
      ws,
      channelId,
      authTimer: null,
      authenticating: false,
      connection: null,
      missedPongs: 0,
      consecutiveRateViolations: 0,
    }
    this.activeSockets.add(state)

    ws.on("pong", () => {
      state.missedPongs = 0
    })

    ws.on("close", () => {
      this.cleanupSocket(state)
    })

    ws.on("error", () => {
      this.cleanupSocket(state)
    })

    ws.on("message", (raw: RawData) => {
      state.missedPongs = 0
      void this.handleMessage(state, raw)
    })

    if (preAuthenticated) {
      void this.completeAuthentication(state, preAuthenticated, {
        includeRetained: true,
      })
      return
    }

    state.authTimer = setTimeout(() => {
      if (!state.connection && ws.readyState === WebSocket.OPEN) {
        sendJson(ws, { type: "error", code: "AUTH_TIMEOUT", message: "认证超时，请在建连后 5 秒内发送 auth 帧。" })
        ws.close(CHANNEL_WS_CLOSE_CODES.AUTH_FAILED, "Authentication timeout")
      }
    }, limits.authTimeoutMs)
    state.authTimer.unref?.()
  }

  private async handleMessage(state: ActiveSocketState, raw: RawData): Promise<void> {
    let parsedJson: unknown
    try {
      const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : Buffer.concat(raw as Buffer[]).toString("utf8")
      parsedJson = JSON.parse(text)
    } catch (error) {
      void error
      sendJson(state.ws, { type: "error", code: "INVALID_JSON", message: "消息必须是合法 JSON。" })
      return
    }

    const parsed = channelWsClientFrameSchema.safeParse(parsedJson)
    if (!parsed.success) {
      const requestId = parsedJson && typeof parsedJson === "object" && typeof (parsedJson as { id?: unknown }).id === "string"
        ? (parsedJson as { id: string }).id
        : undefined
      sendJson(state.ws, {
        type: "error",
        ...(requestId ? { id: requestId } : {}),
        code: "INVALID_FRAME",
        message: parsed.error.issues[0]?.message ?? "消息帧格式无效。",
      })
      return
    }

    const frame: ChannelWsClientFrame = parsed.data

    if (!state.connection) {
      if (frame.type !== "auth") {
        sendJson(state.ws, { type: "error", code: "UNAUTHENTICATED", message: "请先发送 auth 帧完成认证。" })
        state.ws.close(CHANNEL_WS_CLOSE_CODES.AUTH_FAILED, "Unauthenticated")
        return
      }
      if (state.authenticating) return
      state.authenticating = true
      try {
        const credential = await this.channels.authenticateWsCredential(frame.token, state.channelId)
        if (!credential || state.ws.readyState !== WebSocket.OPEN) {
          if (state.ws.readyState === WebSocket.OPEN) {
            sendJson(state.ws, { type: "error", code: "INVALID_CREDENTIAL", message: "频道凭证或 API 密钥无效。" })
            state.ws.close(CHANNEL_WS_CLOSE_CODES.AUTH_FAILED, "Invalid credential")
          }
          return
        }
        await this.completeAuthentication(state, credential, {
          clientId: frame.clientId,
          clientName: frame.clientName,
          meta: frame.meta,
          eventsFilter: frame.events,
          afterSeq: frame.afterSeq,
          includeRetained: frame.includeRetained,
        })
      } catch (error: unknown) {
        this.logger.warn({
          channelId: state.channelId,
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Channel WebSocket first-frame auth failed")
        if (state.ws.readyState === WebSocket.OPEN) {
          sendJson(state.ws, { type: "error", code: "INTERNAL_ERROR", message: "认证服务暂不可用。" })
          state.ws.close(CHANNEL_WS_CLOSE_CODES.GOING_AWAY, "Auth unavailable")
        }
      } finally {
        state.authenticating = false
      }
      return
    }

    const conn = state.connection
    switch (frame.type) {
      case "auth":
        sendJson(state.ws, { type: "error", code: "ALREADY_AUTHENTICATED", message: "连接已完成认证。" })
        return
      case "ping":
        sendJson(state.ws, { type: "pong", serverTime: new Date().toISOString() })
        return
      case "presence.update":
        if (conn.isObserver) {
          sendJson(state.ws, { type: "error", code: "FORBIDDEN_OBSERVER", message: "调试台观察者不参与在线名单。" })
          return
        }
        this.channels.hub.updatePresence(conn.channelId, conn.connectionId, {
          clientName: frame.clientName,
          meta: frame.meta,
        })
        return
      case "publish":
        if (conn.role === "subscribe") {
          sendJson(state.ws, {
            type: "error",
            ...(frame.id ? { id: frame.id } : {}),
            code: "FORBIDDEN_ROLE",
            message: "当前凭证仅允许订阅，不能发布事件。",
          })
          return
        }
        if (!this.channels.hub.consumeWsPublishRate(conn.connectionId)) {
          state.consecutiveRateViolations += 1
          sendJson(state.ws, {
            type: "error",
            ...(frame.id ? { id: frame.id } : {}),
            code: "RATE_LIMITED",
            message: "发送频率超出限制，请稍后重试。",
          })
          if (state.consecutiveRateViolations >= MAX_CONSECUTIVE_RATE_VIOLATIONS) {
            state.ws.close(CHANNEL_WS_CLOSE_CODES.LIMIT_EXCEEDED, "Rate limit exceeded")
          }
          return
        }
        state.consecutiveRateViolations = 0
        try {
          const sender: ChannelEventSender = conn.isObserver
            ? { connectionId: null, clientId: "console-debugger", clientName: "Console 调试台" }
            : { connectionId: conn.connectionId, clientId: conn.clientId, clientName: conn.clientName }
          const result = await this.channels.publishFromWs({
            channelId: conn.channelId,
            event: frame.event,
            payload: frame.payload,
            retain: frame.retain,
            echo: frame.echo,
            targetClientId: frame.targetClientId,
            sender,
          })
          if (frame.id) {
            sendJson(state.ws, {
              type: "ack",
              id: frame.id,
              seq: result.seq,
              deliveredCount: result.deliveredCount,
              retained: result.retained,
            })
          }
        } catch (error: unknown) {
          if (error instanceof OpenApiHttpError) {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: error.code,
              message: error.publicMessage,
            })
            return
          }
          sendJson(state.ws, {
            type: "error",
            ...(frame.id ? { id: frame.id } : {}),
            code: "INTERNAL_ERROR",
            message: "发布事件失败。",
          })
        }
        return
      case "retained.clear":
        if (conn.role === "subscribe") {
          sendJson(state.ws, {
            type: "error",
            ...(frame.id ? { id: frame.id } : {}),
            code: "FORBIDDEN_ROLE",
            message: "当前凭证仅允许订阅，不能清除状态快照。",
          })
          return
        }
        try {
          const res = await this.channels.clearRetainedDirect(conn.channelId, frame.event)
          if (frame.id) {
            sendJson(state.ws, {
              type: "ack",
              id: frame.id,
              deleted: res.deleted,
            })
          }
        } catch (error: unknown) {
          const code = error instanceof OpenApiHttpError ? error.code : "INTERNAL_ERROR"
          const message = error instanceof OpenApiHttpError ? error.publicMessage : "清除状态快照失败。"
          sendJson(state.ws, {
            type: "error",
            ...(frame.id ? { id: frame.id } : {}),
            code,
            message,
          })
        }
    }
  }

  private async completeAuthentication(
    state: ActiveSocketState,
    credential: ResolvedWsCredential,
    options: {
      readonly clientId?: string
      readonly clientName?: string
      readonly meta?: Record<string, unknown>
      readonly eventsFilter?: readonly string[]
      readonly afterSeq?: number
      readonly includeRetained: boolean
    },
  ): Promise<void> {
    if (state.authTimer) {
      clearTimeout(state.authTimer)
      state.authTimer = null
    }
    const clientId = credential.isObserver
      ? "console-debugger"
      : (options.clientId ?? `cli_${randomUUID().replaceAll("-", "").slice(0, 12)}`)
    const clientName = credential.isObserver ? "Console 调试台" : (options.clientName ?? null)

    const shouldLoadRetained = credential.role !== "publish" && options.includeRetained
    const retained = shouldLoadRetained ? await this.channels.loadRetainedItems(credential.channelId) : undefined
    if (state.ws.readyState !== WebSocket.OPEN) return

    const registered = this.channels.hub.registerConnection({
      channelId: credential.channelId,
      ownerId: credential.ownerId,
      credentialType: credential.credentialType,
      credentialId: credential.credentialId,
      role: credential.role,
      isObserver: credential.isObserver,
      clientId,
      clientName,
      meta: options.meta ?? {},
      eventsFilter: options.eventsFilter,
      afterSeq: options.afterSeq,
      seqFloor: credential.seqFloor,
      socket: createWsAdapter(state.ws),
    })

    if (!registered.ok) {
      sendJson(state.ws, { type: "error", code: registered.code, message: registered.message })
      state.ws.close(registered.closeCode, registered.message)
      return
    }

    state.connection = registered.connection
    sendJson(state.ws, {
      type: "ready",
      channelId: credential.channelId,
      connectionId: registered.connection.connectionId,
      clientId: registered.connection.clientId,
      role: registered.connection.role,
      latestSeq: registered.readySnapshot.latestSeq,
      replayTruncated: registered.readySnapshot.replayTruncated,
      presence: registered.readySnapshot.presence,
      ...(retained !== undefined ? { retained } : {}),
    })

    for (const replayFrame of registered.readySnapshot.replayEvents) {
      sendJson(state.ws, replayFrame as unknown as Record<string, unknown>)
    }
  }

  private sweepHeartbeats(): void {
    const maxMissed = this.channels.hub.getLimits().maxMissedHeartbeats
    for (const state of [...this.activeSockets]) {
      if (state.ws.readyState !== WebSocket.OPEN) {
        this.cleanupSocket(state)
        continue
      }
      if (state.missedPongs >= maxMissed) {
        state.ws.close(CHANNEL_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, "Heartbeat timeout")
        this.cleanupSocket(state)
        continue
      }
      state.missedPongs += 1
      try {
        state.ws.ping()
      } catch (error) {
        void error
        this.cleanupSocket(state)
      }
    }
  }

  private cleanupSocket(state: ActiveSocketState): void {
    if (state.authTimer) {
      clearTimeout(state.authTimer)
      state.authTimer = null
    }
    this.activeSockets.delete(state)
    if (state.connection) {
      const conn = state.connection
      state.connection = null
      this.channels.hub.unregisterConnection(conn.channelId, conn.connectionId)
    }
  }
}
