import { Injectable, Optional } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import {
  CHANNEL_WS_CLOSE_CODES,
  matchesChannelEventFilter,
  type ChannelEventSender,
  type ChannelPresenceMember,
  type ChannelRole,
} from "@synapse/shared/channel-contracts"
import { loadChannelConfig, type ChannelLimitsConfig } from "./channel-config"

export type ChannelSocketAdapter = {
  readonly bufferedAmount: number
  send(data: string): void
  close(code: number, reason: string): void
}

export type ChannelCredentialType = "channel_token" | "api_key" | "console_ticket"

export type LiveChannelConnection = {
  readonly connectionId: string
  readonly channelId: string
  readonly ownerId: string
  readonly credentialType: ChannelCredentialType
  readonly credentialId: string
  readonly role: ChannelRole
  readonly isObserver: boolean
  readonly clientId: string
  clientName: string | null
  meta: Record<string, unknown>
  readonly eventsFilter?: readonly string[]
  readonly connectedAt: string
  readonly socket: ChannelSocketAdapter
  rateTokens: number
  rateLastRefillMs: number
}

export type HubEventFrame = {
  readonly type: "event"
  readonly seq: number
  readonly event: string
  readonly payload: unknown
  readonly retain: boolean
  readonly replayed: boolean
  readonly targeted: boolean
  readonly sender: ChannelEventSender
  readonly sentAt: string
}

type BufferedEvent = {
  readonly seq: number
  readonly timestampMs: number
  readonly frame: HubEventFrame
}

type TokenBucket = {
  tokens: number
  lastRefillMs: number
}

type ChannelRuntimeState = {
  readonly connections: Map<string, LiveChannelConnection>
  readonly buffer: BufferedEvent[]
  seq: number
  evictedUpToSeq: number
  productionCount: number
  observerCount: number
  httpRate: TokenBucket
}

export type RegisterChannelConnectionInput = {
  readonly channelId: string
  readonly ownerId: string
  readonly credentialType: ChannelCredentialType
  readonly credentialId: string
  readonly role: ChannelRole
  readonly isObserver: boolean
  readonly clientId: string
  readonly clientName: string | null
  readonly meta: Record<string, unknown>
  readonly eventsFilter?: readonly string[]
  readonly afterSeq?: number
  readonly seqFloor?: number
  readonly socket: ChannelSocketAdapter
  readonly now?: number
}

export type ReadyHubSnapshot = {
  readonly latestSeq: number
  readonly replayTruncated: boolean
  readonly presence: ChannelPresenceMember[]
  readonly replayEvents: HubEventFrame[]
}

export type RegisterChannelConnectionResult =
  | { readonly ok: true; readonly connection: LiveChannelConnection; readonly readySnapshot: ReadyHubSnapshot }
  | { readonly ok: false; readonly code: string; readonly closeCode: number; readonly message: string }

export type HubPublishInput = {
  readonly channelId: string
  readonly event: string
  readonly payload: unknown
  readonly retain: boolean
  readonly echo: boolean
  readonly targetClientId?: string
  readonly sender: ChannelEventSender
  readonly seqFloor?: number
  readonly preallocatedSeq?: number
  readonly now?: number
}

@Injectable()
export class ChannelHub {
  private readonly channels = new Map<string, ChannelRuntimeState>()
  private readonly connectionsById = new Map<string, LiveChannelConnection>()
  private readonly productionCountByAccount = new Map<string, number>()
  private globalProductionCount = 0
  private readonly config: ChannelLimitsConfig

  constructor(@Optional() config?: ChannelLimitsConfig) {
    this.config = config ?? loadChannelConfig()
  }

  getLimits(): ChannelLimitsConfig {
    return this.config
  }

