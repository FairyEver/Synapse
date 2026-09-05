import { createHash, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { chmodSync, existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

import {
  TERMINAL_CLIENT_LEASE_LIMIT,
  TERMINAL_CLIENT_OBSERVE_LIMIT,
  TERMINAL_CONTROLLER_LEASE_LIMIT,
  TERMINAL_GLOBAL_OBSERVE_LIMIT,
  TERMINAL_GLOBAL_OUTPUT_RETENTION_BYTES,
  TERMINAL_GLOBAL_RUNNING_SESSION_LIMIT,
  TERMINAL_RENDERER_SNAPSHOT_MAX_BYTES,
  TERMINAL_SESSION_OBSERVE_LIMIT,
  TERMINAL_SESSION_OUTPUT_RETENTION_BYTES,
} from "../../../config"
import type {
  TerminalAcquireControlInput,
  TerminalCommandInput,
  TerminalCreateSessionOverrideInput,
  TerminalCreateSessionInput as TerminalMcpCreateSessionInput,
  TerminalObserveInput,
  TerminalPasteInput,
  TerminalRawInput,
  TerminalResizeInput,
  TerminalSemanticAction,
  TerminalSemanticInput,
  TerminalStopInput,
} from "../shared/contract-schema"
import { terminalContractError } from "../shared/errors"
import type {
  TerminalCreateCustomToolbarActionInput,
  TerminalCreateGroupCommandInput,
  TerminalCreateGroupInput,
  TerminalCreateSessionInput,
  TerminalAttachSessionInput,
  TerminalAttachSessionResult,
  TerminalDeleteGroupCommandInput,
  TerminalDeleteGroupInput,
  TerminalDeleteSessionInput,
  TerminalCustomToolbarAction,
  TerminalDeleteCustomToolbarActionInput,
  TerminalGroup,
  TerminalGroupCommand,
  TerminalGroupSettings,
  TerminalGlobalLaunchSettings,
  TerminalLaunchLayer,
  TerminalLaunchGroupCommandInput,
  TerminalReadSessionInput,
  TerminalReadSessionResult,
  TerminalRenameGroupInput,
  TerminalRenameSessionInput,
  TerminalResizeSessionInput,
  TerminalRunStartupCommandInput,
  TerminalSession,
  TerminalStopSessionInput,
  TerminalUpdateGroupCommandInput,
  TerminalUpdateGlobalLaunchSettingsInput,
  TerminalUpdateCustomToolbarActionInput,
  TerminalUpdateGroupSettingsInput,
  TerminalWriteSessionInput,
} from "../shared/schema"
import {
  TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH,
  TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH,
  TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT,
} from "../shared/schema"
import {
  TERMINAL_WORKSPACE_PANE_LIMIT,
  collectTerminalPaneLeaves,
  findTerminalPane,
  moveTerminalPane,
  removeTerminalPane,
  setTerminalSplitRatio,
  splitTerminalPane,
  type TerminalClosePaneInput,
  type TerminalCloseWorkspaceInput,
  type TerminalCloseWorkspaceResult,
  type TerminalMovePaneInput,
  type TerminalRenameWorkspaceInput,
  type TerminalSetSplitRatioInput,
  type TerminalSplitPaneInput,
  type TerminalSplitPaneResult,
  type TerminalWorkspace,
} from "../shared/workspace"
import { createTerminalCoreEmulator, type TerminalCoreEmulator } from "./emulator"
import type { TerminalAgentNotificationService } from "./agent-notification-service"
import {
  resolveTerminalEnvironment,
  resolveTerminalLaunchConfiguration,
  resolveTerminalShellArgs,
} from "./environment"
import { createTerminalOutputBuffer, type TerminalOutputBuffer } from "./output-buffer"
import type { TerminalRuntimeStoreUpdate, TerminalStore, TerminalStoreState } from "./store"

export type PtyDisposable = { dispose(): void }
export type PtyLike = {
  readonly pid?: number
  onData(listener: (data: string) => void): PtyDisposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable
  write(data: string | Buffer): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

type SpawnPtyInput = {
  readonly shell: string
  readonly shellArgs?: readonly string[]
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly env: Record<string, string>
}

type TerminalRuntime = {
  readonly pty: PtyLike
  readonly buffer: TerminalOutputBuffer
  readonly emulator: TerminalCoreEmulator
  readonly disposables: PtyDisposable[]
}

export type TerminalControllerContext = {
  readonly clientId: string
  readonly controllerInstanceId: string
  readonly actorKind: "user" | "agent" | "connector" | "extension" | "system"
}

type TerminalLeaseState = {
  readonly leaseId: string
  readonly clientId: string
  readonly controllerInstanceId: string
  readonly acquiredAt: string
  readonly expiresAt: string
  readonly leaseRevision: number
}

type TerminalOperationState = {
  readonly operationId: string
  readonly kind: "stop" | "force_stop" | "input" | "resize" | "delete" | "command_delivery"
  readonly sessionId: string
  status: "pending_delivery" | "delivered" | "delivery_uncertain" | "completed" | "failed"
  readonly requestedAt: string
  readonly requestedBy: string
  updatedAt: string
  relatedOperationId?: string
  finalLifecycle?: TerminalSession["status"]
  finalCause?: string
  errorCode?: string
  acceptedActionCount?: number
  acceptedBytes?: number
  failedActionIndex?: number
}

type IdempotencyEntry = {
  readonly clientId: string
  readonly capability: string
  readonly idempotencyKey: string
  readonly digest: string
  readonly expiresAtMs: number
  readonly result: unknown
}

type TerminalServiceLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
}

export type TerminalService = ReturnType<typeof createTerminalService>

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const LEASE_MIN_MS = 1_000
const LEASE_MAX_MS = 60_000
const COMMAND_ENTER_FLUSH_DELAY_MS = 10
const RUNTIME_PERSIST_DELAY_MS = 250
const RUNTIME_CHECKPOINT_INTERVAL_MS = 5_000
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000
const DELETE_TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1_000
const MAX_SEMANTIC_ACTIONS = 128
const MAX_SEMANTIC_BYTES = 256 * 1024
const NODE_PTY_SPAWN_HELPER_ENV = "SYNAPSE_NODE_PTY_SPAWN_HELPER"
const requireNodePty = createRequire(__filename)
let nodePtyModule: typeof import("node-pty") | undefined
const KEY_BYTES: Readonly<Record<string, string>> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Backspace: "\x7f",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
}

export function createTerminalService(deps: {
  readonly store: TerminalStore
  readonly outputRetentionBytes?: number
  readonly globalOutputRetentionBytes?: number
  readonly resolveDefaultShell?: () => string
  readonly resolveDefaultCwd?: () => string
  readonly resolveEffectivePath?: () => string | null
  readonly appVersion?: string
  readonly spawnPty?: (input: SpawnPtyInput) => PtyLike
  readonly logger?: TerminalServiceLogger
  readonly agentNotifications?: Pick<TerminalAgentNotificationService,
    "prepareSession" | "renameSession" | "handleUserInput" | "unregisterSession" | "handleOscNotification">
}) {
  const events = new EventEmitter()
  const groups = new Map<string, TerminalGroup>()
  const toolbarActions = new Map<string, TerminalCustomToolbarAction>()
  const workspaces = new Map<string, TerminalWorkspace>()
  const sessions = new Map<string, TerminalSession>()
  const runtimes = new Map<string, TerminalRuntime>()
  const buffers = new Map<string, TerminalOutputBuffer>()
  const checkpoints = new Map<string, TerminalStoreState["checkpoints"][number]>()
  const unpublishedSessions = new Map<string, number>()
  const leases = new Map<string, TerminalLeaseState>()
  const leaseRevisions = new Map<string, number>()
  const operations = new Map<string, TerminalOperationState>()
  const activeStopOperations = new Map<string, { stop?: string; force?: string }>()
  const idempotency = new Map<string, IdempotencyEntry>()
  const idempotencyInFlight = new Map<string, { digest: string; promise: Promise<unknown> }>()
  const dirtyRuntimeSessionIds = new Set<string>()
  const persistedOutputSeqBySession = new Map<string, number>()
  const deletePlans = new Map<string, {
    readonly deletePlanId: string
    readonly groupId: string
    readonly groupRevision: number
    readonly membershipRevision: number
    readonly commandCollectionRevision: number
    readonly sessionFacts: readonly { sessionId: string; lifecycle: TerminalSession["status"]; lastOutputSeq: number }[]
    readonly commandIds: readonly string[]
    readonly expiresAt: string
  }>()
  const observeBySession = new Map<string, number>()
  const observeByClient = new Map<string, number>()
  const observeWaitersByClient = new Map<string, Set<{ readonly sessionId: string; readonly cancel: () => void }>>()
  const pendingDomainEvents: Array<{
    readonly domainRevision: number
    readonly eventType: string
    readonly objectId: string
    readonly objectRevision: number
    readonly occurredAt: string
    readonly source: "terminal-core"
    readonly operationId?: string
  }> = []
  let observeGlobal = 0
  const outputRetentionBytes = deps.outputRetentionBytes ?? TERMINAL_SESSION_OUTPUT_RETENTION_BYTES
  const globalOutputRetentionBytes = deps.globalOutputRetentionBytes ?? TERMINAL_GLOBAL_OUTPUT_RETENTION_BYTES
  let terminalDomainRevision = 0
  let globalLaunch: TerminalGlobalLaunchSettings = {
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }
  let persistInFlight: Promise<void> | undefined
  let persistPending = false
  let fullPersistPending = false
  let runtimePersistTimer: ReturnType<typeof setTimeout> | undefined
  let lastRuntimeCheckpointAt = 0
  let persistIdleWaiters: Array<() => void> = []
  let persistRevision = 0
  let settledPersistRevision = 0
  let persistRevisionWaiters: Array<{ readonly revision: number; readonly resolve: () => void }> = []
  let lastPersistError: unknown

  function now(): string { return new Date().toISOString() }

  function snapshotState(): TerminalStoreState {
    pruneOperationTombstones()
    const runtimeCheckpoints = [...runtimes.entries()].flatMap(([sessionId, runtime]) => {
      const session = sessions.get(sessionId)
      if (!session || runtime.emulator.sizeRevision !== session.sizeRevision) return []
      const serialized = runtime.emulator.serialize()
      if (Buffer.byteLength(serialized, "utf8") > 1024 * 1024) return []
      return [{
        sessionId,
        throughOutputSeq: runtime.emulator.throughOutputSeq,
        sizeRevision: session.sizeRevision,
        emulatorId: "xterm-headless" as const,
        emulatorVersion: "6.0.0" as const,
        serialized,
      }]
    })
    return {
      globalLaunch,
      toolbarActions: [...toolbarActions.values()],
      groups: [...groups.values()],
      workspaces: [...workspaces.values()],
      sessions: [...sessions.values()],
      output: [...buffers.values()].flatMap((buffer) => buffer.snapshot()),
      terminalDomainRevision,
      operations: [...operations.values()].map((operation) => ({
        schemaVersion: 2 as const,
        id: operation.operationId,
        operationId: operation.operationId,
        kind: operation.kind,
        resourceType: "session" as const,
        resourceId: operation.sessionId,
        status: operation.status,
        createdAt: operation.requestedAt,
        updatedAt: operation.updatedAt,
        requestedBy: operation.requestedBy,
        ...(operation.relatedOperationId ? { relatedOperationId: operation.relatedOperationId } : {}),
        ...(operation.finalLifecycle ? { finalLifecycle: operation.finalLifecycle } : {}),
        ...(operation.finalCause ? { finalCause: operation.finalCause } : {}),
        ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
        ...(operation.acceptedActionCount !== undefined ? { acceptedActionCount: operation.acceptedActionCount } : {}),
        ...(operation.acceptedBytes !== undefined ? { acceptedBytes: operation.acceptedBytes } : {}),
        ...(operation.failedActionIndex !== undefined ? { failedActionIndex: operation.failedActionIndex } : {}),
      })),
      idempotency: [...idempotency.entries()].map(([scope, entry]) => ({ scope, ...entry })),
      checkpoints: [...checkpoints.values(), ...runtimeCheckpoints]
        .filter((checkpoint, index, items) => items.findLastIndex((item) => item.sessionId === checkpoint.sessionId) === index),
    }
  }

  function schedulePersist(): number {
    persistRevision += 1
    if (runtimePersistTimer) {
      clearTimeout(runtimePersistTimer)
      runtimePersistTimer = undefined
    }
    fullPersistPending = true
    queuePersist()
    return persistRevision
  }

  function scheduleRuntimePersist(sessionId: string): void {
    dirtyRuntimeSessionIds.add(sessionId)
    if (!deps.store.saveRuntimeState) {
      schedulePersist()
      return
    }
    persistRevision += 1
    if (runtimePersistTimer) return
    runtimePersistTimer = setTimeout(() => {
      runtimePersistTimer = undefined
      queuePersist()
    }, RUNTIME_PERSIST_DELAY_MS)
  }

  function queuePersist(): void {
    persistPending = true
    if (!persistInFlight) persistInFlight = runPersistLoop()
  }

  async function runPersistLoop(): Promise<void> {
    try {
      do {
        persistPending = false
        const snapshotRevision = persistRevision
        const saveFullState = fullPersistPending || !deps.store.saveRuntimeState
        fullPersistPending = false
        try {
          if (saveFullState) {
            const snapshot = snapshotState()
            await deps.store.saveState(snapshot)
            commitFullPersist(snapshot)
            publishPersistedDomainEvents(snapshot.terminalDomainRevision)
          } else {
            const snapshot = await snapshotRuntimeState()
            if (snapshot.update.sessions.length > 0) {
              await deps.store.saveRuntimeState!(snapshot.update)
              commitRuntimePersist(snapshot)
            }
          }
          lastPersistError = undefined
        } catch (error) {
          lastPersistError = error
          deps.logger?.warn("Terminal service failed to persist state.", { error })
        }
        settledPersistRevision = snapshotRevision
        const readyRevisionWaiters = persistRevisionWaiters.filter((waiter) => waiter.revision <= snapshotRevision)
        persistRevisionWaiters = persistRevisionWaiters.filter((waiter) => waiter.revision > snapshotRevision)
        for (const waiter of readyRevisionWaiters) waiter.resolve()
      } while (persistPending)
    } finally {
      persistInFlight = undefined
      if (!runtimePersistTimer && !persistPending) {
        const waiters = persistIdleWaiters
        persistIdleWaiters = []
        for (const resolve of waiters) resolve()
      }
    }
  }

  function waitForPersistIdle(): Promise<void> {
    if (!persistInFlight && !runtimePersistTimer && !persistPending) return Promise.resolve()
    return new Promise((resolve) => persistIdleWaiters.push(resolve))
  }

  function waitForPersistRevision(revision: number): Promise<void> {
    if (settledPersistRevision >= revision) return Promise.resolve()
    return new Promise((resolve) => persistRevisionWaiters.push({ revision, resolve }))
  }

  async function flushPersist(): Promise<void> {
    const revision = schedulePersist()
    await waitForPersistRevision(revision)
  }

  async function snapshotRuntimeState(): Promise<{
    readonly update: TerminalRuntimeStoreUpdate
    readonly stateRevisionBySession: ReadonlyMap<string, number>
    readonly attemptedCheckpoint: boolean
  }> {
    const captureCheckpoint = Date.now() - lastRuntimeCheckpointAt >= RUNTIME_CHECKPOINT_INTERVAL_MS
    const updates: TerminalRuntimeStoreUpdate["sessions"][number][] = []
    const stateRevisionBySession = new Map<string, number>()
    let attemptedCheckpoint = false
    for (const sessionId of dirtyRuntimeSessionIds) {
      const runtime = runtimes.get(sessionId)
      let checkpoint: TerminalStoreState["checkpoints"][number] | undefined
      if (captureCheckpoint && runtime) {
        attemptedCheckpoint = true
        const captured = await runtime.emulator.captureSnapshot(TERMINAL_RENDERER_SNAPSHOT_MAX_BYTES)
        if (captured.serialized !== null) {
          checkpoint = {
            sessionId,
            throughOutputSeq: captured.throughOutputSeq,
            sizeRevision: captured.sizeRevision,
            emulatorId: "xterm-headless",
            emulatorVersion: "6.0.0",
            serialized: captured.serialized,
          }
        }
      }
      const session = sessions.get(sessionId)
      const buffer = buffers.get(sessionId)
      if (!session || !buffer) {
        dirtyRuntimeSessionIds.delete(sessionId)
        continue
      }
      if (checkpoint && (checkpoint.sizeRevision !== session.sizeRevision
        || checkpoint.throughOutputSeq > session.lastOutputSeq)) checkpoint = undefined
      updates.push({
        session,
        output: buffer.snapshotAfter(persistedOutputSeqBySession.get(sessionId) ?? 0),
        firstRetainedOutputSeq: buffer.firstOutputSeq,
        ...(checkpoint ? { checkpoint } : {}),
      })
      stateRevisionBySession.set(sessionId, session.stateRevision)
    }
    return { update: { sessions: updates }, stateRevisionBySession, attemptedCheckpoint }
  }

  function commitRuntimePersist(snapshot: {
    readonly update: TerminalRuntimeStoreUpdate
    readonly stateRevisionBySession: ReadonlyMap<string, number>
    readonly attemptedCheckpoint: boolean
  }): void {
    for (const update of snapshot.update.sessions) {
      const persistedSeq = update.output.at(-1)?.seq
      if (persistedSeq !== undefined) persistedOutputSeqBySession.set(update.session.id, persistedSeq)
      if (update.checkpoint) checkpoints.set(update.session.id, update.checkpoint)
      const current = sessions.get(update.session.id)
      if (current?.stateRevision === snapshot.stateRevisionBySession.get(update.session.id)) {
        dirtyRuntimeSessionIds.delete(update.session.id)
      }
    }
    if (snapshot.attemptedCheckpoint) lastRuntimeCheckpointAt = Date.now()
  }

  function commitFullPersist(snapshot: TerminalStoreState): void {
    const retainedSessionIds = new Set(snapshot.sessions.map((session) => session.id))
    for (const session of snapshot.sessions) {
      persistedOutputSeqBySession.set(session.id, session.lastOutputSeq)
      if (sessions.get(session.id)?.stateRevision === session.stateRevision) {
        dirtyRuntimeSessionIds.delete(session.id)
      }
    }
    for (const sessionId of persistedOutputSeqBySession.keys()) {
      if (!retainedSessionIds.has(sessionId)) persistedOutputSeqBySession.delete(sessionId)
    }
    for (const sessionId of dirtyRuntimeSessionIds) {
      if (!retainedSessionIds.has(sessionId)) dirtyRuntimeSessionIds.delete(sessionId)
    }
    checkpoints.clear()
    for (const checkpoint of snapshot.checkpoints) checkpoints.set(checkpoint.sessionId, checkpoint)
    lastRuntimeCheckpointAt = Date.now()
  }

  function publishPersistedDomainEvents(throughDomainRevision: number): void {
    const ready = pendingDomainEvents.filter((event) => event.domainRevision <= throughDomainRevision)
    pendingDomainEvents.splice(0, ready.length)
    for (const event of ready) events.emit("domainChanged", event)
    for (const [sessionId, creationRevision] of unpublishedSessions) {
      if (creationRevision > throughDomainRevision) continue
      unpublishedSessions.delete(sessionId)
      const session = sessions.get(sessionId)
      if (session) events.emit("sessionChanged", session)
    }
  }

  function bumpDomain(eventType: string, objectId: string, objectRevision: number, operationId?: string): void {
    terminalDomainRevision += 1
    pendingDomainEvents.push({
      domainRevision: terminalDomainRevision,
      eventType,
      objectId,
      objectRevision,
      occurredAt: now(),
      source: "terminal-core",
      ...(operationId ? { operationId } : {}),
    })
  }

  function unknownAttention(session: Pick<TerminalSession, "lastOutputSeq" | "sizeRevision">, reason: string) {
    return {
      state: "unknown" as const,
      kind: "unknown" as const,
      reason,
      confidence: 0,
      detectedAt: now(),
      throughOutputSeq: session.lastOutputSeq,
      sizeRevision: session.sizeRevision,
      detectorId: "passive-terminal-v1",
      detectorVersion: "1.0.0",
    }
  }

  function ensureDefaultGroup(): TerminalGroup {
    const existing = [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder)[0]
    if (existing) return existing
    const timestamp = now()
    const group: TerminalGroup = {
      id: randomUUID(),
      name: "默认",
      createdAt: timestamp,
      updatedAt: timestamp,
      sortOrder: 0,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
    }
    groups.set(group.id, group)
    bumpDomain("group.created", group.id, group.groupRevision)
    return group
  }

  function getGroupOrThrow(groupId: string): TerminalGroup {
    const group = groups.get(groupId)
    if (!group) throw terminalContractError("not_found", "not_found")
    return group
  }

  function getSessionOrThrow(sessionId: string): TerminalSession {
    const session = sessions.get(sessionId)
    if (!session) throw terminalContractError("not_found", "not_found")
    return session
  }

  function getWorkspaceOrThrow(workspaceId: string): TerminalWorkspace {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) throw terminalContractError("not_found", "not_found")
    return workspace
  }

  function getWorkspaceBySessionId(sessionId: string): TerminalWorkspace | undefined {
    return [...workspaces.values()].find((workspace) =>
      collectTerminalPaneLeaves(workspace.layout).some((pane) => pane.sessionId === sessionId))
  }

  function createWorkspaceForSession(session: TerminalSession): TerminalWorkspace {
    const timestamp = now()
    const workspace: TerminalWorkspace = {
      id: randomUUID(),
      groupId: session.groupId,
      title: session.title,
      layout: { type: "leaf", paneId: randomUUID(), sessionId: session.id },
      layoutRevision: 1,
      closingPaneIds: [],
      closing: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    workspaces.set(workspace.id, workspace)
    bumpDomain("workspace.created", workspace.id, workspace.layoutRevision)
    return workspace
  }

  function updateGroupMembership(groupId: string): void {
    const group = groups.get(groupId)
    if (!group) return
    groups.set(groupId, {
      ...group,
      groupRevision: group.groupRevision + 1,
      membershipRevision: group.membershipRevision + 1,
      updatedAt: now(),
    })
  }

  function getRuntimeForInput(sessionId: string): TerminalRuntime {
    const session = getSessionOrThrow(sessionId)
    const runtime = runtimes.get(sessionId)
    if (!runtime || session.status !== "running") {
      throw terminalContractError("lifecycle_conflict", "lifecycle", { details: { lifecycle: session.status } })
    }
    return runtime
  }

  function cleanupRuntime(sessionId: string): void {
    const runtime = runtimes.get(sessionId)
    if (!runtime) return
    const session = sessions.get(sessionId)
    if (session && runtime.emulator.sizeRevision === session.sizeRevision) {
      const serialized = runtime.emulator.serialize()
      if (Buffer.byteLength(serialized, "utf8") <= 1024 * 1024) {
        checkpoints.set(sessionId, {
          sessionId,
          throughOutputSeq: runtime.emulator.throughOutputSeq,
          sizeRevision: session.sizeRevision,
          emulatorId: "xterm-headless",
          emulatorVersion: "6.0.0",
          serialized,
        })
      }
    }
    runtimes.delete(sessionId)
    runtime.emulator.dispose()
    for (const disposable of runtime.disposables) disposable.dispose()
  }

  function expireLease(sessionId: string, reason: string): void {
    if (!leases.has(sessionId)) return
    leases.delete(sessionId)
    const revision = (leaseRevisions.get(sessionId) ?? 0) + 1
    leaseRevisions.set(sessionId, revision)
    updateSessionState(sessionId, (session) => ({ ...session }), `lease.${reason}`)
  }

  function updateSessionState(
    sessionId: string,
    transform: (session: TerminalSession) => TerminalSession,
    changeType: string,
  ): TerminalSession {
    const current = getSessionOrThrow(sessionId)
    const updated = transform({
      ...current,
      stateRevision: current.stateRevision + 1,
      updatedAt: now(),
    })
    sessions.set(sessionId, updated)
    events.emit("sessionChanged", updated)
    events.emit("stateChanged", {
      sessionId,
      stateRevision: updated.stateRevision,
      throughOutputSeq: updated.lastOutputSeq,
      changeTypes: [changeType],
    })
    schedulePersist()
    return updated
  }

  function attachRuntime(session: TerminalSession, child: PtyLike, buffer: TerminalOutputBuffer): void {
    const emulator = createTerminalCoreEmulator({
      cols: session.cols,
      rows: session.rows,
      sizeRevision: session.sizeRevision,
      throughOutputSeq: session.lastOutputSeq,
      onWorkingDirectoryChanged: () => {
        if (!unpublishedSessions.has(session.id)) {
          events.emit("workingDirectoryChanged", { sessionId: session.id })
        }
      },
      onNotification: () => deps.agentNotifications?.handleOscNotification(session.id),
    })
    const dataDisposable = child.onData((data) => {
      const current = sessions.get(session.id)
      const runtime = runtimes.get(session.id)
      if (!current || !runtime || (current.status !== "running" && current.status !== "stopping")) return
      const chunk = runtime.buffer.append(session.id, data)
      void runtime.emulator.accept(data, chunk.seq).catch((error) => {
        deps.logger?.warn("Terminal headless emulator rejected output.", { sessionId: session.id, error })
      })
      const updated: TerminalSession = {
        ...current,
        lastOutputSeq: chunk.seq,
        updatedAt: now(),
        attention: unknownAttention({ ...current, lastOutputSeq: chunk.seq }, "output_changed"),
        stateRevision: current.stateRevision + 1,
        discardedOutputBytes: runtime.buffer.discardedBytes,
        discardedOutputChunks: runtime.buffer.discardedChunks,
        ...(runtime.buffer.discardedChunks > current.discardedOutputChunks ? { lastEvictedAt: now() } : {}),
      }
      sessions.set(session.id, updated)
      enforceGlobalOutputQuota()
      if (!unpublishedSessions.has(session.id)) {
        events.emit("data", { sessionId: session.id, chunk })
        events.emit("stateChanged", {
          sessionId: session.id,
          stateRevision: updated.stateRevision,
          throughOutputSeq: chunk.seq,
          changeTypes: ["output", "attention"],
        })
      }
      scheduleRuntimePersist(session.id)
    })
    const exitDisposable = child.onExit((event) => {
      const current = sessions.get(session.id)
      if (!current) return
      cleanupRuntime(session.id)
      expireLease(session.id, "session_ended")
      const timestamp = now()
      const active = activeStopOperations.get(session.id)
      const operationId = active?.force ?? active?.stop
      const terminationOperation = operationId ? operations.get(operationId) : undefined
      const cause = active?.force
        ? "force_stop_confirmed"
        : active?.stop
          ? "normal_stop_confirmed"
          : "process_exit"
      const updated: TerminalSession = {
        ...current,
        status: "ended",
        endCause: cause,
        ...(terminationOperation ? {
          stopOperationId: terminationOperation.operationId,
          stopRequestedBy: terminationOperation.requestedBy,
          stopRequestedAt: terminationOperation.requestedAt,
        } : {}),
        exitCode: event.exitCode,
        signal: event.signal,
        endedAt: timestamp,
        updatedAt: timestamp,
        stateRevision: current.stateRevision + 1,
        attention: unknownAttention(current, "not_running"),
      }
      sessions.set(session.id, updated)
      deps.agentNotifications?.unregisterSession(session.id)
      if (operationId) completeOperation(operationId, updated.status, cause)
      if (!unpublishedSessions.has(session.id)) {
        events.emit("sessionChanged", updated)
        events.emit("stateChanged", {
          sessionId: session.id,
          stateRevision: updated.stateRevision,
          throughOutputSeq: updated.lastOutputSeq,
          changeTypes: ["lifecycle", "operation", "attention", "lease"],
        })
      }
      void finalizeWorkspaceClosures(session.id)
    })
    runtimes.set(session.id, { pty: child, buffer, emulator, disposables: [dataDisposable, exitDisposable] })
  }

  function enforceGlobalOutputQuota(): void {
    let total = [...buffers.values()].reduce((sum, buffer) => sum + buffer.totalBytes, 0)
    while (total > globalOutputRetentionBytes) {
      const candidates = [...buffers.entries()]
        .filter(([, buffer]) => buffer.totalBytes > 0)
        .sort(([leftId, left], [rightId, right]) => {
          const leftEnded = sessions.get(leftId)?.status === "running" || sessions.get(leftId)?.status === "stopping" ? 1 : 0
          const rightEnded = sessions.get(rightId)?.status === "running" || sessions.get(rightId)?.status === "stopping" ? 1 : 0
          if (leftEnded !== rightEnded) return leftEnded - rightEnded
          return (left.snapshot()[0]?.createdAt ?? "").localeCompare(right.snapshot()[0]?.createdAt ?? "")
        })
      const candidate = candidates[0]
      if (!candidate) break
      const removed = candidate[1].evictOldest()
      if (!removed) break
      total -= removed.bytes
      const session = sessions.get(candidate[0])
      if (session) {
        const updated = {
          ...session,
          discardedOutputBytes: candidate[1].discardedBytes,
          discardedOutputChunks: candidate[1].discardedChunks,
          lastEvictedAt: now(),
          stateRevision: session.stateRevision + 1,
          updatedAt: now(),
          attention: unknownAttention(session, "output_evicted"),
        }
        sessions.set(session.id, updated)
        dirtyRuntimeSessionIds.add(session.id)
        events.emit("sessionChanged", updated)
        events.emit("stateChanged", {
          sessionId: session.id,
          stateRevision: updated.stateRevision,
          throughOutputSeq: updated.lastOutputSeq,
          changeTypes: ["output.gap"],
        })
      }
    }
  }

  async function createSessionRecord(
    input: TerminalCreateSessionInput,
    source: "ui" | "mcp" = "ui",
    launchOverrides?: {
      readonly shell?: string
      readonly environment?: TerminalLaunchLayer["environment"]
      readonly overriddenFields?: readonly ("cwd" | "shell" | "environment" | "cols" | "rows")[]
    },
    createdByClientId?: string,
    commandLaunch?: TerminalLaunchLayer,
    createWorkspace = true,
  ): Promise<TerminalSession> {
    assertCreateQuota()
    const group = input.groupId ? getGroupOrThrow(input.groupId) : ensureDefaultGroup()
    const resolvedLaunch = resolveTerminalLaunchConfiguration({
      global: globalLaunch.settings,
      group: launchLayerFromGroup(group.settings),
      command: commandLaunch,
      override: {
        ...(input.cwd ? { defaultCwd: input.cwd } : {}),
        ...(launchOverrides?.shell ? { shell: launchOverrides.shell } : {}),
        ...(launchOverrides?.environment ? { environment: launchOverrides.environment } : {}),
      },
    })
    const sessionId = randomUUID()
    const environment = resolveTerminalEnvironment({
      shell: resolvedLaunch.shell ?? deps.resolveDefaultShell?.(),
      cwd: resolvedLaunch.cwd ?? deps.resolveDefaultCwd?.() ?? os.homedir(),
      effectivePath: deps.resolveEffectivePath?.(),
      overrides: resolvedLaunch.environment,
      appVersion: deps.appVersion,
    })
    const launchEnvironment = Object.fromEntries(Object.entries(resolvedLaunch.environment)
      .filter((entry): entry is [string, string] => entry[1] !== null))
    const timestamp = now()
    const session: TerminalSession = {
      id: sessionId,
      groupId: group.id,
      title: input.title?.trim() || path.basename(environment.cwd) || "终端",
      cwd: environment.cwd,
      shell: environment.shell,
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      cols: input.cols ?? DEFAULT_COLS,
      rows: input.rows ?? DEFAULT_ROWS,
      lastOutputSeq: 0,
      metadataRevision: 1,
      stateRevision: 1,
      inputRevision: 0,
      sizeRevision: 1,
      attention: {
        state: "unknown",
        kind: "unknown",
        reason: "session_started",
        confidence: 0,
        detectedAt: timestamp,
        throughOutputSeq: 0,
        sizeRevision: 1,
        detectorId: "passive-terminal-v1",
        detectorVersion: "1.0.0",
      },
      creationSource: source,
      ...(createdByClientId ? { createdByClientId } : {}),
      endTimeUnknown: false,
      inputHistoryBeforeBaselineUnknown: false,
      launchRevisionApplied: group.launchRevision,
      globalLaunchRevisionApplied: globalLaunch.revision,
      discardedOutputBytes: 0,
      discardedOutputChunks: 0,
      ...(Object.keys(launchEnvironment).length ? { launchEnvironment } : {}),
      launchFacts: {
        shellKind: resolvedLaunch.shellKind,
        cwdKind: resolvedLaunch.cwdKind,
        environmentKeys: Object.keys(launchEnvironment).sort(),
        environmentEntries: [...resolvedLaunch.environmentEntries],
        overriddenFields: [...(launchOverrides?.overriddenFields ?? [])],
        cols: input.cols ?? DEFAULT_COLS,
        rows: input.rows ?? DEFAULT_ROWS,
        legacyUnversioned: false,
      },
    }
    const buffer = createTerminalOutputBuffer({ maxBytes: outputRetentionBytes })
    sessions.set(session.id, session)
    buffers.set(session.id, buffer)
    if (createWorkspace) createWorkspaceForSession(session)
    updateGroupMembership(group.id)
    bumpDomain("session.created", session.id, session.metadataRevision)
    unpublishedSessions.set(session.id, terminalDomainRevision)
    try {
      const defaultShellArgs = resolveTerminalShellArgs(environment.shell)
      const integration = deps.agentNotifications?.prepareSession({
        sessionId,
        title: session.title,
        shell: environment.shell,
        env: environment.env,
        defaultShellArgs,
      })
      const child = (deps.spawnPty ?? spawnNodePty)({
        shell: environment.shell,
        shellArgs: integration?.shellArgs ?? defaultShellArgs,
        cwd: environment.cwd,
        cols: session.cols,
        rows: session.rows,
        env: integration?.env ?? environment.env,
      })
      attachRuntime(session, child, buffer)
      await flushPersist()
      return getSessionOrThrow(session.id)
    } catch (error) {
      deps.logger?.warn("Terminal PTY process failed to start.", { sessionId, error })
      const failed: TerminalSession = {
        ...session,
        status: "failed",
        endCause: "pty_start_failed",
        endedAt: now(),
        updatedAt: now(),
        stateRevision: session.stateRevision + 1,
        attention: unknownAttention(session, "not_running"),
      }
      sessions.set(session.id, failed)
      deps.agentNotifications?.unregisterSession(session.id)
      await flushPersist()
      return getSessionOrThrow(session.id)
    }
  }

  async function start(): Promise<void> {
    const state = await deps.store.loadState()
    globalLaunch = state.globalLaunch ?? {
      revision: 1,
      updatedAt: new Date(0).toISOString(),
    }
    toolbarActions.clear()
    for (const action of state.toolbarActions ?? []) toolbarActions.set(action.id, action)
    terminalDomainRevision = state.terminalDomainRevision
    groups.clear()
    workspaces.clear()
    sessions.clear()
    buffers.clear()
    checkpoints.clear()
    operations.clear()
    idempotency.clear()
    for (const group of state.groups) groups.set(group.id, group)
    for (const session of state.sessions) {
      const restored = session.status === "running" || session.status === "stopping"
        ? {
            ...session,
            status: "lost" as const,
            endCause: "runtime_unrecoverable_after_restart",
            stateRevision: session.stateRevision + 1,
            updatedAt: now(),
            endedAt: now(),
            endTimeUnknown: false,
            attention: unknownAttention(session, "runtime_unrecoverable_after_restart"),
          }
        : session
      sessions.set(restored.id, restored)
      const chunks = state.output.filter((chunk) => chunk.sessionId === restored.id)
      buffers.set(restored.id, createTerminalOutputBuffer({
        maxBytes: outputRetentionBytes,
        initialChunks: chunks,
        initialDiscardedBytes: restored.discardedOutputBytes,
        initialDiscardedChunks: restored.discardedOutputChunks,
      }))
    }
    const assignedSessionIds = new Set<string>()
    for (const workspace of state.workspaces ?? []) {
      const panes = collectTerminalPaneLeaves(workspace.layout)
      if (panes.some((pane) => !sessions.has(pane.sessionId))) continue
      workspaces.set(workspace.id, workspace)
      for (const pane of panes) assignedSessionIds.add(pane.sessionId)
    }
    for (const session of sessions.values()) {
      if (!assignedSessionIds.has(session.id)) createWorkspaceForSession(session)
    }
    for (const operation of state.operations) {
      const restoredSession = sessions.get(operation.resourceId)
      const recoveredStatus = operation.status === "pending_delivery"
        ? "delivery_uncertain" as const
        : operation.status === "delivered" && restoredSession?.status === "lost"
          ? "completed" as const
          : operation.status
      operations.set(operation.operationId, {
        operationId: operation.operationId,
        kind: operation.kind,
        sessionId: operation.resourceId,
        status: recoveredStatus,
        requestedAt: operation.createdAt,
        requestedBy: operation.requestedBy,
        updatedAt: recoveredStatus === operation.status ? operation.updatedAt : now(),
        relatedOperationId: operation.relatedOperationId,
        finalLifecycle: recoveredStatus === "completed" ? "lost" : operation.finalLifecycle,
        finalCause: recoveredStatus === "completed" ? "runtime_unrecoverable_after_restart" : operation.finalCause,
        errorCode: recoveredStatus === "delivery_uncertain" ? "recovery_delivery_unknown" : operation.errorCode,
        acceptedActionCount: operation.acceptedActionCount,
        acceptedBytes: operation.acceptedBytes,
        failedActionIndex: operation.failedActionIndex,
      })
      if (recoveredStatus === "completed" && restoredSession?.status === "lost") {
        sessions.set(restoredSession.id, {
          ...restoredSession,
          stopOperationId: operation.operationId,
          stopRequestedBy: operation.requestedBy,
          stopRequestedAt: operation.createdAt,
        })
      }
    }
    for (const checkpoint of state.checkpoints) checkpoints.set(checkpoint.sessionId, checkpoint)
    for (const entry of state.idempotency) {
      if (entry.expiresAtMs > Date.now()) idempotency.set(entry.scope, {
        clientId: entry.clientId,
        capability: entry.capability,
        idempotencyKey: entry.idempotencyKey,
        digest: entry.digest,
        expiresAtMs: entry.expiresAtMs,
        result: entry.result,
      })
    }
    ensureDefaultGroup()
    for (const workspace of [...workspaces.values()]) finalizeWorkspaceClosuresInMemory(workspace.id)
    await flushPersist()
  }

  async function stop(): Promise<void> {
    for (const [sessionId, runtime] of runtimes) {
      const current = sessions.get(sessionId)
      if (current && (current.status === "running" || current.status === "stopping")) {
        sessions.set(sessionId, {
          ...current,
          status: "lost",
          endCause: "application_shutdown",
          endedAt: now(),
          endTimeUnknown: false,
          stateRevision: current.stateRevision + 1,
          updatedAt: now(),
          attention: unknownAttention(current, "application_shutdown"),
        })
      }
      cleanupRuntime(sessionId)
      try { runtime.pty.kill() } catch (error) {
        deps.logger?.warn("Terminal runtime shutdown failed.", { sessionId, error })
      }
    }
    leases.clear()
    await flushPersist()
  }

  function listGroups(): TerminalGroup[] {
    return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  }

  function getGroup(groupId: string): TerminalGroup {
    return getGroupOrThrow(groupId)
  }

  function getGroupCommand(groupId: string, commandId: string): TerminalGroupCommand {
    return getCommand(getGroupOrThrow(groupId), commandId)
  }

  function getGlobalLaunchSettings(): TerminalGlobalLaunchSettings {
    return globalLaunch
  }

  function listCustomToolbarActions(): TerminalCustomToolbarAction[] {
    return [...toolbarActions.values()]
  }

  function getCustomToolbarAction(id: string): TerminalCustomToolbarAction {
    const action = toolbarActions.get(id)
    if (!action) throw terminalContractError("not_found", "not_found")
    return action
  }

  async function createCustomToolbarAction(
    input: TerminalCreateCustomToolbarActionInput,
  ): Promise<TerminalCustomToolbarAction> {
    requireSensitivePersistence()
    if (toolbarActions.size >= TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { details: { dimension: "toolbar_actions" } })
    }
    const normalized = normalizeCustomToolbarActionInput(input)
    const timestamp = now()
    const action: TerminalCustomToolbarAction = {
      id: randomUUID(),
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
      actionRevision: 1,
    }
    toolbarActions.set(action.id, action)
    bumpDomain("toolbar_action.created", action.id, action.actionRevision)
    await flushPersist()
    return action
  }

  async function updateCustomToolbarAction(
    input: TerminalUpdateCustomToolbarActionInput,
  ): Promise<TerminalCustomToolbarAction> {
    requireSensitivePersistence()
    const existing = getCustomToolbarAction(input.id)
    const normalized = normalizeCustomToolbarActionInput(input)
    if (
      existing.label === normalized.label
      && existing.content === normalized.content
      && existing.pressEnter === normalized.pressEnter
    ) return existing
    const updated: TerminalCustomToolbarAction = {
      ...existing,
      ...normalized,
      updatedAt: now(),
      actionRevision: existing.actionRevision + 1,
    }
    toolbarActions.set(updated.id, updated)
    bumpDomain("toolbar_action.updated", updated.id, updated.actionRevision)
    await flushPersist()
    return updated
  }

  async function deleteCustomToolbarAction(
    input: TerminalDeleteCustomToolbarActionInput,
  ): Promise<void> {
    requireSensitivePersistence()
    const existing = getCustomToolbarAction(input.id)
    toolbarActions.delete(existing.id)
    bumpDomain("toolbar_action.deleted", existing.id, existing.actionRevision)
    await flushPersist()
  }

  async function updateGlobalLaunchSettings(
    input: TerminalUpdateGlobalLaunchSettingsInput,
  ): Promise<TerminalGlobalLaunchSettings> {
    if (input.expectedRevision !== globalLaunch.revision) {
      throw terminalContractError("revision_conflict", "revision", {
        details: { currentRevision: globalLaunch.revision },
      })
    }
    const settings = normalizeLaunchLayer(input.settings)
    if (hasSensitiveEnvironment(settings?.environment)) requireSensitivePersistence()
    if (stableJson(settings ?? {}) === stableJson(globalLaunch.settings ?? {})) return globalLaunch
    globalLaunch = {
      revision: globalLaunch.revision + 1,
      updatedAt: now(),
      ...(settings ? { settings } : {}),
    }
    bumpDomain("global_launch.updated", "default", globalLaunch.revision)
    await flushPersist()
    return globalLaunch
  }

  function listSessions(): TerminalSession[] {
    return [...sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  }

  function listWorkspaces(): TerminalWorkspace[] {
    return [...workspaces.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  }

  function getWorkspace(input: { workspaceId: string }): TerminalWorkspace {
    return getWorkspaceOrThrow(input.workspaceId)
  }

  function getWorkspaceForSession(input: { sessionId: string }): TerminalWorkspace {
    const workspace = getWorkspaceBySessionId(input.sessionId)
    if (!workspace) throw terminalContractError("not_found", "not_found")
    return workspace
  }

  async function renameWorkspace(input: TerminalRenameWorkspaceInput): Promise<TerminalWorkspace> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    const title = input.title.trim()
    if (title === workspace.title) return workspace
    const updated = {
      ...workspace,
      title,
      layoutRevision: workspace.layoutRevision + 1,
      updatedAt: now(),
    }
    workspaces.set(updated.id, updated)
    bumpDomain("workspace.renamed", updated.id, updated.layoutRevision)
    await flushPersist()
    return updated
  }

  async function splitPane(input: TerminalSplitPaneInput): Promise<TerminalSplitPaneResult> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    if (workspace.closing || workspace.closingPaneIds.includes(input.paneId)) {
      throw terminalContractError("lifecycle_conflict", "lifecycle")
    }
    const targetPane = findTerminalPane(workspace.layout, input.paneId)
    if (!targetPane) throw terminalContractError("not_found", "not_found")
    if (collectTerminalPaneLeaves(workspace.layout).length >= TERMINAL_WORKSPACE_PANE_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { details: { dimension: "workspace_panes" } })
    }
    const targetSession = getSessionOrThrow(targetPane.sessionId)
    const session = await createSessionRecord({
      groupId: workspace.groupId,
      cwd: runtimes.get(targetSession.id)?.emulator.currentCwd ?? targetSession.cwd,
      cols: input.cols,
      rows: input.rows,
    }, "ui", undefined, undefined, undefined, false)
    const paneId = randomUUID()
    const layout = splitTerminalPane(workspace.layout, input.paneId, {
      splitId: randomUUID(),
      direction: input.direction === "right" ? "horizontal" : "vertical",
      ratio: 0.5,
    }, { type: "leaf", paneId, sessionId: session.id })
    if (!layout) throw terminalContractError("not_found", "not_found")
    const updated = {
      ...workspace,
      layout,
      layoutRevision: workspace.layoutRevision + 1,
      updatedAt: now(),
    }
    workspaces.set(updated.id, updated)
    bumpDomain("workspace.layout_changed", updated.id, updated.layoutRevision)
    await flushPersist()
    return { workspace: updated, paneId, sessionId: session.id }
  }

  async function updateSplitRatio(input: TerminalSetSplitRatioInput): Promise<TerminalWorkspace> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    const ratio = Math.min(0.95, Math.max(0.05, input.ratio))
    const layout = setTerminalSplitRatio(workspace.layout, input.splitId, ratio)
    if (!layout) throw terminalContractError("not_found", "not_found")
    if (stableJson(layout) === stableJson(workspace.layout)) return workspace
    const updated = {
      ...workspace,
      layout,
      layoutRevision: workspace.layoutRevision + 1,
      updatedAt: now(),
    }
    workspaces.set(updated.id, updated)
    bumpDomain("workspace.layout_changed", updated.id, updated.layoutRevision)
    await flushPersist()
    return updated
  }

  async function movePane(input: TerminalMovePaneInput): Promise<TerminalWorkspace> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    if (input.sourcePaneId === input.targetPaneId) {
      throw terminalContractError("invalid_argument", "validation")
    }
    if (
      workspace.closing
      || workspace.closingPaneIds.includes(input.sourcePaneId)
      || workspace.closingPaneIds.includes(input.targetPaneId)
    ) {
      throw terminalContractError("lifecycle_conflict", "lifecycle")
    }
    const layout = moveTerminalPane(
      workspace.layout,
      input.sourcePaneId,
      input.targetPaneId,
      input.edge,
      randomUUID(),
    )
    if (!layout) throw terminalContractError("not_found", "not_found")
    const updated = {
      ...workspace,
      layout,
      layoutRevision: workspace.layoutRevision + 1,
      updatedAt: now(),
    }
    workspaces.set(updated.id, updated)
    bumpDomain("workspace.layout_changed", updated.id, updated.layoutRevision)
    await flushPersist()
    return updated
  }

  async function closePane(input: TerminalClosePaneInput): Promise<TerminalCloseWorkspaceResult> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    const pane = findTerminalPane(workspace.layout, input.paneId)
    if (!pane) throw terminalContractError("not_found", "not_found")
    const session = getSessionOrThrow(pane.sessionId)
    assertForceCloseSupported(input.force, [session])
    const closingPaneIds = workspace.closingPaneIds.includes(pane.paneId)
      ? workspace.closingPaneIds
      : [...workspace.closingPaneIds, pane.paneId]
    const updated = closingPaneIds === workspace.closingPaneIds
      ? workspace
      : {
          ...workspace,
          closingPaneIds,
          layoutRevision: workspace.layoutRevision + 1,
          updatedAt: now(),
        }
    if (updated !== workspace) {
      workspaces.set(updated.id, updated)
      bumpDomain("workspace.close_requested", updated.id, updated.layoutRevision)
      await flushPersist()
    }
    await requestSessionClosure(session, Boolean(input.force))
    await finalizeWorkspaceClosures(session.id)
    return workspaceCloseResult(input.workspaceId)
  }

  async function closeWorkspace(input: TerminalCloseWorkspaceInput): Promise<TerminalCloseWorkspaceResult> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    const panes = collectTerminalPaneLeaves(workspace.layout)
    const memberSessions = panes.map((pane) => getSessionOrThrow(pane.sessionId))
    assertForceCloseSupported(input.force, memberSessions)
    const updated: TerminalWorkspace = workspace.closing
      ? workspace
      : {
          ...workspace,
          closing: true,
          closingPaneIds: panes.map((pane) => pane.paneId),
          layoutRevision: workspace.layoutRevision + 1,
          updatedAt: now(),
        }
    if (updated !== workspace) {
      workspaces.set(updated.id, updated)
      bumpDomain("workspace.close_requested", updated.id, updated.layoutRevision)
      await flushPersist()
    }
    for (const session of memberSessions) await requestSessionClosure(session, Boolean(input.force))
    await finalizeWorkspaceClosures(memberSessions[0]?.id)
    return workspaceCloseResult(input.workspaceId)
  }

  function assertWorkspaceRevision(workspace: TerminalWorkspace, expected: number): void {
    if (workspace.layoutRevision !== expected) {
      throw terminalContractError("revision_conflict", "revision", {
        details: { currentRevision: workspace.layoutRevision },
      })
    }
  }

  function assertForceCloseSupported(force: boolean | undefined, members: readonly TerminalSession[]): void {
    if (force && process.platform === "win32" && members.some(isActiveSession)) {
      throw terminalContractError("force_stop_unsupported", "capability")
    }
  }

  async function requestSessionClosure(session: TerminalSession, force: boolean): Promise<void> {
    const current = sessions.get(session.id)
    if (!current || !isActiveSession(current)) return
    if (!force && current.status === "stopping") return
    await terminate({ sessionId: current.id, idempotencyKey: randomUUID() }, userController(), force)
  }

  function workspaceCloseResult(workspaceId: string): TerminalCloseWorkspaceResult {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) return { workspaceId, state: "deleted", remainingSessionIds: [] }
    return {
      workspaceId,
      state: "closing",
      remainingSessionIds: collectTerminalPaneLeaves(workspace.layout)
        .map((pane) => pane.sessionId)
        .filter((sessionId) => sessions.has(sessionId)),
    }
  }

  async function finalizeWorkspaceClosures(sessionId?: string): Promise<void> {
    const targets = sessionId
      ? [...workspaces.values()].filter((workspace) => collectTerminalPaneLeaves(workspace.layout)
          .some((pane) => pane.sessionId === sessionId))
      : [...workspaces.values()]
    const deletedSessionIds = targets.flatMap((workspace) => finalizeWorkspaceClosuresInMemory(workspace.id))
    if (deletedSessionIds.length === 0) {
      schedulePersist()
      return
    }
    await flushPersist()
    if (!lastPersistError) {
      for (const deletedSessionId of deletedSessionIds) events.emit("sessionDeleted", { sessionId: deletedSessionId })
    }
  }

  function finalizeWorkspaceClosuresInMemory(workspaceId: string): string[] {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) return []
    const panes = collectTerminalPaneLeaves(workspace.layout)
    if (workspace.closing) {
      if (panes.some((pane) => isActiveSession(sessions.get(pane.sessionId)))) return []
      for (const pane of panes) removeWorkspaceSession(pane.sessionId)
      workspaces.delete(workspace.id)
      updateGroupMembership(workspace.groupId)
      bumpDomain("workspace.deleted", workspace.id, workspace.layoutRevision)
      return panes.map((pane) => pane.sessionId)
    }

    let layout = workspace.layout
    const deletedSessionIds: string[] = []
    const pendingPaneIds: string[] = []
    for (const paneId of workspace.closingPaneIds) {
      const pane = findTerminalPane(layout, paneId)
      if (!pane) continue
      if (isActiveSession(sessions.get(pane.sessionId))) {
        pendingPaneIds.push(paneId)
        continue
      }
      const nextLayout = removeTerminalPane(layout, paneId)
      if (nextLayout === undefined) continue
      removeWorkspaceSession(pane.sessionId)
      deletedSessionIds.push(pane.sessionId)
      if (nextLayout === null) {
        workspaces.delete(workspace.id)
        updateGroupMembership(workspace.groupId)
        bumpDomain("workspace.deleted", workspace.id, workspace.layoutRevision)
        return deletedSessionIds
      }
      layout = nextLayout
    }
    if (deletedSessionIds.length > 0 || pendingPaneIds.length !== workspace.closingPaneIds.length) {
      const updated = {
        ...workspace,
        layout,
        closingPaneIds: pendingPaneIds,
        layoutRevision: workspace.layoutRevision + 1,
        updatedAt: now(),
      }
      workspaces.set(updated.id, updated)
      bumpDomain("workspace.layout_changed", updated.id, updated.layoutRevision)
    }
    return deletedSessionIds
  }

  function removeSessionResources(sessionId: string): void {
    deps.agentNotifications?.unregisterSession(sessionId)
    cleanupRuntime(sessionId)
    sessions.delete(sessionId)
    buffers.delete(sessionId)
    checkpoints.delete(sessionId)
    leases.delete(sessionId)
    leaseRevisions.delete(sessionId)
    activeStopOperations.delete(sessionId)
  }

  function removeWorkspaceSession(sessionId: string): void {
    const session = sessions.get(sessionId)
    removeSessionResources(sessionId)
    if (session) bumpDomain("session.deleted", session.id, session.metadataRevision)
  }

  function isActiveSession(session: TerminalSession | undefined): boolean {
    return session?.status === "running" || session?.status === "stopping"
  }

  async function createGroup(input: TerminalCreateGroupInput): Promise<TerminalGroup> {
    const timestamp = now()
    const group: TerminalGroup = {
      id: randomUUID(),
      name: input.name.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      sortOrder: groups.size,
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
    }
    groups.set(group.id, group)
    bumpDomain("group.created", group.id, group.groupRevision)
    await flushPersist()
    return group
  }

  async function renameGroup(input: TerminalRenameGroupInput): Promise<TerminalGroup> {
    const group = getGroupOrThrow(input.groupId)
    const name = input.name.trim()
    if (name === group.name) return group
    const updated = { ...group, name, updatedAt: now(), groupRevision: group.groupRevision + 1 }
    groups.set(group.id, updated)
    bumpDomain("group.renamed", group.id, updated.groupRevision)
    await flushPersist()
    return updated
  }

  async function updateGroupSettings(input: TerminalUpdateGroupSettingsInput): Promise<TerminalGroup> {
    const group = getGroupOrThrow(input.groupId)
    if (input.expectedLaunchRevision !== undefined && input.expectedLaunchRevision !== group.launchRevision) {
      throw terminalContractError("revision_conflict", "revision", { details: { currentRevision: group.launchRevision } })
    }
    const normalized = normalizeGroupSettings({
      ...input.settings,
      ...(group.settings?.commands?.length ? { commands: group.settings.commands } : {}),
      ...(group.settings?.startupCommand ? { startupCommand: group.settings.startupCommand } : {}),
    }, now())
    if (normalized?.commands?.length || normalized?.environment || normalized?.startupCommand) requireSensitivePersistence()
    const launchChanged = normalized?.defaultCwd !== group.settings?.defaultCwd
      || normalized?.shell !== group.settings?.shell
      || stableJson(normalized?.environment ?? {}) !== stableJson(group.settings?.environment ?? {})
    const updated: TerminalGroup = {
      ...group,
      name: input.name.trim(),
      ...(normalized ? { settings: normalized } : {}),
      updatedAt: now(),
      groupRevision: group.groupRevision + 1,
      launchRevision: group.launchRevision + (launchChanged ? 1 : 0),
    }
    if (!normalized) delete updated.settings
    groups.set(group.id, updated)
    bumpDomain("group.updated", group.id, updated.groupRevision)
    await flushPersist()
    return updated
  }

  async function createGroupCommand(input: TerminalCreateGroupCommandInput): Promise<TerminalGroupCommand> {
    requireSensitivePersistence()
    const group = getGroupOrThrow(input.groupId)
    if (input.expectedCommandCollectionRevision !== undefined && input.expectedCommandCollectionRevision !== group.commandCollectionRevision) {
      throw terminalContractError("revision_conflict", "revision", { details: { currentRevision: group.commandCollectionRevision } })
    }
    const timestamp = now()
    const command: TerminalGroupCommand = {
      id: randomUUID(),
      name: input.name.trim(),
      command: normalizeSavedCommand(input.command),
      createdAt: timestamp,
      updatedAt: timestamp,
      commandRevision: 1,
      ...(() => {
        const launch = normalizeLaunchLayer(input.launch)
        return launch ? { launch } : {}
      })(),
    }
    const commands = [...(group.settings?.commands ?? []), command]
    setGroupCommands(group, commands, "command.created")
    await flushPersist()
    return command
  }

  async function updateGroupCommand(input: TerminalUpdateGroupCommandInput): Promise<TerminalGroupCommand> {
    requireSensitivePersistence()
    const group = getGroupOrThrow(input.groupId)
    const existing = getCommand(group, input.commandId)
    if (input.expectedCommandRevision !== undefined && input.expectedCommandRevision !== existing.commandRevision) {
      throw terminalContractError("revision_conflict", "revision", { details: { currentRevision: existing.commandRevision } })
    }
    const launch = normalizeLaunchLayer(input.launch)
    const updated: TerminalGroupCommand = {
      ...existing,
      name: input.name.trim(),
      command: normalizeSavedCommand(input.command),
      updatedAt: now(),
      commandRevision: existing.commandRevision + 1,
      ...(launch ? { launch } : {}),
    }
    if (input.launch !== undefined && !launch) delete updated.launch
    setGroupCommands(group, (group.settings?.commands ?? []).map((item) => item.id === updated.id ? updated : item), "command.updated")
    await flushPersist()
    return updated
  }

  async function deleteGroupCommand(input: TerminalDeleteGroupCommandInput): Promise<void> {
    const group = getGroupOrThrow(input.groupId)
    getCommand(group, input.commandId)
    setGroupCommands(group, (group.settings?.commands ?? []).filter((item) => item.id !== input.commandId), "command.deleted")
    await flushPersist()
  }

  function setGroupCommands(group: TerminalGroup, commands: TerminalGroupCommand[], eventType: string): void {
    const settings = normalizeGroupSettings({
      ...(group.settings?.defaultCwd ? { defaultCwd: group.settings.defaultCwd } : {}),
      ...(group.settings?.shell ? { shell: group.settings.shell } : {}),
      ...(group.settings?.environment ? { environment: group.settings.environment } : {}),
      ...(commands.length ? { commands } : {}),
      ...(group.settings?.startupCommand ? { startupCommand: group.settings.startupCommand } : {}),
    }, now())
    const updated: TerminalGroup = {
      ...group,
      updatedAt: now(),
      groupRevision: group.groupRevision + 1,
      commandCollectionRevision: group.commandCollectionRevision + 1,
      ...(settings ? { settings } : {}),
    }
    if (!settings) delete updated.settings
    groups.set(group.id, updated)
    bumpDomain(eventType, group.id, updated.commandCollectionRevision)
  }

  async function launchGroupCommand(
    input: TerminalLaunchGroupCommandInput,
    origin: { readonly source: "ui" | "mcp"; readonly clientId?: string } = { source: "ui" },
  ): Promise<TerminalSession> {
    const group = getGroupOrThrow(input.groupId)
    const command = getCommand(group, input.commandId)
    const session = await createSessionRecord({
      groupId: group.id,
      title: command.name,
      cols: input.cols,
      rows: input.rows,
    }, origin.source, undefined, origin.clientId, command.launch)
    const operation = createOperation("command_delivery", session.id, "terminal-command-launch")
    if (session.status !== "running") {
      operation.status = "failed"
      operation.errorCode = "session_start_failed"
      operation.updatedAt = now()
    } else {
      const delivery = deliverSavedCommand(session.id, command.command)
      operation.status = delivery.status
      operation.acceptedActionCount = delivery.acceptedActionCount
      operation.acceptedBytes = delivery.acceptedBytes
      operation.failedActionIndex = delivery.failedActionIndex
      operation.errorCode = delivery.status === "delivered" ? undefined : delivery.status === "failed" ? "command_delivery_failed" : "delivery_uncertain"
      operation.updatedAt = now()
    }
    operations.set(operation.operationId, operation)
    const updated = {
      ...getSessionOrThrow(session.id),
      commandId: command.id,
      commandRevisionApplied: command.commandRevision,
      commandDeliveryOperationId: operation.operationId,
    }
    sessions.set(session.id, updated)
    await flushPersist()
    if (!lastPersistError) events.emit("sessionChanged", updated)
    return updated
  }

  function deliverSavedCommand(sessionId: string, body: string): {
    status: "delivered" | "delivery_uncertain" | "failed"
    acceptedActionCount: number
    acceptedBytes: number
    failedActionIndex?: number
  } {
    const runtime = getRuntimeForInput(sessionId)
    const normalized = normalizeSavedCommand(body)
    const lines = normalized.split("\n")
    let acceptedActionCount = 0
    let acceptedBytes = 0
    let actionIndex = 0
    for (const line of lines) {
      for (const value of [line, KEY_BYTES.Enter]) {
        try {
          runtime.pty.write(value)
          acceptedActionCount += 1
          acceptedBytes += Buffer.byteLength(value, "utf8")
          actionIndex += 1
        } catch {
          if (acceptedBytes > 0) advanceInputRevision(sessionId, "saved_command_input_uncertain")
          return {
            status: acceptedBytes > 0 ? "delivery_uncertain" : "failed",
            acceptedActionCount,
            acceptedBytes,
            failedActionIndex: actionIndex,
          }
        }
      }
    }
    if (acceptedActionCount > 0) advanceInputRevision(sessionId, "saved_command_input")
    return { status: "delivered", acceptedActionCount, acceptedBytes }
  }

  async function deleteGroup(input: TerminalDeleteGroupInput): Promise<void> {
    const group = getGroupOrThrow(input.groupId)
    if ([...sessions.values()].some((session) => session.groupId === group.id)) {
      throw terminalContractError("lifecycle_conflict", "conflict", { details: { code: "group_not_empty" } })
    }
    groups.delete(group.id)
    bumpDomain("group.deleted", group.id, group.groupRevision)
    await flushPersist()
  }

  function previewGroupDelete(groupId: string) {
    const group = getGroupOrThrow(groupId)
    const sessionFacts = [...sessions.values()]
      .filter((session) => session.groupId === groupId)
      .map((session) => ({ sessionId: session.id, lifecycle: session.status, lastOutputSeq: session.lastOutputSeq }))
    const plan = {
      deletePlanId: randomUUID(),
      groupId,
      groupRevision: group.groupRevision,
      membershipRevision: group.membershipRevision,
      commandCollectionRevision: group.commandCollectionRevision,
      sessionFacts,
      commandIds: (group.settings?.commands ?? []).map((command) => command.id),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
    deletePlans.set(plan.deletePlanId, plan)
    return {
      deletePlanId: plan.deletePlanId,
      groupId,
      groupRevision: plan.groupRevision,
      expiresAt: plan.expiresAt,
      sessionCount: sessionFacts.length,
      lifecycleCounts: Object.fromEntries(sessionFacts.map((item) => item.lifecycle).map((lifecycle) => [
        lifecycle,
        sessionFacts.filter((item) => item.lifecycle === lifecycle).length,
      ])),
      commandCount: plan.commandIds.length,
      retainedOutputChunks: sessionFacts.reduce((sum, item) => sum + (buffers.get(item.sessionId)?.snapshot().length ?? 0), 0),
      retainedOutputBytes: sessionFacts.reduce((sum, item) => sum + (buffers.get(item.sessionId)?.totalBytes ?? 0), 0),
    }
  }

  async function commitGroupDelete(deletePlanId: string): Promise<{ deleteOperationId: string; sessionCount: number; commandCount: number }> {
    const plan = deletePlans.get(deletePlanId)
    if (!plan || Date.parse(plan.expiresAt) <= Date.now()) throw terminalContractError("revision_conflict", "conflict")
    const group = getGroupOrThrow(plan.groupId)
    const currentSessions = [...sessions.values()].filter((session) => session.groupId === group.id)
    if (
      group.groupRevision !== plan.groupRevision
      || group.membershipRevision !== plan.membershipRevision
      || group.commandCollectionRevision !== plan.commandCollectionRevision
      || currentSessions.length !== plan.sessionFacts.length
      || currentSessions.some((session) => {
        const fact = plan.sessionFacts.find((item) => item.sessionId === session.id)
        return !fact
          || fact.lifecycle !== session.status
          || fact.lastOutputSeq !== session.lastOutputSeq
          || session.status === "running"
          || session.status === "stopping"
      })
    ) {
      throw terminalContractError("revision_conflict", "conflict")
    }
    const operationId = randomUUID()
    for (const session of currentSessions) {
      sessions.delete(session.id)
      buffers.delete(session.id)
      leases.delete(session.id)
    }
    for (const workspace of [...workspaces.values()]) {
      if (workspace.groupId === group.id) workspaces.delete(workspace.id)
    }
    groups.delete(group.id)
    deletePlans.delete(deletePlanId)
    bumpDomain("group.deleted", group.id, group.groupRevision, operationId)
    await flushPersist()
    if (!lastPersistError) {
      for (const session of currentSessions) events.emit("sessionDeleted", { sessionId: session.id })
    }
    return { deleteOperationId: operationId, sessionCount: currentSessions.length, commandCount: plan.commandIds.length }
  }

  async function createSession(input: TerminalCreateSessionInput): Promise<TerminalSession> {
    return createSessionRecord(input, "ui")
  }

  async function createMcpSession(input: TerminalMcpCreateSessionInput, clientId?: string): Promise<TerminalSession> {
    if (input.groupId) {
      const group = getGroupOrThrow(input.groupId)
      if (input.expectedLaunchRevision !== group.launchRevision) {
        throw terminalContractError("revision_conflict", "revision", {
          details: { currentLaunchRevision: group.launchRevision },
        })
      }
    } else if (input.expectedLaunchRevision !== undefined) {
      throw terminalContractError("invalid_argument", "validation")
    }
    return createSessionRecord({ groupId: input.groupId, title: input.title }, "mcp", undefined, clientId)
  }

  async function createSessionOverride(input: TerminalCreateSessionOverrideInput, clientId?: string): Promise<TerminalSession> {
    if (input.overrides.environment && Object.keys(input.overrides.environment).length > 0) requireSensitivePersistence()
    if (input.groupId) {
      const group = getGroupOrThrow(input.groupId)
      if (input.expectedLaunchRevision !== group.launchRevision) {
        throw terminalContractError("revision_conflict", "revision", {
          details: { currentLaunchRevision: group.launchRevision },
        })
      }
    }
    return createSessionRecord({
      groupId: input.groupId,
      title: input.title,
      cwd: input.overrides.cwd,
      cols: input.overrides.cols,
      rows: input.overrides.rows,
    }, "mcp", {
      shell: input.overrides.shell,
      environment: input.overrides.environment,
      overriddenFields: (Object.keys(input.overrides) as ("cwd" | "shell" | "environment" | "cols" | "rows")[]),
    }, clientId)
  }

  function getSession(input: { sessionId: string }): TerminalSession {
    return getSessionOrThrow(input.sessionId)
  }

  function readSession(input: TerminalReadSessionInput): TerminalReadSessionResult {
    const session = getSessionOrThrow(input.sessionId)
    const result = buffers.get(input.sessionId)?.read({
      afterSeq: input.afterSeq,
      limitBytes: input.limitBytes ?? 256 * 1024,
    }) ?? {
      chunks: [], nextSeq: input.afterSeq ?? 0, firstSeq: session.lastOutputSeq + 1,
      truncated: session.lastOutputSeq > 0, gap: session.lastOutputSeq > 0, hasMore: false,
      discardedBytes: 0, discardedChunks: 0,
    }
    return { session, ...result }
  }

  async function attachSession(input: TerminalAttachSessionInput): Promise<TerminalAttachSessionResult> {
    const runtime = runtimes.get(input.sessionId)
    if (runtime) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const snapshot = await runtime.emulator.captureSnapshot(TERMINAL_RENDERER_SNAPSHOT_MAX_BYTES)
        const session = getSessionOrThrow(input.sessionId)
        if (snapshot.sizeRevision !== session.sizeRevision) continue
        if (snapshot.serialized !== null) {
          return {
            session,
            degraded: false,
            serialized: snapshot.serialized,
            cols: session.cols,
            rows: session.rows,
            throughOutputSeq: snapshot.throughOutputSeq,
            sizeRevision: snapshot.sizeRevision,
            emulatorId: "xterm-headless",
            emulatorVersion: "6.0.0",
            scrollbackTruncated: snapshot.scrollbackTruncated,
            reasons: [],
          }
        }
        return {
          session,
          degraded: true,
          serialized: null,
          cols: session.cols,
          rows: session.rows,
          throughOutputSeq: snapshot.throughOutputSeq,
          sizeRevision: snapshot.sizeRevision,
          emulatorId: "xterm-headless",
          emulatorVersion: "6.0.0",
          scrollbackTruncated: true,
          reasons: ["snapshot_too_large"],
        }
      }
      const session = getSessionOrThrow(input.sessionId)
      return {
        session,
        degraded: true,
        serialized: null,
        cols: session.cols,
        rows: session.rows,
        throughOutputSeq: runtime.emulator.throughOutputSeq,
        sizeRevision: session.sizeRevision,
        emulatorId: "xterm-headless",
        emulatorVersion: "6.0.0",
        scrollbackTruncated: false,
        reasons: ["snapshot_unstable"],
      }
    }

    const session = getSessionOrThrow(input.sessionId)
    const recovered = await restoreCheckpointEmulator(session)
    if (!recovered) {
      return {
        session,
        degraded: true,
        serialized: null,
        cols: session.cols,
        rows: session.rows,
        throughOutputSeq: session.lastOutputSeq,
        sizeRevision: session.sizeRevision,
        emulatorId: "xterm-headless",
        emulatorVersion: "6.0.0",
        scrollbackTruncated: false,
        reasons: ["checkpoint_unavailable"],
      }
    }
    try {
      const snapshot = await recovered.captureSnapshot(TERMINAL_RENDERER_SNAPSHOT_MAX_BYTES)
      if (snapshot.serialized !== null) {
        return {
          session,
          degraded: false,
          serialized: snapshot.serialized,
          cols: session.cols,
          rows: session.rows,
          throughOutputSeq: snapshot.throughOutputSeq,
          sizeRevision: snapshot.sizeRevision,
          emulatorId: "xterm-headless",
          emulatorVersion: "6.0.0",
          scrollbackTruncated: snapshot.scrollbackTruncated,
          reasons: [],
        }
      }
      return {
        session,
        degraded: true,
        serialized: null,
        cols: session.cols,
        rows: session.rows,
        throughOutputSeq: snapshot.throughOutputSeq,
        sizeRevision: snapshot.sizeRevision,
        emulatorId: "xterm-headless",
        emulatorVersion: "6.0.0",
        scrollbackTruncated: true,
        reasons: ["snapshot_too_large"],
      }
    } finally {
      recovered.dispose()
    }
  }

  async function renameSession(input: TerminalRenameSessionInput): Promise<TerminalSession> {
    const current = getSessionOrThrow(input.sessionId)
    const title = input.title.trim()
    if (title === current.title) return current
    const updated = {
      ...current,
      title,
      metadataRevision: current.metadataRevision + 1,
      stateRevision: current.stateRevision + 1,
      updatedAt: now(),
    }
    sessions.set(current.id, updated)
    deps.agentNotifications?.renameSession(updated.id, updated.title)
    bumpDomain("session.renamed", updated.id, updated.metadataRevision)
    await flushPersist()
    if (!lastPersistError) events.emit("sessionChanged", updated)
    return updated
  }

  function writeSession(input: TerminalWriteSessionInput): void {
    expireLease(input.sessionId, "user_takeover")
    const runtime = getRuntimeForInput(input.sessionId)
    runtime.pty.write(input.data)
    advanceInputRevision(input.sessionId, "user_input")
  }

  async function resizeSession(input: TerminalResizeSessionInput): Promise<void> {
    await applySessionResize(input.sessionId, input.cols, input.rows)
  }

  async function deleteSession(input: TerminalDeleteSessionInput): Promise<void> {
    await deleteTerminalSession(input.sessionId, "synapse-ui")
  }

  async function deleteTerminalSession(sessionId: string, requestedBy: string) {
    const session = getSessionOrThrow(sessionId)
    if (session.status === "running" || session.status === "stopping") {
      throw terminalContractError("lifecycle_conflict", "lifecycle", { details: { lifecycle: session.status } })
    }
    const operation = createOperation("delete", session.id, requestedBy)
    operation.status = "completed"
    operation.finalLifecycle = session.status
    operation.finalCause = "session_deleted"
    operation.updatedAt = now()
    const workspace = getWorkspaceBySessionId(session.id)
    if (workspace) {
      const pane = collectTerminalPaneLeaves(workspace.layout).find((item) => item.sessionId === session.id)
      const layout = pane ? removeTerminalPane(workspace.layout, pane.paneId) : undefined
      if (layout === null) {
        workspaces.delete(workspace.id)
        updateGroupMembership(workspace.groupId)
        bumpDomain("workspace.deleted", workspace.id, workspace.layoutRevision, operation.operationId)
      } else if (layout) {
        const updated = {
          ...workspace,
          layout,
          closingPaneIds: workspace.closingPaneIds.filter((paneId) => paneId !== pane?.paneId),
          layoutRevision: workspace.layoutRevision + 1,
          updatedAt: now(),
        }
        workspaces.set(updated.id, updated)
        bumpDomain("workspace.layout_changed", updated.id, updated.layoutRevision, operation.operationId)
      }
    }
    removeSessionResources(session.id)
    bumpDomain("session.deleted", session.id, session.metadataRevision, operation.operationId)
    await flushPersist()
    if (!lastPersistError) events.emit("sessionDeleted", { sessionId: session.id })
    return {
      deleteOperationId: operation.operationId,
      sessionId: session.id,
      lifecycle: session.status,
      retainedOutputChunks: Math.max(0, session.lastOutputSeq - session.discardedOutputChunks),
    }
  }

  async function stopSession(input: TerminalStopSessionInput): Promise<void> {
    if (input.force) {
      await forceStopControlledSession({ sessionId: input.sessionId, idempotencyKey: randomUUID() }, userController())
      return
    }
    await stopControlledSession({ sessionId: input.sessionId, idempotencyKey: randomUUID() }, userController())
  }

  function runStartupCommand(input: TerminalRunStartupCommandInput): void {
    const session = getSessionOrThrow(input.sessionId)
    const group = getGroupOrThrow(session.groupId)
    const startup = group.settings?.startupCommand
    if (!startup) return
    deliverSavedCommand(session.id, startup)
  }

  function acquireControl(input: TerminalAcquireControlInput, controller: TerminalControllerContext) {
    getRuntimeForInput(input.sessionId)
    clearExpiredLease(input.sessionId)
    const existing = leases.get(input.sessionId)
    if (existing) {
      if (sameOwner(existing, controller)) return leaseResult(existing, getSessionOrThrow(input.sessionId))
      throw terminalContractError("control_busy", "lease", {
        retryable: true,
        details: { occupied: true, expiresAt: existing.expiresAt },
      })
    }
    const activeLeases = [...leases.values()].filter((lease) => Date.parse(lease.expiresAt) > Date.now())
    if (activeLeases.filter((lease) => lease.clientId === controller.clientId).length >= TERMINAL_CLIENT_LEASE_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { retryable: true, details: { dimension: "client_leases" } })
    }
    if (activeLeases.filter((lease) => lease.controllerInstanceId === controller.controllerInstanceId).length >= TERMINAL_CONTROLLER_LEASE_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { retryable: true, details: { dimension: "controller_leases" } })
    }
    const acquiredAt = now()
    const leaseRevision = (leaseRevisions.get(input.sessionId) ?? 0) + 1
    const lease: TerminalLeaseState = {
      leaseId: randomUUID(),
      clientId: controller.clientId,
      controllerInstanceId: controller.controllerInstanceId,
      acquiredAt,
      expiresAt: new Date(Date.now() + clamp(input.requestedLeaseMs, LEASE_MIN_MS, LEASE_MAX_MS)).toISOString(),
      leaseRevision,
    }
    leases.set(input.sessionId, lease)
    leaseRevisions.set(input.sessionId, leaseRevision)
    const session = updateSessionState(input.sessionId, (value) => value, "lease.acquired")
    return leaseResult(lease, session)
  }

  function renewControl(input: TerminalAcquireControlInput & { leaseId: string }, controller: TerminalControllerContext) {
    const lease = requireLease(input.sessionId, input.leaseId, controller)
    const renewed: TerminalLeaseState = {
      ...lease,
      expiresAt: new Date(Date.now() + clamp(input.requestedLeaseMs, LEASE_MIN_MS, LEASE_MAX_MS)).toISOString(),
      leaseRevision: lease.leaseRevision + 1,
    }
    leases.set(input.sessionId, renewed)
    leaseRevisions.set(input.sessionId, renewed.leaseRevision)
    const session = updateSessionState(input.sessionId, (value) => value, "lease.renewed")
    return leaseResult(renewed, session)
  }

  function releaseControl(input: { sessionId: string; leaseId: string }, controller: TerminalControllerContext) {
    clearExpiredLease(input.sessionId)
    const lease = leases.get(input.sessionId)
    if (!lease) return { released: false, noOp: true, stateRevision: getSessionOrThrow(input.sessionId).stateRevision }
    if (lease.leaseId !== input.leaseId || !sameOwner(lease, controller)) {
      throw terminalContractError("lease_invalid", "lease")
    }
    leases.delete(input.sessionId)
    leaseRevisions.set(input.sessionId, lease.leaseRevision + 1)
    const session = updateSessionState(input.sessionId, (value) => value, "lease.released")
    return { released: true, noOp: false, stateRevision: session.stateRevision }
  }

  function sendSemanticInput(input: TerminalSemanticInput, controller: TerminalControllerContext) {
    if (input.actions.length > MAX_SEMANTIC_ACTIONS) throw terminalContractError("invalid_argument", "validation")
    const encoded = input.actions.map(encodeSemanticAction)
    const totalBytes = encoded.reduce((sum, value) => sum + Buffer.byteLength(value), 0)
    if (totalBytes > MAX_SEMANTIC_BYTES) throw terminalContractError("invalid_argument", "validation")
    return idempotent(controller.clientId, "session_input.send", input.idempotencyKey, input, () => {
      validateInputRequest(input.sessionId, input.leaseId, input.expectedInputRevision, controller)
      return deliverWrites(input.sessionId, encoded, "input")
    })
  }

  async function sendCommand(input: TerminalCommandInput, controller: TerminalControllerContext) {
    validateText(input.text, false)
    return idempotentAsync(controller.clientId, "session_input.command", input.idempotencyKey, input, async () => {
      validateInputRequest(input.sessionId, input.leaseId, input.expectedInputRevision, controller)
      return deliverCommandWrites(input.sessionId, input.text)
    })
  }

  async function deliverCommandWrites(sessionId: string, text: string) {
    const runtime = getRuntimeForInput(sessionId)
    const before = getSessionOrThrow(sessionId).inputRevision
    const operation = createOperation("input", sessionId, "terminal-controller")
    let acceptedActionCount = 0
    let acceptedBytes = 0
    let failedActionIndex: number | undefined
    try {
      runtime.pty.write(text)
      acceptedActionCount = 1
      acceptedBytes = Buffer.byteLength(text)
      await new Promise<void>((resolve) => setTimeout(resolve, COMMAND_ENTER_FLUSH_DELAY_MS))
      runtime.pty.write(KEY_BYTES.Enter)
      acceptedActionCount = 2
      acceptedBytes += Buffer.byteLength(KEY_BYTES.Enter)
      operation.status = "delivered"
    } catch {
      failedActionIndex = acceptedActionCount
      operation.status = acceptedBytes > 0 ? "delivery_uncertain" : "failed"
      operation.errorCode = operation.status === "delivery_uncertain" ? "delivery_uncertain" : "internal_error"
    }
    if (acceptedBytes > 0) advanceInputRevision(sessionId, "automation_input")
    operation.updatedAt = now()
    operations.set(operation.operationId, operation)
    const after = getSessionOrThrow(sessionId).inputRevision
    return {
      operationId: operation.operationId,
      inputRevisionBefore: before,
      inputRevisionAfter: after,
      acceptedAt: operation.updatedAt,
      acceptedActionCount,
      acceptedBytes,
      ...(failedActionIndex === undefined ? {} : { failedActionIndex }),
      outcome: operation.status === "delivered"
        ? "accepted"
        : operation.status === "delivery_uncertain"
          ? "delivery_uncertain"
          : "partial",
    }
  }

  async function paste(input: TerminalPasteInput, controller: TerminalControllerContext) {
    if (hasForbiddenTextControl(input.text, true)) throw terminalContractError("invalid_argument", "validation")
    return idempotentAsync(controller.clientId, "session_input.paste", input.idempotencyKey, input, async () => {
      validateInputRequest(input.sessionId, input.leaseId, input.expectedInputRevision, controller)
      const runtime = getRuntimeForInput(input.sessionId)
      await runtime.emulator.ready()
      const evidence = runtime.emulator.bracketedPasteEvidence()
      if (!evidence.enabled || !evidence.fresh || evidence.throughOutputSeq < input.expectedThroughOutputSeq) {
        throw terminalContractError("paste_mode_unavailable", "capability", {
          details: { throughOutputSeq: evidence.throughOutputSeq, sizeRevision: evidence.sizeRevision },
        })
      }
      const framed = `\x1b[200~${input.text}\x1b[201~`
      return deliverWrites(input.sessionId, [framed], "input", { uncertainOnFailure: true })
    })
  }

  function sendRaw(input: TerminalRawInput, controller: TerminalControllerContext) {
    const decoded = Buffer.from(input.dataBase64, "base64")
    if (!decoded.length || decoded.toString("base64") !== input.dataBase64) {
      throw terminalContractError("invalid_argument", "validation")
    }
    if (decoded.byteLength > MAX_SEMANTIC_BYTES) throw terminalContractError("invalid_argument", "validation")
    return idempotent(controller.clientId, "session_input.raw", input.idempotencyKey, input, () => {
      validateInputRequest(input.sessionId, input.leaseId, input.expectedInputRevision, controller)
      return deliverWrites(input.sessionId, [decoded], "input")
    })
  }

  function deliverWrites(
    sessionId: string,
    writes: readonly (string | Buffer)[],
    operationKind: "input",
    options: {
      readonly uncertainOnFailure?: boolean
    } = {},
  ) {
    const runtime = getRuntimeForInput(sessionId)
    const before = getSessionOrThrow(sessionId).inputRevision
    const operation = createOperation(operationKind, sessionId, "terminal-controller")
    let acceptedActionCount = 0
    let acceptedBytes = 0
    let failedActionIndex: number | undefined
    try {
      for (let index = 0; index < writes.length; index += 1) {
        const value = writes[index]!
        runtime.pty.write(value)
        acceptedActionCount += 1
        acceptedBytes += typeof value === "string" ? Buffer.byteLength(value) : value.byteLength
      }
      operation.status = "delivered"
    } catch {
      failedActionIndex = acceptedActionCount
      operation.status = options.uncertainOnFailure ? "delivery_uncertain" : acceptedBytes > 0 ? "delivery_uncertain" : "failed"
      operation.errorCode = operation.status === "delivery_uncertain" ? "delivery_uncertain" : "internal_error"
    }
    if (acceptedBytes > 0 || operation.status === "delivery_uncertain") advanceInputRevision(sessionId, "automation_input")
    operation.updatedAt = now()
    operations.set(operation.operationId, operation)
    const after = getSessionOrThrow(sessionId).inputRevision
    return {
      operationId: operation.operationId,
      inputRevisionBefore: before,
      inputRevisionAfter: after,
      acceptedAt: operation.updatedAt,
      acceptedActionCount,
      acceptedBytes,
      ...(failedActionIndex === undefined ? {} : { failedActionIndex }),
      outcome: operation.status === "delivered"
        ? "accepted"
        : operation.status === "delivery_uncertain"
          ? "delivery_uncertain"
          : "partial",
    }
  }

  async function resizeControlledSession(input: TerminalResizeInput, controller: TerminalControllerContext) {
    requireLease(input.sessionId, input.leaseId, controller)
    const current = getSessionOrThrow(input.sessionId)
    if (current.sizeRevision !== input.expectedSizeRevision) {
      throw terminalContractError("revision_conflict", "revision", { details: { currentSizeRevision: current.sizeRevision } })
    }
    return idempotentAsync(controller.clientId, "session.resize", input.idempotencyKey, input, async () => {
      if (current.cols === input.cols && current.rows === input.rows) {
        return { noOp: true, sizeRevision: current.sizeRevision, stateRevision: current.stateRevision }
      }
      const updated = await applySessionResize(input.sessionId, input.cols, input.rows)
      return { noOp: false, sizeRevision: updated.sizeRevision, stateRevision: updated.stateRevision }
    })
  }

  async function applySessionResize(sessionId: string, cols: number, rows: number): Promise<TerminalSession> {
    const runtime = getRuntimeForInput(sessionId)
    const current = getSessionOrThrow(sessionId)
    if (current.cols === cols && current.rows === rows) return current

    runtime.pty.resize(cols, rows)
    const updated: TerminalSession = {
      ...current,
      cols,
      rows,
      sizeRevision: current.sizeRevision + 1,
      stateRevision: current.stateRevision + 1,
      attention: unknownAttention({ ...current, sizeRevision: current.sizeRevision + 1 }, "resize"),
      updatedAt: now(),
    }
    sessions.set(current.id, updated)
    events.emit("sessionChanged", updated)
    events.emit("stateChanged", {
      sessionId,
      stateRevision: updated.stateRevision,
      throughOutputSeq: updated.lastOutputSeq,
      changeTypes: ["size", "attention"],
    })

    const barrier = await runtime.emulator.resize(cols, rows, updated.sizeRevision)
    events.emit("resized", {
      sessionId,
      cols,
      rows,
      sizeRevision: barrier.sizeRevision,
      throughOutputSeq: barrier.throughOutputSeq,
    })
    scheduleRuntimePersist(sessionId)
    return updated
  }

  async function stopControlledSession(input: TerminalStopInput, controller: TerminalControllerContext) {
    return terminate(input, controller, false)
  }

  async function forceStopControlledSession(input: TerminalStopInput, controller: TerminalControllerContext) {
    return terminate(input, controller, true)
  }

  async function terminate(input: TerminalStopInput, controller: TerminalControllerContext, force: boolean) {
    const session = getSessionOrThrow(input.sessionId)
    if (session.status === "ended" || session.status === "failed" || session.status === "lost") {
      return { outcome: "terminal_noop", lifecycle: session.status, sessionId: session.id }
    }
    if (force && process.platform === "win32") {
      throw terminalContractError("force_stop_unsupported", "capability")
    }
    const active = activeStopOperations.get(session.id) ?? {}
    const existingId = force ? active.force : active.stop
    if (existingId) return operations.get(existingId)
    if (!force && session.status !== "running") {
      if (active.stop) return operations.get(active.stop)
      throw terminalContractError("lifecycle_conflict", "lifecycle", { details: { lifecycle: session.status } })
    }
    const operation = createOperation(force ? "force_stop" : "stop", session.id, controller.clientId)
    if (force && active.stop) operation.relatedOperationId = active.stop
    operations.set(operation.operationId, operation)
    activeStopOperations.set(session.id, force
      ? { ...active, force: operation.operationId }
      : { ...active, stop: operation.operationId })
    try {
      const runtime = runtimes.get(session.id)
      if (!runtime) throw new Error("missing runtime")
      runtime.pty.kill(force ? "SIGKILL" : process.platform === "win32" ? undefined : "SIGHUP")
      operation.status = "delivered"
      operation.updatedAt = now()
      if (session.status === "running") {
        updateSessionState(session.id, (value) => ({ ...value, status: "stopping" }), "lifecycle.stopping")
      } else {
        updateSessionState(session.id, (value) => value, "operation.force_delivered")
      }
      expireLease(session.id, "stopping")
      return operation
    } catch {
      operation.status = "failed"
      operation.errorCode = force ? "force_stop_unsupported" : "normal_stop_unsupported"
      operation.updatedAt = now()
      updateSessionState(session.id, (value) => value, "operation.delivery_failed")
      return operation
    }
  }

  function createOperation(kind: TerminalOperationState["kind"], sessionId: string, requestedBy: string): TerminalOperationState {
    const timestamp = now()
    const operation: TerminalOperationState = {
      operationId: randomUUID(), kind, sessionId, status: "pending_delivery",
      requestedAt: timestamp, requestedBy, updatedAt: timestamp,
    }
    operations.set(operation.operationId, operation)
    bumpDomain("operation.created", operation.operationId, 1, operation.operationId)
    return operation
  }

  function completeOperation(operationId: string, lifecycle: TerminalSession["status"], cause: string): void {
    const operation = operations.get(operationId)
    if (!operation) return
    operation.status = "completed"
    operation.finalLifecycle = lifecycle
    operation.finalCause = cause
    operation.updatedAt = now()
  }

  function getOperation(operationId: string): TerminalOperationState {
    const operation = operations.get(operationId)
    if (!operation) throw terminalContractError("not_found", "not_found")
    return { ...operation }
  }

  function observe(input: TerminalObserveInput, includeOutput: boolean, clientId = "synapse-ui") {
    const session = getSessionOrThrow(input.sessionId)
    validateWatermarks(session, input)
    const immediate = buildObservation(input, includeOutput)
    if (immediate.changed || input.maxWaitMs === 0) return Promise.resolve(immediate)
    acquireObserveSlot(input.sessionId, clientId)
    return new Promise<ReturnType<typeof buildObservation>>((resolve) => {
      let settled = false
      const clientWaiters = observeWaitersByClient.get(clientId) ?? new Set()
      const finish = (cancelled = false) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        events.off("stateChanged", onChange)
        clientWaiters.delete(waiter)
        if (clientWaiters.size === 0) observeWaitersByClient.delete(clientId)
        releaseObserveSlot(input.sessionId, clientId)
        resolve({ ...buildObservation(input, includeOutput), ...(cancelled ? { cancelled: true } : {}) })
      }
      const waiter = { sessionId: input.sessionId, cancel: () => finish(true) }
      clientWaiters.add(waiter)
      observeWaitersByClient.set(clientId, clientWaiters)
      const onChange = (event: { sessionId: string }) => {
        if (event.sessionId === input.sessionId) finish()
      }
      const timer = setTimeout(finish, input.maxWaitMs)
      events.on("stateChanged", onChange)
    })
  }

  function revokeClientAccess(clientId: string, resource?: string): void {
    const targetSessionId = resource?.startsWith("terminal:session:")
      ? resource.slice("terminal:session:".length)
      : undefined
    for (const waiter of [...(observeWaitersByClient.get(clientId) ?? [])]) {
      if (!targetSessionId || waiter.sessionId === targetSessionId) waiter.cancel()
    }
    for (const [sessionId, lease] of leases) {
      if (lease.clientId === clientId && (!targetSessionId || targetSessionId === sessionId)) {
        expireLease(sessionId, "authorization_revoked")
      }
    }
  }

  function assertCreateQuota(): void {
    const running = [...sessions.values()].filter((session) => session.status === "running" || session.status === "stopping")
    if (running.length >= TERMINAL_GLOBAL_RUNNING_SESSION_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { retryable: true, details: { dimension: "global_running_sessions" } })
    }
  }

  function acquireObserveSlot(sessionId: string, clientId: string): void {
    if ((observeBySession.get(sessionId) ?? 0) >= TERMINAL_SESSION_OBSERVE_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { retryable: true, details: { dimension: "session_observe" } })
    }
    if ((observeByClient.get(clientId) ?? 0) >= TERMINAL_CLIENT_OBSERVE_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { retryable: true, details: { dimension: "client_observe" } })
    }
    if (observeGlobal >= TERMINAL_GLOBAL_OBSERVE_LIMIT) {
      throw terminalContractError("quota_exceeded", "quota", { retryable: true, details: { dimension: "global_observe" } })
    }
    observeBySession.set(sessionId, (observeBySession.get(sessionId) ?? 0) + 1)
    observeByClient.set(clientId, (observeByClient.get(clientId) ?? 0) + 1)
    observeGlobal += 1
  }

  function releaseObserveSlot(sessionId: string, clientId: string): void {
    decrementCounter(observeBySession, sessionId)
    decrementCounter(observeByClient, clientId)
    observeGlobal = Math.max(0, observeGlobal - 1)
  }

  function validateWatermarks(session: TerminalSession, input: TerminalObserveInput): void {
    if (input.afterStateRevision > session.stateRevision || input.afterOutputSeq > session.lastOutputSeq) {
      throw terminalContractError("watermark_ahead", "cursor", {
        details: { stateRevision: session.stateRevision, throughOutputSeq: session.lastOutputSeq },
      })
    }
  }

  function buildObservation(input: TerminalObserveInput, includeOutput: boolean) {
    const state = getSessionState(input.sessionId, undefined)
    const output = readSession({
      sessionId: input.sessionId,
      afterSeq: input.afterOutputSeq,
      limitBytes: input.limitBytes ?? 256 * 1024,
    })
    const changeTypes: string[] = []
    if (state.stateRevision > input.afterStateRevision) changeTypes.push("state")
    if (state.throughOutputSeq > input.afterOutputSeq) changeTypes.push("output")
    return {
      changed: changeTypes.length > 0,
      generatedAt: now(),
      state,
      changeTypes,
      nextStateRevision: state.stateRevision,
      nextOutputSeq: output.nextSeq,
      outputRange: {
        firstSeq: output.firstSeq,
        throughSeq: output.nextSeq,
        gap: output.gap,
        truncated: output.truncated,
        hasMore: output.hasMore,
      },
      ...(includeOutput ? { chunks: output.chunks } : {}),
    }
  }

  function getSessionState(sessionId: string, controller?: TerminalControllerContext) {
    clearExpiredLease(sessionId)
    const session = getSessionOrThrow(sessionId)
    const lease = leases.get(sessionId)
    return {
      sessionId,
      lifecycle: session.status,
      attention: session.attention,
      lease: !lease
        ? { occupied: false, leaseRevision: leaseRevisions.get(sessionId) ?? 0 }
        : sameOwner(lease, controller)
          ? {
              occupied: true, own: true, leaseId: lease.leaseId,
              acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt,
              leaseRevision: lease.leaseRevision,
            }
          : { occupied: true, own: false, expiresAt: lease.expiresAt, leaseRevision: lease.leaseRevision },
      stateRevision: session.stateRevision,
      throughOutputSeq: session.lastOutputSeq,
      inputRevision: session.inputRevision,
      sizeRevision: session.sizeRevision,
      ...(session.status === "ended" || session.status === "failed" || session.status === "lost" ? {
        endFacts: {
          cause: session.endCause ?? (session.status === "ended" ? "process_exit" : session.status === "failed" ? "infrastructure_failure" : "runtime_lost"),
          exitCode: session.exitCode ?? null,
          signal: session.signal ?? null,
          endedAt: session.endedAt ?? null,
          endTimeUnknown: session.endTimeUnknown,
          ...(session.stopOperationId ? { stopOperationId: session.stopOperationId } : {}),
          ...(session.stopRequestedBy ? { requestedBy: session.stopRequestedBy === controller?.clientId ? "self" : "other_actor" } : {}),
          ...(session.stopRequestedAt ? { requestedAt: session.stopRequestedAt } : {}),
        },
      } : {}),
    }
  }

  async function restoreCheckpointEmulator(session: TerminalSession): Promise<TerminalCoreEmulator | null> {
    const checkpoint = checkpoints.get(session.id)
    const firstRetainedSeq = buffers.get(session.id)?.snapshot()[0]?.seq ?? session.lastOutputSeq + 1
    if (!checkpoint
      || checkpoint.sizeRevision !== session.sizeRevision
      || checkpoint.throughOutputSeq > session.lastOutputSeq
      || (firstRetainedSeq !== 1 && checkpoint.throughOutputSeq < firstRetainedSeq - 1)) {
      return null
    }
    const emulator = createTerminalCoreEmulator({
      cols: session.cols,
      rows: session.rows,
      sizeRevision: session.sizeRevision,
    })
    try {
      await emulator.accept(checkpoint.serialized, checkpoint.throughOutputSeq)
      for (const chunk of buffers.get(session.id)?.snapshot() ?? []) {
        if (chunk.seq > checkpoint.throughOutputSeq) await emulator.accept(chunk.data, chunk.seq)
      }
      return emulator
    } catch (error) {
      emulator.dispose()
      throw error
    }
  }

  async function getView(input: { sessionId: string; kind: "screen" | "scrollback"; tailLines?: number; maxBytes: number }) {
    const runtime = runtimes.get(input.sessionId)
    if (!runtime) {
      const session = getSessionOrThrow(input.sessionId)
      const emulator = await restoreCheckpointEmulator(session)
      if (emulator) {
        try {
          return emulator.getView(input)
        } finally {
          emulator.dispose()
        }
      }
      return {
        kind: input.kind,
        lines: [], cols: session.cols, rows: session.rows, cursor: { x: 0, y: 0 },
        generatedAt: now(), throughOutputSeq: session.lastOutputSeq, sizeRevision: session.sizeRevision,
        emulatorId: "xterm-headless", emulatorVersion: "6.0.0",
        degraded: true, reasons: ["checkpoint_unavailable"], hasMore: false,
      }
    }
    return runtime.emulator.getView(input)
  }

  function clearExpiredLease(sessionId: string): void {
    const lease = leases.get(sessionId)
    if (lease && Date.parse(lease.expiresAt) <= Date.now()) expireLease(sessionId, "expired")
  }

  function requireLease(sessionId: string, leaseId: string, controller: TerminalControllerContext): TerminalLeaseState {
    clearExpiredLease(sessionId)
    const lease = leases.get(sessionId)
    if (!lease) throw terminalContractError("lease_expired", "lease")
    if (lease.leaseId !== leaseId || !sameOwner(lease, controller)) {
      throw terminalContractError("lease_invalid", "lease")
    }
    return lease
  }

  function validateInputRequest(
    sessionId: string,
    leaseId: string,
    expectedInputRevision: number,
    controller: TerminalControllerContext,
  ): void {
    requireLease(sessionId, leaseId, controller)
    const session = getSessionOrThrow(sessionId)
    if (session.inputRevision !== expectedInputRevision) {
      throw terminalContractError("revision_conflict", "revision", {
        details: { currentInputRevision: session.inputRevision },
      })
    }
  }

  function advanceInputRevision(sessionId: string, reason: string): TerminalSession {
    deps.agentNotifications?.handleUserInput(sessionId)
    return updateSessionState(sessionId, (session) => ({
      ...session,
      inputRevision: session.inputRevision + 1,
      attention: unknownAttention(session, reason),
    }), "input")
  }

  function idempotent<T>(
    clientId: string,
    capability: string,
    key: string,
    request: unknown,
    operation: () => T,
  ): T {
    pruneIdempotency()
    const scope = `${clientId}:${capability}:${key}`
    const digest = createHash("sha256").update(stableJson(request)).digest("hex")
    const existing = idempotency.get(scope)
    if (existing) {
      if (existing.digest !== digest) throw terminalContractError("idempotency_conflict", "idempotency")
      return existing.result as T
    }
    const result = operation()
    idempotency.set(scope, { clientId, capability, idempotencyKey: key, digest, expiresAtMs: Date.now() + IDEMPOTENCY_RETENTION_MS, result })
    schedulePersist()
    return result
  }

  async function idempotentAsync<T>(
    clientId: string,
    capability: string,
    key: string,
    request: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    pruneIdempotency()
    const scope = `${clientId}:${capability}:${key}`
    const digest = createHash("sha256").update(stableJson(request)).digest("hex")
    const existing = idempotency.get(scope)
    if (existing) {
      if (existing.digest !== digest) throw terminalContractError("idempotency_conflict", "idempotency")
      return existing.result as T
    }
    const pending = idempotencyInFlight.get(scope)
    if (pending) {
      if (pending.digest !== digest) throw terminalContractError("idempotency_conflict", "idempotency")
      return pending.promise as Promise<T>
    }
    const promise = (async () => {
      const result = await operation()
      idempotency.set(scope, { clientId, capability, idempotencyKey: key, digest, expiresAtMs: Date.now() + IDEMPOTENCY_RETENTION_MS, result })
      schedulePersist()
      return result
    })()
    idempotencyInFlight.set(scope, { digest, promise })
    try {
      return await promise
    } finally {
      if (idempotencyInFlight.get(scope)?.promise === promise) idempotencyInFlight.delete(scope)
    }
  }

  function runIdempotentOperation<T>(
    clientId: string,
    capability: string,
    key: string,
    request: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    return idempotentAsync(clientId, capability, key, request, operation)
  }

  function pruneIdempotency(): void {
    const current = Date.now()
    for (const [key, value] of idempotency) if (value.expiresAtMs <= current) idempotency.delete(key)
  }

  function pruneOperationTombstones(): void {
    const cutoff = Date.now() - DELETE_TOMBSTONE_RETENTION_MS
    for (const [operationId, operation] of operations) {
      if (operation.kind === "delete" && !sessions.has(operation.sessionId) && Date.parse(operation.updatedAt) <= cutoff) {
        operations.delete(operationId)
      }
    }
  }

  function requireSensitivePersistence(): void {
    if (deps.store.persistenceProtection !== "available") {
      throw terminalContractError("persistence_unavailable", "persistence", { retryable: true })
    }
  }

  function getCurrentWorkingDirectory(sessionId: string): string {
    const session = getSessionOrThrow(sessionId)
    return runtimes.get(sessionId)?.emulator.currentCwd ?? session.cwd
  }

  return {
    start,
    stop,
    getGlobalLaunchSettings,
    listCustomToolbarActions,
    createCustomToolbarAction,
    updateCustomToolbarAction,
    deleteCustomToolbarAction,
    updateGlobalLaunchSettings,
    listGroups,
    listWorkspaces,
    getWorkspace,
    getWorkspaceForSession,
    renameWorkspace,
    splitPane,
    movePane,
    updateSplitRatio,
    closePane,
    closeWorkspace,
    getGroup,
    getGroupCommand,
    createGroup,
    renameGroup,
    updateGroupSettings,
    createGroupCommand,
    updateGroupCommand,
    deleteGroupCommand,
    launchGroupCommand,
    deleteGroup,
    previewGroupDelete,
    commitGroupDelete,
    listSessions,
    createSession,
    createMcpSession,
    createSessionOverride,
    getSession,
    getCurrentWorkingDirectory,
    readSession,
    attachSession,
    renameSession,
    writeSession,
    resizeSession,
    deleteSession,
    deleteTerminalSession,
    stopSession,
    runStartupCommand,
    acquireControl,
    renewControl,
    releaseControl,
    sendSemanticInput,
    sendCommand,
    paste,
    sendRaw,
    resizeControlledSession,
    stopControlledSession,
    forceStopControlledSession,
    getOperation,
    observe,
    revokeClientAccess,
    getSessionState,
    getView,
    get terminalDomainRevision() { return terminalDomainRevision },
    get lastPersistError() { return lastPersistError },
    get persistenceProtection() { return deps.store.persistenceProtection ?? "unavailable" },
    runIdempotentOperation,
    flushPersistQueue: waitForPersistIdle,
    getLastPersistError: () => lastPersistError,
    getPersistDiagnostics: () => ({
      inFlight: Boolean(persistInFlight),
      pending: persistPending || Boolean(runtimePersistTimer),
      idleWaiterCount: persistIdleWaiters.length,
    }),
    get events() { return events },
  }
}

