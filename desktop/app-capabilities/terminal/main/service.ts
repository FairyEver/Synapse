import type { MobileToolbarButton } from "@synapse/shared" with { "resolution-mode": "import" }
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
import {
  TERMINAL_AGENT_ATTENTION_DETECTOR_ID,
  TERMINAL_AGENT_ATTENTION_DETECTOR_VERSION,
  type TerminalAcquireControlInput,
  type TerminalAgentAttentionUpdate,
  type TerminalCommandInput,
  type TerminalCreateSessionOverrideInput,
  type TerminalCreateSessionInput as TerminalMcpCreateSessionInput,
  type TerminalObserveInput,
  type TerminalPasteInput,
  type TerminalRawInput,
  type TerminalResizeInput,
  type TerminalSemanticAction,
  type TerminalSemanticInput,
  type TerminalStopInput,
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
  TerminalReorderGroupsInput,
  TerminalProjectGroupSource,
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
  TERMINAL_GROUP_NAME_MAX_LENGTH,
  TERMINAL_PROJECT_GROUP_NAME_PREFIX,
} from "../shared/schema"
import {
  TERMINAL_WORKSPACE_PANE_LIMIT,
  collectTerminalPaneLeaves,
  equalizeTerminalPaneGroup,
  findTerminalPane,
  moveTerminalPane,
  removeTerminalPane,
  setTerminalSplitRatio,
  splitTerminalPane,
  type TerminalClosePaneInput,
  type TerminalCloseWorkspaceInput,
  type TerminalCloseWorkspaceResult,
  type TerminalEqualizePaneInput,
  type TerminalMovePaneInput,
  type TerminalRenameWorkspaceInput,
  type TerminalSetSplitRatioInput,
  type TerminalSplitPaneInput,
  type TerminalSplitPaneResult,
  type TerminalUpdateWorkspaceInput,
  type TerminalWorkspace,
} from "../shared/workspace"
import {
  createTerminalCoreEmulator,
  type TerminalCoreEmulator,
  type TerminalStyledLine,
} from "./emulator"
import type { TerminalAgentNotificationService } from "./agent-notification-service"
import { projectMobileToolbarButtons } from "./mobile-toolbar"
import {
  applyTerminalSessionIdentity,
  resolveTerminalEnvironment,
  resolveTerminalLaunchConfiguration,
  resolveTerminalShellArgs,
} from "./environment"
import { createTerminalOutputBuffer, type TerminalOutputBuffer } from "./output-buffer"
import type { TerminalRuntimeStoreUpdate, TerminalStore, TerminalStoreState } from "./store"

export type PtyDisposable = { dispose(): void }
export type PtyLike = {
  readonly pid?: number
  /**
   * 这个 PTY 的设备名（node-pty 的 `ptsName`，如 `/dev/ttys036`）。
   *
   * 它是「终端会话 → 跑在里面的进程」唯一由内核担保的接点：设备名在 PTY 生命周期里不变，
   * 而进程的控制终端是活的内核事实，所以外部可以 `ps -t <设备名>` 反查到真正跑在里面的
   * agent 进程。Windows 没有这个设备，缺省即不写。
   */
  readonly ptsName?: string
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
  /**
   * The last grid the desktop's own layout asked for. Runtime state, like the
   * dimensions a phone claims: it is not persisted and dies with the PTY, which
   * is exactly as long as this terminal can still be resized back.
   */
  desktopGrid: { cols: number; rows: number } | null
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
  readonly resourceSessionId?: string
}

type TerminalServiceLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
}

export type TerminalService = ReturnType<typeof createTerminalService>

/**
 * Who asked for a grid change.
 *
 * Only a phone's own request claims size ownership; every other source releases
 * it. See `applySessionResize`.
 *
 * The two desktop branches differ in whether the grid is remembered as the one
 * the local layout wants. `desktop-layout` is the renderer's fit, and it is the
 * only source that knows what shape the pane would have: recording it is what
 * lets a phone's `releaseGrid` restore the size without the desktop being
 * visible to re-fit. `desktop` is an automated resize, which is a caller picking
 * dimensions for its own reasons and says nothing about the local layout.
 */
type SessionResizeSource =
  | { readonly kind: "desktop" }
  | { readonly kind: "desktop-layout" }
  | {
    readonly kind: "mobile"
    readonly deviceLabel: string
    readonly mobileClientInstanceId: string
  }

/** Compared by value, so re-adopting the same shape from the same phone is a no-op. */
function sameSizeOwner(
  a: TerminalSession["sizeOwner"],
  b: TerminalSession["sizeOwner"],
): boolean {
  if (!a || !b) return a === b
  return a.deviceLabel === b.deviceLabel
    && a.mobileClientInstanceId === b.mobileClientInstanceId
    && a.cols === b.cols
    && a.rows === b.rows
}

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
/**
 * The bytes behind every key name the phone may send; `MOBILE_KEYS` is the list, and
 * the two are kept in step deliberately rather than by convention — a name in one and
 * not the other is a key that validates on the cloud and then throws here.
 *
 * Arrows, Home/End and PageUp/PageDown use normal-mode sequences. That is not an
 * oversight about DECCKM: the existing entries were already normal-mode, and the
 * application-mode alternative would silently change what ArrowUp has always sent.
 *
 * `Backspace` (`\x7f`) and `Delete` (`\x1b[3~`) are different keys, as are the
 * desktop toolbar's local `Clear` (which never reaches the PTY) and `Ctrl+L`.
 *
 * Exported so the mobile toolbar's tests can hold it against a table written out by
 * hand: every value here is a byte string someone has to get right, and nothing else
 * in the codebase would notice a typo in one of them.
 */
