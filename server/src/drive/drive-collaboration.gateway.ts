import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common"
import type {
  DriveCollaborationControlMessage,
  DriveCollaborationJoinMessage,
} from "@synapse/shared"
import { DRIVE_COLLABORATION_PROTOCOL_VERSION } from "@synapse/shared"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import { UserAuthService } from "../auth/user-auth.service"
import { userSessionCookieName } from "../auth/user-web-session"
import { loadEnv } from "../config/env"
import { DriveService } from "./drive.service"
import {
  DriveCollaborationService,
  type DriveCollaborationAccess,
  type DriveCollaborationConnection,
} from "./drive-collaboration.service"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"

const collaborationPath = "/api/drive/collaboration"
const maxPayloadBytes = 256 * 1024
const heartbeatIntervalMs = 20_000
const heartbeatTimeoutMs = 45_000
const messageSync = 0
const messageAwareness = 1
const rateLimitWindowMs = 10_000
const rateLimitMessagesPerWindow = 400

type ConnectedSocket = {
  readonly socket: WebSocket
  readonly cookies: ReadonlyMap<string, string>
  readonly actorUserId: string | null
  lastSeenAt: number
  messageWindowStartedAt: number
  messageCount: number
  joined: null | {
    readonly access: DriveCollaborationAccess
    readonly connection: DriveCollaborationConnection
    readonly context: DriveCollaborationJoinMessage["context"]
    readonly awarenessClientIds: Set<number>
    readonly unsubscribeBus: () => void
  }
}

