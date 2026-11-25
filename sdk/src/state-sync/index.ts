import { StateSyncError, type StateSyncErrorOptions } from "../shared/errors"
import {
  applyMutationToMirror,
  applySnapshotToMirror,
  assertValidPath,
  cloneJsonValue,
  isAncestorOrEqualPath,
  isPathCoveredBySubscriptions,
  isPlainObject,
  readPath,
  validateJsonValue,
} from "../shared/path"
import {
  WsTransport,
  type WebSocketLike,
  type WebSocketLikeConstructor,
  type WsConnectionStatus,
} from "../shared/ws-transport"

export const SDK_VERSION = "1.0.0"

export { StateSyncError, type StateSyncErrorOptions }
export type { WebSocketLike, WebSocketLikeConstructor }

export type StateSyncMutationOp = "set" | "patch" | "delete"
export type StateSyncRole = "read" | "write" | "create_write"
export type StateSyncConnectionStatus = WsConnectionStatus

export interface StateSyncClientOptions {
  readonly baseUrl: string
  readonly spaceId: string
  readonly token: string
  readonly WebSocket?: WebSocketLikeConstructor
  readonly fetch?: typeof fetch
  readonly heartbeatIntervalMs?: number
  readonly reconnectBaseDelayMs?: number
  readonly reconnectMaxDelayMs?: number
}

export interface StateSyncOnDisconnectAction {
  readonly op: StateSyncMutationOp
  readonly path: string
  readonly value?: unknown
}

export interface StateSyncPresenceMember {
  readonly connectionId: string
  readonly clientId: string
  readonly clientName: string | null
  readonly role: StateSyncRole
  readonly meta: Record<string, unknown>
  readonly connectedAt: string
}

export interface StateSyncPresencePatch {
  readonly clientName?: string
  readonly meta?: Record<string, unknown>
}

export interface StateSyncListenerMeta {
  readonly rev: number
  readonly path: string
  readonly exists: boolean
}

export interface StateSyncMutateOptions {
  readonly expectedRev?: number
  readonly echo?: boolean
}

export interface StateSyncMutateResult {
  readonly rev: number
  readonly changed: boolean
}

export interface StateSyncTransactionHelpers {
  readonly abort: () => symbol
  readonly remove: () => symbol
}

export interface StateSyncTransactionOptions {
  readonly maxRetries?: number
}

export interface StateSyncTransactionResult<T = unknown> {
  readonly committed: boolean
  readonly rev: number
  readonly value: T
}

export interface StateSyncCreateRoomOptions {
  readonly docId?: string
  readonly initialData?: Record<string, unknown>
  readonly ttlSeconds?: number | null
  readonly clientId?: string
  readonly clientName?: string
  readonly meta?: Record<string, unknown>
  readonly paths?: readonly string[]
  readonly connect?: boolean
}

export interface StateSyncCreateRoomConnectedResult {
  readonly docId: string
  readonly rev: number
  readonly expiresAt: string | null
  readonly wsPath: string
  readonly room: StateSyncRoom
}

export interface StateSyncCreateRoomDetachedResult {
  readonly docId: string
  readonly rev: number
  readonly expiresAt: string | null
  readonly wsPath: string
}

export interface StateSyncJoinOptions {
  readonly clientId?: string
  readonly clientName?: string
  readonly meta?: Record<string, unknown>
  readonly paths?: readonly string[]
}

export interface StateSyncSnapshotResult {
  readonly spaceId: string
  readonly docId: string
  readonly path: string
  readonly exists: boolean
  readonly value: unknown
  readonly rev: number
  readonly expiresAt: string | null
}

export interface StateSyncRoom {
  readonly docId: string
  readonly rev: number
  readonly connectionId: string
  readonly clientId: string
  readonly expiresAt: string | null
  readonly status: StateSyncConnectionStatus
  get<T = unknown>(path?: string): T | undefined
  on<T = unknown>(path: string, cb: (value: T | undefined, meta: StateSyncListenerMeta) => void): () => void
  set(path: string, value: unknown, opts?: StateSyncMutateOptions): Promise<StateSyncMutateResult>
  patch(path: string, partialObj: Record<string, unknown>, opts?: StateSyncMutateOptions): Promise<StateSyncMutateResult>
  delete(path: string, opts?: StateSyncMutateOptions): Promise<StateSyncMutateResult>
  transaction<T = unknown>(
    path: string,
    updater: (current: T | undefined, helpers: StateSyncTransactionHelpers) => T | symbol | undefined,
    opts?: StateSyncTransactionOptions,
  ): Promise<StateSyncTransactionResult<T | undefined>>
  onDisconnect(actions: readonly StateSyncOnDisconnectAction[]): Promise<void>
  clearOnDisconnect(): Promise<void>
  onPresence(cb: (members: StateSyncPresenceMember[]) => void): () => void
  updatePresence(patch: StateSyncPresencePatch): void
  onStatus(cb: (status: StateSyncConnectionStatus) => void): () => void
  close(): void
}