  registerConnection(input: RegisterChannelConnectionInput): RegisterChannelConnectionResult {
    const now = input.now ?? Date.now()

    if (!input.isObserver) {
      if (this.globalProductionCount >= this.config.maxGlobalConnections) {
        return {
          ok: false,
          code: "GLOBAL_CONNECTION_LIMIT_EXCEEDED",
          closeCode: CHANNEL_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "服务端实时连接数已达上限。",
        }
      }
      const accountCount = this.productionCountByAccount.get(input.ownerId) ?? 0
      if (accountCount >= this.config.maxConnectionsPerAccount) {
        return {
          ok: false,
          code: "ACCOUNT_CONNECTION_LIMIT_EXCEEDED",
          closeCode: CHANNEL_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "当前账号的频道连接数已达上限。",
        }
      }
    }

    const existingState = this.channels.get(input.channelId)
    if (input.isObserver) {
      if ((existingState?.observerCount ?? 0) >= this.config.maxObserversPerChannel) {
        return {
          ok: false,
          code: "OBSERVER_LIMIT_EXCEEDED",
          closeCode: CHANNEL_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "当前频道的调试台连接数已达上限。",
        }
      }
    } else if ((existingState?.productionCount ?? 0) >= this.config.maxConnectionsPerChannel) {
      return {
        ok: false,
        code: "CHANNEL_CONNECTION_LIMIT_EXCEEDED",
        closeCode: CHANNEL_WS_CLOSE_CODES.LIMIT_EXCEEDED,
        message: "当前频道的在线连接数已达上限。",
      }
    }

    const state = this.getOrCreateChannel(input.channelId, input.seqFloor ?? 0, now)
    this.pruneBuffer(state, now)

    const connection: LiveChannelConnection = {
      connectionId: `conn_${randomUUID().replaceAll("-", "")}`,
      channelId: input.channelId,
      ownerId: input.ownerId,
      credentialType: input.credentialType,
      credentialId: input.credentialId,
      role: input.role,
      isObserver: input.isObserver,
      clientId: input.clientId,
      clientName: input.clientName,
      meta: { ...input.meta },
      eventsFilter: input.eventsFilter ? [...input.eventsFilter] : undefined,
      connectedAt: new Date(now).toISOString(),
      socket: input.socket,
      rateTokens: this.config.wsBurst,
      rateLastRefillMs: now,
    }

    // Broadcast join to existing sockets BEFORE inserting the new connection so
    // any cascading eviction (presence.leave) cannot reach this socket before `ready`,
    // and the presence snapshot built below reflects any evicted broken sockets.
    if (!connection.isObserver) {
      this.broadcastFrame(state, {
        type: "presence.join",
        member: toPresenceMember(connection),
      })
    }

    // Re-attach state in case evicting all prior broken sockets pruned the empty entry.
    this.channels.set(input.channelId, state)
    state.connections.set(connection.connectionId, connection)
    this.connectionsById.set(connection.connectionId, connection)
    if (connection.isObserver) {
      state.observerCount++
    } else {
      state.productionCount++
      this.globalProductionCount++
      this.productionCountByAccount.set(connection.ownerId, (this.productionCountByAccount.get(connection.ownerId) ?? 0) + 1)
    }

    const canReceiveEvents = connection.role !== "publish"
    let replayTruncated = false
    let replayEvents: HubEventFrame[] = []
    if (canReceiveEvents && input.afterSeq !== undefined) {
      replayTruncated = input.afterSeq < state.evictedUpToSeq || input.afterSeq > state.seq
      replayEvents = state.buffer
        .filter((entry) => entry.seq > input.afterSeq! && matchesChannelEventFilter(entry.frame.event, connection.eventsFilter))
        .map((entry) => ({ ...entry.frame, replayed: true }))
    }

    const presence = this.buildPresenceList(state)

    return {
      ok: true,
      connection,
      readySnapshot: {
        latestSeq: state.seq,
        replayTruncated,
        presence,
        replayEvents,
      },
    }
  }

  unregisterConnection(channelId: string, connectionId: string, broadcastLeave = true): void {
    const state = this.channels.get(channelId)
    if (!state) return
    const connection = state.connections.get(connectionId)
    if (!connection) return

    state.connections.delete(connectionId)
    this.connectionsById.delete(connectionId)
    if (connection.isObserver) {
      state.observerCount = Math.max(0, state.observerCount - 1)
    } else {
      state.productionCount = Math.max(0, state.productionCount - 1)
      this.globalProductionCount = Math.max(0, this.globalProductionCount - 1)
      const nextAccountCount = (this.productionCountByAccount.get(connection.ownerId) ?? 1) - 1
      if (nextAccountCount <= 0) this.productionCountByAccount.delete(connection.ownerId)
      else this.productionCountByAccount.set(connection.ownerId, nextAccountCount)

      if (broadcastLeave) {
        this.broadcastFrame(state, {
          type: "presence.leave",
          member: toPresenceMember(connection),
        })
      }
    }

    this.pruneChannelIfIdle(channelId, state, Date.now())
  }

  updatePresence(
    channelId: string,
    connectionId: string,
    patch: { readonly clientName?: string; readonly meta?: Record<string, unknown> },
  ): ChannelPresenceMember | null {
    const state = this.channels.get(channelId)
    const connection = state?.connections.get(connectionId)
    if (!state || !connection || connection.isObserver) return null
    if (patch.clientName !== undefined) connection.clientName = patch.clientName
    if (patch.meta !== undefined) connection.meta = { ...patch.meta }
    const member = toPresenceMember(connection)
    this.broadcastFrame(state, { type: "presence.update", member })
    return member
  }