function spawnNodePty(input: SpawnPtyInput): PtyLike {
  ensureNodePtySpawnHelperExecutable()
  const pty = loadNodePty()
  return pty.spawn(input.shell, [...(input.shellArgs ?? resolveTerminalShellArgs(input.shell))], {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env,
  })
}

function loadNodePty(): typeof import("node-pty") {
  if (nodePtyModule) return nodePtyModule
  const packagedHelperPath = resolvePackagedNodePtySpawnHelper()
  if (packagedHelperPath) {
    process.env[NODE_PTY_SPAWN_HELPER_ENV] = packagedHelperPath
  } else {
    delete process.env[NODE_PTY_SPAWN_HELPER_ENV]
  }
  nodePtyModule = requireNodePty("node-pty") as typeof import("node-pty")
  return nodePtyModule
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === "win32") return
  const packagedHelperPath = resolvePackagedNodePtySpawnHelper()
  if (packagedHelperPath) {
    ensureExecutableIfPresent(packagedHelperPath)
    return
  }
  const packageRoot = path.dirname(require.resolve("node-pty/package.json"))
  ensureExecutableIfPresent(path.join(packageRoot, "build", "Release", "spawn-helper"))
  ensureExecutableIfPresent(path.join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"))
}

function resolvePackagedNodePtySpawnHelper(): string | null {
  if (process.platform !== "darwin") return null
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (!resourcesPath) return null
  const helperPath = path.resolve(resourcesPath, "..", "Frameworks", "node-pty-spawn-helper")
  return existsSync(helperPath) ? helperPath : null
}