export const KEY_BYTES: Readonly<Record<string, string>> = {
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
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Delete: "\x1b[3~",
  "Ctrl+A": "\x01",
  "Ctrl+E": "\x05",
  "Ctrl+U": "\x15",
  "Ctrl+K": "\x0b",
  "Ctrl+W": "\x17",
  "Ctrl+L": "\x0c",
  "Ctrl+R": "\x12",
  "Ctrl+Z": "\x1a",
  "Ctrl+B": "\x02",
  "Ctrl+F": "\x06",
  "Ctrl+G": "\x07",
  // `\x08`, not `\x7f`: Backspace is the *delete* key on a terminal, and `\x08` is
  // what a real Ctrl+H sends. The two are the pair this table is most likely to get
  // wrong, so the test spells them out a second time.
  "Ctrl+H": "\x08",
  // `\x0a`, not `\x0d`: Ctrl+J is a line feed, which Enter already owns as a
  // carriage return. See the same note on `Ctrl+H`.
  "Ctrl+J": "\x0a",
  "Ctrl+N": "\x0e",
  "Ctrl+O": "\x0f",
  "Ctrl+P": "\x10",
  "Ctrl+Q": "\x11",
  "Ctrl+S": "\x13",
  "Ctrl+T": "\x14",
  "Ctrl+V": "\x16",
  "Ctrl+X": "\x18",
  "Ctrl+Y": "\x19",
  // Back-tab. Claude Code cycles its permission mode on it, which is why it earns a
  // key of its own rather than being composed from Shift and Tab on the phone.
  "Shift+Tab": "\x1b[Z",
  // F1–F4 keep the SS3 form the terminal's own function keys send; F5 upward use CSI,
  // which is where the numbered codes start. `Insert` is CSI 2, the counterpart to
  // `Delete`'s CSI 3, and it is a different key from anything in the table above.
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
  Insert: "\x1b[2~",
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
    "prepareSession" | "renameSession" | "handleUserInput" | "unregisterSession" | "handleOscNotification"
    | "getAgentStateView">
}) {
  const events = new EventEmitter()
  const groups = new Map<string, TerminalGroup>()
  const toolbarActions = new Map<string, TerminalCustomToolbarAction>()
  const workspaces = new Map<string, TerminalWorkspace>()
  /**
   * Per-group conversation numbering for auto-named sessions ("<group name> #<n>").
   * In-memory only, by design: every terminal is gone after an app restart, so the
   * sequence restarts at #1, and a deleted conversation never returns its number.
   */
  const conversationSequences = new Map<string, number>()
  const sessions = new Map<string, TerminalSession>()
  const runtimes = new Map<string, TerminalRuntime>()
  const buffers = new Map<string, TerminalOutputBuffer>()
  const endCallbacks = new Map<string, () => void>()
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
      const current = sessions.get(update.session.id)
      const persistedSeq = update.output.at(-1)?.seq
      if (persistedSeq !== undefined && current) persistedOutputSeqBySession.set(update.session.id, persistedSeq)
      if (update.checkpoint && current) checkpoints.set(update.session.id, update.checkpoint)
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
    for (const checkpoint of snapshot.checkpoints) {
      if (sessions.has(checkpoint.sessionId)) checkpoints.set(checkpoint.sessionId, checkpoint)
    }
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

  /**
   * 被动证据（输出、尺寸、输入、回收）只失效非 Hook 的注意证据：
   * Hook 上报的等待输入只能由后续 Hook 事件、用户输入或会话结束改写，避免终端重绘把标记冲掉。
   */
  function passiveAttention(
    session: Pick<TerminalSession, "attention" | "lastOutputSeq" | "sizeRevision">,
    reason: string,
  ) {
    return session.attention.detectorId === TERMINAL_AGENT_ATTENTION_DETECTOR_ID
      ? session.attention
      : unknownAttention(session, reason)
  }

  function nextGroupSortOrder(): number {
    return [...groups.values()].reduce((highest, group) => Math.max(highest, group.sortOrder + 1), 0)
  }

  /**
   * Where a terminal goes when its creator named no place for it.
   *
   * Skips the project groups deliberately: since every project has a group, taking the
   * first group in the sidebar would put an anonymous terminal inside somebody's
   * project, which is the whole thing these groups exist to stop.
   */
  function ensureDefaultGroup(): TerminalGroup {
    const existing = [...groups.values()]
      .filter((group) => group.projectId === undefined)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
    if (existing) return existing
    const timestamp = now()
    const group: TerminalGroup = {
      id: randomUUID(),
      name: "默认",
      createdAt: timestamp,
      updatedAt: timestamp,
      sortOrder: nextGroupSortOrder(),
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
    }
    groups.set(group.id, group)
    bumpDomain("group.created", group.id, group.groupRevision)
    return group
  }

  function findProjectGroup(projectId: string): TerminalGroup | undefined {
    return [...groups.values()]
      .filter((group) => group.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
  }

  /**
   * Makes the group an Agent project is shown as, or brings its name up to date.
   *
   * Both ends of the same fact call this — the reconciliation that follows the project
   * list, and a launch that names a project — so a project group is never created twice
   * and never named by two different rules. In memory only; the caller flushes.
   *
   * The project's folder comes with it: a group that belongs to a project opens its
   * terminals in that project unless the user has said otherwise. Only an empty slot is
   * filled — a working directory somebody chose is theirs, and renaming a project is
   * not a reason to move it.
   */
  function upsertProjectGroup(source: TerminalProjectGroupSource): TerminalGroup {
    const name = `${TERMINAL_PROJECT_GROUP_NAME_PREFIX}${source.name}`.slice(0, TERMINAL_GROUP_NAME_MAX_LENGTH)
    const existing = findProjectGroup(source.projectId)
    const projectCwd = source.path ? path.resolve(source.path) : undefined
    const settings = existing?.settings?.defaultCwd === undefined && projectCwd
      ? { ...existing?.settings, defaultCwd: projectCwd }
      : existing?.settings
    if (existing) {
      const renamed = existing.name !== name
      const adopted = settings !== existing.settings
      if (!renamed && !adopted) return existing
      const updated = {
        ...existing,
        name,
        ...(settings ? { settings } : {}),
        updatedAt: now(),
        groupRevision: existing.groupRevision + 1,
        launchRevision: existing.launchRevision + (adopted ? 1 : 0),
      }
      groups.set(updated.id, updated)
      bumpDomain(renamed ? "group.renamed" : "group.updated", updated.id, updated.groupRevision)
      return updated
    }
    const timestamp = now()
    const group: TerminalGroup = {
      id: randomUUID(),
      name,
      projectId: source.projectId,
      createdAt: timestamp,
      updatedAt: timestamp,
      sortOrder: nextGroupSortOrder(),
      ...(projectCwd ? { settings: { defaultCwd: projectCwd } } : {}),
      groupRevision: 1,
      launchRevision: 1,
      membershipRevision: 1,
      commandCollectionRevision: 1,
    }
    groups.set(group.id, group)
    bumpDomain("group.created", group.id, group.groupRevision)
    return group
  }

  /** Removes a group and everything in it, the way the user's own delete does. */
  function removeGroupWithMembers(groupId: string): string[] {
    const deletedSessionIds: string[] = []
    for (const session of [...sessions.values()]) {
      if (session.groupId !== groupId) continue
      removeSessionResources(session.id)
      deletedSessionIds.push(session.id)
    }
    for (const workspace of [...workspaces.values()]) {
      if (workspace.groupId === groupId) workspaces.delete(workspace.id)
    }
    const group = groups.get(groupId)
    groups.delete(groupId)
    conversationSequences.delete(groupId)
    if (group) bumpDomain("group.deleted", groupId, group.groupRevision)
    return deletedSessionIds
  }

  /**
   * Makes the project groups match the project list the caller owns.
   *
   * One direction only, and one pass: a project without a group gets one named after it,
   * a group whose project is gone goes with it, and nothing else about either is
   * touched — a group the user renamed is a project group that follows the project, not
   * a copy of it.
   */
  async function syncProjectGroups(sources: readonly TerminalProjectGroupSource[]): Promise<void> {
    const wantedIds = new Set(sources.map((source) => source.projectId))
    for (const source of sources) upsertProjectGroup(source)
    const orphanedGroupIds = [...groups.values()]
      .filter((group) => group.projectId !== undefined && !wantedIds.has(group.projectId))
      .map((group) => group.id)
    const deletedSessionIds = orphanedGroupIds.flatMap((groupId) => removeGroupWithMembers(groupId))
    await flushPersist()
    if (!lastPersistError) {
      for (const sessionId of deletedSessionIds) events.emit("sessionDeleted", { sessionId })
    }
  }

  function getGroupOrThrow(groupId: string): TerminalGroup {
    const group = groups.get(groupId)
    if (!group) throw terminalContractError("not_found", "not_found")
    return group
  }

  /**
   * Refuses the two things a project group cannot do, wherever the request came from.
   *
   * The sidebar does not offer them either — this is the same rule held one layer down,
   * so a caller that is not the sidebar (an MCP tool, a phone) gets the same answer
   * instead of a change the next reconciliation would silently undo.
   */
  function assertGroupNameIsLocal(group: TerminalGroup): void {
    if (group.projectId === undefined) return
    throw terminalContractError("invalid_argument", "validation", {
      details: { reason: "project_group_is_managed", projectId: group.projectId },
    })
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

  /**
   * The workspace a session is the only terminal of, when it is one.
   *
   * A one-pane workspace and its session are one conversation wearing two names: the
   * desktop draws the workspace's title in the sidebar and the header tabs, the phone
   * draws the session's in its list (a workspace reaches a phone only once it holds a
   * split, see `summaryWorkspaces`). A rename on either surface therefore has to reach
   * the other, or the new name lands on one side and the old one stays on the other.
   *
   * A split is the case where the two names mean different things on purpose: the
   * workspace is then the tab and the terminals inside it are terminals of their own,
   * so renaming a pane must leave the row above it alone.
   */
  function workspaceSolelyForSession(sessionId: string): TerminalWorkspace | undefined {
    const workspace = getWorkspaceBySessionId(sessionId)
    if (!workspace) return undefined
    const panes = collectTerminalPaneLeaves(workspace.layout)
    return panes.length === 1 && panes[0]?.sessionId === sessionId ? workspace : undefined
  }

  /** The mirror of {@link workspaceSolelyForSession}: the session a workspace holds alone. */
  function soleSessionInWorkspace(workspace: TerminalWorkspace): TerminalSession | undefined {
    const panes = collectTerminalPaneLeaves(workspace.layout)
    if (panes.length !== 1) return undefined
    const sessionId = panes[0]?.sessionId
    return sessionId === undefined ? undefined : sessions.get(sessionId)
  }

  /**
   * Next "<group name> #<n>" title for a session that was not given an explicit name.
   * Numbers are per group and never recycled, so deleting a conversation leaves a gap.
   */
  function nextConversationTitle(group: TerminalGroup): string {
    const next = (conversationSequences.get(group.id) ?? 0) + 1
    conversationSequences.set(group.id, next)
    return `${group.name} #${next}`
  }

  function createWorkspaceForSession(session: TerminalSession, title: string = session.title): TerminalWorkspace {
    const timestamp = now()
    const workspace: TerminalWorkspace = {
      id: randomUUID(),
      groupId: session.groupId,
      title,
      pinned: false,
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

  /**
   * Hook 驱动的"等待输入"注意状态：只写状态、kind、原因与水位，重复事件不推进 revision。
   */
  function applyAgentAttention(input: TerminalAgentAttentionUpdate): void {
    const session = sessions.get(input.sessionId)
    if (!session) return
    if (
      session.attention.detectorId === TERMINAL_AGENT_ATTENTION_DETECTOR_ID
      && session.attention.state === input.state
      && session.attention.kind === input.kind
      && session.attention.reason === input.reason
    ) return
    updateSessionState(input.sessionId, (current) => ({
      ...current,
      attention: {
        state: input.state,
        kind: input.kind,
        reason: input.reason,
        confidence: 1,
        detectedAt: now(),
        throughOutputSeq: current.lastOutputSeq,
        sizeRevision: current.sizeRevision,
        detectorId: TERMINAL_AGENT_ATTENTION_DETECTOR_ID,
        detectorVersion: TERMINAL_AGENT_ATTENTION_DETECTOR_VERSION,
      },
    }), input.state === "waiting" ? "attention.waiting" : "attention.cleared")
  }

  function attachRuntime(session: TerminalSession, child: PtyLike, buffer: TerminalOutputBuffer): void {
    const emulator = createTerminalCoreEmulator({
      cols: session.cols,
      rows: session.rows,
      sizeRevision: session.sizeRevision,
      throughOutputSeq: session.lastOutputSeq,
      logger: deps.logger,
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
        attention: passiveAttention({ ...current, lastOutputSeq: chunk.seq }, "output_changed"),
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
      const lease = leases.get(session.id)
      if (lease) {
        leases.delete(session.id)
        leaseRevisions.set(session.id, lease.leaseRevision + 1)
      }
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
        attention: passiveAttention(current, "not_running"),
      }
      sessions.set(session.id, updated)
      deps.agentNotifications?.unregisterSession(session.id)
      if (operationId) completeOperation(operationId, updated.status, cause)
      const published = !unpublishedSessions.has(session.id)
      if (published) {
        events.emit("sessionChanged", updated)
        events.emit("stateChanged", {
          sessionId: session.id,
          stateRevision: updated.stateRevision,
          throughOutputSeq: updated.lastOutputSeq,
          changeTypes: ["lifecycle", "operation", "attention", "lease"],
        })
      }
      const removed = removeTerminalSessionInMemory(session.id)
      runEndCallback(session.id)
      if (published && removed) events.emit("sessionDeleted", { sessionId: session.id })
      void flushPersist()
    })
    runtimes.set(session.id, {
      pty: child,
      buffer,
      emulator,
      disposables: [dataDisposable, exitDisposable],
      desktopGrid: null,
    })
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
          attention: passiveAttention(session, "output_evicted"),
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
      /** Explicit argv for the launched program; defaults to the shell's own arguments. */
      readonly args?: readonly string[]
      readonly environment?: TerminalLaunchLayer["environment"]
      readonly overriddenFields?: readonly ("cwd" | "shell" | "environment" | "cols" | "rows")[]
      /** Caller-owned launch environment that must never be written into the session record. */
      readonly persistEnvironment?: boolean
    },
    createdByClientId?: string,
    commandLaunch?: TerminalLaunchLayer,
    createWorkspace = true,
    createWorkspaceTitle?: string,
  ): Promise<TerminalSession> {
    assertCreateQuota()
    const group = input.groupId
      ? getGroupOrThrow(input.groupId)
      : (input.projectId ? findProjectGroup(input.projectId) : undefined) ?? ensureDefaultGroup()
    const explicitTitle = input.title?.trim()
    const sessionTitle = explicitTitle || nextConversationTitle(group)
    /*
     * A freshly created tab is named after its group, while the conversation inside it carries
     * the numbered name. An explicitly named session (command launch, embedded agent CLI, MCP)
     * keeps naming its own tab so concurrent terminals stay distinguishable.
     */
    const workspaceTitle = createWorkspaceTitle ?? (explicitTitle ? sessionTitle : group.name)
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
      title: sessionTitle,
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
      ...(Object.keys(launchEnvironment).length && launchOverrides?.persistEnvironment !== false ? { launchEnvironment } : {}),
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
    if (createWorkspace) createWorkspaceForSession(session, workspaceTitle)
    updateGroupMembership(group.id)
    bumpDomain("session.created", session.id, session.metadataRevision)
    unpublishedSessions.set(session.id, terminalDomainRevision)
    try {
      const defaultShellArgs = launchOverrides?.args ?? resolveTerminalShellArgs(environment.shell)
      /*
       * 身份在这里注入而不是在 `resolveTerminalEnvironment` 里：新标签页的 workspace 到
       * 这一步才建出来，而分屏出来的 pane 要到调用方的 `splitTerminalPane` 之后才归属
       * workspace。前者的进程拿得到两条身份，后者只拿得到会话身份。
       */
      const sessionWorkspace = getWorkspaceBySessionId(session.id)
      const launchEnvironment = applyTerminalSessionIdentity(environment.env, {
        sessionId,
        ...(sessionWorkspace ? { workspaceId: sessionWorkspace.id } : {}),
      })
      const integration = deps.agentNotifications?.prepareSession({
        sessionId,
        title: session.title,
        shell: environment.shell,
        env: launchEnvironment,
        defaultShellArgs,
      })
      const child = (deps.spawnPty ?? spawnNodePty)({
        shell: environment.shell,
        shellArgs: integration?.shellArgs ?? defaultShellArgs,
        cwd: environment.cwd,
        cols: session.cols,
        rows: session.rows,
        env: integration?.env ?? launchEnvironment,
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
        attention: passiveAttention(session, "not_running"),
      }
      sessions.set(session.id, failed)
      deps.agentNotifications?.unregisterSession(session.id)
      removeTerminalSessionInMemory(session.id)
      runEndCallback(session.id)
      await flushPersist()
      return failed
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
    conversationSequences.clear()
    sessions.clear()
    buffers.clear()
    checkpoints.clear()
    operations.clear()
    idempotency.clear()
    for (const group of state.groups) groups.set(group.id, group)
    for (const session of state.sessions) sessions.set(session.id, session)
    for (const workspace of state.workspaces ?? []) {
      const panes = collectTerminalPaneLeaves(workspace.layout)
      if (panes.some((pane) => !sessions.has(pane.sessionId))) continue
      workspaces.set(workspace.id, workspace)
    }
    for (const sessionId of [...sessions.keys()]) removeTerminalSessionInMemory(sessionId)
    for (const entry of state.idempotency) {
      if (
        entry.expiresAtMs > Date.now()
        && !isSessionIdempotencyCapability(entry.capability)
        && !readStringProperty(entry.result, "sessionId")
      ) {
        idempotency.set(entry.scope, {
          clientId: entry.clientId,
          capability: entry.capability,
          idempotencyKey: entry.idempotencyKey,
          digest: entry.digest,
          expiresAtMs: entry.expiresAtMs,
          result: entry.result,
        })
      }
    }
    ensureDefaultGroup()
    await flushPersist()
  }

  async function stop(): Promise<void> {
    const sessionIds = [...sessions.keys()]
    for (const [sessionId, runtime] of runtimes) {
      cleanupRuntime(sessionId)
      try { runtime.pty.kill() } catch (error) {
        deps.logger?.warn("Terminal runtime shutdown failed.", { sessionId, error })
      }
    }
    for (const sessionId of sessionIds) removeTerminalSessionInMemory(sessionId)
    workspaces.clear()
    conversationSequences.clear()
    operations.clear()
    deletePlans.clear()
    for (const [scope, entry] of idempotency) {
      if (entry.resourceSessionId || isSessionIdempotencyCapability(entry.capability)) idempotency.delete(scope)
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

  /**
   * The buttons a phone is shown for this computer: the built-ins followed by the
   * user's own, in the order the desktop draws them.
   *
   * Read by the mobile gateway, which runs in this process. Deliberately not an IPC
   * operation and not a capability: nothing outside the desktop asks for it, so it
   * would only widen the surface the app advertises.
   *
   * The platform is this process's own, not a caller's: which built-ins exist is a
   * fact about the computer, not about who is asking.
   */
  function listMobileToolbarButtons(): readonly MobileToolbarButton[] {
    return projectMobileToolbarButtons({
      custom: listCustomToolbarActions(),
      platform: process.platform,
      keyBytes: KEY_BYTES,
    })
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

  /**
   * 置顶的 workspace 排在同分组其他 workspace 前面，其余仍按创建时间倒序。
   * 排序在这里而不是渲染层，UI、手机和 MCP 读到的是同一个顺序。
   */
  function listWorkspaces(): TerminalWorkspace[] {
    return [...workspaces.values()].sort((a, b) => (
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || b.createdAt.localeCompare(a.createdAt)
      || b.id.localeCompare(a.id)
    ))
  }

  function getWorkspace(input: { workspaceId: string }): TerminalWorkspace {
    return getWorkspaceOrThrow(input.workspaceId)
  }

  function getWorkspaceForSession(input: { sessionId: string }): TerminalWorkspace {
    const workspace = getWorkspaceBySessionId(input.sessionId)
    if (!workspace) throw terminalContractError("not_found", "not_found")
    return workspace
  }

  function applyWorkspaceTitle(workspace: TerminalWorkspace, title: string): TerminalWorkspace {
    const updated = {
      ...workspace,
      title,
      layoutRevision: workspace.layoutRevision + 1,
      updatedAt: now(),
    }
    workspaces.set(updated.id, updated)
    bumpDomain("workspace.renamed", updated.id, updated.layoutRevision)
    return updated
  }

  async function updateWorkspace(input: TerminalUpdateWorkspaceInput): Promise<TerminalWorkspace> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    const pinned = input.pinned ?? workspace.pinned
    if (pinned === workspace.pinned) return workspace
    const updated: TerminalWorkspace = {
      id: workspace.id,
      groupId: workspace.groupId,
      title: workspace.title,
      pinned,
      layout: workspace.layout,
      layoutRevision: workspace.layoutRevision + 1,
      closingPaneIds: workspace.closingPaneIds,
      closing: workspace.closing,
      createdAt: workspace.createdAt,
      updatedAt: now(),
    }
    workspaces.set(updated.id, updated)
    bumpDomain("workspace.updated", updated.id, updated.layoutRevision)
    await flushPersist()
    return updated
  }

  async function renameWorkspace(input: TerminalRenameWorkspaceInput): Promise<TerminalWorkspace> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    const title = input.title.trim()
    if (title === workspace.title) return workspace
    const updated = applyWorkspaceTitle(workspace, title)
    // The conversation's only terminal goes by the same name, so it takes the new one
    // too — otherwise the phone's list, which draws terminals, would keep the old one.
    const sole = soleSessionInWorkspace(updated)
    const renamedSession = sole && sole.title !== title ? applySessionTitle(sole, title) : undefined
    await flushPersist()
    if (!lastPersistError && renamedSession) events.emit("sessionChanged", renamedSession)
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

  async function equalizePane(input: TerminalEqualizePaneInput): Promise<TerminalWorkspace> {
    const workspace = getWorkspaceOrThrow(input.workspaceId)
    assertWorkspaceRevision(workspace, input.expectedLayoutRevision)
    if (workspace.closing || workspace.closingPaneIds.includes(input.paneId)) {
      throw terminalContractError("lifecycle_conflict", "lifecycle")
    }
    const layout = equalizeTerminalPaneGroup(workspace.layout, input.paneId)
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
    dirtyRuntimeSessionIds.delete(sessionId)
    persistedOutputSeqBySession.delete(sessionId)
    unpublishedSessions.delete(sessionId)
    leases.delete(sessionId)
    leaseRevisions.delete(sessionId)
    activeStopOperations.delete(sessionId)
  }

  function removeTerminalSessionInMemory(sessionId: string): boolean {
    const session = sessions.get(sessionId)
    if (!session) return false
    const workspace = getWorkspaceBySessionId(sessionId)
    if (workspace) {
      const pane = collectTerminalPaneLeaves(workspace.layout).find((item) => item.sessionId === sessionId)
      const layout = pane ? removeTerminalPane(workspace.layout, pane.paneId) : undefined
      if (layout === null) {
        workspaces.delete(workspace.id)
        bumpDomain("workspace.deleted", workspace.id, workspace.layoutRevision)
      } else if (layout) {
        const updated = {
          ...workspace,
          layout,
          closingPaneIds: workspace.closingPaneIds.filter((paneId) => paneId !== pane?.paneId),
          layoutRevision: workspace.layoutRevision + 1,
          updatedAt: now(),
        }
        workspaces.set(updated.id, updated)
        bumpDomain("workspace.layout_changed", updated.id, updated.layoutRevision)
      }
    }
    removeSessionResources(sessionId)
    updateGroupMembership(session.groupId)
    for (const [operationId, operation] of operations) {
      if (operation.sessionId === sessionId) operations.delete(operationId)
    }
    for (const [scope, entry] of idempotency) {
      if (entry.resourceSessionId === sessionId) idempotency.delete(scope)
    }
    for (const [deletePlanId, plan] of deletePlans) {
      if (plan.sessionFacts.some((fact) => fact.sessionId === sessionId)) deletePlans.delete(deletePlanId)
    }
    bumpDomain("session.deleted", session.id, session.metadataRevision)
    return true
  }

  function runEndCallback(sessionId: string): void {
    const callback = endCallbacks.get(sessionId)
    if (!callback) return
    endCallbacks.delete(sessionId)
    try {
      callback()
    } catch (error) {
      deps.logger?.warn("Terminal session end callback failed.", { sessionId, error })
    }
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
    assertGroupNameIsLocal(group)
    const updated = { ...group, name, updatedAt: now(), groupRevision: group.groupRevision + 1 }
    groups.set(group.id, updated)
    bumpDomain("group.renamed", group.id, updated.groupRevision)
    await flushPersist()
    return updated
  }

  async function reorderGroups(input: TerminalReorderGroupsInput): Promise<TerminalGroup[]> {
    const currentOrder = listGroups()
    const seenGroupIds = new Set<string>()
    for (const groupId of input.groupIds) {
      if (seenGroupIds.has(groupId)) {
        throw terminalContractError("invalid_argument", "validation", { details: { reason: "duplicate_group_id", groupId } })
      }
      if (!groups.has(groupId)) {
        throw terminalContractError("invalid_argument", "validation", { details: { reason: "unknown_group_id", groupId } })
      }
      seenGroupIds.add(groupId)
    }
    if (seenGroupIds.size !== currentOrder.length) {
      throw terminalContractError("invalid_argument", "validation", { details: { reason: "incomplete_group_order" } })
    }

    const reordered = input.groupIds.map((groupId) => groups.get(groupId)!)
    if (reordered.every((group, index) => group.sortOrder === index)) return currentOrder

    const timestamp = now()
    for (const [index, group] of reordered.entries()) {
      if (group.sortOrder === index) continue
      const updated: TerminalGroup = {
        ...group,
        sortOrder: index,
        updatedAt: timestamp,
        groupRevision: group.groupRevision + 1,
      }
      groups.set(group.id, updated)
      bumpDomain("group.reordered", group.id, updated.groupRevision)
    }
    await flushPersist()
    return listGroups()
  }

  async function updateGroupSettings(input: TerminalUpdateGroupSettingsInput): Promise<TerminalGroup> {
    const group = getGroupOrThrow(input.groupId)
    // Launch settings are the user's to set on any group; the name is not, on this one.
    if (input.name.trim() !== group.name) assertGroupNameIsLocal(group)
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
      cols: input.cols,
      rows: input.rows,
    }, origin.source, undefined, origin.clientId, command.launch, true, `${group.name} ${command.name}`)
    if (session.status !== "running") return session
    const operation = createOperation("command_delivery", session.id, "terminal-command-launch")
    const delivery = deliverSavedCommand(session.id, command.command)
    operation.status = delivery.status
    operation.acceptedActionCount = delivery.acceptedActionCount
    operation.acceptedBytes = delivery.acceptedBytes
    operation.failedActionIndex = delivery.failedActionIndex
    operation.errorCode = delivery.status === "delivered" ? undefined : delivery.status === "failed" ? "command_delivery_failed" : "delivery_uncertain"
    operation.updatedAt = now()
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
    assertGroupNameIsLocal(group)
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

  /**
   * First-party launch for an embedded agent CLI. The launch environment belongs to the caller
   * (for example provider credentials) and must stay out of the persisted session record.
   */
  async function createSessionWithEphemeralEnvironment(input: {
    readonly title?: string
    readonly cwd: string
    readonly shell: string
    readonly args?: readonly string[]
    /**
     * The Agent project this launch belongs to, when it belongs to one.
     *
     * Carries the name as well as the id, unlike the UI's own create: this path is how
     * a conversation is started in a project, and it is the one caller that can have a
     * project in hand before the reconciliation has made its group.
     */
    readonly project?: TerminalProjectGroupSource
    readonly environment: Record<string, string>
    /**
     * The grid the CLI is born into. Omitted, the session takes the default shape.
     *
     * A CLI paints its banner and first prompt within the opening milliseconds and those lines
     * keep whatever width the PTY had, so asking for a size after creation is too late — ADR 0063
     * requires explicit dimensions to be part of the creation itself.
     */
    readonly cols?: number
    readonly rows?: number
    /**
     * Who asked for it, when that is a remote client rather than the desktop's own UI.
     *
     * Recorded on the session so a terminal the user did not open locally can be told
     * apart from one they did. Absent for the UI's own launches, which is every launch
     * this method had before the mobile gateway became a caller.
     */
    readonly createdByClientId?: string
    /** Runs once when the session process ends; used to release caller-owned launch assets. */
    readonly onEnded?: () => void
  }): Promise<TerminalSession> {
    const session = await createSessionRecord({
      ...(input.project ? { groupId: upsertProjectGroup(input.project).id } : {}),
      title: input.title,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
    }, "ui", {
      shell: input.shell,
      args: input.args,
      environment: input.environment,
      overriddenFields: [
        "cwd", "shell", "environment",
        ...(input.cols === undefined ? [] : ["cols" as const]),
        ...(input.rows === undefined ? [] : ["rows" as const]),
      ],
      persistEnvironment: false,
    }, input.createdByClientId)
    if (input.onEnded) endCallbacks.set(session.id, input.onEnded)
    return session
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

  function applySessionTitle(session: TerminalSession, title: string): TerminalSession {
    const updated = {
      ...session,
      title,
      metadataRevision: session.metadataRevision + 1,
      stateRevision: session.stateRevision + 1,
      updatedAt: now(),
    }
    sessions.set(updated.id, updated)
    deps.agentNotifications?.renameSession(updated.id, updated.title)
    bumpDomain("session.renamed", updated.id, updated.metadataRevision)
    return updated
  }

  async function renameSession(input: TerminalRenameSessionInput): Promise<TerminalSession> {
    const current = getSessionOrThrow(input.sessionId)
    const title = input.title.trim()
    if (title === current.title) return current
    const updated = applySessionTitle(current, title)
    // A conversation holding nothing but this terminal goes by the same name, and the
    // desktop draws that name from the workspace; see `workspaceSolelyForSession`. A
    // phone renames through this function, so without the rewrite below the new name
    // would reach the phone's list alone and the desktop's sidebar would keep the old.
    const workspace = workspaceSolelyForSession(current.id)
    if (workspace && workspace.title !== title) applyWorkspaceTitle(workspace, title)
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
    await applySessionResize(input.sessionId, input.cols, input.rows, { kind: "desktop-layout" })
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

  /**
   * The one place a session's grid changes, and therefore the one place size
   * ownership changes too.
   *
   * `source` names who asked. Anything that is not a phone clears mobile
   * ownership, and only a phone's own request re-establishes it. That rule is a
   * backstop rather than the way ownership normally returns — taking the grid back
   * is the desktop's explicit release, which does not come through here at all —
   * but it is what keeps a write from landing on a claim nobody made: an
   * automated resize and creation both arrive as non-mobile.
   */
  async function applySessionResize(
    sessionId: string,
    cols: number,
    rows: number,
    source: SessionResizeSource = { kind: "desktop" },
  ): Promise<TerminalSession> {
    const runtime = getRuntimeForInput(sessionId)
    const current = getSessionOrThrow(sessionId)

    const nextOwner: TerminalSession["sizeOwner"] = source.kind === "mobile"
      ? {
        kind: "mobile",
        deviceLabel: source.deviceLabel,
        mobileClientInstanceId: source.mobileClientInstanceId,
        cols,
        rows,
      }
      : undefined
    const ownerChanged = !sameSizeOwner(current.sizeOwner, nextOwner)
    const sizeChanged = current.cols !== cols || current.rows !== rows
    // Before the early return below, not after: the record has to track the last
    // shape the layout asked for even when the grid did not move, or a restore
    // would put the terminal back at a shape the pane has since outgrown.
    if (source.kind === "desktop-layout") runtime.desktopGrid = { cols, rows }
    // Ownership can change with the grid unchanged — a phone adopting a session
    // that already happens to be its shape. The renderer still has to hear about
    // that, or the badge never appears.
    if (!sizeChanged && !ownerChanged) return current

    if (sizeChanged) runtime.pty.resize(cols, rows)

    const updated: TerminalSession = {
      ...current,
      cols,
      rows,
      sizeOwner: nextOwner,
      sizeRevision: sizeChanged ? current.sizeRevision + 1 : current.sizeRevision,
      stateRevision: current.stateRevision + 1,
      attention: sizeChanged
        ? passiveAttention({ ...current, sizeRevision: current.sizeRevision + 1 }, "resize")
        : current.attention,
      updatedAt: now(),
    }
    sessions.set(current.id, updated)
    events.emit("sessionChanged", updated)
    events.emit("stateChanged", {
      sessionId,
      stateRevision: updated.stateRevision,
      throughOutputSeq: updated.lastOutputSeq,
      changeTypes: sizeChanged ? ["size", "attention"] : ["size"],
    })

    if (sizeChanged) {
      const barrier = await runtime.emulator.resize(cols, rows, updated.sizeRevision)
      events.emit("resized", {
        sessionId,
        cols,
        rows,
        sizeRevision: barrier.sizeRevision,
        throughOutputSeq: barrier.throughOutputSeq,
      })
    }
    scheduleRuntimePersist(sessionId)
    return updated
  }

  /**
   * A phone setting the grid for its own display mode.
   *
   * Not the automated path: ADR 0063 lets a user or UI resize proceed without a
   * lease, because it takes no input control and revokes nothing the desktop
   * holds. `resizeSession` stays as it was and means "the desktop did this".
   */
  async function resizeSessionFromDevice(input: {
    readonly sessionId: string
    readonly cols: number
    readonly rows: number
    readonly deviceLabel: string
    readonly mobileClientInstanceId: string
  }): Promise<TerminalSession> {
    return applySessionResize(input.sessionId, input.cols, input.rows, {
      kind: "mobile",
      deviceLabel: input.deviceLabel,
      mobileClientInstanceId: input.mobileClientInstanceId,
    })
  }

  /**
   * Hands the grid back to the desktop without touching the PTY.
   *
   * The renderer calls this and then re-runs its own fit, so the size moves once
   * instead of snapping to a placeholder and moving again. The PTY keeps the
   * phone's grid until that fit lands, which is deliberate: releasing ownership
   * is a statement about who decides, not about what the size currently is.
   */
  function releaseSizeOwnership(sessionId: string): TerminalSession {
    const current = getSessionOrThrow(sessionId)
    if (!current.sizeOwner) return current
    const updated: TerminalSession = {
      ...current,
      sizeOwner: undefined,
      stateRevision: current.stateRevision + 1,
      updatedAt: now(),
    }
    sessions.set(current.id, updated)
    events.emit("sessionChanged", updated)
    events.emit("stateChanged", {
      sessionId,
      stateRevision: updated.stateRevision,
      throughOutputSeq: updated.lastOutputSeq,
      changeTypes: ["size"],
    })
    scheduleRuntimePersist(sessionId)
    return updated
  }

  /**
   * Puts the PTY back at the size the local layout wants, and returns whether it
   * could.
   *
   * This is what a phone's `releaseGrid` means. Handing ownership back is only
   * half the job — the other half is moving the grid, and the phone cannot do
   * that itself: everything it was ever told is the size the PTY currently has.
   * The desktop normally moves it on its own next fit, but that fit only runs
   * while a pane is actually on screen, so a window that is closed or in the
   * background would leave the PTY at the phone's grid indefinitely while the
   * phone, now in a mode that draws the desktop's layout, shows the wrong shape.
   *
   * One call does both because a non-mobile resize releases ownership by itself
   * (ADR 0216): releasing first and resizing after would emit two state batches
   * for one user action.
   *
   * `false` means the desktop has never laid this terminal out — nothing has ever
   * told us what shape it would want. There is no honest size to substitute, so
   * the caller reports that rather than inventing one; the next time the pane is
   * shown, the fit records a grid and the phone picks it up from the resize
   * event. Ownership is still handed back either way.
   */
  async function restoreGridForDesktop(sessionId: string): Promise<boolean> {
    const current = getSessionOrThrow(sessionId)
    if (!current.sizeOwner) return true
    const grid = runtimes.get(sessionId)?.desktopGrid
    if (!grid) {
      releaseSizeOwnership(sessionId)
      return false
    }
    await applySessionResize(sessionId, grid.cols, grid.rows, { kind: "desktop-layout" })
    return true
  }

  /**
   * Drops ownership held by a phone that is gone.
   *
   * The PTY is left where it is: shrinking it out from under a terminal nobody is
   * watching would reflow output the local user is about to read, and the
   * desktop's next layout change sets the size anyway.
   */
  function releaseSizeOwnershipForClient(mobileClientInstanceId: string): void {
    for (const session of sessions.values()) {
      if (session.sizeOwner?.mobileClientInstanceId === mobileClientInstanceId) {
        releaseSizeOwnership(session.id)
      }
    }
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
      if (!sessions.has(session.id)) return operation
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
    /*
     * 只读、且只描述这个 PTY 本身：调用方拿它去 `ps -t` 就能把会话与跑在里面的进程对上，
     * 这正是「拿着一段引用去认领另一个会话」需要的那一步。它不依赖 Agent 原生通知，
     * 对普通 shell 与任何 agent 一样成立；进程结束后 PTY 没了，字段随之缺席。
     */
    const tty = runtimes.get(sessionId)?.pty.ptsName
    /*
     * agent 块缺席与 `state: "ended"` 是两件不同的事：缺席代表「这个会话里从来没有 agent
     * 进来过，或者 Agent 原生通知没开」，`ended` 代表「跑过、已经退出」。调用方据此决定是
     * 该让用户去启动一个，还是该让用户去 resume。合起来只会得到一个错的结论。
     */
    const agent = deps.agentNotifications?.getAgentStateView(sessionId)
    return {
      sessionId,
      lifecycle: session.status,
      attention: session.attention,
      ...(tty ? { tty } : {}),
      ...(agent ? { agent } : {}),
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
      logger: deps.logger,
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
        lines: [], cols: session.cols, rows: session.rows, textCursor: { x: 0, y: 0 },
        generatedAt: now(), throughOutputSeq: session.lastOutputSeq, sizeRevision: session.sizeRevision,
        emulatorId: "xterm-headless", emulatorVersion: "6.0.0",
        degraded: true, reasons: ["checkpoint_unavailable"], hasMore: false,
      }
    }
    return runtime.emulator.getView(input)
  }

  /**
   * Styled tail of a session's screen, for consumers that render it themselves
   * rather than shipping raw ANSI. Mirrors `getView`'s checkpoint fallback so a
   * session whose runtime is gone still yields its last known screen.
   */
  async function readLineWindow(input: { sessionId: string; maxLines: number }) {
    const runtime = runtimes.get(input.sessionId)
    if (!runtime) {
      const session = getSessionOrThrow(input.sessionId)
      const emulator = await restoreCheckpointEmulator(session)
      if (emulator) {
        try {
          return emulator.readLineWindow({ maxLines: input.maxLines })
        } finally {
          emulator.dispose()
        }
      }
      return {
        lines: [],
        startIndex: 0,
        totalLines: 0,
        cols: session.cols,
        rows: session.rows,
        cursor: { row: 0, col: 0, visible: false },
        alt: false,
        throughOutputSeq: session.lastOutputSeq,
        sizeRevision: session.sizeRevision,
      }
    }
    // Reads are synchronous over the buffer, so wait for queued writes to land
    // first; otherwise a burst of output can be read half-applied.
    await runtime.emulator.ready()
    return runtime.emulator.readLineWindow({ maxLines: input.maxLines })
  }

  /**
   * An arbitrary slice of a session's scrollback, for history paging.
   *
   * Returns nothing for a session whose runtime is gone: the checkpoint holds a
   * truncated snapshot, and serving history out of it would hand the phone a
   * window that does not line up with what it already has.
   */
  async function readLineRange(input: {
    sessionId: string
    from: number
    maxLines: number
  }): Promise<{ readonly lines: TerminalStyledLine[]; readonly startIndex: number }> {
    const runtime = runtimes.get(input.sessionId)
    if (!runtime) return { lines: [], startIndex: 0 }
    await runtime.emulator.ready()
    return runtime.emulator.readLineRange({ from: input.from, maxLines: input.maxLines })
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
      attention: passiveAttention(session, reason),
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
    const resourceSessionId = resolveIdempotencySessionId(request, result)
    if (!resourceSessionId || sessions.has(resourceSessionId)) {
      idempotency.set(scope, {
        clientId,
        capability,
        idempotencyKey: key,
        digest,
        expiresAtMs: Date.now() + IDEMPOTENCY_RETENTION_MS,
        result,
        ...(resourceSessionId ? { resourceSessionId } : {}),
      })
      schedulePersist()
    }
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
      const resourceSessionId = resolveIdempotencySessionId(request, result)
      if (!resourceSessionId || sessions.has(resourceSessionId)) {
        idempotency.set(scope, {
          clientId,
          capability,
          idempotencyKey: key,
          digest,
          expiresAtMs: Date.now() + IDEMPOTENCY_RETENTION_MS,
          result,
          ...(resourceSessionId ? { resourceSessionId } : {}),
        })
        schedulePersist()
      }
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
    listMobileToolbarButtons,
    createCustomToolbarAction,
    updateCustomToolbarAction,
    deleteCustomToolbarAction,
    updateGlobalLaunchSettings,
    listGroups,
    syncProjectGroups,
    listWorkspaces,
    getWorkspace,
    getWorkspaceForSession,
    renameWorkspace,
    updateWorkspace,
    splitPane,
    movePane,
    equalizePane,
    updateSplitRatio,
    closePane,
    closeWorkspace,
    getGroup,
    getGroupCommand,
    createGroup,
    renameGroup,
    reorderGroups,
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
    createSessionWithEphemeralEnvironment,
    getSession,
    getCurrentWorkingDirectory,
    readSession,
    attachSession,
    resizeSessionFromDevice,
    releaseSizeOwnership,
    restoreGridForDesktop,
    releaseSizeOwnershipForClient,
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
    readLineWindow,
    readLineRange,
    applyAgentAttention,
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

function resolveIdempotencySessionId(request: unknown, result: unknown): string | undefined {
  return readStringProperty(request, "sessionId") ?? readStringProperty(result, "sessionId")
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const property = (value as Record<string, unknown>)[key]
  return typeof property === "string" && property ? property : undefined
}

function isSessionIdempotencyCapability(capability: string): boolean {
  return capability.startsWith("session") || capability.includes(".session")
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