  allocateNextSeq(channelId: string, seqFloor = 0, now = Date.now()): number {
    const state = this.getOrCreateChannel(channelId, seqFloor, now)
    if (seqFloor > state.seq) state.seq = seqFloor
    state.seq += 1
    return state.seq
  }

  publishEvent(input: HubPublishInput): { readonly seq: number; readonly deliveredCount: number; readonly sentAt: string } {
    const now = input.now ?? Date.now()
    const state = this.getOrCreateChannel(input.channelId, input.seqFloor ?? 0, now)
    this.pruneBuffer(state, now)

    let seq: number
    if (input.preallocatedSeq !== undefined) {
      seq = input.preallocatedSeq
      if (seq > state.seq) state.seq = seq
    } else {
      if (input.seqFloor !== undefined && input.seqFloor > state.seq) {
        state.seq = input.seqFloor
      }
      state.seq += 1
      seq = state.seq
    }
    const sentAt = new Date(now).toISOString()
    const targeted = Boolean(input.targetClientId)

    const frame: HubEventFrame = {
      type: "event",
      seq,
      event: input.event,
      payload: input.payload,
      retain: input.retain,
      replayed: false,
      targeted,
      sender: input.sender,
      sentAt,
    }

    if (!targeted) {
      state.buffer.push({ seq, timestampMs: now, frame })
      while (state.buffer.length > this.config.replayMaxItems) {
        const evicted = state.buffer.shift()
        if (evicted && evicted.seq > state.evictedUpToSeq) {
          state.evictedUpToSeq = evicted.seq
        }
      }
    }

    const serialized = JSON.stringify(frame)
    let deliveredCount = 0
    const failed: LiveChannelConnection[] = []

    for (const connection of [...state.connections.values()]) {
      if (connection.role === "publish") continue
      if (!input.echo && input.sender.connectionId && connection.connectionId === input.sender.connectionId) {
        continue
      }
      if (targeted && !connection.isObserver && connection.clientId !== input.targetClientId) {
        continue
      }
      if (!matchesChannelEventFilter(input.event, connection.eventsFilter)) {
        continue
      }

      if (this.trySendRaw(connection, serialized)) {
        if (!connection.isObserver) deliveredCount += 1
      } else {
        failed.push(connection)
      }
    }

    for (const conn of failed) {
      this.evictSlowOrBroken(conn)
    }

    return { seq, deliveredCount, sentAt }
  }

  getPresence(channelId: string): ChannelPresenceMember[] {
    const state = this.channels.get(channelId)
    if (!state) return []
    return this.buildPresenceList(state)
  }

  getOnlineCount(channelId: string): number {
    return this.channels.get(channelId)?.productionCount ?? 0
  }

  getLatestSeq(channelId: string): number {
    return this.channels.get(channelId)?.seq ?? 0
  }

  consumeWsPublishRate(connectionId: string, now = Date.now()): boolean {
    const connection = this.connectionsById.get(connectionId)
    if (!connection) return false
    if (now > connection.rateLastRefillMs) {
      const elapsedSec = (now - connection.rateLastRefillMs) / 1000
      connection.rateTokens = Math.min(this.config.wsBurst, connection.rateTokens + elapsedSec * this.config.wsRatePerSec)
      connection.rateLastRefillMs = now
    }
    if (connection.rateTokens < 1) return false
    connection.rateTokens -= 1
    return true
  }

  consumeHttpPublishRate(channelId: string, now = Date.now()): { readonly allowed: boolean; readonly retryAfterSec: number } {
    const state = this.getOrCreateChannel(channelId, 0, now)
    if (now > state.httpRate.lastRefillMs) {
      const elapsedSec = (now - state.httpRate.lastRefillMs) / 1000
      state.httpRate.tokens = Math.min(this.config.httpBurst, state.httpRate.tokens + elapsedSec * this.config.httpRatePerSec)
      state.httpRate.lastRefillMs = now
    }
    if (state.httpRate.tokens < 1) {
      const needed = 1 - state.httpRate.tokens
      const retryAfterSec = Math.max(1, Math.ceil(needed / this.config.httpRatePerSec))
      return { allowed: false, retryAfterSec }
    }
    state.httpRate.tokens -= 1
    return { allowed: true, retryAfterSec: 0 }
  }