export function ensureExecutableIfPresent(filePath: string): void {
  if (!existsSync(filePath)) return
  const mode = statSync(filePath).mode & 0o777
  if ((mode & 0o111) === 0) chmodSync(filePath, mode | 0o755)
}

function normalizeGroupSettings(settings: TerminalGroupSettings | undefined, timestamp: string): TerminalGroupSettings | undefined {
  if (!settings) return undefined
  const launch = normalizeLaunchLayer(settings)
  const commands = (settings.commands ?? []).map((command) => ({
    ...command,
    name: command.name.trim(),
    command: normalizeSavedCommand(command.command),
    updatedAt: command.updatedAt || timestamp,
    commandRevision: command.commandRevision || 1,
    ...(() => {
      const commandLaunch = normalizeLaunchLayer(command.launch)
      return commandLaunch ? { launch: commandLaunch } : {}
    })(),
  }))
  const startupCommand = settings.startupCommand?.trim()
  if (!launch && !commands.length && !startupCommand) return undefined
  return {
    ...(launch ?? {}),
    ...(commands.length ? { commands } : {}),
    ...(startupCommand ? { startupCommand: normalizeSavedCommand(startupCommand) } : {}),
  }
}

function normalizeLaunchLayer(settings: TerminalLaunchLayer | undefined): TerminalLaunchLayer | undefined {
  if (!settings) return undefined
  const defaultCwd = settings.defaultCwd?.trim()
  const shell = settings.shell?.trim()
  const environment = settings.environment && Object.keys(settings.environment).length
    ? Object.fromEntries(Object.entries(settings.environment).sort(([left], [right]) => left.localeCompare(right)))
    : undefined
  if (!defaultCwd && !shell && !environment) return undefined
  const normalized = {
    ...(defaultCwd ? { defaultCwd: path.resolve(defaultCwd) } : {}),
    ...(shell ? { shell } : {}),
    ...(environment ? { environment } : {}),
  }
  resolveTerminalLaunchConfiguration({ global: normalized })
  return normalized
}

