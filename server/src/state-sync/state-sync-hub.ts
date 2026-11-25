import { Injectable, Optional } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import {
  STATE_SYNC_WS_CLOSE_CODES,
  applyStateSyncMutation,
  isAncestorOrEqualPath,
  isPlainObject,
  parseStateSyncPath,
  readStateSyncPath,
  validateStateSyncJsonValue,
  type StateSyncMutationOp,
  type StateSyncOnDisconnectAction,
  type StateSyncPresenceMember,
  type StateSyncRole,
} from "@synapse/shared/state-sync-contracts"
import { STATE_SYNC_READ_SCOPE, STATE_SYNC_WRITE_SCOPE } from "../api-keys/api-key-capabilities"
import type { ApiKeyChangeEvent } from "../api-keys/api-key-change-notifier"
import { loadStateSyncConfig, type StateSyncLimitsConfig } from "./state-sync-config"
import { StateSyncSubscriptionTrie } from "./state-sync-trie"

export type StateSyncSocketAdapter = {
  readonly bufferedAmount: number
  send(data: string): void
  close(code: number, reason: string): void
}

export type StateSyncCredentialType = "space_token" | "api_key" | "console_ticket"

export type DisconnectReason = "normal" | "timeout_or_slow" | "revoked" | "scope_changed" | "shutdown"

export type PersistDocInput = {
  readonly spaceId: string
  readonly docId: string
  readonly data: Record<string, unknown>
  readonly rev: bigint
  readonly expiresAt: Date | null
}

export type StateSyncDocPersister = (docKey: PersistDocInput) => Promise<void>

export type LoadedDocSnapshot = {
  readonly spaceId: string
  readonly docId: string
  readonly data: Record<string, unknown>
  readonly rev: bigint
  readonly ttlSeconds: number | null
  readonly expiresAt: Date | null
}

export type ActiveDocHandle = {
  readonly spaceId: string
  readonly docId: string
  readonly rev: bigint
  readonly evictedUpToRev: bigint
  readonly expiresAt: Date | null
  readonly onlineCount: number
  readonly observerCount: number
  readonly dirty: boolean
}

export type SnapshotItem = {
  readonly path: string
  readonly exists: boolean
  readonly value: unknown
}

export type MutationActor = {
  readonly connectionId?: string | null
  readonly clientId?: string | null
  readonly clientName?: string | null
}

export type MutationBroadcastFrame = {
  readonly type: "mutation"
  readonly rev: number
  readonly op: StateSyncMutationOp
  readonly path: string
  readonly value?: unknown
  readonly replayed: boolean
  readonly actor?: MutationActor
  readonly ts: string
}

export type SnapshotBroadcastFrame = {
  readonly type: "snapshot"
  readonly rev: number
  readonly path: string
  readonly exists: boolean
  readonly value: unknown
}

export type ReadyStateSyncPayload = {
  readonly type: "ready"
  readonly spaceId: string
  readonly docId: string
  readonly connectionId: string
  readonly clientId: string
  readonly role: StateSyncRole
  readonly rev: number
  readonly expiresAt: string | null
  readonly replayTruncated: boolean
  readonly presence: StateSyncPresenceMember[]
  readonly snapshots: SnapshotItem[]
}

export type LiveStateSyncConnection = {
  readonly connectionId: string
  readonly spaceId: string
  readonly docId: string
  readonly ownerId: string
  readonly credentialType: StateSyncCredentialType
  readonly credentialId: string
  readonly role: StateSyncRole
  readonly isObserver: boolean
  readonly clientId: string
  clientName: string | null
  meta: Record<string, unknown>
  readonly connectedAt: string
  readonly socket: StateSyncSocketAdapter
  onDisconnectActions: StateSyncOnDisconnectAction[]
  rateTokens: number
  rateLastRefillMs: number
}

export type RegisterStateSyncConnectionInput = {
  readonly spaceId: string
  readonly docId: string
  readonly ownerId: string
  readonly credentialType: StateSyncCredentialType
  readonly credentialId: string
  readonly role: StateSyncRole
  readonly isObserver: boolean
  readonly clientId: string
  readonly clientName: string | null
  readonly meta: Record<string, unknown>
  readonly paths?: readonly string[]
  readonly sinceRev?: number | bigint
  readonly socket: StateSyncSocketAdapter
  readonly docSnapshot?: LoadedDocSnapshot
  readonly now?: number
}

export type RegisterStateSyncConnectionResult =
  | {
      readonly ok: true
      readonly connection: LiveStateSyncConnection
      readonly readyPayload: ReadyStateSyncPayload
      readonly replayedMutations: MutationBroadcastFrame[]
    }
  | {
      readonly ok: false
      readonly code: string
      readonly closeCode: number
      readonly message: string
    }

export type HubMutateInput = {
  readonly op: StateSyncMutationOp
  readonly path: string
  readonly value?: unknown
  readonly expectedRev?: number | bigint
  readonly echo?: boolean
  readonly actor?: MutationActor
  readonly sourceConnectionId?: string
  readonly syncPersist?: boolean
  readonly skipRateLimit?: boolean
  readonly now?: number
}

export type HubMutateResult =
  | {
      readonly ok: true
      readonly rev: bigint
      readonly changed: boolean
      readonly expiresAt: Date | null
      readonly deliveredCount: number
    }
  | {
      readonly ok: false
      readonly code:
        | "DOC_NOT_FOUND"
        | "SHUTTING_DOWN"
        | "INVALID_INPUT"
        | "PATH_CONFLICT"
        | "DOC_TOO_LARGE"
        | "PAYLOAD_TOO_LARGE"
        | "REV_CONFLICT"
        | "RATE_LIMITED"
        | "PERSIST_FAILED"
      readonly message: string
      readonly currentRev?: bigint
      readonly retryAfterSec?: number
    }

export type UpdateSubscriptionsResult =
  | { readonly ok: true; readonly snapshots: SnapshotItem[]; readonly rev: bigint }
  | { readonly ok: false; readonly code: string; readonly message: string }

export type SetOnDisconnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string }

export type LiveDocStat = {
  readonly docId: string
  readonly rev: bigint
  readonly onlineCount: number
  readonly observerCount: number
  readonly expiresAt: Date | null
  readonly dirty: boolean
}

export type LiveSpaceStats = {
  readonly totalOnlineCount: number
  readonly totalObserverCount: number
  readonly activeDocCount: number
  readonly docs: LiveDocStat[]
}

type BufferedMutation = {
  readonly rev: bigint
  readonly timestampMs: number
  readonly writePath: string
  readonly frame: MutationBroadcastFrame
}

type TokenBucket = {
  tokens: number
  lastRefillMs: number
}

