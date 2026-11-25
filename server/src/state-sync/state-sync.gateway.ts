import { Injectable, Logger, type OnApplicationShutdown, type OnModuleDestroy } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import {
  STATE_SYNC_WS_CLOSE_CODES,
  stateSyncWsClientFrameSchema,
  type StateSyncWsClientFrame,
} from "@synapse/shared/state-sync-contracts"
import { RawData, WebSocket, WebSocketServer } from "ws"
import type {
  DisconnectReason,
  LiveStateSyncConnection,
  StateSyncSocketAdapter,
} from "./state-sync-hub"
import { StateSyncService, type ResolvedStateSyncWsCredential } from "./state-sync.service"

const STATE_SYNC_WS_PATH_REGEX = /^\/api\/open\/v1\/state-sync\/spaces\/([^/]+)\/docs\/([^/]+)\/ws\/?$/iu
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
const MAX_PENDING_AUTH_MESSAGES = 16

type ActiveSocketState = {
  readonly ws: WebSocket
  readonly spaceId: string
  readonly docId: string
  authTimer: NodeJS.Timeout | null
  authenticating: boolean
  closed: boolean
  closeReason: DisconnectReason | null
  readonly pendingMessages: RawData[]
  connection: LiveStateSyncConnection | null
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

function parseUpgradeTarget(
  request: IncomingMessage,
): { readonly spaceId: string; readonly docId: string; readonly hasForbiddenQuerySecret: boolean } | null {
  let url: URL
  try {
    url = new URL(request.url ?? "/", "http://localhost")
  } catch (error) {
    void error
    return null
  }
  const match = STATE_SYNC_WS_PATH_REGEX.exec(url.pathname)
  if (!match?.[1] || !match[2]) return null

  let spaceId: string
  let docId: string
  try {
    spaceId = decodeURIComponent(match[1])
    docId = decodeURIComponent(match[2])
  } catch (error) {
    void error
    return null
  }
  if (!spaceId || !docId) return null

  let hasForbiddenQuerySecret = false
  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_CREDENTIAL_KEYS.has(key.toLowerCase())) {
      hasForbiddenQuerySecret = true
      break
    }
  }
  return { spaceId, docId, hasForbiddenQuerySecret }
}

function extractUpgradeBearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (typeof header !== "string") return null
  return /^Bearer ([^\s]+)$/u.exec(header)?.[1] ?? null
}