function launchLayerFromGroup(settings: TerminalGroupSettings | undefined): TerminalLaunchLayer | undefined {
  if (!settings) return undefined
  return normalizeLaunchLayer({
    ...(settings.defaultCwd ? { defaultCwd: settings.defaultCwd } : {}),
    ...(settings.shell ? { shell: settings.shell } : {}),
    ...(settings.environment ? { environment: settings.environment } : {}),
  })
}

function hasSensitiveEnvironment(environment: TerminalLaunchLayer["environment"]): boolean {
  return Object.values(environment ?? {}).some((value) => value !== null)
}

function normalizeSavedCommand(command: string): string {
  const normalized = command.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
  if (!normalized || hasForbiddenTextControl(normalized, true)) {
    throw terminalContractError("invalid_argument", "validation")
  }
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
}

function normalizeCustomToolbarActionInput(
  input: TerminalCreateCustomToolbarActionInput | TerminalUpdateCustomToolbarActionInput,
): Pick<TerminalCustomToolbarAction, "label" | "content" | "pressEnter"> {
  const label = input.label.trim()
  const content = input.content.trim()
  if (
    !label
    || label.length > TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH
    || !content
    || content.length > TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH
    || /[\r\n]/.test(content)
    || hasForbiddenTextControl(content, false)
  ) {
    throw terminalContractError("invalid_argument", "validation")
  }
  return { label, content, pressEnter: input.pressEnter }
}