@Injectable()
export class DriveCollaborationGateway implements OnApplicationShutdown {
  private readonly logger = new Logger(DriveCollaborationGateway.name)
  private readonly publicOrigin = normalizeOrigin(loadEnv(process.env).appPublicUrl ?? "http://localhost:3000")
  private readonly sockets = new Set<ConnectedSocket>()
  private server: WebSocketServer | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly auth: UserAuthService,
    private readonly drive: DriveService,
    private readonly collaboration: DriveCollaborationService,
    private readonly bus: LocalDriveCollaborationBus,
  ) {}

  attach(httpServer: HttpServer): void {
    if (this.server || !this.collaboration.isEnabled()) return
    this.server = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes })
    this.heartbeatTimer = setInterval(() => this.sweepStaleConnections(), heartbeatIntervalMs)
    this.heartbeatTimer.unref?.()
    httpServer.on("upgrade", (request, socket, head) => {
      if (upgradePath(request) !== collaborationPath) return
      if (normalizeOrigin(readHeader(request, "origin")) !== this.publicOrigin) {
        this.rejectUpgrade(socket)
        return
      }
      void this.authenticateOptionalUser(request).then(({ actorUserId, cookies }) => {
        this.server?.handleUpgrade(request, socket, head, (webSocket) => {
          this.bindSocket(webSocket, actorUserId, cookies)
        })
      }).catch((error: unknown) => {
        this.logger.warn({ errorName: error instanceof Error ? error.name : typeof error }, "Drive collaboration upgrade authentication failed")
        this.rejectUpgrade(socket)
      })
    })
  }

  onApplicationShutdown(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    for (const entry of this.sockets) entry.socket.close(1012, "server_shutdown")
    this.sockets.clear()
    this.server?.close()
    this.server = null
  }

  private bindSocket(socket: WebSocket, actorUserId: string | null, cookies: ReadonlyMap<string, string>): void {
    const now = Date.now()
    const entry: ConnectedSocket = { socket, cookies, actorUserId, lastSeenAt: now, messageWindowStartedAt: now, messageCount: 0, joined: null }
    this.sockets.add(entry)
    socket.on("pong", () => { entry.lastSeenAt = Date.now() })
    socket.on("message", (payload, isBinary) => {
      entry.lastSeenAt = Date.now()
      void this.handleMessage(entry, payload, isBinary).catch((error: unknown) => {
        this.logger.warn({
          errorName: error instanceof Error ? error.name : typeof error,
          itemId: entry.joined?.access.itemId,
        }, "Drive collaboration message failed")
        if (socket.readyState === WebSocket.OPEN) sendControl(socket, { type: "error", code: "DRIVE_COLLABORATION_MESSAGE_FAILED", message: "协同同步失败。" })
      })
    })
    socket.on("close", () => this.disconnect(entry))
    socket.on("error", () => this.disconnect(entry))
  }

  private async handleMessage(entry: ConnectedSocket, payload: RawData, isBinary: boolean): Promise<void> {
    if (!acceptMessage(entry)) {
      entry.socket.close(1008, "rate_limited")
      return
    }
    if (!entry.joined) {
      if (isBinary) {
        entry.socket.close(1008, "join_required")
        return
      }
      const join = parseJoinMessage(rawDataToBuffer(payload).toString("utf8"))
      if (!join) {
        entry.socket.close(1003, "invalid_join")
        return
      }
      await this.join(entry, join)
      return
    }
    if (!isBinary) {
      entry.socket.close(1003, "binary_required")
      return
    }
    const bytes = new Uint8Array(rawDataToBuffer(payload))
    const decoder = decoding.createDecoder(bytes)
    const messageType = decoding.readVarUint(decoder)
    if (messageType === messageSync) {
      await this.handleSyncMessage(entry, decoder)
      return
    }
    if (messageType === messageAwareness) {
      this.handleAwarenessMessage(entry, decoding.readVarUint8Array(decoder))
      return
    }
    entry.socket.close(1003, "unknown_message")
  }

  private async join(entry: ConnectedSocket, join: DriveCollaborationJoinMessage): Promise<void> {
    const shareCookie = join.context.kind === "share"
      ? entry.cookies.get(driveAccessCookieName(join.context.shareId))
      : undefined
    const access = await this.drive.resolveCollaborationAccess({
      context: join.context,
      actorUserId: entry.actorUserId,
      shareCookie,
    })
    const connection: DriveCollaborationConnection = {
      clientId: join.clientId,
      userId: access.userId,
      canWrite: access.canWrite,
      sendUpdate: (update) => sendSyncUpdate(entry.socket, update),
      sendAwareness: (update) => {
        if (access.userId) sendAwarenessUpdate(entry.socket, update)
      },
      sendControl: (message) => sendControl(entry.socket, message),
      close: (code, reason) => entry.socket.close(code, reason),
      revalidate: async () => {
        const sessionToken = entry.cookies.get(userSessionCookieName)
        const currentSession = sessionToken ? await this.auth.verifyWebSession(sessionToken) : null
        const refreshed = await this.drive.resolveCollaborationAccess({
          context: join.context,
          actorUserId: currentSession?.userId ?? null,
          shareCookie,
        })
        return refreshed.itemId === access.itemId && refreshed.canWrite && currentSession?.userId === access.userId
      },
    }
    const room = await this.collaboration.join(access, connection, join.epoch)
    if (!room.accepted) {
      sendControl(entry.socket, {
        type: "epoch_replaced",
        epoch: room.epoch,
        checkpointVersionId: room.checkpointVersionId,
      })
      entry.socket.close(1008, "epoch_replaced")
      return
    }
    const unsubscribeBus = this.bus.subscribe(access.itemId, (message) => sendControl(entry.socket, message))
    entry.joined = { access, connection, context: join.context, awarenessClientIds: new Set(), unsubscribeBus }
    sendControl(entry.socket, {
      type: "joined",
      protocolVersion: DRIVE_COLLABORATION_PROTOCOL_VERSION,
      itemId: access.itemId,
      epoch: room.epoch,
      checkpointVersionId: room.checkpointVersionId,
      canWrite: access.canWrite,
      durableSequence: room.durableSequence.toString(),
    })
    sendSyncStep1(entry.socket, room.doc)
    const preview = this.collaboration.getRoomPreview(access.itemId)
    if (preview) sendControl(entry.socket, preview)
    if (access.userId) {
      const awareness = this.collaboration.getRoomAwareness(access.itemId)
      const clientIds = awareness ? [...awareness.getStates().keys()] : []
      if (awareness && clientIds.length > 0) sendAwarenessUpdate(entry.socket, awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds))
    }
  }

  private async handleSyncMessage(entry: ConnectedSocket, decoder: decoding.Decoder): Promise<void> {
    const joined = entry.joined
    if (!joined) return
    const subtype = decoding.readVarUint(decoder)
    if (subtype === syncProtocol.messageYjsSyncStep1) {
      const stateVector = decoding.readVarUint8Array(decoder)
      const doc = this.collaboration.getRoomDocument(joined.access.itemId)
      if (!doc) throw new Error("collaboration_room_missing")
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeSyncStep2(encoder, doc, stateVector)
      entry.socket.send(encoding.toUint8Array(encoder))
      return
    }
    if (subtype === syncProtocol.messageYjsSyncStep2 || subtype === syncProtocol.messageYjsUpdate) {
      if (!joined.connection.canWrite) {
        joined.connection.sendControl({ type: "permission_changed", canWrite: false, reason: "read_only" })
        return
      }
      const update = decoding.readVarUint8Array(decoder)
      await this.collaboration.applyClientUpdate(joined.access.itemId, joined.connection.clientId, update)
      return
    }
    entry.socket.close(1003, "unknown_sync_message")
  }

  private handleAwarenessMessage(entry: ConnectedSocket, update: Uint8Array): void {
    const joined = entry.joined
    if (!joined || !joined.access.userId) {
      entry.socket.close(1008, "awareness_not_allowed")
      return
    }
    const awarenessEntries = decodeAwarenessEntries(update)
    if (!awarenessEntries || awarenessEntries.length > 1) {
      entry.socket.close(1008, "invalid_awareness")
      return
    }
    const awareness = this.collaboration.getRoomAwareness(joined.access.itemId)
    if (!awareness) return
    for (const awarenessEntry of awarenessEntries) {
      if (joined.awarenessClientIds.size > 0 && !joined.awarenessClientIds.has(awarenessEntry.clientId)) {
        entry.socket.close(1008, "awareness_client_mismatch")
        return
      }
      if (awarenessEntry.state !== null && !isSafeAwarenessState(awarenessEntry.state)) {
        entry.socket.close(1008, "unsafe_awareness")
        return
      }
      joined.awarenessClientIds.add(awarenessEntry.clientId)
    }
    awarenessProtocol.applyAwarenessUpdate(awareness, update, joined.connection)
    this.collaboration.broadcastAwareness(joined.access.itemId, update)
  }

  private disconnect(entry: ConnectedSocket): void {
    if (!this.sockets.delete(entry)) return
    const joined = entry.joined
    if (!joined) return
    joined.unsubscribeBus()
    const awareness = this.collaboration.getRoomAwareness(joined.access.itemId)
    if (awareness && joined.awarenessClientIds.size > 0) {
      const removal = removeAwarenessClients(awareness, [...joined.awarenessClientIds], joined.connection)
      this.collaboration.broadcastAwareness(joined.access.itemId, removal)
    }
    this.collaboration.leave(joined.access.itemId, joined.connection)
  }

  private sweepStaleConnections(): void {
    const now = Date.now()
    for (const entry of this.sockets) {
      if (now - entry.lastSeenAt > heartbeatTimeoutMs) {
        entry.socket.close(1000, "heartbeat_timeout")
        entry.socket.terminate()
        this.disconnect(entry)
      } else if (entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.ping()
      }
    }
  }

  private async authenticateOptionalUser(request: IncomingMessage): Promise<{
    readonly actorUserId: string | null
    readonly cookies: ReadonlyMap<string, string>
  }> {
    const cookies = parseCookies(readHeader(request, "cookie"))
    const sessionToken = cookies.get(userSessionCookieName)
    const session = sessionToken ? await this.auth.verifyWebSession(sessionToken) : null
    return { actorUserId: session?.userId ?? null, cookies }
  }

  private rejectUpgrade(socket: Duplex): void {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
    socket.destroy()
  }
}