type ActiveDocState = {
  readonly key: string
  readonly spaceId: string
  readonly docId: string
  data: Record<string, unknown>
  rev: bigint
  evictedUpToRev: bigint
  ttlSeconds: number | null
  expiresAt: Date | null
  readonly connections: Map<string, LiveStateSyncConnection>
  readonly trie: StateSyncSubscriptionTrie
  readonly buffer: BufferedMutation[]
  productionCount: number
  observerCount: number
  readonly docWriteRate: TokenBucket
  writeChain: Promise<void>
  dirty: boolean
  dirtySinceMs: number | null
  persistedRev: bigint
  flushInFlight: Promise<void> | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  maxWaitTimer: ReturnType<typeof setTimeout> | null
  idleEvictTimer: ReturnType<typeof setTimeout> | null
  deleted: boolean
}

export function resolveApiKeyStateSyncWsRole(scopes: readonly string[]): StateSyncRole | null {
  if (scopes.includes(STATE_SYNC_WRITE_SCOPE)) return "create_write"
  if (scopes.includes(STATE_SYNC_READ_SCOPE)) return "read"
  return null
}

function makeDocKey(spaceId: string, docId: string): string {
  return `${spaceId}:${docId}`
}

function closeCodeToDisconnectReason(closeCode: number): DisconnectReason {
  if (closeCode === STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY) return "shutdown"
  if (closeCode === STATE_SYNC_WS_CLOSE_CODES.ROLE_CHANGED) return "scope_changed"
  if (closeCode === STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW) return "timeout_or_slow"
  if (closeCode === STATE_SYNC_WS_CLOSE_CODES.NORMAL) return "normal"
  return "revoked"
}

function toPresenceMember(connection: LiveStateSyncConnection): StateSyncPresenceMember {
  return {
    connectionId: connection.connectionId,
    clientId: connection.clientId,
    clientName: connection.clientName,
    role: connection.role,
    meta: structuredClone(connection.meta),
    connectedAt: connection.connectedAt,
  }
}

function toDocHandle(state: ActiveDocState): ActiveDocHandle {
  return {
    spaceId: state.spaceId,
    docId: state.docId,
    rev: state.rev,
    evictedUpToRev: state.evictedUpToRev,
    expiresAt: state.expiresAt ? new Date(state.expiresAt.getTime()) : null,
    onlineCount: state.productionCount,
    observerCount: state.observerCount,
    dirty: state.dirty,
  }
}

function refillBucket(bucket: TokenBucket, ratePerSec: number, burst: number, now: number): void {
  if (now > bucket.lastRefillMs) {
    const elapsedSec = (now - bucket.lastRefillMs) / 1000
    bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * ratePerSec)
    bucket.lastRefillMs = now
  }
}

function retryAfterSeconds(currentTokens: number, ratePerSec: number): number {
  const needed = Math.max(0, 1 - currentTokens)
  return Math.max(1, Math.ceil(needed / Math.max(ratePerSec, 0.0001)))
}

function validateAction(
  action: StateSyncOnDisconnectAction,
  config: StateSyncLimitsConfig,
): { ok: true; normalizedPath: string } | { ok: false; code: string; message: string } {
  const parsed = parseStateSyncPath(action.path)
  if (!parsed.ok) {
    return { ok: false, code: "INVALID_INPUT", message: parsed.message }
  }
  if (action.op !== "set" && action.op !== "patch" && action.op !== "delete") {
    return { ok: false, code: "INVALID_INPUT", message: `不支持的操作类型: ${String(action.op)}` }
  }
  if (action.op === "delete" && parsed.segments.length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "禁止删除根路径 /。" }
  }
  if (action.op === "set" && action.value === undefined) {
    return { ok: false, code: "INVALID_INPUT", message: "set 操作必须提供 value。" }
  }
  if (action.op === "set" && parsed.segments.length === 0 && !isPlainObject(action.value)) {
    return { ok: false, code: "INVALID_INPUT", message: "根节点必须为普通 JSON 对象。" }
  }
  if (action.op === "patch" && !isPlainObject(action.value)) {
    return { ok: false, code: "INVALID_INPUT", message: "patch 载荷必须为普通 JSON 对象。" }
  }
  if (action.value !== undefined) {
    const valCheck = validateStateSyncJsonValue(action.value, {
      maxBytes: config.maxWriteBytes,
      maxDepth: config.maxValueDepth,
    })
    if (!valCheck.ok) {
      return { ok: false, code: valCheck.code, message: valCheck.message }
    }
  }
  return { ok: true, normalizedPath: parsed.normalized }
}

@Injectable()
export class StateSyncHub {
  private readonly docs = new Map<string, ActiveDocState>()
  private readonly connectionsById = new Map<string, LiveStateSyncConnection>()
  private readonly productionCountBySpace = new Map<string, number>()
  private readonly productionCountByAccount = new Map<string, number>()
  private readonly docCreateRateBySpace = new Map<string, TokenBucket>()
  private globalProductionCount = 0
  private readonly config: StateSyncLimitsConfig
  private persister: StateSyncDocPersister | null = null
  private persistErrorHandler: ((error: unknown, spaceId: string, docId: string) => void) | null = null
  private shuttingDown = false

  constructor(@Optional() config?: StateSyncLimitsConfig) {
    this.config = config ?? loadStateSyncConfig()
  }

  getLimits(): StateSyncLimitsConfig {
    return this.config
  }

  configurePersister(
    persister: StateSyncDocPersister,
    onError?: (error: unknown, spaceId: string, docId: string) => void,
  ): void {
    this.persister = persister
    this.persistErrorHandler = onError ?? null
  }

  loadOrAttachDoc(snapshot: LoadedDocSnapshot): ActiveDocHandle {
    const key = makeDocKey(snapshot.spaceId, snapshot.docId)
    const existing = this.docs.get(key)
    if (existing && !existing.deleted) {
      this.clearIdleEvictTimer(existing)
      if (existing.connections.size === 0 && !existing.dirty && !this.shuttingDown) {
        this.scheduleIdleEvict(existing)
      }
      return toDocHandle(existing)
    }

    const rev = BigInt(snapshot.rev)
    const now = Date.now()
    const state: ActiveDocState = {
      key,
      spaceId: snapshot.spaceId,
      docId: snapshot.docId,
      data: structuredClone(snapshot.data),
      rev,
      evictedUpToRev: rev,
      ttlSeconds: snapshot.ttlSeconds,
      expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt.getTime()) : null,
      connections: new Map(),
      trie: new StateSyncSubscriptionTrie(),
      buffer: [],
      productionCount: 0,
      observerCount: 0,
      docWriteRate: { tokens: this.config.docWriteBurst, lastRefillMs: now },
      writeChain: Promise.resolve(),
      dirty: false,
      dirtySinceMs: null,
      persistedRev: rev,
      flushInFlight: null,
      debounceTimer: null,
      maxWaitTimer: null,
      idleEvictTimer: null,
      deleted: false,
    }