function createWsAdapter(ws: WebSocket): StateSyncSocketAdapter {
  return {
    get bufferedAmount() {
      return ws.bufferedAmount
    },
    send(data: string) {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open")
      ws.send(data)
    },
    close(code: number, reason: string) {
      if (ws.readyState === WebSocket.OPEN) {
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
export class StateSyncGateway implements OnApplicationShutdown, OnModuleDestroy {
  private readonly logger = new Logger(StateSyncGateway.name)
  private server: WebSocketServer | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private readonly activeSockets = new Set<ActiveSocketState>()
  private shutdownPromise: Promise<void> | null = null

  constructor(private readonly stateSync: StateSyncService) {}

  attach(httpServer: HttpServer): void {
    if (this.server) return
    const limits = this.stateSync.hub.getLimits()
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

      if (this.shutdownPromise) {
        rejectUpgrade(socket, 503, "Service Unavailable", "Server shutting down.")
        return
      }

      if (target.hasForbiddenQuerySecret) {
        rejectUpgrade(socket, 400, "Bad Request", "Credentials must not be passed in URL query parameters.")
        return
      }

      const bearer = extractUpgradeBearer(request)
      if (bearer) {
        void this.stateSync.authenticateWsToken(target.spaceId, target.docId, bearer)
          .then((credential) => {
            if (socket.destroyed) return
            const server = this.server
            if (!server || this.shutdownPromise) {
              rejectUpgrade(socket, 503, "Service Unavailable", "Server shutting down.")
              return
            }
            if (!credential) {
              rejectUpgrade(socket, 401, "Unauthorized", "Invalid state sync credential.")
              return
            }
            server.handleUpgrade(request, socket, head, (ws) => {
              this.bindSocket(ws, target.spaceId, target.docId, credential)
            })
          })
          .catch((error: unknown) => {
            this.logger.warn({
              spaceId: target.spaceId,
              docId: target.docId,
              errorName: error instanceof Error ? error.name : typeof error,
            }, "State sync WebSocket upgrade authentication failed")
            rejectUpgrade(socket, 503, "Service Unavailable", "Authentication service unavailable.")
          })
        return
      }

      // Standard browser flow: upgrade first, require first-frame `auth` within authTimeoutMs.
      this.server?.handleUpgrade(request, socket, head, (ws) => {
        this.bindSocket(ws, target.spaceId, target.docId, null)
      })
    })
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown()
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown()
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = this.performShutdown()
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    for (const state of [...this.activeSockets]) {
      state.closed = true
      state.closeReason = "shutdown"
      if (state.authTimer) {
        clearTimeout(state.authTimer)
        state.authTimer = null
      }
      if (!state.connection && state.ws.readyState === WebSocket.OPEN) {
        state.ws.close(STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY, "Server shutting down")
      }
    }
    await this.stateSync.hub.shutdown()
    this.activeSockets.clear()
    if (this.server) {
      const closing = this.server
      this.server = null
      closing.close()
    }
  }

  private bindSocket(
    ws: WebSocket,
    spaceId: string,
    docId: string,
    preAuthenticated: ResolvedStateSyncWsCredential | null,
  ): void {
    const limits = this.stateSync.hub.getLimits()
    const state: ActiveSocketState = {
      ws,
      spaceId,
      docId,
      authTimer: null,
      authenticating: Boolean(preAuthenticated),
      closed: false,
      closeReason: null,
      pendingMessages: [],
      connection: null,
      missedPongs: 0,
      consecutiveRateViolations: 0,
    }
    this.activeSockets.add(state)

    ws.on("pong", () => {
      state.missedPongs = 0
    })

    ws.on("close", () => {
      const reason = state.closeReason ?? "normal"
      this.cleanupSocket(state, reason)
    })

    ws.on("error", () => {
      this.cleanupSocket(state, state.closeReason ?? "normal")
    })

    ws.on("message", (raw: RawData) => {
      state.missedPongs = 0
      void this.handleMessage(state, raw).catch((error: unknown) => {
        this.logger.warn({
          spaceId: state.spaceId,
          docId: state.docId,
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Unexpected rejection handling state sync message")
      })
    })

    if (preAuthenticated) {
      void this.completeAuthentication(state, preAuthenticated, {})
        .catch((error: unknown) => {
          this.logger.warn({
            spaceId,
            docId,
            errorName: error instanceof Error ? error.name : typeof error,
          }, "State sync WebSocket upgrade completion failed")
          if (!state.closed && ws.readyState === WebSocket.OPEN) {
            sendJson(ws, { type: "error", code: "INTERNAL_ERROR", message: "认证初始化失败，请稍后重试。" })
            state.closeReason = "shutdown"
            ws.close(STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY, "Initialization failed")
          }
        })
        .finally(() => {
          state.authenticating = false
          this.flushPendingMessages(state)
        })
      return
    }

    state.authTimer = setTimeout(() => {
      if (!state.connection && !state.closed && ws.readyState === WebSocket.OPEN) {
        sendJson(ws, { type: "error", code: "AUTH_TIMEOUT", message: "认证超时，请在建连后 5 秒内发送 auth 帧。" })
        ws.close(STATE_SYNC_WS_CLOSE_CODES.AUTH_FAILED, "Authentication timeout")
      }
    }, limits.authTimeoutMs)
    state.authTimer.unref?.()
  }

  private flushPendingMessages(state: ActiveSocketState): void {
    if (!state.connection || state.closed || state.ws.readyState !== WebSocket.OPEN) {
      state.pendingMessages.length = 0
      return
    }
    while (state.pendingMessages.length > 0 && !state.closed && state.ws.readyState === WebSocket.OPEN) {
      const next = state.pendingMessages.shift()!
      void this.handleMessage(state, next).catch((error: unknown) => {
        this.logger.warn({
          spaceId: state.spaceId,
          docId: state.docId,
          errorName: error instanceof Error ? error.name : typeof error,
        }, "Unexpected rejection flushing pending state sync message")
      })
    }
  }

  private async handleMessage(state: ActiveSocketState, raw: RawData): Promise<void> {
    try {
      if (state.closed) return

      if (!state.connection && state.authenticating) {
        if (state.pendingMessages.length < MAX_PENDING_AUTH_MESSAGES) {
          state.pendingMessages.push(raw)
        }
        return
      }

      let parsedJson: unknown
      try {
        const text = typeof raw === "string"
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString("utf8")
            : raw instanceof ArrayBuffer
              ? Buffer.from(raw).toString("utf8")
              : Buffer.concat(raw).toString("utf8")
        parsedJson = JSON.parse(text)
      } catch (error) {
        void error
        sendJson(state.ws, { type: "error", code: "INVALID_JSON", message: "消息必须是合法 JSON。" })
        return
      }

      const parsed = stateSyncWsClientFrameSchema.safeParse(parsedJson)
      if (!parsed.success) {
        const rawId = parsedJson && typeof parsedJson === "object"
          ? (parsedJson as { id?: unknown }).id
          : undefined
        const requestId = typeof rawId === "string" && rawId.length >= 1 && rawId.length <= 128
          ? rawId
          : undefined
        sendJson(state.ws, {
          type: "error",
          ...(requestId ? { id: requestId } : {}),
          code: "INVALID_FRAME",
          message: parsed.error.issues[0]?.message ?? "消息帧格式无效。",
        })
        return
      }

      const frame: StateSyncWsClientFrame = parsed.data

      if (!state.connection) {
        if (frame.type !== "auth") {
          sendJson(state.ws, { type: "error", code: "UNAUTHENTICATED", message: "请先发送 auth 帧完成认证。" })
          state.ws.close(STATE_SYNC_WS_CLOSE_CODES.AUTH_FAILED, "Unauthenticated")
          return
        }
        state.authenticating = true
        try {
          const credential = await this.stateSync.authenticateWsToken(state.spaceId, state.docId, frame.token)
          if (state.closed || state.ws.readyState !== WebSocket.OPEN) {
            return
          }
          if (!credential) {
            sendJson(state.ws, { type: "error", code: "INVALID_CREDENTIAL", message: "状态同步凭证无效或已过期。" })
            state.ws.close(STATE_SYNC_WS_CLOSE_CODES.AUTH_FAILED, "Invalid credential")
            return
          }
          await this.completeAuthentication(state, credential, {
            clientId: frame.clientId,
            clientName: frame.clientName,
            meta: frame.meta,
            paths: frame.paths,
            sinceRev: frame.sinceRev,
          })
        } catch (error: unknown) {
          this.logger.warn({
            spaceId: state.spaceId,
            docId: state.docId,
            errorName: error instanceof Error ? error.name : typeof error,
          }, "State sync WebSocket first-frame auth failed")
          if (!state.closed && state.ws.readyState === WebSocket.OPEN) {
            sendJson(state.ws, { type: "error", code: "INTERNAL_ERROR", message: "认证服务暂不可用。" })
            state.closeReason = "shutdown"
            state.ws.close(STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY, "Auth unavailable")
          }
        } finally {
          state.authenticating = false
          this.flushPendingMessages(state)
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
          this.stateSync.hub.updatePresence(conn.spaceId, conn.docId, conn.connectionId, {
            clientName: frame.clientName,
            meta: frame.meta,
          })
          return
        case "subscribe": {
          const res = this.stateSync.hub.updateSubscriptions(
            conn.spaceId,
            conn.docId,
            conn.connectionId,
            "subscribe",
            frame.paths,
          )
          if (!res.ok) {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: res.code,
              message: res.message,
            })
            return
          }
          for (const snap of res.snapshots) {
            sendJson(state.ws, {
              type: "snapshot",
              rev: Number(res.rev),
              path: snap.path,
              exists: snap.exists,
              value: snap.value,
            })
          }
          if (frame.id) {
            sendJson(state.ws, {
              type: "ack",
              id: frame.id,
              rev: Number(res.rev),
            })
          }
          return
        }
        case "unsubscribe": {
          const res = this.stateSync.hub.updateSubscriptions(
            conn.spaceId,
            conn.docId,
            conn.connectionId,
            "unsubscribe",
            frame.paths,
          )
          if (!res.ok) {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: res.code,
              message: res.message,
            })
            return
          }
          if (frame.id) {
            sendJson(state.ws, {
              type: "ack",
              id: frame.id,
              rev: Number(res.rev),
            })
          }
          return
        }
        case "mutate": {
          if (conn.isObserver || conn.role === "read") {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: "FORBIDDEN_ROLE",
              message: "当前连接仅允许只读，不能写入房间状态。",
            })
            return
          }
          const res = await this.stateSync.hub.mutate(conn.spaceId, conn.docId, {
            op: frame.op,
            path: frame.path,
            value: frame.value,
            expectedRev: frame.expectedRev,
            echo: frame.echo,
            sourceConnectionId: conn.connectionId,
            actor: {
              connectionId: conn.connectionId,
              clientId: conn.clientId,
              clientName: conn.clientName,
            },
          })
          if (!res.ok) {
            if (res.code === "RATE_LIMITED") {
              state.consecutiveRateViolations += 1
              sendJson(state.ws, {
                type: "error",
                ...(frame.id ? { id: frame.id } : {}),
                code: res.code,
                message: res.message,
              })
              if (state.consecutiveRateViolations >= MAX_CONSECUTIVE_RATE_VIOLATIONS) {
                state.ws.close(STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED, "Rate limit exceeded")
              }
              return
            }
            state.consecutiveRateViolations = 0
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: res.code,
              message: res.message,
              ...(res.currentRev !== undefined ? { currentRev: Number(res.currentRev) } : {}),
            })
            return
          }
          state.consecutiveRateViolations = 0
          if (frame.id) {
            sendJson(state.ws, {
              type: "ack",
              id: frame.id,
              rev: Number(res.rev),
              changed: res.changed,
            })
          }
          return
        }
        case "onDisconnect.set": {
          if (conn.isObserver || conn.role === "read") {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: "FORBIDDEN_ROLE",
              message: "当前连接仅允许只读，不能注册掉线动作。",
            })
            return
          }
          const res = this.stateSync.hub.setOnDisconnect(
            conn.spaceId,
            conn.docId,
            conn.connectionId,
            frame.actions,
          )
          if (!res.ok) {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: res.code,
              message: res.message,
            })
            return
          }
          if (frame.id) {
            sendJson(state.ws, { type: "ack", id: frame.id })
          }
          return
        }
        case "onDisconnect.clear": {
          if (conn.isObserver || conn.role === "read") {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: "FORBIDDEN_ROLE",
              message: "当前连接仅允许只读，不能清除掉线动作。",
            })
            return
          }
          const res = this.stateSync.hub.setOnDisconnect(conn.spaceId, conn.docId, conn.connectionId, [])
          if (!res.ok) {
            sendJson(state.ws, {
              type: "error",
              ...(frame.id ? { id: frame.id } : {}),
              code: res.code,
              message: res.message,
            })
            return
          }
          if (frame.id) {
            sendJson(state.ws, { type: "ack", id: frame.id })
          }
          return
        }
      }
    } catch (error: unknown) {
      this.logger.warn({
        spaceId: state.spaceId,
        docId: state.docId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Unhandled error handling state sync WebSocket frame")
      if (!state.closed && state.ws.readyState === WebSocket.OPEN) {
        sendJson(state.ws, {
          type: "error",
          code: "INTERNAL_ERROR",
          message: "处理消息帧时发生内部错误，请稍后重试。",
        })
      }
    }
  }

  private async completeAuthentication(
    state: ActiveSocketState,
    credential: ResolvedStateSyncWsCredential,
    options: {
      readonly clientId?: string
      readonly clientName?: string
      readonly meta?: Record<string, unknown>
      readonly paths?: readonly string[]
      readonly sinceRev?: number
    },
  ): Promise<void> {
    if (state.authTimer) {
      clearTimeout(state.authTimer)
      state.authTimer = null
    }
    if (state.closed || state.ws.readyState !== WebSocket.OPEN) return

    const docSnapshot = await this.stateSync.loadDocForGateway(credential.spaceId, credential.docId)
    if (state.closed || state.ws.readyState !== WebSocket.OPEN) return
    if (!docSnapshot) {
      sendJson(state.ws, { type: "error", code: "DOC_NOT_FOUND", message: "房间不存在或已过期。" })
      state.ws.close(STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Document not found")
      return
    }

    const clientId = credential.isObserver
      ? "console-debugger"
      : (options.clientId ?? `cli_${randomUUID().replaceAll("-", "").slice(0, 12)}`)
    const clientName = credential.isObserver ? "Console 调试台" : (options.clientName ?? null)

    const registered = this.stateSync.hub.registerConnection({
      spaceId: credential.spaceId,
      docId: credential.docId,
      ownerId: credential.ownerId,
      credentialType: credential.credentialType,
      credentialId: credential.credentialId,
      role: credential.role,
      isObserver: credential.isObserver,
      clientId,
      clientName,
      meta: options.meta ?? {},
      paths: options.paths,
      sinceRev: options.sinceRev,
      socket: createWsAdapter(state.ws),
      docSnapshot,
    })

    if (!registered.ok) {
      sendJson(state.ws, { type: "error", code: registered.code, message: registered.message })
      state.ws.close(registered.closeCode, registered.message)
      return
    }

    state.connection = registered.connection
    sendJson(state.ws, registered.readyPayload as unknown as Record<string, unknown>)

    for (const replayFrame of registered.replayedMutations) {
      sendJson(state.ws, replayFrame as unknown as Record<string, unknown>)
    }
  }

  private sweepHeartbeats(): void {
    const limits = this.stateSync.hub.getLimits()
    for (const state of [...this.activeSockets]) {
      if (state.closed || state.ws.readyState !== WebSocket.OPEN) {
        this.cleanupSocket(state, state.closeReason ?? "normal")
        continue
      }
      if (state.ws.bufferedAmount > limits.slowConsumerBytes) {
        state.closeReason = "timeout_or_slow"
        state.ws.close(STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, "Slow consumer")
        this.cleanupSocket(state, "timeout_or_slow")
        continue
      }
      if (state.missedPongs >= limits.maxMissedHeartbeats) {
        state.closeReason = "timeout_or_slow"
        state.ws.close(STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, "Heartbeat timeout")
        this.cleanupSocket(state, "timeout_or_slow")
        continue
      }
      state.missedPongs += 1
      try {
        state.ws.ping()
      } catch (error) {
        void error
        this.cleanupSocket(state, state.closeReason ?? "timeout_or_slow")
      }
    }
  }

  private cleanupSocket(state: ActiveSocketState, reason: DisconnectReason): void {
    state.closed = true
    if (state.authTimer) {
      clearTimeout(state.authTimer)
      state.authTimer = null
    }
    state.pendingMessages.length = 0
    this.activeSockets.delete(state)
    if (state.connection) {
      const conn = state.connection
      state.connection = null
      void this.stateSync.hub
        .unregisterConnection(conn.spaceId, conn.docId, conn.connectionId, reason)
        .catch((error: unknown) => {
          this.logger.warn({
            spaceId: conn.spaceId,
            docId: conn.docId,
            connectionId: conn.connectionId,
            errorName: error instanceof Error ? error.name : typeof error,
          }, "State sync connection unregister failed")
        })
    }
  }
}