export function removeAwarenessClients(awareness: awarenessProtocol.Awareness, clientIds: readonly number[], origin: unknown): Uint8Array {
  awarenessProtocol.removeAwarenessStates(awareness, [...clientIds], origin)
  return awarenessProtocol.encodeAwarenessUpdate(awareness, [...clientIds])
}

function acceptMessage(entry: ConnectedSocket): boolean {
  const now = Date.now()
  if (now - entry.messageWindowStartedAt >= rateLimitWindowMs) {
    entry.messageWindowStartedAt = now
    entry.messageCount = 0
  }
  entry.messageCount += 1
  return entry.messageCount <= rateLimitMessagesPerWindow
}

function parseJoinMessage(value: string): DriveCollaborationJoinMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const input = parsed as Partial<DriveCollaborationJoinMessage>
  if (input.type !== "join" || input.protocolVersion !== DRIVE_COLLABORATION_PROTOCOL_VERSION || typeof input.clientId !== "string" || input.clientId.length < 8 || input.clientId.length > 128) return null
  if (!input.context || (input.context.kind !== "owner" && input.context.kind !== "share")) return null
  if (input.context.kind === "owner" && !input.context.itemId) return null
  if (input.context.kind === "share" && !input.context.shareId) return null
  return input as DriveCollaborationJoinMessage
}