    this.docs.set(key, state)
    if (!this.shuttingDown) {
      this.scheduleIdleEvict(state)
    }
    return toDocHandle(state)
  }

  getDocHandle(spaceId: string, docId: string): ActiveDocHandle | null {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    if (!state || state.deleted) return null
    return toDocHandle(state)
  }

  readDocPath(
    spaceId: string,
    docId: string,
    path = "/",
  ): { readonly exists: boolean; readonly value: unknown; readonly rev: bigint; readonly expiresAt: Date | null } | null {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    if (!state || state.deleted) return null
    const read = readStateSyncPath(state.data, path)
    return {
      exists: read.exists,
      value: read.value,
      rev: state.rev,
      expiresAt: state.expiresAt ? new Date(state.expiresAt.getTime()) : null,
    }
  }

  hasActiveConnections(spaceId: string, docId: string): boolean {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    return Boolean(state && !state.deleted && state.connections.size > 0)
  }

  registerConnection(input: RegisterStateSyncConnectionInput): RegisterStateSyncConnectionResult {
    const now = input.now ?? Date.now()

    if (this.shuttingDown) {
      return {
        ok: false,
        code: "SHUTTING_DOWN",
        closeCode: STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY,
        message: "服务正在关闭，请稍后重连。",
      }
    }

    if (input.docSnapshot) {
      this.loadOrAttachDoc(input.docSnapshot)
    }

    const key = makeDocKey(input.spaceId, input.docId)
    const state = this.docs.get(key)
    if (!state || state.deleted) {
      return {
        ok: false,
        code: "DOC_NOT_FOUND",
        closeCode: STATE_SYNC_WS_CLOSE_CODES.REVOKED,
        message: "房间不存在或已删除。",
      }
    }

    if (input.isObserver) {
      if (state.observerCount >= this.config.maxObserversPerDoc) {
        return {
          ok: false,
          code: "OBSERVER_LIMIT_EXCEEDED",
          closeCode: STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "当前房间的调试台连接数已达上限。",
        }
      }
    } else {
      if (this.globalProductionCount >= this.config.maxGlobalConnections) {
        return {
          ok: false,
          code: "GLOBAL_CONNECTION_LIMIT_EXCEEDED",
          closeCode: STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "服务端状态同步连接数已达上限。",
        }
      }
      const accountCount = this.productionCountByAccount.get(input.ownerId) ?? 0
      if (accountCount >= this.config.maxConnectionsPerAccount) {
        return {
          ok: false,
          code: "ACCOUNT_CONNECTION_LIMIT_EXCEEDED",
          closeCode: STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "当前账号的状态同步连接数已达上限。",
        }
      }
      const spaceCount = this.productionCountBySpace.get(input.spaceId) ?? 0
      if (spaceCount >= this.config.maxConnectionsPerSpace) {
        return {
          ok: false,
          code: "SPACE_CONNECTION_LIMIT_EXCEEDED",
          closeCode: STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "当前同步空间的在线连接数已达上限。",
        }
      }
      if (state.productionCount >= this.config.maxConnectionsPerDoc) {
        return {
          ok: false,
          code: "DOC_CONNECTION_LIMIT_EXCEEDED",
          closeCode: STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED,
          message: "当前房间的在线连接数已达上限。",
        }
      }
    }

    const rawPaths = input.paths === undefined ? ["/"] : input.paths
    const normalizedPaths: string[] = []
    const seenPaths = new Set<string>()
    for (const rawPath of rawPaths) {
      const parsed = parseStateSyncPath(rawPath)
      if (!parsed.ok) {
        return {
          ok: false,
          code: "INVALID_INPUT",
          closeCode: STATE_SYNC_WS_CLOSE_CODES.AUTH_FAILED,
          message: parsed.message,
        }
      }
      if (!seenPaths.has(parsed.normalized)) {
        seenPaths.add(parsed.normalized)
        normalizedPaths.push(parsed.normalized)
      }
    }
    if (normalizedPaths.length > this.config.maxSubscribedPaths) {
      return {
        ok: false,
        code: "LIMIT_EXCEEDED",
        closeCode: STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED,
        message: `单连接最多订阅 ${this.config.maxSubscribedPaths} 条路径。`,
      }
    }

    this.clearIdleEvictTimer(state)
    this.pruneReplayBuffer(state, now)

    if (!input.isObserver && state.ttlSeconds !== null) {
      state.expiresAt = new Date(now + state.ttlSeconds * 1000)
    }

    const connection: LiveStateSyncConnection = {
      connectionId: `conn_${randomUUID().replaceAll("-", "")}`,
      spaceId: input.spaceId,
      docId: input.docId,
      ownerId: input.ownerId,
      credentialType: input.credentialType,
      credentialId: input.credentialId,
      role: input.role,
      isObserver: input.isObserver,
      clientId: input.clientId,
      clientName: input.clientName,
      meta: structuredClone(input.meta),
      connectedAt: new Date(now).toISOString(),
      socket: input.socket,
      onDisconnectActions: [],
      rateTokens: this.config.wsBurst,
      rateLastRefillMs: now,
    }

    // Broadcast presence.join to existing connections BEFORE inserting the new connection
    // so the new socket never receives presence frames before `ready`.
    if (!connection.isObserver) {
      this.broadcastFrame(state, {
        type: "presence.join",
        member: toPresenceMember(connection),
      })
    }

    // Re-clear idle eviction timer in case broadcasting presence.join evicted a broken socket.
    this.clearIdleEvictTimer(state)
    state.connections.set(connection.connectionId, connection)
    this.connectionsById.set(connection.connectionId, connection)
    state.trie.subscribe(connection.connectionId, normalizedPaths)

    if (connection.isObserver) {
      state.observerCount += 1
    } else {
      state.productionCount += 1
      this.globalProductionCount += 1
      this.productionCountBySpace.set(
        connection.spaceId,
        (this.productionCountBySpace.get(connection.spaceId) ?? 0) + 1,
      )
      this.productionCountByAccount.set(
        connection.ownerId,
        (this.productionCountByAccount.get(connection.ownerId) ?? 0) + 1,
      )
    }

    let replayTruncated = false
    let replayedMutations: MutationBroadcastFrame[] = []
    let snapshots: SnapshotItem[] = []

    if (input.sinceRev === undefined) {
      snapshots = this.buildSnapshots(state.data, normalizedPaths)
    } else {
      const sinceRev = BigInt(input.sinceRev)
      const withinWindow = sinceRev >= state.evictedUpToRev && sinceRev <= state.rev
      if (!withinWindow) {
        replayTruncated = true
        snapshots = this.buildSnapshots(state.data, normalizedPaths)
      } else {
        const missed = state.buffer.filter((entry) => entry.rev > sinceRev)
        let requiresFreshSnapshot = false
        const replayCandidates: MutationBroadcastFrame[] = []

        for (const entry of missed) {
          const coveredBySubscription = normalizedPaths.some((subPath) =>
            isAncestorOrEqualPath(subPath, entry.writePath),
          )
          if (coveredBySubscription) {
            replayCandidates.push({ ...entry.frame, replayed: true })
            continue
          }
          const overwritesSubscribedChild = normalizedPaths.some(
            (subPath) => entry.writePath !== subPath && isAncestorOrEqualPath(entry.writePath, subPath),
          )
          if (overwritesSubscribedChild) {
            requiresFreshSnapshot = true
            break
          }
        }

        if (requiresFreshSnapshot) {
          replayTruncated = true
          snapshots = this.buildSnapshots(state.data, normalizedPaths)
        } else {
          replayTruncated = false
          replayedMutations = replayCandidates
          snapshots = []
        }
      }
    }

    const readyPayload: ReadyStateSyncPayload = {
      type: "ready",
      spaceId: state.spaceId,
      docId: state.docId,
      connectionId: connection.connectionId,
      clientId: connection.clientId,
      role: connection.role,
      rev: Number(state.rev),
      expiresAt: state.expiresAt ? state.expiresAt.toISOString() : null,
      replayTruncated,
      presence: this.buildPresenceList(state),
      snapshots,
    }

    return {
      ok: true,
      connection,
      readyPayload,
      replayedMutations,
    }
  }

  async unregisterConnection(
    spaceId: string,
    docId: string,
    connectionId: string,
    reason: DisconnectReason,
  ): Promise<void> {
    const key = makeDocKey(spaceId, docId)
    const state = this.docs.get(key)
    if (!state) return
    const connection = state.connections.get(connectionId)
    if (!connection) return

    const pendingActions = this.detachConnection(state, connection)

    if (!connection.isObserver && reason !== "shutdown" && !state.deleted) {
      this.broadcastFrame(state, {
        type: "presence.leave",
        member: toPresenceMember(connection),
      })
    }

    const shouldRunOnDisconnect =
      (reason === "normal" || reason === "timeout_or_slow")
      && !this.shuttingDown
      && !state.deleted
      && !connection.isObserver
      && connection.role !== "read"
      && pendingActions.length > 0

    if (shouldRunOnDisconnect) {
      for (const action of pendingActions) {
        if (this.shuttingDown || state.deleted) break
        await this.mutate(spaceId, docId, {
          op: action.op,
          path: action.path,
          value: action.value,
          echo: false,
          actor: {
            connectionId: connection.connectionId,
            clientId: connection.clientId,
            clientName: connection.clientName,
          },
          skipRateLimit: true,
        })
      }
    }

    if (!state.deleted && !this.shuttingDown) {
      if (!connection.isObserver && state.productionCount === 0 && state.dirty) {
        await this.flushDoc(state)
      }
      if (state.connections.size === 0 && !state.dirty) {
        this.scheduleIdleEvict(state)
      }
    }
  }

  updateSubscriptions(
    spaceId: string,
    docId: string,
    connectionId: string,
    op: "subscribe" | "unsubscribe",
    paths: readonly string[],
  ): UpdateSubscriptionsResult {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    const connection = state?.connections.get(connectionId)
    if (!state || state.deleted || !connection) {
      return { ok: false, code: "CONNECTION_NOT_FOUND", message: "连接不存在。" }
    }

    const normalized: string[] = []
    const seen = new Set<string>()
    for (const rawPath of paths) {
      const parsed = parseStateSyncPath(rawPath)
      if (!parsed.ok) {
        return { ok: false, code: "INVALID_INPUT", message: parsed.message }
      }
      if (!seen.has(parsed.normalized)) {
        seen.add(parsed.normalized)
        normalized.push(parsed.normalized)
      }
    }

    if (op === "subscribe") {
      const merged = new Set(state.trie.getSubscribedPaths(connectionId))
      for (const path of normalized) merged.add(path)
      if (merged.size > this.config.maxSubscribedPaths) {
        return {
          ok: false,
          code: "LIMIT_EXCEEDED",
          message: `单连接最多订阅 ${this.config.maxSubscribedPaths} 条路径。`,
        }
      }
      state.trie.subscribe(connectionId, normalized)
      return {
        ok: true,
        snapshots: this.buildSnapshots(state.data, normalized),
        rev: state.rev,
      }
    }

    state.trie.unsubscribe(connectionId, normalized)
    return {
      ok: true,
      snapshots: [],
      rev: state.rev,
    }
  }

  setOnDisconnect(
    spaceId: string,
    docId: string,
    connectionId: string,
    actions: readonly StateSyncOnDisconnectAction[],
  ): SetOnDisconnectResult {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    const connection = state?.connections.get(connectionId)
    if (!state || state.deleted || !connection) {
      return { ok: false, code: "CONNECTION_NOT_FOUND", message: "连接不存在。" }
    }
    if (connection.isObserver || connection.role === "read") {
      return { ok: false, code: "FORBIDDEN", message: "当前连接无写权限，无法注册掉线动作。" }
    }
    if (actions.length > this.config.maxOnDisconnectActions) {
      return {
        ok: false,
        code: "LIMIT_EXCEEDED",
        message: `单连接最多注册 ${this.config.maxOnDisconnectActions} 条掉线动作。`,
      }
    }

    const sanitized: StateSyncOnDisconnectAction[] = []
    for (const action of actions) {
      const check = validateAction(action, this.config)
      if (!check.ok) {
        return { ok: false, code: check.code, message: check.message }
      }
      sanitized.push({
        op: action.op,
        path: check.normalizedPath,
        ...(action.value !== undefined ? { value: structuredClone(action.value) } : {}),
      })
    }

    connection.onDisconnectActions = sanitized
    return { ok: true }
  }

  mutate(spaceId: string, docId: string, input: HubMutateInput): Promise<HubMutateResult> {
    if (this.shuttingDown) {
      return Promise.resolve({
        ok: false,
        code: "SHUTTING_DOWN",
        message: "服务正在关闭，暂不接受新写入。",
      })
    }

    const state = this.docs.get(makeDocKey(spaceId, docId))
    if (!state || state.deleted) {
      return Promise.resolve({
        ok: false,
        code: "DOC_NOT_FOUND",
        message: "房间不存在。",
      })
    }

    return this.enqueueDocOp(state, () => this.executeMutateSerial(state, input))
  }

  updatePresence(
    spaceId: string,
    docId: string,
    connectionId: string,
    patch: { readonly clientName?: string; readonly meta?: Record<string, unknown> },
  ): StateSyncPresenceMember | null {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    const connection = state?.connections.get(connectionId)
    if (!state || state.deleted || !connection || connection.isObserver) return null

    if (patch.clientName !== undefined) connection.clientName = patch.clientName
    if (patch.meta !== undefined) connection.meta = structuredClone(patch.meta)

    const member = toPresenceMember(connection)
    this.broadcastFrame(state, { type: "presence.update", member })
    return member
  }

  getPresence(spaceId: string, docId: string): StateSyncPresenceMember[] {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    if (!state || state.deleted) return []
    return this.buildPresenceList(state)
  }

  getLiveDocStats(spaceId: string): LiveSpaceStats {
    let totalOnlineCount = 0
    let totalObserverCount = 0
    const docs: LiveDocStat[] = []

    for (const state of this.docs.values()) {
      if (state.deleted || state.spaceId !== spaceId) continue
      totalOnlineCount += state.productionCount
      totalObserverCount += state.observerCount
      docs.push({
        docId: state.docId,
        rev: state.rev,
        onlineCount: state.productionCount,
        observerCount: state.observerCount,
        expiresAt: state.expiresAt ? new Date(state.expiresAt.getTime()) : null,
        dirty: state.dirty,
      })
    }

    return {
      totalOnlineCount,
      totalObserverCount,
      activeDocCount: docs.length,
      docs,
    }
  }

  consumeDocCreateRate(spaceId: string, now = Date.now()): { readonly allowed: boolean; readonly retryAfterSec: number } {
    let bucket = this.docCreateRateBySpace.get(spaceId)
    if (!bucket) {
      bucket = { tokens: this.config.docCreateBurst, lastRefillMs: now }
      this.docCreateRateBySpace.set(spaceId, bucket)
    }
    const ratePerSec = this.config.docCreateRatePerMin / 60
    refillBucket(bucket, ratePerSec, this.config.docCreateBurst, now)
    if (bucket.tokens < 1) {
      return { allowed: false, retryAfterSec: retryAfterSeconds(bucket.tokens, ratePerSec) }
    }
    bucket.tokens -= 1
    return { allowed: true, retryAfterSec: 0 }
  }

  disconnectBySpace(
    spaceId: string,
    closeCode: number = STATE_SYNC_WS_CLOSE_CODES.REVOKED,
    reasonText = "Space deleted",
  ): number {
    const reason = closeCodeToDisconnectReason(closeCode)
    const targetDocs = [...this.docs.values()].filter((doc) => doc.spaceId === spaceId)
    const targets: LiveStateSyncConnection[] = []

    for (const doc of targetDocs) {
      if (closeCode === STATE_SYNC_WS_CLOSE_CODES.REVOKED) {
        doc.deleted = true
        this.clearAllTimers(doc)
      }
      for (const conn of doc.connections.values()) {
        targets.push(conn)
      }
    }

    const disconnected = this.forceCloseConnectionsBatch(targets, closeCode, reasonText, reason)

    if (closeCode === STATE_SYNC_WS_CLOSE_CODES.REVOKED) {
      for (const doc of targetDocs) {
        if (this.docs.get(doc.key) === doc) {
          this.docs.delete(doc.key)
        }
      }
    }

    this.docCreateRateBySpace.delete(spaceId)
    return disconnected
  }

  disconnectByDoc(
    spaceId: string,
    docId: string,
    closeCode: number = STATE_SYNC_WS_CLOSE_CODES.REVOKED,
    reasonText = "Document deleted",
  ): number {
    const key = makeDocKey(spaceId, docId)
    const doc = this.docs.get(key)
    if (!doc) return 0

    const reason = closeCodeToDisconnectReason(closeCode)
    if (closeCode === STATE_SYNC_WS_CLOSE_CODES.REVOKED) {
      doc.deleted = true
      this.clearAllTimers(doc)
    }

    const targets = [...doc.connections.values()]
    const disconnected = this.forceCloseConnectionsBatch(targets, closeCode, reasonText, reason)

    if (closeCode === STATE_SYNC_WS_CLOSE_CODES.REVOKED && this.docs.get(key) === doc) {
      this.docs.delete(key)
    }
    return disconnected
  }

  disconnectByToken(
    tokenId: string,
    closeCode: number = STATE_SYNC_WS_CLOSE_CODES.REVOKED,
    reasonText = "Token revoked",
  ): number {
    const reason = closeCodeToDisconnectReason(closeCode)
    const targets = [...this.connectionsById.values()].filter(
      (conn) => conn.credentialType === "space_token" && conn.credentialId === tokenId,
    )
    return this.forceCloseConnectionsBatch(targets, closeCode, reasonText, reason)
  }

  disconnectByOwner(
    ownerId: string,
    closeCode: number = STATE_SYNC_WS_CLOSE_CODES.REVOKED,
    reasonText = "Account disabled",
  ): number {
    const reason = closeCodeToDisconnectReason(closeCode)
    const targets = [...this.connectionsById.values()].filter((conn) => conn.ownerId === ownerId)
    return this.forceCloseConnectionsBatch(targets, closeCode, reasonText, reason)
  }

  handleApiKeyChange(event: ApiKeyChangeEvent): number {
    if (event.kind === "revoked") {
      return this.disconnectByApiKey(
        event.apiKeyId,
        STATE_SYNC_WS_CLOSE_CODES.REVOKED,
        "API key revoked",
        "revoked",
      )
    }
    if (event.kind === "user_disabled") {
      return this.disconnectByOwner(event.userId, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Account disabled")
    }

    const nextRole = resolveApiKeyStateSyncWsRole(event.scopes)
    const canAccessSpace = (spaceId: string): boolean =>
      event.stateSyncAccessMode === "all_owned" || event.stateSyncSpaceIds.includes(spaceId)

    // 1. Connections that lost space access or all state_sync WS scopes -> 4003 (revoked)
    let disconnected = this.disconnectByApiKey(
      event.apiKeyId,
      STATE_SYNC_WS_CLOSE_CODES.REVOKED,
      "API key state sync access revoked",
      "revoked",
      (conn) => !nextRole || !canAccessSpace(conn.spaceId),
    )

    // 2. Remaining connections whose effective read/write capability changed -> 4004 (scope_changed)
    if (nextRole) {
      const nextIsReadOnly = nextRole === "read"
      disconnected += this.disconnectByApiKey(
        event.apiKeyId,
        STATE_SYNC_WS_CLOSE_CODES.ROLE_CHANGED,
        "API key state sync scope changed",
        "scope_changed",
        (conn) => (conn.role === "read") !== nextIsReadOnly,
      )
    }

    return disconnected
  }

  async flushDocByKey(spaceId: string, docId: string): Promise<void> {
    const state = this.docs.get(makeDocKey(spaceId, docId))
    if (!state || state.deleted) return
    await this.flushDoc(state)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true

    for (const doc of this.docs.values()) {
      this.clearAllTimers(doc)
    }

    const allConnections = [...this.connectionsById.values()]
    this.forceCloseConnectionsBatch(
      allConnections,
      STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY,
      "Server shutting down",
      "shutdown",
    )

    const flushAll = Promise.allSettled(
      [...this.docs.values()]
        .filter((doc) => !doc.deleted)
        .map(async (doc) => {
          await doc.writeChain
          if (doc.dirty && !doc.deleted && this.persister) {
            await this.flushDoc(doc)
          }
        }),
    )
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const deadline = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, this.config.shutdownFlushTimeoutMs)
      timeoutHandle.unref?.()
    })

    await Promise.race([flushAll, deadline])
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }

  private enqueueDocOp<T>(state: ActiveDocState, fn: () => Promise<T> | T): Promise<T> {
    const run = state.writeChain.then(fn, fn)
    state.writeChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async executeMutateSerial(state: ActiveDocState, input: HubMutateInput): Promise<HubMutateResult> {
    const now = input.now ?? Date.now()

    if (this.shuttingDown) {
      return { ok: false, code: "SHUTTING_DOWN", message: "服务正在关闭，暂不接受新写入。" }
    }
    if (state.deleted) {
      return { ok: false, code: "DOC_NOT_FOUND", message: "房间不存在。" }
    }

    if (!input.skipRateLimit) {
      const rateCheck = this.consumeWriteRates(state, input.sourceConnectionId, now)
      if (!rateCheck.allowed) {
        return {
          ok: false,
          code: "RATE_LIMITED",
          message: rateCheck.message,
          retryAfterSec: rateCheck.retryAfterSec,
        }
      }
    }

    if (input.expectedRev !== undefined) {
      const expected = BigInt(input.expectedRev)
      if (state.rev !== expected) {
        return {
          ok: false,
          code: "REV_CONFLICT",
          message: "文档版本已更新，请重试。",
          currentRev: state.rev,
        }
      }
    }

    const parsedPath = parseStateSyncPath(input.path)
    if (!parsedPath.ok) {
      return { ok: false, code: "INVALID_INPUT", message: parsedPath.message }
    }

    if (input.value !== undefined) {
      const writeCheck = validateStateSyncJsonValue(input.value, {
        maxBytes: this.config.maxWriteBytes,
        maxDepth: this.config.maxValueDepth,
      })
      if (!writeCheck.ok) {
        return {
          ok: false,
          code: writeCheck.code,
          message: writeCheck.message,
        }
      }
    }

    const applied = applyStateSyncMutation(state.data, {
      op: input.op,
      path: parsedPath.normalized,
      value: input.value,
      maxDocBytes: this.config.maxDocBytes,
    })
    if (!applied.ok) {
      return {
        ok: false,
        code: applied.code,
        message: applied.message,
      }
    }

    if (!applied.changed) {
      return {
        ok: true,
        rev: state.rev,
        changed: false,
        expiresAt: state.expiresAt ? new Date(state.expiresAt.getTime()) : null,
        deliveredCount: 0,
      }
    }

    const nextRev = state.rev + 1n
    const nextExpiresAt =
      state.ttlSeconds !== null
        ? new Date(now + state.ttlSeconds * 1000)
        : state.expiresAt
          ? new Date(state.expiresAt.getTime())
          : null

    if (input.syncPersist && this.persister) {
      let persistFailed = false
      let persistError: unknown
      let abortedDeleted = false

      const runSyncPersist = async (): Promise<void> => {
        if (state.deleted) {
          abortedDeleted = true
          return
        }
        this.clearFlushTimers(state)
        const persister = this.persister
        if (!persister) {
          return
        }
        try {
          await persister({
            spaceId: state.spaceId,
            docId: state.docId,
            data: structuredClone(applied.nextRoot),
            rev: nextRev,
            expiresAt: nextExpiresAt ? new Date(nextExpiresAt.getTime()) : null,
          })
        } catch (error) {
          persistFailed = true
          persistError = error
          if (state.dirty && !state.deleted && !this.shuttingDown) {
            this.scheduleFlush(state)
          }
          return
        }

        if (state.deleted) {
          abortedDeleted = true
          return
        }

        state.data = applied.nextRoot
        state.rev = nextRev
        state.expiresAt = nextExpiresAt
        state.persistedRev = nextRev
        state.dirty = false
        state.dirtySinceMs = null
      }

      this.clearFlushTimers(state)
      const previous = state.flushInFlight ?? Promise.resolve()
      const tracked: Promise<void> = previous.then(runSyncPersist, runSyncPersist).finally(() => {
        if (state.flushInFlight === tracked) {
          state.flushInFlight = null
        }
      })
      state.flushInFlight = tracked
      await tracked

      if (persistFailed) {
        this.persistErrorHandler?.(persistError, state.spaceId, state.docId)
        if (state.deleted) {
          return {
            ok: false,
            code: "DOC_NOT_FOUND",
            message: "房间不存在。",
          }
        }
        return {
          ok: false,
          code: "PERSIST_FAILED",
          message: "持久化文档写入失败。",
        }
      }

      if (abortedDeleted || state.deleted) {
        return {
          ok: false,
          code: "DOC_NOT_FOUND",
          message: "房间不存在。",
        }
      }
    } else {
      state.data = applied.nextRoot
      state.rev = nextRev
      state.expiresAt = nextExpiresAt
      state.dirty = true
      if (state.dirtySinceMs === null) {
        state.dirtySinceMs = now
      }
      this.scheduleFlush(state)
    }

    this.pruneReplayBuffer(state, now)

    const mutationFrame: MutationBroadcastFrame = {
      type: "mutation",
      rev: Number(state.rev),
      op: input.op,
      path: parsedPath.normalized,
      ...(input.op !== "delete" ? { value: structuredClone(input.value) } : {}),
      replayed: false,
      ...(input.actor ? { actor: input.actor } : {}),
      ts: new Date(now).toISOString(),
    }

    state.buffer.push({
      rev: state.rev,
      timestampMs: now,
      writePath: parsedPath.normalized,
      frame: mutationFrame,
    })
    while (state.buffer.length > this.config.replayMaxItems) {
      const evicted = state.buffer.shift()
      if (evicted && evicted.rev > state.evictedUpToRev) {
        state.evictedUpToRev = evicted.rev
      }
    }

    const deliveredCount = this.broadcastMutationAndSnapshots(
      state,
      parsedPath.normalized,
      mutationFrame,
      input.echo ?? false,
      input.sourceConnectionId,
    )

    if (!state.dirty && state.connections.size === 0 && !state.deleted && !this.shuttingDown) {
      this.scheduleIdleEvict(state)
    }

    return {
      ok: true,
      rev: state.rev,
      changed: true,
      expiresAt: state.expiresAt ? new Date(state.expiresAt.getTime()) : null,
      deliveredCount,
    }
  }

  private consumeWriteRates(
    state: ActiveDocState,
    sourceConnectionId: string | undefined,
    now: number,
  ): { allowed: true } | { allowed: false; message: string; retryAfterSec: number } {
    let sourceConn: LiveStateSyncConnection | undefined
    if (sourceConnectionId) {
      sourceConn = state.connections.get(sourceConnectionId)
      if (sourceConn) {
        if (now > sourceConn.rateLastRefillMs) {
          const elapsedSec = (now - sourceConn.rateLastRefillMs) / 1000
          sourceConn.rateTokens = Math.min(
            this.config.wsBurst,
            sourceConn.rateTokens + elapsedSec * this.config.wsRatePerSec,
          )
          sourceConn.rateLastRefillMs = now
        }
        if (sourceConn.rateTokens < 1) {
          return {
            allowed: false,
            message: "单连接写入频率超过上限。",
            retryAfterSec: retryAfterSeconds(sourceConn.rateTokens, this.config.wsRatePerSec),
          }
        }
      }
    }

    refillBucket(state.docWriteRate, this.config.docWriteRatePerSec, this.config.docWriteBurst, now)
    if (state.docWriteRate.tokens < 1) {
      return {
        allowed: false,
        message: "当前房间写入频率超过上限。",
        retryAfterSec: retryAfterSeconds(state.docWriteRate.tokens, this.config.docWriteRatePerSec),
      }
    }

    if (sourceConn) {
      sourceConn.rateTokens -= 1
    }
    state.docWriteRate.tokens -= 1
    return { allowed: true }
  }

  private broadcastMutationAndSnapshots(
    state: ActiveDocState,
    writePath: string,
    mutationFrame: MutationBroadcastFrame,
    echo: boolean,
    sourceConnectionId?: string,
  ): number {
    const { mutationRecipients, snapshotRecipients } = state.trie.resolveAffected(writePath)
    const serializedMutation = JSON.stringify(mutationFrame)
    let deliveredCount = 0
    const failed: LiveStateSyncConnection[] = []

    for (const connId of mutationRecipients) {
      const conn = state.connections.get(connId)
      if (!conn) continue
      if (!echo && sourceConnectionId && conn.connectionId === sourceConnectionId) continue

      if (this.trySendRaw(conn, serializedMutation)) {
        if (!conn.isObserver) deliveredCount += 1
      } else {
        failed.push(conn)
      }
    }

    for (const [connId, paths] of snapshotRecipients) {
      const conn = state.connections.get(connId)
      if (!conn) continue
      if (!echo && sourceConnectionId && conn.connectionId === sourceConnectionId) continue

      let connFailed = false
      let sentAny = false
      for (const targetPath of paths) {
        const read = readStateSyncPath(state.data, targetPath)
        const snapFrame: SnapshotBroadcastFrame = {
          type: "snapshot",
          rev: Number(state.rev),
          path: targetPath,
          exists: read.exists,
          value: read.value,
        }
        if (this.trySendRaw(conn, JSON.stringify(snapFrame))) {
          sentAny = true
        } else {
          connFailed = true
          break
        }
      }

      if (connFailed) {
        failed.push(conn)
      } else if (sentAny && !conn.isObserver) {
        deliveredCount += 1
      }
    }

    for (const conn of failed) {
      this.evictSlowOrBroken(conn)
    }

    return deliveredCount
  }

  private scheduleFlush(state: ActiveDocState): void {
    if (!this.persister || state.deleted || this.shuttingDown) return

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null
      void this.flushDoc(state)
    }, this.config.flushDebounceMs)
    state.debounceTimer.unref?.()

    if (!state.maxWaitTimer) {
      state.maxWaitTimer = setTimeout(() => {
        state.maxWaitTimer = null
        void this.flushDoc(state)
      }, this.config.flushMaxWaitMs)
      state.maxWaitTimer.unref?.()
    }
  }

  private flushDoc(state: ActiveDocState): Promise<void> {
    if (!this.persister || state.deleted || !state.dirty) {
      this.clearFlushTimers(state)
      return Promise.resolve()
    }

    const run = async (): Promise<void> => {
      while (state.dirty && !state.deleted && this.persister) {
        this.clearFlushTimers(state)
        const targetRev = state.rev
        const snapshotData = structuredClone(state.data)
        const targetExpiresAt = state.expiresAt ? new Date(state.expiresAt.getTime()) : null

        try {
          await this.persister({
            spaceId: state.spaceId,
            docId: state.docId,
            data: snapshotData,
            rev: targetRev,
            expiresAt: targetExpiresAt,
          })

          if (state.deleted) {
            break
          }

          state.persistedRev = targetRev
          if (state.rev === targetRev) {
            state.dirty = false
            state.dirtySinceMs = null
          } else if (!this.shuttingDown && state.productionCount > 0) {
            this.scheduleFlush(state)
            break
          }
        } catch (error) {
          this.persistErrorHandler?.(error, state.spaceId, state.docId)
          if (!this.shuttingDown && !state.deleted) {
            this.scheduleFlush(state)
          }
          break
        }
      }

      if (!state.dirty && state.connections.size === 0 && !state.deleted && !this.shuttingDown) {
        this.scheduleIdleEvict(state)
      }
    }

    const previous = state.flushInFlight ?? Promise.resolve()
    const tracked: Promise<void> = previous.then(run, run).finally(() => {
      if (state.flushInFlight === tracked) {
        state.flushInFlight = null
      }
      if (!state.dirty && state.connections.size === 0 && !state.deleted && !this.shuttingDown) {
        this.scheduleIdleEvict(state)
      }
    })
    state.flushInFlight = tracked
    return tracked
  }

  private scheduleIdleEvict(state: ActiveDocState): void {
    this.clearIdleEvictTimer(state)
    if (state.connections.size > 0 || state.dirty || state.deleted || this.shuttingDown) {
      return
    }
    state.idleEvictTimer = setTimeout(() => {
      state.idleEvictTimer = null
      if (state.connections.size === 0 && !state.dirty && !state.flushInFlight && !state.deleted) {
        this.clearAllTimers(state)
        if (this.docs.get(state.key) === state) {
          this.docs.delete(state.key)
        }
      }
    }, this.config.idleEvictMs)
    state.idleEvictTimer.unref?.()
  }

  private clearFlushTimers(state: ActiveDocState): void {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }
    if (state.maxWaitTimer) {
      clearTimeout(state.maxWaitTimer)
      state.maxWaitTimer = null
    }
  }

  private clearIdleEvictTimer(state: ActiveDocState): void {
    if (state.idleEvictTimer) {
      clearTimeout(state.idleEvictTimer)
      state.idleEvictTimer = null
    }
  }

  private clearAllTimers(state: ActiveDocState): void {
    this.clearFlushTimers(state)
    this.clearIdleEvictTimer(state)
  }

  private pruneReplayBuffer(state: ActiveDocState, now: number): void {
    const cutoff = now - this.config.replayWindowMs
    while (state.buffer.length > 0 && state.buffer[0]!.timestampMs < cutoff) {
      const expired = state.buffer.shift()
      if (expired && expired.rev > state.evictedUpToRev) {
        state.evictedUpToRev = expired.rev
      }
    }
  }

  private buildSnapshots(data: Record<string, unknown>, paths: readonly string[]): SnapshotItem[] {
    return paths.map((path) => {
      const read = readStateSyncPath(data, path)
      return {
        path,
        exists: read.exists,
        value: read.value,
      }
    })
  }

  private buildPresenceList(state: ActiveDocState): StateSyncPresenceMember[] {
    const members: StateSyncPresenceMember[] = []
    for (const conn of state.connections.values()) {
      if (!conn.isObserver) {
        members.push(toPresenceMember(conn))
      }
    }
    return members
  }

  private broadcastFrame(
    state: ActiveDocState,
    frame: Record<string, unknown>,
    excludeConnectionId?: string,
  ): void {
    const serialized = JSON.stringify(frame)
    const failed: LiveStateSyncConnection[] = []
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

  private trySendRaw(connection: LiveStateSyncConnection, serialized: string): boolean {
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

  private evictSlowOrBroken(connection: LiveStateSyncConnection): void {
    this.forceCloseConnection(
      connection,
      STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW,
      "Slow consumer or broken socket",
      "timeout_or_slow",
    )
  }

  private detachConnection(
    state: ActiveDocState,
    connection: LiveStateSyncConnection,
  ): StateSyncOnDisconnectAction[] {
    const pendingActions = connection.onDisconnectActions
    connection.onDisconnectActions = []

    state.connections.delete(connection.connectionId)
    this.connectionsById.delete(connection.connectionId)
    state.trie.removeConnection(connection.connectionId)

    if (connection.isObserver) {
      state.observerCount = Math.max(0, state.observerCount - 1)
    } else {
      state.productionCount = Math.max(0, state.productionCount - 1)
      this.globalProductionCount = Math.max(0, this.globalProductionCount - 1)

      const nextSpaceCount = (this.productionCountBySpace.get(connection.spaceId) ?? 1) - 1
      if (nextSpaceCount <= 0) this.productionCountBySpace.delete(connection.spaceId)
      else this.productionCountBySpace.set(connection.spaceId, nextSpaceCount)

      const nextAccountCount = (this.productionCountByAccount.get(connection.ownerId) ?? 1) - 1
      if (nextAccountCount <= 0) this.productionCountByAccount.delete(connection.ownerId)
      else this.productionCountByAccount.set(connection.ownerId, nextAccountCount)
    }

    return pendingActions
  }

  private disconnectByApiKey(
    apiKeyId: string,
    closeCode: number,
    reasonText: string,
    reason: DisconnectReason,
    predicate?: (conn: LiveStateSyncConnection) => boolean,
  ): number {
    const targets = [...this.connectionsById.values()].filter(
      (conn) =>
        conn.credentialType === "api_key"
        && conn.credentialId === apiKeyId
        && (!predicate || predicate(conn)),
    )
    return this.forceCloseConnectionsBatch(targets, closeCode, reasonText, reason)
  }

  private forceCloseConnectionsBatch(
    targets: readonly LiveStateSyncConnection[],
    closeCode: number,
    reasonText: string,
    reason: DisconnectReason,
  ): number {
    if (targets.length === 0) return 0

    const detached: Array<{
      readonly state: ActiveDocState
      readonly connection: LiveStateSyncConnection
    }> = []
    const affectedDocs = new Map<ActiveDocState, { hadProductionDisconnect: boolean }>()

    for (const conn of targets) {
      conn.onDisconnectActions = []
      if (!this.connectionsById.has(conn.connectionId)) {
        continue
      }
      const state = this.docs.get(makeDocKey(conn.spaceId, conn.docId))
      if (!state || state.connections.get(conn.connectionId) !== conn) {
        this.connectionsById.delete(conn.connectionId)
        continue
      }
      this.detachConnection(state, conn)
      detached.push({ state, connection: conn })

      const docInfo = affectedDocs.get(state)
      if (docInfo) {
        if (!conn.isObserver) docInfo.hadProductionDisconnect = true
      } else {
        affectedDocs.set(state, { hadProductionDisconnect: !conn.isObserver })
      }
    }

    if (reason !== "shutdown") {
      for (const { state, connection } of detached) {
        if (!connection.isObserver && !state.deleted) {
          this.broadcastFrame(state, {
            type: "presence.leave",
            member: toPresenceMember(connection),
          })
        }
      }
    }

    for (const { connection } of detached) {
      try {
        connection.socket.close(closeCode, reasonText)
      } catch (error) {
        void error
      }
    }

    if (!this.shuttingDown) {
      for (const [state, info] of affectedDocs) {
        if (state.deleted) continue
        if (info.hadProductionDisconnect && state.productionCount === 0 && state.dirty) {
          void this.flushDoc(state).catch((error: unknown) => {
            this.persistErrorHandler?.(error, state.spaceId, state.docId)
          })
        } else if (state.connections.size === 0 && !state.dirty) {
          this.scheduleIdleEvict(state)
        }
      }
    }

    return detached.length
  }

  private forceCloseConnection(
    connection: LiveStateSyncConnection,
    closeCode: number,
    reasonText: string,
    reason: DisconnectReason,
  ): void {
    if (!this.connectionsById.has(connection.connectionId)) {
      return
    }
    // Do NOT await unregisterConnection here because forceCloseConnection may be called
    // synchronously during broadcast inside writeChain; unregisterConnection removes the
    // connection synchronously first and queues any allowed onDisconnect onto writeChain.
    void this.unregisterConnection(
      connection.spaceId,
      connection.docId,
      connection.connectionId,
      reason,
    ).catch((error: unknown) => {
      this.persistErrorHandler?.(error, connection.spaceId, connection.docId)
    })
    try {
      connection.socket.close(closeCode, reasonText)
    } catch (error) {
      void error
    }
  }
}