function getCommand(group: TerminalGroup, commandId: string): TerminalGroupCommand {
  const command = group.settings?.commands?.find((item) => item.id === commandId)
  if (!command) throw terminalContractError("not_found", "not_found")
  return command
}

function encodeSemanticAction(action: TerminalSemanticAction): string {
  if (action.type === "key") {
    const encoded = KEY_BYTES[action.key]
    if (!encoded) throw terminalContractError("invalid_argument", "validation")
    return encoded
  }
  validateText(action.text, false)
  return action.text
}

function validateText(value: string, allowLf: boolean): void {
  if (!value || hasForbiddenTextControl(value, allowLf)) {
    throw terminalContractError("invalid_argument", "validation")
  }
}

function hasForbiddenTextControl(value: string, allowLf: boolean): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint === 0x7f) return true
    if (codePoint <= 0x08) return true
    if (codePoint === 0x09) continue
    if (codePoint === 0x0a) {
      if (!allowLf) return true
      continue
    }
    if (codePoint >= 0x0b && codePoint <= 0x1f) return true
  }
  return false
}

function sameOwner(lease: TerminalLeaseState, controller?: TerminalControllerContext): boolean {
  return Boolean(controller
    && lease.clientId === controller.clientId
    && lease.controllerInstanceId === controller.controllerInstanceId)
}

function leaseResult(lease: TerminalLeaseState, session: TerminalSession) {
  return {
    leaseId: lease.leaseId,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    leaseRevision: lease.leaseRevision,
    stateRevision: session.stateRevision,
    inputRevision: session.inputRevision,
  }
}

function userController(): TerminalControllerContext {
  return { clientId: "synapse-ui", controllerInstanceId: "renderer", actorKind: "user" }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function decrementCounter(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 0) - 1
  if (next > 0) counts.set(key, next)
  else counts.delete(key)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