function sendControl(socket: WebSocket, message: DriveCollaborationControlMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function sendSyncStep1(socket: WebSocket, doc: import("yjs").Doc): void {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeSyncStep1(encoder, doc)
  socket.send(encoding.toUint8Array(encoder))
}

function sendSyncUpdate(socket: WebSocket, update: Uint8Array): void {
  if (socket.readyState !== WebSocket.OPEN) return
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeUpdate(encoder, update)
  socket.send(encoding.toUint8Array(encoder))
}

function sendAwarenessUpdate(socket: WebSocket, update: Uint8Array): void {
  if (socket.readyState !== WebSocket.OPEN) return
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageAwareness)
  encoding.writeVarUint8Array(encoder, update)
  socket.send(encoding.toUint8Array(encoder))
}

function decodeAwarenessEntries(update: Uint8Array): Array<{ readonly clientId: number; readonly state: unknown }> | null {
  try {
    const decoder = decoding.createDecoder(update)
    const count = decoding.readVarUint(decoder)
    const entries: Array<{ readonly clientId: number; readonly state: unknown }> = []
    for (let index = 0; index < count; index += 1) {
      const clientId = decoding.readVarUint(decoder)
      decoding.readVarUint(decoder)
      const state = JSON.parse(decoding.readVarString(decoder)) as unknown
      entries.push({ clientId, state })
    }
    return entries
  } catch {
    return null
  }
}

export function isSafeAwarenessState(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (JSON.stringify(value).length > 4096) return false
  const state = value as Record<string, unknown>
  if (Object.keys(state).some((key) => key !== "user" && key !== "selection")) return false
  if (state.user !== undefined) {
    if (!state.user || typeof state.user !== "object" || Array.isArray(state.user)) return false
    const user = state.user as Record<string, unknown>
    if (Object.keys(user).some((key) => key !== "name" && key !== "color" && key !== "colorLight")) return false
    if (typeof user.name !== "string" || user.name.length > 80) return false
    for (const key of ["color", "colorLight"] as const) {
      if (user[key] !== undefined && (typeof user[key] !== "string" || !user[key].startsWith("var(--"))) return false
    }
  }
  if (state.selection !== undefined) {
    if (!state.selection || typeof state.selection !== "object" || Array.isArray(state.selection)) return false
    const selection = state.selection as Record<string, unknown>
    if (Object.keys(selection).some((key) => key !== "anchor" && key !== "head")) return false
    if (!isSafeRelativePosition(selection.anchor) || !isSafeRelativePosition(selection.head)) return false
  }
  return true
}

function isSafeRelativePosition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const position = value as Record<string, unknown>
  if (Object.keys(position).some((key) => !["type", "tname", "item", "assoc"].includes(key))) return false
  if (position.type !== null && position.type !== undefined) return false
  if (typeof position.tname !== "string" || position.tname !== "content") return false
  if (!Number.isSafeInteger(position.assoc)) return false
  if (position.item === null) return true
  if (!position.item || typeof position.item !== "object" || Array.isArray(position.item)) return false
  const item = position.item as Record<string, unknown>
  return Object.keys(item).every((key) => key === "client" || key === "clock")
    && Number.isSafeInteger(item.client)
    && Number.isSafeInteger(item.clock)
}

function parseCookies(value: string): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>()
  for (const part of value.split(";")) {
    const separator = part.indexOf("=")
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const rawValue = part.slice(separator + 1).trim()
    if (!name) continue
    try {
      cookies.set(name, decodeURIComponent(rawValue))
    } catch {
      cookies.set(name, rawValue)
    }
  }
  return cookies
}

function driveAccessCookieName(shareId: string): string {
  return `synapse_drive_access_share_${Buffer.from(shareId, "utf8").toString("base64url")}`
}

function rawDataToBuffer(value: RawData): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (Array.isArray(value)) return Buffer.concat(value)
  return Buffer.from(value as never)
}

function upgradePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "", "http://localhost").pathname
  } catch {
    return ""
  }
}

function readHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/u, "")
}