  disconnectByChannel(channelId: string, closeCode: number, reason: string): number {
    const state = this.channels.get(channelId)
    if (!state) return 0
    const targets = [...state.connections.values()]
    for (const conn of targets) {
      this.forceCloseConnection(conn, closeCode, reason, false)
    }
    this.channels.delete(channelId)
    return targets.length
  }

  disconnectByCredential(
    credentialType: "channel_token" | "api_key",
    credentialId: string,
    closeCode: number,
    reason: string,
    predicate?: (conn: LiveChannelConnection) => boolean,
  ): number {
    const targets = [...this.connectionsById.values()].filter(
      (conn) => conn.credentialType === credentialType
        && conn.credentialId === credentialId
        && (!predicate || predicate(conn)),
    )
    for (const conn of targets) {
      this.forceCloseConnection(conn, closeCode, reason, true)
    }
    return targets.length
  }

  disconnectByOwner(ownerId: string, closeCode: number, reason: string): number {
    const targets = [...this.connectionsById.values()].filter((conn) => conn.ownerId === ownerId)
    for (const conn of targets) {
      this.forceCloseConnection(conn, closeCode, reason, false)
    }
    return targets.length
  }

  shutdownAll(): void {
    const targets = [...this.connectionsById.values()]
    for (const conn of targets) {
      this.forceCloseConnection(conn, CHANNEL_WS_CLOSE_CODES.GOING_AWAY, "Server shutting down", false)
    }
  }

  private getOrCreateChannel(channelId: string, seqFloor: number, now: number): ChannelRuntimeState {
    let state = this.channels.get(channelId)
    if (!state) {
      state = {
        connections: new Map(),
        buffer: [],
        seq: seqFloor,
        evictedUpToSeq: seqFloor,
        productionCount: 0,
        observerCount: 0,
        httpRate: { tokens: this.config.httpBurst, lastRefillMs: now },
      }
      this.channels.set(channelId, state)
    } else if (seqFloor > state.seq) {
      state.seq = seqFloor
      if (state.buffer.length === 0) state.evictedUpToSeq = seqFloor
    }
    return state
  }

  private pruneBuffer(state: ChannelRuntimeState, now: number): void {
    const cutoff = now - this.config.replayWindowMs
    while (state.buffer.length > 0 && state.buffer[0]!.timestampMs < cutoff) {
      const expired = state.buffer.shift()
      if (expired && expired.seq > state.evictedUpToSeq) {
        state.evictedUpToSeq = expired.seq
      }
    }
  }

  private pruneChannelIfIdle(channelId: string, state: ChannelRuntimeState, now: number): void {
    this.pruneBuffer(state, now)
    if (state.connections.size === 0 && state.buffer.length === 0 && state.seq === 0) {
      this.channels.delete(channelId)
    }
  }

  private buildPresenceList(state: ChannelRuntimeState): ChannelPresenceMember[] {
    const members: ChannelPresenceMember[] = []
    for (const conn of state.connections.values()) {
      if (!conn.isObserver) members.push(toPresenceMember(conn))
    }
    return members
  }

  private broadcastFrame(state: ChannelRuntimeState, frame: Record<string, unknown>, excludeConnectionId?: string): void {
    const serialized = JSON.stringify(frame)
    const failed: LiveChannelConnection[] = []
    for (const conn of [...state.connections.values()]) {
      if (excludeConnectionId && conn.connectionId === excludeConnectionId) continue
      if (!this.trySendRaw(conn, serialized)) {
        failed.push(conn)
      }
    }
    for (const conn of failed) {
      this.evictSlowOrBroken(conn)
    }
  }

  private trySendRaw(connection: LiveChannelConnection, serialized: string): boolean {
    if (connection.socket.bufferedAmount > this.config.slowConsumerBytes) {
      return false
    }
    try {
      connection.socket.send(serialized)
      return true
    } catch (error) {
      void error
      return false
    }
  }

  private evictSlowOrBroken(connection: LiveChannelConnection): void {
    this.forceCloseConnection(connection, CHANNEL_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, "Slow consumer or broken socket")
  }

  private forceCloseConnection(connection: LiveChannelConnection, closeCode: number, reason: string, broadcastLeave = true): void {
    this.unregisterConnection(connection.channelId, connection.connectionId, broadcastLeave)
    try {
      connection.socket.close(closeCode, reason)
    } catch (error) {
      void error
    }
  }
}

function toPresenceMember(connection: LiveChannelConnection): ChannelPresenceMember {
  return {
    connectionId: connection.connectionId,
    clientId: connection.clientId,
    clientName: connection.clientName,
    role: connection.role,
    meta: { ...connection.meta } as ChannelPresenceMember["meta"],
    connectedAt: connection.connectedAt,
  }
}