export interface StateSyncClient {
  createRoom(opts: StateSyncCreateRoomOptions & { readonly connect: false }): Promise<StateSyncCreateRoomDetachedResult>
  createRoom(opts?: StateSyncCreateRoomOptions & { readonly connect?: true }): Promise<StateSyncCreateRoomConnectedResult>
  createRoom(
    opts?: StateSyncCreateRoomOptions,
  ): Promise<StateSyncCreateRoomConnectedResult | StateSyncCreateRoomDetachedResult>
  join(docId: string, opts?: StateSyncJoinOptions): Promise<StateSyncRoom>
  getSnapshot(docId: string, path?: string): Promise<StateSyncSnapshotResult>
}

const OPEN_API_PREFIX = "/api/open/v1/state-sync"
const MAX_ON_DISCONNECT_ACTIONS = 8
const MAX_SUBSCRIBED_PATHS = 32
const DEFAULT_TRANSACTION_RETRIES = 5
const TRANSACTION_ABORT = Symbol("SynapseStateSync.Abort")
const TRANSACTION_REMOVE = Symbol("SynapseStateSync.Remove")

type PathListenerEntry = {
  readonly path: string
  readonly cb: (value: unknown, meta: StateSyncListenerMeta) => void
}

type PendingRequest = {
  readonly resolve: (frame: Record<string, unknown>) => void
  readonly reject: (error: StateSyncError) => void
  readonly localMutation?: {
    readonly op: StateSyncMutationOp
    readonly path: string
    readonly value?: unknown
  }
}

type RevWaiter = {
  readonly targetRev: number
  readonly resolve: () => void
  readonly timer: ReturnType<typeof setTimeout>
}

function normalizeHttpBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "")
  if (!trimmed) {
    throw new StateSyncError("INVALID_CONFIG", "baseUrl 不能为空。")
  }
  if (/^wss:\/\//iu.test(trimmed)) return trimmed.replace(/^wss:\/\//iu, "https://")
  if (/^ws:\/\//iu.test(trimmed)) return trimmed.replace(/^ws:\/\//iu, "http://")
  return trimmed
}

function normalizeWsBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "")
  if (!trimmed) {
    throw new StateSyncError("INVALID_CONFIG", "baseUrl 不能为空。")
  }
  if (/^https:\/\//iu.test(trimmed)) return trimmed.replace(/^https:\/\//iu, "wss://")
  if (/^http:\/\//iu.test(trimmed)) return trimmed.replace(/^http:\/\//iu, "ws://")
  return trimmed
}

function createRequestId(seq: number): string {
  const cryptoObj = globalThis.crypto
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return `req_${seq}_${cryptoObj.randomUUID().slice(0, 8)}`
  }
  return `req_${seq}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSubscribedPaths(paths?: readonly string[]): string[] {
  const raw = paths === undefined || paths.length === 0 ? ["/"] : paths
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const item of raw) {
    const parsed = assertValidPath(item)
    if (!seen.has(parsed.normalized)) {
      seen.add(parsed.normalized)
      normalized.push(parsed.normalized)
    }
  }
  if (normalized.length > MAX_SUBSCRIBED_PATHS) {
    throw new StateSyncError("INVALID_INPUT", `单连接最多订阅 ${MAX_SUBSCRIBED_PATHS} 条路径。`)
  }
  return normalized
}

function validateMutationArgs(op: StateSyncMutationOp, path: string, value?: unknown): string {
  const { segments, normalized } = assertValidPath(path)
  if (op === "delete") {
    if (segments.length === 0) {
      throw new StateSyncError("INVALID_INPUT", "禁止删除根路径 /。")
    }
    return normalized
  }
  if (op === "set") {
    if (value === undefined) {
      throw new StateSyncError("INVALID_INPUT", "set 操作必须提供非 undefined 的 value。")
    }
    if (segments.length === 0 && !isPlainObject(value)) {
      throw new StateSyncError("INVALID_INPUT", "根节点必须为普通 JSON 对象。")
    }
    validateJsonValue(value)
    return normalized
  }
  if (op === "patch") {
    if (!isPlainObject(value)) {
      throw new StateSyncError("INVALID_INPUT", "patch 载荷必须为普通 JSON 对象。")
    }
    validateJsonValue(value)
    return normalized
  }
  throw new StateSyncError("INVALID_INPUT", `不支持的操作类型: ${String(op)}`)
}

function valuesDiffer(
  before: { readonly exists: boolean; readonly value: unknown },
  after: { readonly exists: boolean; readonly value: unknown },
): boolean {
  if (before.exists !== after.exists) return true
  if (!before.exists && !after.exists) return false
  return JSON.stringify(before.value) !== JSON.stringify(after.value)
}

class StateSyncRoomImpl implements StateSyncRoom {
  readonly docId: string
  private readonly token: string
  private readonly transport: WsTransport
  private readonly subscribedPaths: Set<string>
  private readonly listeners = new Set<PathListenerEntry>()
  private readonly presenceListeners = new Set<(members: StateSyncPresenceMember[]) => void>()
  private readonly statusListeners = new Set<(status: StateSyncConnectionStatus) => void>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly revWaiters = new Set<RevWaiter>()

  private mirror: Record<string, unknown> = {}
  private _rev = 0
  private appliedMirrorRev = 0
  private pendingReplayRemaining = 0
  private pendingReplayTargetRev: number | null = null
  private _connectionId = ""
  private _clientId: string
  private clientName?: string
  private meta?: Record<string, unknown>
  private _expiresAt: string | null = null
  private presenceMembers: StateSyncPresenceMember[] = []
  private desiredOnDisconnect: StateSyncOnDisconnectAction[] | null = null
  private requestSeq = 0
  private initialized = false
  private initialResolve: ((room: StateSyncRoom) => void) | null = null
  private initialReject: ((error: StateSyncError) => void) | null = null
  private lastServerError: StateSyncError | null = null

  constructor(params: {
    readonly wsUrl: string
    readonly docId: string
    readonly token: string
    readonly WebSocketCtor: WebSocketLikeConstructor
    readonly heartbeatIntervalMs?: number
    readonly reconnectBaseDelayMs?: number
    readonly reconnectMaxDelayMs?: number
    readonly joinOptions?: StateSyncJoinOptions
  }) {
    this.docId = params.docId
    this.token = params.token
    this._clientId = params.joinOptions?.clientId ?? ""
    this.clientName = params.joinOptions?.clientName
    this.meta = params.joinOptions?.meta ? cloneJsonValue(params.joinOptions.meta) : undefined
    this.subscribedPaths = new Set(normalizeSubscribedPaths(params.joinOptions?.paths))

    this.transport = new WsTransport({
      url: params.wsUrl,
      WebSocketCtor: params.WebSocketCtor,
      heartbeatIntervalMs: params.heartbeatIntervalMs,
      reconnectBaseDelayMs: params.reconnectBaseDelayMs,
      reconnectMaxDelayMs: params.reconnectMaxDelayMs,
      onOpen: (isReconnect) => this.handleTransportOpen(isReconnect),
      onMessage: (frame) => this.handleServerFrame(frame),
      onClose: (info) => this.handleTransportClose(info),
      onStatusChange: (status) => this.emitStatus(status),
    })
  }

  connect(): Promise<StateSyncRoom> {
    return new Promise<StateSyncRoom>((resolve, reject) => {
      this.initialResolve = resolve
      this.initialReject = reject
      this.transport.connect()
    })
  }

  get rev(): number {
    return this._rev
  }

  get connectionId(): string {
    return this._connectionId
  }

  get clientId(): string {
    return this._clientId
  }

  get expiresAt(): string | null {
    return this._expiresAt
  }

  get status(): StateSyncConnectionStatus {
    return this.transport.getStatus()
  }

  get<T = unknown>(path = "/"): T | undefined {
    const { normalized } = assertValidPath(path)
    const result = readPath(this.mirror, normalized)
    return result.exists ? (result.value as T) : undefined
  }

  on<T = unknown>(path: string, cb: (value: T | undefined, meta: StateSyncListenerMeta) => void): () => void {
    const { normalized } = assertValidPath(path)
    if (!isPathCoveredBySubscriptions(normalized, this.subscribedPaths)) {
      throw new StateSyncError(
        "PATH_NOT_SUBSCRIBED",
        `路径 "${normalized}" 未被当前连接的订阅路径覆盖。`,
      )
    }

    const entry: PathListenerEntry = {
      path: normalized,
      cb: cb as (value: unknown, meta: StateSyncListenerMeta) => void,
    }
    this.listeners.add(entry)

    const current = readPath(this.mirror, normalized)
    cb(current.exists ? (current.value as T) : undefined, {
      rev: this._rev,
      path: normalized,
      exists: current.exists,
    })

    return () => {
      this.listeners.delete(entry)
    }
  }

  async set(path: string, value: unknown, opts?: StateSyncMutateOptions): Promise<StateSyncMutateResult> {
    return this.sendMutate("set", path, value, opts)
  }

  async patch(
    path: string,
    partialObj: Record<string, unknown>,
    opts?: StateSyncMutateOptions,
  ): Promise<StateSyncMutateResult> {
    return this.sendMutate("patch", path, partialObj, opts)
  }

  async delete(path: string, opts?: StateSyncMutateOptions): Promise<StateSyncMutateResult> {
    return this.sendMutate("delete", path, undefined, opts)
  }

  async transaction<T = unknown>(
    path: string,
    updater: (current: T | undefined, helpers: StateSyncTransactionHelpers) => T | symbol | undefined,
    opts?: StateSyncTransactionOptions,
  ): Promise<StateSyncTransactionResult<T | undefined>> {
    const { normalized } = assertValidPath(path)
    if (!isPathCoveredBySubscriptions(normalized, this.subscribedPaths)) {
      throw new StateSyncError(
        "PATH_NOT_SUBSCRIBED",
        `路径 "${normalized}" 未被当前连接的订阅路径覆盖，无法执行 transaction。`,
      )
    }

    const rawRetries = opts?.maxRetries ?? DEFAULT_TRANSACTION_RETRIES
    const maxRetries = Number.isInteger(rawRetries) && rawRetries >= 0 ? rawRetries : DEFAULT_TRANSACTION_RETRIES

    const helpers: StateSyncTransactionHelpers = {
      abort: () => TRANSACTION_ABORT,
      remove: () => TRANSACTION_REMOVE,
    }

    let knownServerRev = this._rev

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const baseRev = Math.max(this._rev, knownServerRev)
      const currentSnap = readPath(this.mirror, normalized)
      const currentValue = currentSnap.exists ? (currentSnap.value as T) : undefined
      const next = updater(currentValue, helpers)

      if (next === TRANSACTION_ABORT || next === undefined) {
        const freshSnap = readPath(this.mirror, normalized)
        return {
          committed: false,
          rev: this._rev,
          value: freshSnap.exists ? (freshSnap.value as T) : undefined,
        }
      }

      try {
        if (next === TRANSACTION_REMOVE) {
          const res = await this.delete(normalized, { expectedRev: baseRev })
          return {
            committed: true,
            rev: res.rev,
            value: undefined,
          }
        }
        const res = await this.set(normalized, next, { expectedRev: baseRev })
        return {
          committed: true,
          rev: res.rev,
          value: cloneJsonValue(next as T),
        }
      } catch (error) {
        if (error instanceof StateSyncError && error.code === "REV_CONFLICT") {
          if (attempt >= maxRetries) {
            throw error
          }
          const targetRev =
            typeof error.currentRev === "number" ? Math.max(error.currentRev, baseRev + 1) : baseRev + 1
          knownServerRev = Math.max(knownServerRev, targetRev)
          await this.waitForRevAtLeast(targetRev, 150)
          continue
        }
        throw error
      }
    }

    throw new StateSyncError("REV_CONFLICT", "事务重试次数已耗尽。", { currentRev: knownServerRev })
  }

  async onDisconnect(actions: readonly StateSyncOnDisconnectAction[]): Promise<void> {
    if (!Array.isArray(actions)) {
      throw new StateSyncError("INVALID_INPUT", "actions 必须是数组。")
    }
    if (actions.length > MAX_ON_DISCONNECT_ACTIONS) {
      throw new StateSyncError("INVALID_INPUT", `单连接最多注册 ${MAX_ON_DISCONNECT_ACTIONS} 条掉线动作。`)
    }

    const sanitized: StateSyncOnDisconnectAction[] = actions.map((action) => {
      const normalizedPath = validateMutationArgs(action.op, action.path, action.value)
      return action.op === "delete"
        ? { op: "delete", path: normalizedPath }
        : { op: action.op, path: normalizedPath, value: cloneJsonValue(action.value) }
    })

    await this.sendRequest({
      type: "onDisconnect.set",
      actions: sanitized,
    })
    this.desiredOnDisconnect = sanitized
  }

  async clearOnDisconnect(): Promise<void> {
    await this.sendRequest({
      type: "onDisconnect.clear",
    })
    this.desiredOnDisconnect = null
  }

  onPresence(cb: (members: StateSyncPresenceMember[]) => void): () => void {
    this.presenceListeners.add(cb)
    cb(cloneJsonValue(this.presenceMembers))
    return () => {
      this.presenceListeners.delete(cb)
    }
  }

  updatePresence(patch: StateSyncPresencePatch): void {
    if (!patch || (patch.clientName === undefined && patch.meta === undefined)) {
      throw new StateSyncError("INVALID_INPUT", "updatePresence 至少需要提供 clientName 或 meta。")
    }
    if (patch.meta !== undefined) {
      if (!isPlainObject(patch.meta)) {
        throw new StateSyncError("INVALID_INPUT", "meta 必须为普通 JSON 对象。")
      }
      validateJsonValue(patch.meta)
      this.meta = cloneJsonValue(patch.meta)
    }
    if (patch.clientName !== undefined) {
      this.clientName = patch.clientName
    }

    this.transport.send({
      type: "presence.update",
      ...(patch.clientName !== undefined ? { clientName: patch.clientName } : {}),
      ...(patch.meta !== undefined ? { meta: cloneJsonValue(patch.meta) } : {}),
    })
  }

  onStatus(cb: (status: StateSyncConnectionStatus) => void): () => void {
    this.statusListeners.add(cb)
    cb(this.transport.getStatus())
    return () => {
      this.statusListeners.delete(cb)
    }
  }

  close(): void {
    this.rejectAllPending(new StateSyncError("CONNECTION_CLOSED", "客户端已关闭连接。"))
    this.flushRevWaiters()
    this.transport.close(1000, "Client closed")
  }

  private async sendMutate(
    op: StateSyncMutationOp,
    path: string,
    value: unknown,
    opts?: StateSyncMutateOptions,
  ): Promise<StateSyncMutateResult> {
    const normalizedPath = validateMutationArgs(op, path, value)
    const clonedValue = op === "delete" ? undefined : cloneJsonValue(value)

    const payload: Record<string, unknown> = {
      type: "mutate",
      op,
      path: normalizedPath,
      ...(op !== "delete" ? { value: clonedValue } : {}),
      ...(opts?.expectedRev !== undefined ? { expectedRev: opts.expectedRev } : {}),
      ...(opts?.echo !== undefined ? { echo: opts.echo } : {}),
    }

    const ack = await this.sendRequest(payload, {
      op,
      path: normalizedPath,
      value: clonedValue,
    })

    return {
      rev: typeof ack.rev === "number" ? ack.rev : this._rev,
      changed: typeof ack.changed === "boolean" ? ack.changed : true,
    }
  }

  private sendRequest(
    payload: Record<string, unknown>,
    localMutation?: PendingRequest["localMutation"],
  ): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = createRequestId(++this.requestSeq)
      this.pending.set(id, { resolve, reject, localMutation })
      try {
        this.transport.send({ ...payload, id })
      } catch (error) {
        this.pending.delete(id)
        reject(
          error instanceof StateSyncError
            ? error
            : new StateSyncError("SEND_FAILED", error instanceof Error ? error.message : "发送消息失败。"),
        )
      }
    })
  }

  private handleTransportOpen(isReconnect: boolean): void {
    const authPayload: Record<string, unknown> = {
      type: "auth",
      token: this.token,
      paths: [...this.subscribedPaths],
    }
    if (this._clientId) authPayload.clientId = this._clientId
    if (this.clientName !== undefined) authPayload.clientName = this.clientName
    if (this.meta !== undefined) authPayload.meta = cloneJsonValue(this.meta)
    if (isReconnect) authPayload.sinceRev = this.appliedMirrorRev

    try {
      this.transport.send(authPayload)
    } catch (error) {
      void error
    }
  }

  private handleTransportClose(info: { readonly code: number; readonly reason: string; readonly willReconnect: boolean }): void {
    this.pendingReplayRemaining = 0
    this.pendingReplayTargetRev = null
    this.rejectAllPending(
      new StateSyncError("CONNECTION_CLOSED", info.reason || `WebSocket 已关闭 (code ${info.code})。`),
    )
    if (!this.initialized && this.initialReject) {
      const rejectInitial = this.initialReject
      this.initialResolve = null
      this.initialReject = null
      rejectInitial(
        this.lastServerError
          ?? new StateSyncError("CONNECTION_CLOSED", info.reason || `连接关闭 (code ${info.code})。`),
      )
    }
    if (!info.willReconnect) {
      this.flushRevWaiters()
    }
  }

  private handleServerFrame(frame: Record<string, unknown>): void {
    const type = typeof frame.type === "string" ? frame.type : ""
    switch (type) {
      case "pong":
        this.transport.recordPong()
        return
      case "ready":
        this.handleReadyFrame(frame)
        return
      case "mutation":
        this.handleMutationFrame(frame)
        return
      case "snapshot":
        this.handleSnapshotFrame(frame)
        return
      case "ack":
        this.handleAckFrame(frame)
        return
      case "error":
        this.handleErrorFrame(frame)
        return
      case "presence.join":
        this.handlePresenceJoin(frame)
        return
      case "presence.leave":
        this.handlePresenceLeave(frame)
        return
      case "presence.update":
        this.handlePresenceUpdate(frame)
        return
      default:
        return
    }
  }

  private handleReadyFrame(frame: Record<string, unknown>): void {
    const isReconnect = this.initialized
    const readyRev = typeof frame.rev === "number" ? frame.rev : 0
    this._connectionId = typeof frame.connectionId === "string" ? frame.connectionId : ""
    if (typeof frame.clientId === "string" && frame.clientId.length > 0) {
      this._clientId = frame.clientId
    }
    this._expiresAt = typeof frame.expiresAt === "string" ? frame.expiresAt : null
    this.presenceMembers = Array.isArray(frame.presence)
      ? (cloneJsonValue(frame.presence) as StateSyncPresenceMember[])
      : []

    const snapshots = Array.isArray(frame.snapshots)
      ? (frame.snapshots as Array<{ path: string; exists: boolean; value: unknown }>)
      : []

    this.pendingReplayRemaining = 0
    this.pendingReplayTargetRev = null

    if (snapshots.length > 0) {
      const beforeStates = isReconnect ? this.captureListenerSnapshots([...this.listeners]) : null
      let nextMirror: Record<string, unknown> = {}
      for (const snap of snapshots) {
        nextMirror = applySnapshotToMirror(nextMirror, snap.path, Boolean(snap.exists), snap.value)
      }
      this.mirror = nextMirror
      this._rev = Math.max(this._rev, readyRev)
      this.appliedMirrorRev = Math.max(this.appliedMirrorRev, readyRev)
      if (beforeStates) {
        this.notifyChangedListeners(beforeStates, this._rev)
      }
    } else if (!isReconnect) {
      this._rev = Math.max(this._rev, readyRev)
      this.appliedMirrorRev = readyRev
    } else {
      const replayTruncated = Boolean(frame.replayTruncated)
      const replayedCount =
        typeof frame.replayedCount === "number" && Number.isInteger(frame.replayedCount) && frame.replayedCount >= 0
          ? frame.replayedCount
          : undefined
      if (!replayTruncated && replayedCount === 0) {
        this.appliedMirrorRev = Math.max(this.appliedMirrorRev, readyRev)
        this._rev = Math.max(this._rev, readyRev)
      } else if (!replayTruncated && replayedCount !== undefined && replayedCount > 0) {
        this.pendingReplayRemaining = replayedCount
        this.pendingReplayTargetRev = readyRev
      }
    }

    this.lastServerError = null
    this.transport.markAuthenticated()
    this.notifyRevWaiters()

    if (!this.initialized) {
      this.initialized = true
      const resolveInitial = this.initialResolve
      this.initialResolve = null
      this.initialReject = null
      resolveInitial?.(this)
    } else {
      this.emitPresence()
      if (this.desiredOnDisconnect && this.desiredOnDisconnect.length > 0) {
        const actionsToRestore = cloneJsonValue(this.desiredOnDisconnect)
        void this.sendRequest({
          type: "onDisconnect.set",
          actions: actionsToRestore,
        }).catch((error) => {
          void error
        })
      }
    }
  }

  private handleMutationFrame(frame: Record<string, unknown>): void {
    const rev = typeof frame.rev === "number" ? frame.rev : this._rev
    const op = frame.op as StateSyncMutationOp
    const path = typeof frame.path === "string" ? frame.path : "/"
    if (op !== "set" && op !== "patch" && op !== "delete") return

    const isReplayed = frame.replayed === true
    let advanced = false

    if (rev > this.appliedMirrorRev) {
      const candidates = this.collectAffectedListeners(path)
      const beforeStates = this.captureListenerSnapshots(candidates)

      this.mirror = applyMutationToMirror(this.mirror, op, path, frame.value)
      this.appliedMirrorRev = rev
      if (rev > this._rev) {
        this._rev = rev
      }
      advanced = true
      this.notifyChangedListeners(beforeStates, this._rev)
    }

    if (isReplayed && this.pendingReplayRemaining > 0) {
      this.pendingReplayRemaining -= 1
      if (this.pendingReplayRemaining === 0 && this.pendingReplayTargetRev !== null) {
        const targetRev = this.pendingReplayTargetRev
        this.pendingReplayTargetRev = null
        if (targetRev > this.appliedMirrorRev) {
          this.appliedMirrorRev = targetRev
          advanced = true
        }
        if (targetRev > this._rev) {
          this._rev = targetRev
          advanced = true
        }
      }
    }

    if (advanced) {
      this.notifyRevWaiters()
    }
  }

  private handleSnapshotFrame(frame: Record<string, unknown>): void {
    const rev = typeof frame.rev === "number" ? frame.rev : this._rev
    const path = typeof frame.path === "string" ? frame.path : "/"
    const exists = Boolean(frame.exists)

    const candidates = this.collectAffectedListeners(path)
    const beforeStates = this.captureListenerSnapshots(candidates)

    this.mirror = applySnapshotToMirror(this.mirror, path, exists, frame.value)
    if (rev > this.appliedMirrorRev) {
      this.appliedMirrorRev = rev
    }
    if (rev > this._rev) {
      this._rev = rev
    }

    this.notifyChangedListeners(beforeStates, this._rev)
    this.notifyRevWaiters()
  }

  private handleAckFrame(frame: Record<string, unknown>): void {
    const id = typeof frame.id === "string" ? frame.id : ""
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)

    const ackRev = typeof frame.rev === "number" ? frame.rev : undefined
    const changed = typeof frame.changed === "boolean" ? frame.changed : true

    const overlapsSubscribed =
      entry.localMutation !== undefined
      && this.isPathOverlappingSubscriptions(entry.localMutation.path)

    if (overlapsSubscribed && entry.localMutation && changed && (ackRev === undefined || ackRev > this.appliedMirrorRev)) {
      const { op, path, value } = entry.localMutation
      const candidates = this.collectAffectedListeners(path)
      const beforeStates = this.captureListenerSnapshots(candidates)

      this.mirror = applyMutationToMirror(this.mirror, op, path, value)
      if (ackRev !== undefined) {
        this.appliedMirrorRev = ackRev
        if (ackRev > this._rev) {
          this._rev = ackRev
        }
      }

      this.notifyChangedListeners(beforeStates, this._rev)
      this.notifyRevWaiters()
    } else if (ackRev !== undefined && ackRev > this._rev) {
      this._rev = ackRev
      this.notifyRevWaiters()
    }

    entry.resolve(frame)
  }

  private handleErrorFrame(frame: Record<string, unknown>): void {
    const code = typeof frame.code === "string" ? frame.code : "SERVER_ERROR"
    const message = typeof frame.message === "string" ? frame.message : "状态同步请求失败。"
    const currentRev = typeof frame.currentRev === "number" ? frame.currentRev : undefined
    const error = new StateSyncError(code, message, { currentRev })
    this.lastServerError = error

    const id = typeof frame.id === "string" ? frame.id : ""
    if (id) {
      const entry = this.pending.get(id)
      if (entry) {
        this.pending.delete(id)
        entry.reject(error)
        return
      }
    }

    if (!this.initialized && this.initialReject) {
      const rejectInitial = this.initialReject
      this.initialResolve = null
      this.initialReject = null
      this.transport.close(1000, error.message)
      rejectInitial(error)
    }
  }

  private handlePresenceJoin(frame: Record<string, unknown>): void {
    const member = frame.member as StateSyncPresenceMember | undefined
    if (!member || typeof member.connectionId !== "string") return
    const cloned = cloneJsonValue(member)
    const idx = this.presenceMembers.findIndex((m) => m.connectionId === cloned.connectionId)
    if (idx >= 0) {
      this.presenceMembers[idx] = cloned
    } else {
      this.presenceMembers.push(cloned)
    }
    this.emitPresence()
  }

  private handlePresenceLeave(frame: Record<string, unknown>): void {
    const member = frame.member as StateSyncPresenceMember | undefined
    if (!member || typeof member.connectionId !== "string") return
    const prevLen = this.presenceMembers.length
    this.presenceMembers = this.presenceMembers.filter((m) => m.connectionId !== member.connectionId)
    if (this.presenceMembers.length !== prevLen) {
      this.emitPresence()
    }
  }

  private handlePresenceUpdate(frame: Record<string, unknown>): void {
    const member = frame.member as StateSyncPresenceMember | undefined
    if (!member || typeof member.connectionId !== "string") return
    const cloned = cloneJsonValue(member)
    const idx = this.presenceMembers.findIndex((m) => m.connectionId === cloned.connectionId)
    if (idx >= 0) {
      this.presenceMembers[idx] = cloned
    } else {
      this.presenceMembers.push(cloned)
    }
    this.emitPresence()
  }

  private isPathOverlappingSubscriptions(path: string): boolean {
    for (const subPath of this.subscribedPaths) {
      if (isAncestorOrEqualPath(subPath, path) || isAncestorOrEqualPath(path, subPath)) {
        return true
      }
    }
    return false
  }

  private collectAffectedListeners(changedPath: string): PathListenerEntry[] {
    const affected: PathListenerEntry[] = []
    for (const entry of this.listeners) {
      if (isAncestorOrEqualPath(entry.path, changedPath) || isAncestorOrEqualPath(changedPath, entry.path)) {
        affected.push(entry)
      }
    }
    return affected
  }

  private captureListenerSnapshots(
    entries: readonly PathListenerEntry[],
  ): Array<{ readonly entry: PathListenerEntry; readonly before: { readonly exists: boolean; readonly value: unknown } }> {
    return entries.map((entry) => ({
      entry,
      before: readPath(this.mirror, entry.path),
    }))
  }

  private notifyChangedListeners(
    captured: ReadonlyArray<{
      readonly entry: PathListenerEntry
      readonly before: { readonly exists: boolean; readonly value: unknown }
    }>,
    rev: number,
  ): void {
    for (const { entry, before } of captured) {
      if (!this.listeners.has(entry)) continue
      const after = readPath(this.mirror, entry.path)
      if (!valuesDiffer(before, after)) continue
      try {
        entry.cb(after.exists ? after.value : undefined, {
          rev,
          path: entry.path,
          exists: after.exists,
        })
      } catch (error) {
        void error
      }
    }
  }

  private emitPresence(): void {
    for (const cb of [...this.presenceListeners]) {
      try {
        cb(cloneJsonValue(this.presenceMembers))
      } catch (error) {
        void error
      }
    }
  }

  private emitStatus(status: StateSyncConnectionStatus): void {
    for (const cb of [...this.statusListeners]) {
      try {
        cb(status)
      } catch (error) {
        void error
      }
    }
  }

  private rejectAllPending(error: StateSyncError): void {
    for (const entry of this.pending.values()) {
      entry.reject(error)
    }
    this.pending.clear()
  }

  private waitForRevAtLeast(targetRev: number, timeoutMs: number): Promise<void> {
    if (this._rev >= targetRev && this.appliedMirrorRev >= targetRev) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      const waiter: RevWaiter = {
        targetRev,
        resolve: () => {
          clearTimeout(waiter.timer)
          this.revWaiters.delete(waiter)
          resolve()
        },
        timer: setTimeout(() => {
          this.revWaiters.delete(waiter)
          resolve()
        }, timeoutMs),
      }
      this.revWaiters.add(waiter)
    })
  }

  private notifyRevWaiters(): void {
    for (const waiter of [...this.revWaiters]) {
      if (this._rev >= waiter.targetRev && this.appliedMirrorRev >= waiter.targetRev) {
        waiter.resolve()
      }
    }
  }

  private flushRevWaiters(): void {
    for (const waiter of [...this.revWaiters]) {
      waiter.resolve()
    }
  }
}

export function createClient(options: StateSyncClientOptions): StateSyncClient {
  if (!options || typeof options !== "object") {
    throw new StateSyncError("INVALID_CONFIG", "createClient 需要配置对象。")
  }
  const httpBase = normalizeHttpBaseUrl(options.baseUrl)
  const wsBase = normalizeWsBaseUrl(options.baseUrl)
  const spaceId = typeof options.spaceId === "string" ? options.spaceId.trim() : ""
  const token = typeof options.token === "string" ? options.token.trim() : ""

  if (!spaceId) {
    throw new StateSyncError("INVALID_CONFIG", "spaceId 不能为空。")
  }
  if (!token) {
    throw new StateSyncError("INVALID_CONFIG", "token 不能为空。")
  }

  const fetchImpl = options.fetch ?? globalThis.fetch
  const wsCtor = options.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketLikeConstructor | undefined)

  async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
    if (typeof fetchImpl !== "function") {
      throw new StateSyncError("FETCH_UNAVAILABLE", "当前环境缺少 fetch，请在 createClient 中传入 fetch。")
    }
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    })

    let parsedBody: unknown = null
    const text = await response.text()
    if (text) {
      try {
        parsedBody = JSON.parse(text)
      } catch (error) {
        void error
        parsedBody = null
      }
    }

    if (!response.ok) {
      const envelope = isPlainObject(parsedBody) ? parsedBody : null
      const errorObj = envelope && isPlainObject(envelope.error) ? envelope.error : null
      const code = typeof errorObj?.code === "string" ? errorObj.code : `HTTP_${response.status}`
      const message =
        typeof errorObj?.message === "string"
          ? errorObj.message
          : `状态同步 HTTP 请求失败 (HTTP ${response.status})。`
      const currentRev = typeof errorObj?.currentRev === "number" ? errorObj.currentRev : undefined
      const requestId = typeof envelope?.requestId === "string" ? envelope.requestId : undefined
      throw new StateSyncError(code, message, {
        status: response.status,
        currentRev,
        requestId,
      })
    }

    return parsedBody as T
  }

  async function join(docId: string, joinOpts?: StateSyncJoinOptions): Promise<StateSyncRoom> {
    const trimmedDocId = typeof docId === "string" ? docId.trim() : ""
    if (!trimmedDocId) {
      throw new StateSyncError("INVALID_INPUT", "docId 不能为空。")
    }
    if (typeof wsCtor !== "function") {
      throw new StateSyncError("WEBSOCKET_UNAVAILABLE", "当前环境缺少 WebSocket，请在 createClient 中传入 WebSocket。")
    }

    const wsUrl = `${wsBase}${OPEN_API_PREFIX}/spaces/${encodeURIComponent(spaceId)}/docs/${encodeURIComponent(trimmedDocId)}/ws`
    const room = new StateSyncRoomImpl({
      wsUrl,
      docId: trimmedDocId,
      token,
      WebSocketCtor: wsCtor,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      reconnectBaseDelayMs: options.reconnectBaseDelayMs,
      reconnectMaxDelayMs: options.reconnectMaxDelayMs,
      joinOptions: joinOpts,
    })
    return room.connect()
  }

  async function createRoom(
    opts?: StateSyncCreateRoomOptions,
  ): Promise<StateSyncCreateRoomConnectedResult | StateSyncCreateRoomDetachedResult> {
    const body: Record<string, unknown> = {}
    if (opts?.docId !== undefined) body.docId = opts.docId
    if (opts?.initialData !== undefined) {
      if (!isPlainObject(opts.initialData)) {
        throw new StateSyncError("INVALID_INPUT", "initialData 必须为普通 JSON 对象。")
      }
      validateJsonValue(opts.initialData)
      body.initialData = opts.initialData
    }
    if (opts?.ttlSeconds !== undefined) body.ttlSeconds = opts.ttlSeconds

    const url = `${httpBase}${OPEN_API_PREFIX}/spaces/${encodeURIComponent(spaceId)}/docs`
    const created = await requestJson<{
      readonly spaceId: string
      readonly docId: string
      readonly rev: number
      readonly expiresAt: string | null
      readonly wsPath: string
    }>(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (opts?.connect === false) {
      return {
        docId: created.docId,
        rev: created.rev,
        expiresAt: created.expiresAt,
        wsPath: created.wsPath,
      }
    }

    const room = await join(created.docId, {
      clientId: opts?.clientId,
      clientName: opts?.clientName,
      meta: opts?.meta,
      paths: opts?.paths,
    })

    return {
      docId: created.docId,
      rev: room.rev,
      expiresAt: room.expiresAt ?? created.expiresAt,
      wsPath: created.wsPath,
      room,
    }
  }

  async function getSnapshot(docId: string, path?: string): Promise<StateSyncSnapshotResult> {
    const trimmedDocId = typeof docId === "string" ? docId.trim() : ""
    if (!trimmedDocId) {
      throw new StateSyncError("INVALID_INPUT", "docId 不能为空。")
    }
    let query = ""
    if (path !== undefined) {
      const { normalized } = assertValidPath(path)
      query = `?path=${encodeURIComponent(normalized)}`
    }
    const url = `${httpBase}${OPEN_API_PREFIX}/spaces/${encodeURIComponent(spaceId)}/docs/${encodeURIComponent(trimmedDocId)}${query}`
    return requestJson<StateSyncSnapshotResult>(url, { method: "GET" })
  }

  return {
    createRoom: createRoom as StateSyncClient["createRoom"],
    join,
    getSnapshot,
  }
}
