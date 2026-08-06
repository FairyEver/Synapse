import { EventEmitter } from "node:events"
import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, createWriteStream, type Stats } from "node:fs"
import { copyFile, lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { SynapseAccountState } from "../../src/types/account"
import type { DriveLocalUploadProgressEvent } from "../../src/types/bridge"
import type {
  DriveChangeDto,
  DriveItemDto,
  DriveItemTreeListPageDto,
  DriveSyncBindingPreviewDto,
  DriveSyncInitialTransferPreviewDto,
  DriveSyncInitialTransferPreviewEntryDto,
  DriveSyncConflictResolutionInput,
  DriveSyncCreateSafeBindingInput,
  DriveChangeListInput,
  DriveChangeListPageDto,
  DriveSyncBindingDto,
  DriveSyncBindingStatus,
  DriveSyncConflictResolutionAction,
  DriveSyncOperationDto,
  DriveSyncOperationStatus,
  DriveSyncConflictDto,
  DriveSyncSnapshotDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type {
  DataNamespace,
  DriveSyncBaselineEntryV1,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
  DriveSyncStateEntryV1,
} from "../runtime/data-repo"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"
import { createDriveSyncBaselineStore } from "./drive-sync-baseline"
import { previewDriveSyncBinding, readDriveSyncGitignoreRules } from "./drive-sync-binding-validator"
import { DriveSyncLocalPreconditionError, executeDriveSyncOperation, type UploadSnapshot } from "./drive-sync-executor"
import { createDefaultDriveSyncExcludeRules, isDriveSyncExcluded } from "./drive-sync-excludes"
import { sanitizeError } from "./error-sanitize"
import {
  formatDriveSyncSkippedLocalEntries,
  hashDriveSyncFile,
  inspectDriveSyncLocalPath,
  scanDriveSyncLocalTree,
  scanDriveSyncLocalTreeDetailed,
  type DriveSyncLocalSnapshotEntry,
} from "./drive-sync-local-snapshot"
import {
  createDriveSyncDirectoryTarget,
  assertNoSymlinkPathComponents,
  assertDriveSyncLocalRelativePathPortable,
  driveSyncLocalWriteRootPath,
  localPathIdentitiesOverlap,
  normalizeLocalPath,
  pathCollisionKey,
  writeDriveSyncFileTarget,
} from "./drive-sync-paths"
import {
  planDriveSyncLocalChanges,
  planDriveSyncRemoteChanges,
  type DriveSyncPlannedConflict,
  type DriveSyncPlannedOperation,
} from "./drive-sync-planner"
import { pollDriveSyncRemoteChanges } from "./drive-sync-remote-poller"
import { createDriveSyncWatcher, type DriveSyncLocalChange, type DriveSyncWatchFactory } from "./drive-sync-watcher"
import {
  createDriveSyncWorkCoordinator,
  isDriveSyncWorkCancelledError,
} from "./drive-sync-work-coordinator"

export interface DriveSyncServiceDeps {
  readonly bindings: DataNamespace<DriveSyncBindingEntryV1>
  readonly baseline: DataNamespace<DriveSyncBaselineEntryV1>
  readonly operations: DataNamespace<DriveSyncOperationEntryV1>
  readonly conflicts: DataNamespace<DriveSyncConflictEntryV1>
  readonly state: DataNamespace<DriveSyncStateEntryV1>
  readonly accountService: DriveSyncAccountService
  readonly trashLocalPath?: (localPath: string) => Promise<void>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly now?: () => Date
  readonly createId?: (prefix: string) => string
  readonly watch?: DriveSyncWatchFactory
  readonly stagingRootPath?: string
}

type DriveSyncRemoteTreeEntry = {
  readonly id: string
  readonly name: string
  readonly type: DriveItemDto["type"]
  readonly path: string
  readonly size: string
}

export interface DriveSyncAccountService {
  readonly getState?: () => SynapseAccountState
  readonly onStateChanged?: (listener: (state: SynapseAccountState) => void) => () => void
  readonly onBeforeIdentityChange?: (listener: () => void | Promise<void>) => () => void
  readonly getDriveItem?: (itemId: string) => Promise<DriveItemDto>
  readonly downloadDriveFile: (input: {
    readonly itemId: string
    readonly outputPath: string
    readonly signal?: AbortSignal
    readonly onProgress?: (completedBytes: number, totalBytes: number) => void
  }) => Promise<{ readonly ok: true; readonly path: string }>
  readonly downloadDriveFolderZip: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<{ readonly ok: true; readonly path: string }>
  readonly uploadDriveLocalItems: (input: {
    readonly taskId?: string
    readonly parentId?: string | null
    readonly items: Array<
      | {
        kind: "file"
        path: string
        name: string
        mimeType?: string | null
        expectedItemId?: string | null
      }
      | {
        kind: "folder"
        folderName: string
        files: Array<{ path: string; relativePath: string; mimeType?: string | null }>
      }
    >
  }, options?: {
    readonly signal?: AbortSignal
    readonly onProgress?: (event: DriveLocalUploadProgressEvent) => void
    readonly onFolderPrepared?: (input: { readonly id: string; readonly created: boolean }) => void
  }) => Promise<{ readonly completed: number; readonly failed: number; readonly skipped: number; readonly message?: string }>
  readonly uploadDriveSyncFile: (input: {
    readonly parentId: string | null
    readonly path: string
    readonly name: string
    readonly expectedItemId?: string | null
    readonly onProgress?: (completedBytes: number, totalBytes: number) => void
    readonly signal?: AbortSignal
  }) => Promise<DriveItemDto>
  readonly createDriveFolder: (input: { readonly parentId?: string | null; readonly name: string }) => Promise<{ readonly id: string; readonly name: string; readonly type: string }>
  readonly renameDriveItem: (itemId: string, name: string) => Promise<unknown>
  readonly moveDriveItem: (itemId: string, parentId: string | null) => Promise<unknown>
  readonly deleteDriveItem: (itemId: string) => Promise<{ readonly ok: true }>
  readonly listDriveChanges: (input: DriveChangeListInput) => Promise<DriveChangeListPageDto>
  readonly listDriveItemTree: (input: { readonly parentId?: string | null; readonly offset?: number; readonly limit?: number }) => Promise<{
    readonly items: ReadonlyArray<Partial<DriveItemTreeListPageDto["items"][number]> & { readonly id: string; readonly name: string; readonly type: string }>
    readonly nextOffset?: number | null
  }>
}

export interface DriveSyncCreateBindingInput {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly remoteParentId?: string | null
  readonly kind: "file" | "folder"
  readonly drivePathHint?: string | null
  readonly localPath: string
  readonly remoteCursor?: string | null
  readonly excludeRules?: readonly string[]
  readonly importedGitignoreRules?: readonly string[]
  readonly useDefaultExcludes?: boolean
  readonly initialDirection?: DriveSyncCreateSafeBindingInput["direction"]
  readonly initialCursor?: string | null
  readonly initialPhase?: DriveSyncBindingEntryV1["initialPhase"]
  readonly deferWatcher?: boolean
  readonly initialStatus?: "initializing" | "active"
}

type DriveSyncCreateBindingInternalInput = DriveSyncCreateBindingInput & {
  readonly skipLocalAuthorization?: boolean
}

type DriveSyncLocalPermissionSource =
  | "driveSync.previewBinding"
  | "driveSync.createBinding"
  | "driveSync.createSafeBinding"
  | "driveSync.executeOperation"

export interface DriveSyncRecordOperationInput {
  readonly id?: string
  readonly bindingId: string
  readonly kind: DriveSyncOperationEntryV1["kind"]
  readonly status: DriveSyncOperationStatus
  readonly driveItemId?: string | null
  readonly relativePath: string
  readonly localPath?: string | null
  readonly remotePathHint?: string | null
  readonly message?: string | null
  readonly attemptCount?: number
  readonly nextRetryAt?: string | null
  readonly completedBytes?: number | null
  readonly totalBytes?: number | null
  readonly remoteItemKind?: "file" | "folder" | null
  readonly source?: "local" | "remote" | "initialization" | "manual"
  readonly snapshotPath?: string | null
  readonly snapshotHash?: string | null
  readonly snapshotSize?: number | null
  readonly snapshotMtimeMs?: number | null
  readonly completedRemoteMutations?: readonly DriveChangeDto["type"][]
}

export interface DriveSyncRecordConflictInput {
  readonly bindingId: string
  readonly driveItemId?: string | null
  readonly relativePath: string
  readonly localPath?: string | null
  readonly remotePathHint?: string | null
  readonly type: DriveSyncConflictEntryV1["type"]
  readonly localSnapshot?: Record<string, unknown> | null
  readonly remoteSnapshot?: Record<string, unknown> | null
}

export interface DriveSyncSetHealthInput {
  readonly health: DriveSyncStateEntryV1["health"]
  readonly lastCursor?: string | null
  readonly lastError?: string | null
}

type DriveSyncServiceEvents = {
  changed: [snapshot: DriveSyncSnapshotDto]
}

const LOCAL_ROOT_MISSING_ERROR = "本地路径不存在。"
const LOCAL_ROOT_INACCESSIBLE_ERROR = "本地路径无法访问。"
const DEFAULT_REMOTE_POLL_INTERVAL_MS = 30_000
const SNAPSHOT_GLOBAL_OPERATION_LIMIT = 20
const SNAPSHOT_BINDING_OPERATION_LIMIT = 20
const OPERATION_HISTORY_LIMIT_PER_BINDING = SNAPSHOT_BINDING_OPERATION_LIMIT * 5
const INITIAL_TRANSFER_PREVIEW_ENTRY_LIMIT = 200
const LEGACY_OWNER_ID = "drive-sync:legacy-test-owner"
const RETRY_MAX_DELAY_MS = 5 * 60_000

class TypedDriveSyncEventEmitter extends EventEmitter {
  override on<K extends keyof DriveSyncServiceEvents>(
    eventName: K,
    listener: (...args: DriveSyncServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof DriveSyncServiceEvents>(
    eventName: K,
    ...args: DriveSyncServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

type PendingRemoteEcho = {
  readonly itemId: string
  readonly relativePath: string
  readonly changeTypes: readonly DriveChangeDto["type"][]
  readonly expiresAt: number
}

export function createDriveSyncService(deps: DriveSyncServiceDeps) {
  const events = new TypedDriveSyncEventEmitter()
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = (prefix: string) => deps.createId?.(prefix) ?? `${prefix}:${randomUUID()}`
  const baselineStore = createDriveSyncBaselineStore({ baseline: deps.baseline, now: deps.now })
  const workCoordinator = createDriveSyncWorkCoordinator()
  const activeWorkSignals = new Map<string, AbortSignal>()
  const localWatcher = createDriveSyncWatcher({
    onChanges: handleLocalChanges,
    onRescanRequested: queueBindingCatchUp,
    onFlushError: ({ changes, error }) => {
      void recordLocalChangeFlushError(changes, error)
    },
    onError: ({ bindingId, error }) => {
      void handleLocalWatcherError(bindingId, error)
    },
    watch: deps.watch,
  })
  let remotePollTimer: ReturnType<typeof setInterval> | null = null
  let remotePollIntervalMs = DEFAULT_REMOTE_POLL_INTERVAL_MS
  let remotePollingRequested = false
  let remotePollRunning = false
  let remotePollPromise: Promise<void> | null = null
  const pendingRemoteEchoes = new Map<string, PendingRemoteEcho[]>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const fullRescanBindingIds = new Set<string>()
  let storageReadyPromise: Promise<void> | null = null
  let stopAccountListener: (() => void) | null = null
  let stopBeforeIdentityChangeListener: (() => void) | null = null
  let accountStateChangePromise: Promise<void> = Promise.resolve()

  async function getSnapshot(): Promise<DriveSyncSnapshotDto> {
    await ensureStorageReady()
    const storedState = await deps.state.getSingleton()
    const currentOwner = currentOwnerUserId()
    const ownerUserId = currentOwner ?? (storedState?.schemaVersion === 2 ? storedState.ownerUserId ?? null : null)
    const bindingEntries = (await deps.bindings.list())
      .filter((binding) => binding.status !== "removed" && binding.ownerUserId === ownerUserId)
      .sort(compareUpdatedDesc)
    const visibleBindingIds = new Set(bindingEntries.map((binding) => binding.id))
    const bindings = currentOwner
      ? await Promise.all(bindingEntries.map(toSnapshotBindingDto))
      : bindingEntries.map((entry) => toBindingDto(entry))
    const conflicts = (await deps.conflicts.list())
      .filter((conflict) => conflict.status === "open" && visibleBindingIds.has(conflict.bindingId))
      .sort(compareCreatedAsc)
      .map(toConflictDto)
    const operationEntries = (await deps.operations.list())
      .filter((operation) => visibleBindingIds.has(operation.bindingId))
      .sort(compareUpdatedDesc)
    const operations = selectSnapshotOperations(operationEntries, bindingEntries)
      .map(toOperationDto)
    const ownerState = ownerUserId ? storedState?.healthByOwner?.[ownerUserId] : null
    const state = ownerState
      ? { ...storedState, ...ownerState, ownerUserId } as DriveSyncStateEntryV1
      : await loadState()

    return {
      bindings,
      conflicts,
      operations,
      health: {
        status: state.health,
        connectivity: isCurrentAccountOnline() ? "online" : "offline",
        readOnly: currentOwner === null || !isCurrentAccountOnline(),
        lastError: state.lastError,
        updatedAt: state.updatedAt,
      },
      summary: {
        activeBindingCount: bindings.filter((binding) => binding.status === "active").length,
        runningOperationCount: operations.filter((operation) => isRunningOperationStatus(operation.status)).length,
        retryWaitingOperationCount: operations.filter((operation) => operation.status === "retry_wait").length,
        conflictCount: conflicts.length,
        errorCount: bindings.filter((binding) => binding.status === "error").length,
      },
    }
  }

  function currentAccountState(): SynapseAccountState {
    return deps.accountService.getState?.() ?? {
      status: "authenticated",
      connectivity: "online",
      profile: {
        user: { id: LEGACY_OWNER_ID, email: "", handle: "", status: "active" },
        syncedAt: timestamp(),
      },
    }
  }

  function currentOwnerUserId(): string | null {
    const state = currentAccountState()
    return state.status === "authenticated" ? state.profile.user.id : null
  }

  function requireOnlineOwnerUserId(): string {
    const state = currentAccountState()
    if (state.status !== "authenticated") throw new Error("请先登录后再创建同步。")
    if (state.connectivity !== "online") throw new Error("当前处于离线状态，恢复连接后再创建同步。")
    return state.profile.user.id
  }

  function isCurrentAccountOnline(): boolean {
    const state = currentAccountState()
    return state.status === "authenticated" && state.connectivity === "online"
  }

  async function listOwnerBindings(): Promise<DriveSyncBindingEntryV1[]> {
    const ownerUserId = currentOwnerUserId()
    if (!ownerUserId) return []
    return (await deps.bindings.list()).filter((binding) =>
      binding.schemaVersion === 3 && binding.ownerUserId === ownerUserId,
    )
  }

  async function ensureStorageReady(): Promise<void> {
    storageReadyPromise ??= migrateLegacyStorage()
    await storageReadyPromise
  }

  async function migrateLegacyStorage(): Promise<void> {
    const bindingRows = await deps.bindings.list()
    const baselineRows = await deps.baseline.list()
    const operationRows = await deps.operations.list()
    const conflictRows = await deps.conflicts.list()
    const state = await deps.state.getSingleton()
    const hasLegacy = [bindingRows, baselineRows, operationRows, conflictRows]
      .some((entries) => entries.some((entry) => entry.schemaVersion === 1))
      || state?.schemaVersion === 1
    if (!hasLegacy) return
    await Promise.all([
      ...bindingRows.map((entry) => deps.bindings.remove(entry.id)),
      ...baselineRows.map((entry) => deps.baseline.remove(entry.id)),
      ...operationRows.map((entry) => deps.operations.remove(entry.id)),
      ...conflictRows.map((entry) => deps.conflicts.remove(entry.id)),
    ])
    await deps.state.setSingleton(defaultState(timestamp()))
    if (deps.stagingRootPath) await rm(deps.stagingRootPath, { recursive: true, force: true })
  }

  async function toSnapshotBindingDto(entry: DriveSyncBindingEntryV1): Promise<DriveSyncBindingDto> {
    if (entry.status !== "active") return toBindingDto(entry)
    const rootBaseline = (await baselineStore.listByBinding(entry.id))
      .find((baseline) => baseline.relativePath === "")
    if (!rootBaseline) return toBindingDto(entry)
    if (rootBaseline.deletedAt !== null) {
      return toBindingDto(entry, { status: "error", lastError: "同步根对象已删除。" })
    }

    const localIssue = await inspectLocalRootIssue(entry)
    if (localIssue) {
      await markBindingError(entry.id, localIssue, { emitChanged: false })
      return toBindingDto(entry, { status: "error", lastError: localIssue })
    }

    return toBindingDto(entry)
  }

  async function createBinding(input: DriveSyncCreateBindingInternalInput): Promise<DriveSyncBindingDto> {
    await ensureStorageReady()
    const ownerUserId = requireOnlineOwnerUserId()
    const localPath = normalizeLocalPath(preserveRequiredString(input.localPath, "本地路径不能为空。"))
    const driveItemId = normalizeRequiredString(input.driveItemId, "云盘条目不能为空。")
    const driveItemName = preserveRequiredString(input.driveItemName, "云盘条目名称不能为空。")
    if (input.kind !== "file" && input.kind !== "folder") throw new Error("云盘条目类型无效。")
    if (!input.skipLocalAuthorization) {
      await authorizeLocalPath({
        action: "fs.read.outside-userdata",
        localPath,
        source: "driveSync.createBinding",
        metadata: {
          driveItemId,
          driveItemName,
          direction: "bind_existing",
          kind: input.kind,
        },
      })
    }

    const activeBindings = (await listOwnerBindings()).filter((binding) => binding.status !== "removed")
    if (activeBindings.some((binding) => binding.driveItemId === driveItemId)) {
      throw new Error("云盘条目已绑定。")
    }
    if (await hasOverlappingLocalBinding(activeBindings, localPath)) {
      throw new Error("本地路径已绑定。")
    }

    const now = timestamp()
    const entry: DriveSyncBindingEntryV1 = {
      id: createId("drive-sync-binding"),
      schemaVersion: 3,
      ownerUserId,
      initialDirection: input.initialDirection ?? "bind_existing",
      initialPhase: input.initialPhase ?? null,
      initialCursor: input.initialCursor ?? null,
      driveItemId,
      remoteParentId: input.remoteParentId ?? null,
      driveItemName,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath,
      status: input.initialStatus ?? "active",
      remoteCursor: input.remoteCursor ?? null,
      lastSyncedAt: null,
      lastError: null,
      excludeRules: createBindingExcludeRules(input.excludeRules ?? [], input.importedGitignoreRules ?? [], input.useDefaultExcludes),
      createdAt: now,
      updatedAt: now,
    }

    await deps.bindings.upsert(entry)
    await ensureStoredOwnerState(ownerUserId)
    if (!input.deferWatcher) await reconcileLocalWatcher()
    await emitChanged()
    return toBindingDto(entry)
  }

  async function updateBindingStatus(
    id: string,
    status: DriveSyncBindingStatus,
    lastError: string | null = null,
  ): Promise<DriveSyncBindingDto> {
    const existing = await requireBinding(id)
    const entry: DriveSyncBindingEntryV1 = {
      ...existing,
      status,
      lastError: sanitizeNullableDriveSyncMessage(lastError),
      updatedAt: timestamp(),
    }
    await deps.bindings.upsert(entry)
    await reconcileLocalWatcher()
    await emitChanged()
    return toBindingDto(entry)
  }

  async function removeBinding(id: string): Promise<void> {
    await workCoordinator.cancelAndRun(id, async () => {
      await clearBindingState(id)
      await updateBindingStatus(id, "removed")
    })
  }

  async function discardBinding(id: string): Promise<void> {
    await clearBindingState(id)
    await deps.bindings.remove(id)
    await reconcileLocalWatcher()
    await emitChanged()
  }

  async function clearBindingState(id: string): Promise<void> {
    clearBindingRetry(id)
    await baselineStore.removeBinding(id)
    const [operations, conflicts] = await Promise.all([
      deps.operations.list({ bindingId: id }),
      deps.conflicts.list({ bindingId: id }),
    ])
    await Promise.all(operations
      .map((operation) => operation.snapshotPath)
      .filter((snapshotPath): snapshotPath is string => Boolean(snapshotPath))
      .map((snapshotPath) => removeManagedSnapshot(snapshotPath, deps.stagingRootPath)))
    await Promise.all([
      ...operations.map((operation) => deps.operations.remove(operation.id)),
      ...conflicts.map((conflict) => deps.conflicts.remove(conflict.id)),
    ])
    pendingRemoteEchoes.delete(id)
    if (deps.stagingRootPath) {
      await rm(path.join(deps.stagingRootPath, safeStagingSegment(id)), { recursive: true, force: true })
    }
  }

  async function pauseBinding(id: string): Promise<DriveSyncBindingDto> {
    clearBindingRetry(id)
    return workCoordinator.cancelAndRun(id, () => updateBindingStatus(id, "paused"))
  }

  async function resumeBinding(id: string): Promise<DriveSyncBindingDto> {
    return runBindingActionSingleFlight(id, async () => {
      const binding = await requireBinding(id)
      const ready = await ensureBindingRootReady(binding, { checkRemote: true, throwOnIssue: true })
      if (!ready) return toBindingDto(await requireBinding(id))
      if (binding.initialPhase !== null) {
        await updateBindingStatus(id, "initializing")
        await resumeInitializingBinding(await requireBinding(id))
        return toBindingDto(await requireBinding(id))
      }
      await updateBindingStatus(id, "active")
      await catchUpBinding(await requireBinding(id), true)
      return toBindingDto(await requireBinding(id))
    })
  }

  async function updateExcludeRules(input: {
    readonly id: string
    readonly defaults: readonly string[]
    readonly importedGitignore: readonly string[]
    readonly user: readonly string[]
  }): Promise<DriveSyncBindingDto> {
    return runBindingActionSingleFlight(input.id, async () => {
      const binding = await requireBinding(input.id)
      const entry: DriveSyncBindingEntryV1 = {
        ...binding,
        excludeRules: {
          ...binding.excludeRules,
          defaults: [...input.defaults],
          importedGitignore: [...input.importedGitignore],
          user: [...input.user],
        },
        updatedAt: timestamp(),
      }
      const reIncludedPaths = binding.kind === "folder"
        ? await findReIncludedPaths(binding, entry)
        : []
      await deps.bindings.upsert(entry)
      const baselines = await baselineStore.listByBinding(input.id)
      await Promise.all(baselines
        .filter((baseline) => baseline.relativePath && isDriveSyncExcluded(baseline.relativePath, entry.excludeRules, baseline.kind))
        .map((baseline) => baselineStore.removePath(input.id, baseline.relativePath)))
      await reconcileLocalWatcher()
      if (reIncludedPaths.length > 0) {
        await fullRescanBinding(entry)
        return toBindingDto(await requireBinding(entry.id))
      }
      await emitChanged()
      return toBindingDto(entry)
    })
  }

  async function findReIncludedPaths(
    previous: DriveSyncBindingEntryV1,
    next: DriveSyncBindingEntryV1,
  ): Promise<readonly string[]> {
    const localEntries = await scanDriveSyncLocalTree({
      rootPath: next.localPath,
      rules: next.excludeRules,
      hashFiles: false,
    })
    const remoteEntries = await listAllRemoteTreeEntries(next.driveItemId)
    const candidates = [
      ...localEntries.map((entry) => ({ relativePath: entry.relativePath, kind: entry.kind })),
      ...remoteEntries.map((entry) => ({
        relativePath: normalizeRemoteTreePath(entry.path, next.driveItemName, next.drivePathHint),
        kind: entry.type,
      })),
    ]
    return [...new Set(candidates
      .filter((candidate) => candidate.relativePath
        && isDriveSyncExcluded(candidate.relativePath, previous.excludeRules, candidate.kind)
        && !isDriveSyncExcluded(candidate.relativePath, next.excludeRules, candidate.kind))
      .map((candidate) => candidate.relativePath))]
      .sort((left, right) => left.localeCompare(right))
  }

  async function rescanBinding(id: string): Promise<void> {
    await runBindingActionSingleFlight(id, async () => {
      const binding = await requireBinding(id)
      await assertBindingRootReady(binding, { checkRemote: true })
      await fullRescanBinding(binding)
    })
  }

  async function pollRemoteChanges(id?: string): Promise<void> {
    if (id) {
      await runBindingActionSingleFlight(id, async () => {
        const binding = await requireBinding(id)
        await assertBindingRootReady(binding, { checkRemote: true })
        if (!isAutomaticallySyncableBinding(binding)) return
        await catchUpBinding(binding, true)
      })
      return
    }

    if (!isCurrentAccountOnline()) return
    const bindings = (await listOwnerBindings()).filter(isAutomaticallySyncableBinding)
    const results = await Promise.allSettled(bindings.map((binding) =>
      runBindingActionSingleFlight(binding.id, async () => {
        const current = await requireBinding(binding.id)
        if (!isAutomaticallySyncableBinding(current)) return
        await catchUpBinding(current, false)
      }),
    ))
    const failures: unknown[] = []
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") continue
      failures.push(result.reason)
      const binding = bindings[index]
      if (!binding) continue
      if (isRetryableSyncError(result.reason)) {
        await ensureBindingRetryForError(binding.id, result.reason, false)
      } else {
        await markBindingError(binding.id, errorMessage(result.reason), { emitChanged: false }).catch(() => undefined)
      }
    }
    if (failures.length > 0) throw failures[0]
    if (bindings.length > 0) {
      await setHealth({ health: "idle", lastError: null })
    }
  }

  async function pollActiveBindingRemoteChanges(binding: DriveSyncBindingEntryV1, throwOnRootIssue: boolean): Promise<void> {
    const rootReady = await ensureBindingRootReady(binding, {
      checkRemote: true,
      throwOnIssue: throwOnRootIssue,
    })
    if (!rootReady) return
    const baseline = await baselineStore.listByBinding(binding.id)
    let localChanges: readonly DriveSyncLocalChange[]
    try {
      localChanges = await localWatcher.scanBinding({ binding, baseline })
    } catch (error) {
      const message = `本地变更扫描失败：${errorMessage(error)}`
      await markBindingError(binding.id, message, { emitChanged: true })
      if (throwOnRootIssue) throw new Error(message, { cause: error })
      return
    }
    const openConflictPaths = await listOpenConflictPaths(binding.id)
    const localChangedPaths = new Set([
      ...localChanges.map((change) => change.relativePath),
      ...openConflictPaths,
    ])
    if (await handleMissingFileBindingRoot({ binding, baseline, localChangedPaths })) return
    await pollDriveSyncRemoteChanges({
      binding,
      baseline,
      accountService: deps.accountService,
      onOperations: (operations) => executePlannedOperations(operations, { throwOnError: true }),
      onConflicts: recordPlannedConflicts,
      updateBindingCursor,
      localChangedPaths,
      shouldIgnoreChange: (change, relativePath) => consumePendingRemoteEcho(binding.id, change, relativePath),
    })
  }

  async function catchUpBinding(binding: DriveSyncBindingEntryV1, throwOnRootIssue: boolean): Promise<void> {
    await pollActiveBindingRemoteChanges(binding, throwOnRootIssue)
    const current = await requireBinding(binding.id)
    if (!isAutomaticallySyncableBinding(current)) return
    await scanBindingForLocalChanges(current, { throwOnScanError: throwOnRootIssue })
  }

  function queueBindingCatchUp(bindingId: string): void {
    void runBindingActionSingleFlight(bindingId, async () => {
      const binding = await requireBinding(bindingId)
      if (!isAutomaticallySyncableBinding(binding) || !isCurrentAccountOnline()) return
      await catchUpBinding(binding, false)
    }).catch(async (error) => {
      if (isRetryableSyncError(error)) {
        await ensureBindingRetryForError(bindingId, error, false)
        return
      }
      await markBindingError(bindingId, errorMessage(error), { emitChanged: true })
    })
  }

  function startRemotePolling(intervalMs: number = DEFAULT_REMOTE_POLL_INTERVAL_MS): void {
    remotePollIntervalMs = intervalMs
    remotePollingRequested = true
    if (!isCurrentAccountOnline()) return
    armRemotePolling()
  }

  function armRemotePolling(): void {
    if (!remotePollingRequested || remotePollTimer !== null) return
    remotePollTimer = setInterval(() => {
      queueBackgroundRemotePoll()
    }, remotePollIntervalMs)
  }

  function suspendRemotePolling(): void {
    if (remotePollTimer === null) return
    clearInterval(remotePollTimer)
    remotePollTimer = null
  }

  async function startLocalWatcher(): Promise<void> {
    await ensureStorageReady()
    stopBeforeIdentityChangeListener ??= deps.accountService.onBeforeIdentityChange?.(async () => {
      suspendRemotePolling()
      localWatcher.stop()
      clearAllRetries()
      await workCoordinator.cancelAllAndWait()
    }) ?? null
    stopAccountListener ??= deps.accountService.onStateChanged?.(() => {
      queueAccountStateChanged()
    }) ?? null
    await recoverInterruptedOperations()
    await reconcileLocalWatcher()
    if (isCurrentAccountOnline()) await rescanActiveBindingsAfterWatcherStart()
  }

  async function stopRemotePolling(): Promise<void> {
    remotePollingRequested = false
    suspendRemotePolling()
    await remotePollPromise
  }

  function queueBackgroundRemotePoll(): void {
    if (remotePollPromise) return
    const ownerUserId = currentOwnerUserId()
    remotePollPromise = runBackgroundRemotePoll(ownerUserId).finally(() => {
      remotePollPromise = null
    })
    void remotePollPromise
  }

  async function runBackgroundRemotePoll(ownerUserId: string | null): Promise<void> {
    if (!ownerUserId || currentOwnerUserId() !== ownerUserId) return
    if (remotePollRunning) return
    remotePollRunning = true
    try {
      await pollRemoteChanges()
    } catch (error) {
      if (currentOwnerUserId() !== ownerUserId) return
      await setHealth({
        health: isRetryableSyncError(error) ? "retrying" : "error",
        lastError: errorMessage(error),
      })
    } finally {
      remotePollRunning = false
    }
  }

  async function stopLocalWatcher(): Promise<void> {
    stopAccountListener?.()
    stopAccountListener = null
    stopBeforeIdentityChangeListener?.()
    stopBeforeIdentityChangeListener = null
    await accountStateChangePromise
    await workCoordinator.cancelAllAndWait()
    localWatcher.stop()
    clearAllRetries()
  }

  function queueAccountStateChanged(): void {
    accountStateChangePromise = accountStateChangePromise
      .catch(() => undefined)
      .then(handleAccountStateChanged)
      .catch(async (error) => {
        if (isCurrentAccountOnline()) {
          await setHealth({
            health: isRetryableSyncError(error) ? "retrying" : "error",
            lastError: errorMessage(error),
          })
          return
        }
        await emitChanged()
      })
  }

  async function handleAccountStateChanged(): Promise<void> {
    suspendRemotePolling()
    localWatcher.stop()
    clearAllRetries()
    await remotePollPromise
    await workCoordinator.cancelAllAndWait()
    if (!isCurrentAccountOnline()) {
      await emitChanged()
      return
    }
    await setHealth({ health: "idle", lastError: null })
    await recoverInterruptedOperations()
    await reconcileLocalWatcher()
    await pollRemoteChanges().catch(async (error) => {
      await setHealth({ health: "retrying", lastError: errorMessage(error) })
    })
    await rescanActiveBindingsAfterWatcherStart()
    armRemotePolling()
  }

  async function handleLocalWatcherError(bindingId: string, error: unknown): Promise<void> {
    const hasRootConflict = (await deps.conflicts.list({ bindingId })).some((conflict) =>
      conflict.status === "open" && conflict.relativePath === "" && conflict.type === "delete_vs_modify",
    )
    if (hasRootConflict) return
    await updateBindingStatus(bindingId, "error", `本地路径监听失败：${errorMessage(error)}`)
  }

  async function resolveConflict(input: DriveSyncConflictResolutionInput): Promise<void> {
    const conflict = await deps.conflicts.get(input.conflictId)
    if (!conflict || conflict.status !== "open") throw new Error("同步冲突不存在。")
    await runBindingActionSingleFlight(conflict.bindingId, async () => {
      const currentConflict = await deps.conflicts.get(input.conflictId)
      if (!currentConflict || currentConflict.status !== "open") throw new Error("同步冲突不存在。")
      if (input.action === "skip") {
        await emitChanged()
        return
      }
      const refreshedConflict = await refreshConflictBeforeResolution(currentConflict)
      const bindingRemoved = await applyConflictResolution(refreshedConflict, input.action)
      if (bindingRemoved) return
      const resolved: DriveSyncConflictEntryV1 = {
        ...refreshedConflict,
        status: "resolved",
        resolution: input.action,
        resolvedAt: timestamp(),
      }
      await deps.conflicts.upsert(resolved)
      await updateBindingStatusAfterConflictResolution(currentConflict.bindingId)
      await emitChanged()
    })
  }

  async function refreshConflictBeforeResolution(
    conflict: DriveSyncConflictEntryV1,
  ): Promise<DriveSyncConflictEntryV1> {
    const binding = await requireBinding(conflict.bindingId)
    const currentLocalPath = conflictLocalPath(binding, conflict)
    const local = await inspectDriveSyncLocalPath(currentLocalPath)
    let remote: DriveItemDto | null = null
    const remoteChecked = Boolean(conflict.driveItemId && deps.accountService.getDriveItem)
    if (conflict.driveItemId && deps.accountService.getDriveItem) {
      try {
        remote = await deps.accountService.getDriveItem(conflict.driveItemId)
      } catch (error) {
        if (!isRemoteNotFoundError(error)) throw error
      }
    }
    const localKind = local.kind === "file" || local.kind === "folder" ? local.kind : null
    const localStats = localKind ? await lstat(currentLocalPath) : null
    const refreshedLocalSnapshot = localKind
      ? {
          exists: true,
          itemKind: localKind,
          pathHint: conflict.relativePath,
          size: localKind === "file" ? localStats?.size ?? null : null,
          mtimeMs: localStats?.mtimeMs ?? null,
          hash: localKind === "file" ? await hashDriveSyncFile(currentLocalPath) : null,
        }
      : null
    const refreshedRemoteSnapshot = remoteChecked
      ? remote
        ? {
            exists: true,
            itemKind: remote.type,
            pathHint: conflict.remotePathHint,
            size: remote.size,
            name: remote.name,
            parentId: remote.parentId,
            updatedAt: remote.updatedAt,
          }
        : null
      : conflict.remoteSnapshot
    const changed = conflictSnapshotChanged(conflict.localSnapshot, refreshedLocalSnapshot)
      || (remoteChecked && conflictSnapshotChanged(conflict.remoteSnapshot, refreshedRemoteSnapshot))
    const refreshed: DriveSyncConflictEntryV1 = {
      ...conflict,
      localSnapshot: refreshedLocalSnapshot,
      remoteSnapshot: refreshedRemoteSnapshot,
    }
    await deps.conflicts.upsert(refreshed)
    if (changed) {
      await emitChanged()
      throw new Error("冲突内容已变化，请重新确认处理方式。")
    }
    return refreshed
  }

  async function previewBinding(input: Omit<DriveSyncCreateSafeBindingInput, "direction"> & {
    readonly remoteExists: boolean
    readonly directionHint?: DriveSyncCreateSafeBindingInput["direction"] | null
  }): Promise<DriveSyncBindingPreviewDto> {
    await authorizeLocalPath({
      action: input.directionHint === "remote_to_local" ? "fs.write.outside-userdata" : "fs.read.outside-userdata",
      localPath: input.localPath,
      source: "driveSync.previewBinding",
      metadata: {
        direction: input.directionHint ?? null,
        driveItemId: input.driveItemId,
        driveItemName: input.driveItemName,
        kind: input.kind,
      },
    })
    const remoteItem = input.remoteExists ? await getDriveItemFromAccountService(deps.accountService, input.driveItemId) : null
    const activeBindings = await listOwnerBindings()
    const remoteOverlapReason = input.remoteExists
      ? await findRemoteBindingOverlapReason(input.driveItemId, activeBindings)
      : null
    const preview = await previewDriveSyncBinding({
      ...input,
      remoteSize: remoteItem?.size ?? null,
      activeBindings,
    })
    if (remoteOverlapReason) {
      return {
        ...preview,
        status: "blocked",
        direction: null,
        reason: remoteOverlapReason,
      }
    }
    if (preview.status !== "blocked" && input.directionHint === "local_to_remote") {
      try {
        await assertNoRemoteUploadRootConflict(input.targetParentId ?? null, input.driveItemName)
      } catch (error) {
        return {
          ...preview,
          status: "blocked",
          direction: null,
          reason: errorMessage(error),
        }
      }
    }
    if (
      preview.status === "ready"
      && preview.direction === "bind_existing"
      && input.kind === "folder"
      && remoteItem?.type === "folder"
    ) {
      const { differences } = await compareExistingFolderTree({
        driveItemId: input.driveItemId,
        driveItemName: remoteItem.name,
        drivePathHint: input.drivePathHint ?? null,
        localPath: input.localPath,
        excludeRules: createBindingExcludeRules(input.excludeRules ?? [], preview.importedGitignoreRules, input.useDefaultExcludes),
        hashFiles: false,
      })
      if (differences.length > 0) {
        return {
          ...preview,
          status: "blocked",
          direction: null,
          reason: formatFolderDifferenceReason(differences),
        }
      }
    }
    if (preview.status === "blocked" || preview.direction === null) return preview
    try {
      return {
        ...preview,
        initialTransfer: await buildInitialTransferPreview(input, preview, remoteItem),
      }
    } catch (error) {
      return {
        ...preview,
        status: "blocked",
        direction: null,
        reason: errorMessage(error),
        initialTransfer: null,
      }
    }
  }

  async function createSafeBinding(input: DriveSyncCreateSafeBindingInput): Promise<DriveSyncBindingDto> {
    await authorizeLocalPath({
      action: input.direction === "remote_to_local" ? "fs.write.outside-userdata" : "fs.read.outside-userdata",
      localPath: input.localPath,
      source: "driveSync.createSafeBinding",
      metadata: {
        direction: input.direction,
        driveItemId: input.driveItemId,
        driveItemName: input.driveItemName,
        kind: input.kind,
      },
    })
    if (input.direction === "bind_existing") {
      return createBindExistingBinding(input)
    }
    const importedGitignoreRules = await readBindingImportedGitignoreRules(input)
    if (input.kind === "folder" && input.direction === "local_to_remote") {
      await assertLocalFolderTreeFullySyncable(input.localPath, createBindingExcludeRules(input.excludeRules ?? [], importedGitignoreRules, input.useDefaultExcludes))
    }
    if (input.direction === "local_to_remote") {
      await assertNoRemoteUploadRootConflict(input.targetParentId ?? null, input.driveItemName)
    }
    if (input.direction === "remote_to_local") {
      await assertRemoteToLocalTargetStillSafe(input)
      if (input.kind === "folder") {
        await assertRemoteFolderTreeLocallyRepresentable({
          driveItemId: input.driveItemId,
          driveItemName: input.driveItemName,
          drivePathHint: input.drivePathHint ?? null,
          excludeRules: createBindingExcludeRules(input.excludeRules ?? [], importedGitignoreRules, input.useDefaultExcludes),
        })
      }
    }
    const initialRemoteCursor = input.direction === "remote_to_local" ? await currentRemoteCursor() : null
    const remoteParentId = input.direction === "local_to_remote"
      ? input.targetParentId ?? null
      : (await getDriveItemFromAccountService(deps.accountService, input.driveItemId)).parentId

    let binding = await createBinding({
      driveItemId: input.driveItemId,
      driveItemName: input.driveItemName,
      remoteParentId,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath: input.localPath,
      excludeRules: input.excludeRules ?? [],
      importedGitignoreRules,
      useDefaultExcludes: input.useDefaultExcludes,
      initialDirection: input.direction,
      initialCursor: initialRemoteCursor,
      initialPhase: "transfer",
      initialStatus: "initializing",
      deferWatcher: true,
      skipLocalAuthorization: true,
    })

    try {
      await runBindingActionSingleFlight(binding.id, async () => {
        if (input.kind === "file" && input.direction === "remote_to_local") {
          await downloadInitialFile(binding)
        } else if (input.kind === "file" && input.direction === "local_to_remote") {
          binding = await updateBindingDriveItemId(binding.id, await uploadInitialFile(binding, input.targetParentId ?? null))
        } else if (input.kind === "folder" && input.direction === "remote_to_local") {
          await downloadInitialFolder(binding, input.drivePathHint ?? null)
        } else if (input.kind === "folder" && input.direction === "local_to_remote") {
          binding = await updateBindingDriveItemId(binding.id, await uploadInitialFolder(binding, input.targetParentId ?? null, input.drivePathHint ?? null))
        }
        if (input.direction === "remote_to_local") {
          await updateBindingInitialization(binding.id, "replay", initialRemoteCursor)
          await replayInitialRemoteChanges(binding.id, initialRemoteCursor)
          binding = await activateBindingAfterInitialReplay(binding.id)
        } else {
          binding = await activateBindingAtCurrentRemoteCursor(binding.id)
        }
      })
      return binding
    } catch (error) {
      const message = errorMessage(error)
      const currentBinding = await deps.bindings.get(binding.id) ?? binding
      const rollbackUnfinishedLocalUpload = input.direction === "local_to_remote" && currentBinding.driveItemId === input.driveItemId
      const initializationOperation = (await deps.operations.list({ bindingId: currentBinding.id }))
        .filter((operation) => operation.status === "running" && operation.source === "initialization")
        .sort(compareUpdatedDesc)[0]
      await recordOperation({
        id: initializationOperation?.id,
        bindingId: currentBinding.id,
        kind: input.direction === "remote_to_local" ? "download" : "upload",
        status: "error",
        driveItemId: rollbackUnfinishedLocalUpload ? null : currentBinding.driveItemId,
        relativePath: "",
        localPath: input.localPath,
        remotePathHint: input.drivePathHint ?? null,
        message,
      })
      if (rollbackUnfinishedLocalUpload) {
        await discardBinding(currentBinding.id)
        throw new Error(message, { cause: error })
      }
      return await updateBindingStatus(currentBinding.id, "error", message)
    }
  }

  async function findRemoteBindingOverlapReason(
    driveItemId: string,
    activeBindings: readonly DriveSyncBindingEntryV1[],
  ): Promise<string | null> {
    const active = activeBindings.filter((binding) => binding.status !== "removed")
    if (active.some((binding) => binding.driveItemId === driveItemId)) return "云盘条目已绑定。"
    if (active.length === 0) return null

    const candidateAncestors = await collectRemoteAncestorIds(driveItemId)
    if (active.some((binding) => candidateAncestors.has(binding.driveItemId))) {
      return "云盘条目位于已同步的云盘文件夹内。"
    }

    for (const binding of active) {
      const boundAncestors = await collectRemoteAncestorIds(binding.driveItemId)
      if (boundAncestors.has(driveItemId)) return "云盘条目包含已同步的云盘条目。"
    }
    return null
  }

  async function hasOverlappingLocalBinding(
    activeBindings: readonly DriveSyncBindingEntryV1[],
    localPath: string,
  ): Promise<boolean> {
    for (const binding of activeBindings) {
      if (await localPathIdentitiesOverlap(binding.localPath, localPath)) return true
    }
    return false
  }

  async function collectRemoteAncestorIds(driveItemId: string): Promise<ReadonlySet<string>> {
    const ancestors = new Set<string>()
    let currentId: string | null = driveItemId
    while (currentId && !ancestors.has(currentId)) {
      ancestors.add(currentId)
      const item = await getDriveItemFromAccountService(deps.accountService, currentId)
      currentId = item.parentId ?? null
    }
    return ancestors
  }

  async function assertRemoteToLocalTargetStillSafe(input: DriveSyncCreateSafeBindingInput): Promise<void> {
    const remoteItem = await getDriveItemFromAccountService(deps.accountService, input.driveItemId)
    if (remoteItem.type !== input.kind) throw new Error("云盘条目类型与绑定类型不一致。")
    const activeBindings = await listOwnerBindings()
    const remoteOverlapReason = await findRemoteBindingOverlapReason(input.driveItemId, activeBindings)
    if (remoteOverlapReason) throw new Error(remoteOverlapReason)
    const preview = await previewDriveSyncBinding({
      ...input,
      remoteExists: true,
      remoteSize: remoteItem.size,
      directionHint: "remote_to_local",
      activeBindings,
    })
    if (preview.status !== "ready" || preview.direction !== "remote_to_local") {
      throw new Error(preview.reason ?? "本地路径已变化，请重新校验后再同步。")
    }
  }

  async function createBindExistingBinding(input: DriveSyncCreateSafeBindingInput): Promise<DriveSyncBindingDto> {
    const remoteItem = await getDriveItemFromAccountService(deps.accountService, input.driveItemId)
    if (remoteItem.type !== input.kind) throw new Error("云盘条目类型与绑定类型不一致。")
    const activeBindings = await listOwnerBindings()
    const remoteOverlapReason = await findRemoteBindingOverlapReason(input.driveItemId, activeBindings)
    if (remoteOverlapReason) throw new Error(remoteOverlapReason)
    const preview = await previewDriveSyncBinding({
      ...input,
      remoteExists: true,
      remoteSize: remoteItem.size,
      directionHint: input.direction,
      activeBindings,
    })
    if (preview.status !== "ready" || preview.direction !== "bind_existing") {
      throw new Error(preview.reason ?? "本地路径不能和已有云盘条目建立绑定。")
    }

    const initialCursor = await currentRemoteCursor()
    const binding = await createBinding({
      driveItemId: input.driveItemId,
      driveItemName: input.driveItemName,
      remoteParentId: remoteItem.parentId,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath: input.localPath,
      excludeRules: input.excludeRules ?? [],
      importedGitignoreRules: preview.importedGitignoreRules,
      useDefaultExcludes: input.useDefaultExcludes,
      initialDirection: input.direction,
      initialCursor,
      initialPhase: "transfer",
      initialStatus: "initializing",
      deferWatcher: true,
      skipLocalAuthorization: true,
    })
    const operation = await recordOperation({
      bindingId: binding.id,
      kind: "scan",
      status: "running",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      source: "initialization",
      message: "正在校验本地与云盘内容。",
    })
    try {
      const prepared = input.kind === "file"
        ? await prepareExistingFileBaseline(input.localPath, remoteItem.id, binding.id)
        : await prepareExistingFolderBaselines({
          bindingId: binding.id,
          driveItemId: input.driveItemId,
          driveItemName: remoteItem.name,
          drivePathHint: input.drivePathHint ?? null,
          localPath: input.localPath,
          excludeRules: createBindingExcludeRules(input.excludeRules ?? [], preview.importedGitignoreRules, input.useDefaultExcludes),
        })
      for (const entry of prepared) {
        await baselineStore.upsert({ ...entry, bindingId: binding.id })
      }
      await recordOperation({
        id: operation.id,
        bindingId: binding.id,
        kind: "scan",
        status: "succeeded",
        driveItemId: binding.driveItemId,
        relativePath: "",
        localPath: binding.localPath,
        source: "initialization",
        message: null,
      })
      await updateBindingInitialization(binding.id, "replay", initialCursor)
      await replayInitialRemoteChanges(binding.id, initialCursor)
      return await activateBindingAfterInitialReplay(binding.id)
    } catch (error) {
      await discardBinding(binding.id)
      throw error
    }
  }

  async function activateBindingAtCurrentRemoteCursor(bindingId: string): Promise<DriveSyncBindingDto> {
    await updateBindingCursor(bindingId, await currentRemoteCursor())
    await updateBindingInitialization(bindingId, null, null)
    return updateBindingStatus(bindingId, "active")
  }

  async function replayInitialRemoteChanges(bindingId: string, cursor: string | null): Promise<void> {
    await updateBindingCursor(bindingId, cursor)
    await pollActiveBindingRemoteChanges(await requireBinding(bindingId), true)
  }

  async function activateBindingAfterInitialReplay(bindingId: string): Promise<DriveSyncBindingDto> {
    const binding = await requireBinding(bindingId)
    if (binding.status === "conflict" || binding.status === "error") return toBindingDto(binding)
    await updateBindingInitialization(bindingId, null, null)
    return updateBindingStatus(bindingId, "active")
  }

  async function updateBindingInitialization(
    bindingId: string,
    initialPhase: DriveSyncBindingEntryV1["initialPhase"],
    initialCursor: string | null,
  ): Promise<void> {
    const binding = await requireBinding(bindingId)
    await deps.bindings.upsert({
      ...binding,
      initialPhase,
      initialCursor,
      updatedAt: timestamp(),
    })
    await emitChanged()
  }

  async function currentRemoteCursor(): Promise<string | null> {
    const page = await deps.accountService.listDriveChanges({ cursor: "latest", limit: 1 })
    return page.nextCursor
  }

  async function createVerificationDirectory(bindingId: string): Promise<string> {
    const root = deps.stagingRootPath ?? path.join(os.tmpdir(), "synapse-drive-sync-staging")
    const bindingRoot = path.join(root, safeStagingSegment(bindingId))
    await mkdir(bindingRoot, { recursive: true })
    return mkdtemp(path.join(bindingRoot, "verify-"))
  }

  async function prepareExistingFileBaseline(
    localPath: string,
    remoteItemId: string,
    bindingId: string,
  ): Promise<Array<Omit<Parameters<typeof baselineStore.upsert>[0], "bindingId">>> {
    const remoteBefore = await getDriveItemFromAccountService(deps.accountService, remoteItemId)
    const localBefore = await lstat(localPath)
    if (!localBefore.isFile()) throw new Error("本地条目类型不支持同步。")
    const localHash = await hashDriveSyncFile(localPath)
    const verificationDirectory = await createVerificationDirectory(bindingId)
    try {
      const downloadedPath = path.join(verificationDirectory, "remote-file")
      await deps.accountService.downloadDriveFile({ itemId: remoteItemId, outputPath: downloadedPath, signal: activeWorkSignals.get(bindingId) })
      const remoteHash = await hashDriveSyncFile(downloadedPath)
      const [localAfter, remoteAfter, currentLocalHash] = await Promise.all([
        lstat(localPath),
        getDriveItemFromAccountService(deps.accountService, remoteItemId),
        hashDriveSyncFile(localPath),
      ])
      if (
        !localAfter.isFile()
        || localBefore.size !== localAfter.size
        || localBefore.mtimeMs !== localAfter.mtimeMs
        || localHash !== currentLocalHash
        || remoteBefore.size !== remoteAfter.size
        || remoteBefore.updatedAt !== remoteAfter.updatedAt
      ) throw new Error("校验期间内容发生变化，请重试。")
      if (localHash !== remoteHash) throw new Error("本地与云盘文件内容不一致，无法直接绑定。")
    } finally {
      await rm(verificationDirectory, { recursive: true, force: true })
    }
    return [{
      relativePath: "",
      kind: "file",
      remoteItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: localBefore.size,
      localMtimeMs: localBefore.mtimeMs,
      localHash,
      deletedAt: null,
    }]
  }

  async function prepareExistingFolderBaselines(input: {
    readonly bindingId: string
    readonly driveItemId: string
    readonly driveItemName: string
    readonly drivePathHint?: string | null
    readonly localPath: string
    readonly excludeRules: DriveSyncBindingEntryV1["excludeRules"]
  }): Promise<Array<Omit<Parameters<typeof baselineStore.upsert>[0], "bindingId">>> {
    const initial = await compareExistingFolderTree({
      ...input,
      hashFiles: true,
    })
    if (initial.differences.length > 0) {
      throw new Error(formatFolderDifferenceReason(initial.differences))
    }
    const verificationDirectory = await createVerificationDirectory(input.bindingId)
    try {
      const localFiles = initial.localEntries.filter((entry) => entry.kind === "file")
      await mapWithConcurrency(localFiles, 2, async (local, index) => {
        const remote = initial.remoteByPath.get(local.relativePath)
        if (!remote || local.hash === null) throw new Error("同步校验失败。")
        const downloadedPath = path.join(verificationDirectory, `remote-${index}`)
        try {
          await deps.accountService.downloadDriveFile({ itemId: remote.id, outputPath: downloadedPath, signal: activeWorkSignals.get(input.bindingId) })
          if (await hashDriveSyncFile(downloadedPath) !== local.hash) {
            throw new Error(`本地文件夹与云盘文件夹内容不一致：${local.relativePath} 内容不一致`)
          }
        } finally {
          await rm(downloadedPath, { force: true })
        }
      })
      const current = await compareExistingFolderTree({ ...input, hashFiles: true })
      if (
        current.differences.length > 0
        || folderLocalManifest(initial.localEntries) !== folderLocalManifest(current.localEntries)
        || folderRemoteManifest(initial.remoteByPath) !== folderRemoteManifest(current.remoteByPath)
      ) throw new Error("校验期间内容发生变化，请重试。")
    } finally {
      await rm(verificationDirectory, { recursive: true, force: true })
    }

    return [
      {
        relativePath: "",
        kind: "folder",
        remoteItemId: input.driveItemId,
        remoteVersionId: null,
        remoteEtag: null,
        localSize: null,
        localMtimeMs: null,
        localHash: null,
        deletedAt: null,
      },
      ...initial.localEntries.map((local) => {
        const remote = initial.remoteByPath.get(local.relativePath)
        if (!remote) throw new Error("同步基线生成失败。")
        return {
          relativePath: local.relativePath,
          kind: local.kind,
          remoteItemId: remote.id,
          remoteVersionId: null,
          remoteEtag: null,
          localSize: local.size,
          localMtimeMs: local.mtimeMs,
          localHash: local.hash,
          deletedAt: null,
        }
      }),
    ]
  }

  async function compareExistingFolderTree(input: {
    readonly driveItemId: string
    readonly driveItemName: string
    readonly drivePathHint?: string | null
    readonly localPath: string
    readonly excludeRules: DriveSyncBindingEntryV1["excludeRules"]
    readonly hashFiles: boolean
  }) {
    const localEntries = await scanDriveSyncLocalTree({
      rootPath: input.localPath,
      rules: input.excludeRules,
      hashFiles: input.hashFiles,
    })
    const remoteEntries = await listAllRemoteTreeEntries(input.driveItemId)
    const remoteByPath = new Map(
      remoteEntries
        .map((entry) => [normalizeRemoteTreePath(entry.path, input.driveItemName, input.drivePathHint), entry] as const)
        .filter(([relativePath, entry]) => !isDriveSyncExcluded(relativePath, input.excludeRules, entry.type)),
    )
    const localByPath = new Map(localEntries.map((entry) => [entry.relativePath, entry]))
    assertNoRemoteFolderPathCollisions(remoteEntries, input.driveItemName, input.excludeRules, input.drivePathHint)

    const differences: string[] = []
    for (const local of localEntries) {
      const remote = remoteByPath.get(local.relativePath)
      if (!remote) {
        differences.push(`${local.relativePath} 仅在本地存在`)
        continue
      }
      if (remote.type !== local.kind) {
        differences.push(`${local.relativePath} 类型不一致`)
        continue
      }
      if (local.kind === "file" && String(local.size ?? 0) !== remote.size) {
        differences.push(`${local.relativePath} 大小不一致`)
      }
    }
    for (const [relativePath] of remoteByPath) {
      if (!localByPath.has(relativePath)) differences.push(`${relativePath} 仅在云盘存在`)
    }

    return { differences, localEntries, remoteByPath }
  }

  async function listAllRemoteTreeEntries(parentId: string): Promise<readonly DriveSyncRemoteTreeEntry[]> {
    const entries: DriveSyncRemoteTreeEntry[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const page = await deps.accountService.listDriveItemTree({ parentId, offset, limit: 200 })
      entries.push(...page.items.map(toRemoteTreeEntry))
      offset = page.nextOffset ?? null
    }
    return entries
  }

  async function buildInitialTransferPreview(
    input: Omit<DriveSyncCreateSafeBindingInput, "direction"> & {
      readonly remoteExists: boolean
      readonly directionHint?: DriveSyncCreateSafeBindingInput["direction"] | null
    },
    preview: DriveSyncBindingPreviewDto,
    remoteItem: DriveItemDto | null,
  ): Promise<DriveSyncInitialTransferPreviewDto> {
    if (preview.direction === null || preview.direction === "bind_existing") {
      return summarizeInitialTransferEntries([])
    }

    if (preview.direction === "local_to_remote") {
      if (input.kind === "file") {
        const stats = await lstat(input.localPath)
        return summarizeInitialTransferEntries([{
          action: "upload_file",
          relativePath: ".",
          size: String(stats.size),
        }])
      }
      const snapshot = await scanDriveSyncLocalTreeDetailed({
        rootPath: input.localPath,
        rules: createBindingExcludeRules(input.excludeRules ?? [], preview.importedGitignoreRules, input.useDefaultExcludes),
        hashFiles: false,
      })
      const entries: DriveSyncInitialTransferPreviewEntryDto[] = [{
        action: "create_remote_folder",
        relativePath: ".",
        size: null,
      }, ...snapshot.entries.map((entry) => ({
        action: entry.kind === "file" ? "upload_file" as const : "create_remote_folder" as const,
        relativePath: entry.relativePath,
        size: entry.kind === "file" ? String(entry.size ?? 0) : null,
      }))]
      return summarizeInitialTransferEntries(entries)
    }

    if (!remoteItem) throw new Error("云盘条目不存在。")
    if (input.kind === "file") {
      return summarizeInitialTransferEntries([{
        action: "download_file",
        relativePath: ".",
        size: remoteItem.size,
      }])
    }
    const rules = createBindingExcludeRules(input.excludeRules ?? [], preview.importedGitignoreRules, input.useDefaultExcludes)
    const remoteEntries = await listAllRemoteTreeEntries(input.driveItemId)
    assertNoRemoteFolderPathCollisions(remoteEntries, input.driveItemName, rules, input.drivePathHint)
    const entries: DriveSyncInitialTransferPreviewEntryDto[] = [{
      action: "create_local_folder",
      relativePath: ".",
      size: null,
    }]
    for (const entry of remoteEntries) {
      const relativePath = normalizeRemoteTreePath(entry.path, input.driveItemName, input.drivePathHint)
      if (!relativePath || isDriveSyncExcluded(relativePath, rules, entry.type)) continue
      entries.push({
        action: entry.type === "file" ? "download_file" : "create_local_folder",
        relativePath,
        size: entry.type === "file" ? entry.size : null,
      })
    }
    return summarizeInitialTransferEntries(entries)
  }

  function summarizeInitialTransferEntries(
    entries: readonly DriveSyncInitialTransferPreviewEntryDto[],
  ): DriveSyncInitialTransferPreviewDto {
    const ordered = [...entries].sort((left, right) => {
      if (left.relativePath === right.relativePath) return 0
      if (left.relativePath === ".") return -1
      if (right.relativePath === ".") return 1
      return left.relativePath.localeCompare(right.relativePath)
    })
    const fileEntries = ordered.filter((entry) => entry.action === "upload_file" || entry.action === "download_file")
    const totalBytes = fileEntries.reduce((total, entry) => {
      if (!entry.size || !/^\d+$/.test(entry.size)) return total
      return total + BigInt(entry.size)
    }, 0n)
    return {
      totalEntries: ordered.length,
      fileCount: fileEntries.length,
      folderCount: ordered.length - fileEntries.length,
      totalBytes: totalBytes.toString(),
      entries: ordered.slice(0, INITIAL_TRANSFER_PREVIEW_ENTRY_LIMIT),
      truncated: ordered.length > INITIAL_TRANSFER_PREVIEW_ENTRY_LIMIT,
    }
  }

  async function downloadInitialFile(binding: DriveSyncBindingDto): Promise<void> {
    const operation = await recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "running",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      source: "initialization",
      message: "正在下载。",
    })
    const current = await inspectDriveSyncLocalPath(binding.localPath)
    if (current.kind !== "missing") {
      const baseline = (await baselineStore.listByBinding(binding.id))
        .find((entry) => entry.relativePath === "" && entry.deletedAt === null)
      const safeToOverwrite = current.kind === "file"
        && Boolean(baseline?.localHash)
        && await hashDriveSyncFile(binding.localPath) === baseline?.localHash
      if (!safeToOverwrite) {
        await recordConflict({
          bindingId: binding.id,
          driveItemId: binding.driveItemId,
          relativePath: "",
          localPath: binding.localPath,
          remotePathHint: binding.drivePathHint,
          type: current.kind === "file" ? "both_modified" : "type_mismatch",
          localSnapshot: { kind: current.kind },
          remoteSnapshot: { kind: "file", itemId: binding.driveItemId },
        })
        await recordOperation({
          id: operation.id,
          bindingId: binding.id,
          kind: "download",
          status: "conflict",
          driveItemId: binding.driveItemId,
          relativePath: "",
          localPath: binding.localPath,
          source: "initialization",
          message: "本地文件在初始化恢复期间已变化。",
        })
        return
      }
    }
    const localPath = await writeDriveSyncFileTarget(
      driveSyncLocalWriteRootPath(binding),
      binding.localPath,
      (outputPath) => deps.accountService.downloadDriveFile({ itemId: binding.driveItemId, outputPath, signal: activeWorkSignals.get(binding.id) }),
    )
    const local = await inspectDriveSyncLocalPath(localPath)
    const stats = local.kind === "file" ? await lstat(localPath) : null
    if (local.kind === "file") {
      localWatcher.markSelfWrite({
        bindingId: binding.id,
        relativePath: "",
      })
    }
    await baselineStore.upsert({
      bindingId: binding.id,
      relativePath: "",
      kind: "file",
      remoteItemId: binding.driveItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: stats?.size ?? null,
      localMtimeMs: stats?.mtimeMs ?? null,
      localHash: local.kind === "file" ? await hashDriveSyncFile(localPath) : null,
      deletedAt: null,
    })
    await recordOperation({
      id: operation.id,
      bindingId: binding.id,
      kind: "download",
      status: "succeeded",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: null,
      message: null,
      source: "initialization",
    })
  }

  async function updateBindingDriveItemId(id: string, driveItemId: string): Promise<DriveSyncBindingDto> {
    const existing = await requireBinding(id)
    const entry: DriveSyncBindingEntryV1 = {
      ...existing,
      driveItemId,
      updatedAt: timestamp(),
    }
    await deps.bindings.upsert(entry)
    await reconcileLocalWatcher()
    await emitChanged()
    return toBindingDto(entry)
  }

  type InitialFileUploadSnapshot = {
    readonly uploadPath: string
    readonly uploadDirectory: string
    readonly localSize: number
    readonly localMtimeMs: number
    readonly localHash: string
  }

  async function createInitialFileUploadSnapshot(bindingId: string, localPath: string): Promise<InitialFileUploadSnapshot> {
    const stagingRoot = deps.stagingRootPath ?? path.join(os.tmpdir(), "synapse-drive-sync-staging")
    const bindingRoot = path.join(stagingRoot, safeStagingSegment(bindingId))
    await mkdir(bindingRoot, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const uploadDirectory = await mkdtemp(path.join(bindingRoot, "initial-upload-"))
      const uploadPath = path.join(uploadDirectory, path.basename(localPath))
      let accepted = false
      try {
        const snapshot = await copyLocalFileToVerifiedSnapshot(path.dirname(localPath), localPath, uploadPath)
        if (snapshot) {
          accepted = true
          return {
            uploadPath,
            uploadDirectory,
            localSize: snapshot.size,
            localMtimeMs: snapshot.mtimeMs,
            localHash: snapshot.hash,
          }
        }
      } finally {
        if (!accepted) await rm(uploadDirectory, { recursive: true, force: true })
      }
    }
    throw new Error("生成上传快照时本地文件持续变化，请稍后重试。")
  }

  async function hasInitialFileChangedSinceSnapshot(localPath: string, snapshot: InitialFileUploadSnapshot): Promise<boolean> {
    try {
      const current = await lstat(localPath)
      if (!current.isFile()) return true
      if (current.size !== snapshot.localSize) return true
      return await hashDriveSyncFile(localPath) !== snapshot.localHash
    } catch {
      return true
    }
  }

  async function uploadInitialFile(binding: DriveSyncBindingDto, targetParentId: string | null): Promise<string> {
    await assertNoRemoteUploadRootConflict(targetParentId, binding.driveItemName)
    const snapshot = await createInitialFileUploadSnapshot(binding.id, binding.localPath)
    const operation = await recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "running",
      driveItemId: null,
      relativePath: "",
      localPath: binding.localPath,
      source: "initialization",
      snapshotPath: snapshot.uploadPath,
      snapshotHash: snapshot.localHash,
      snapshotSize: snapshot.localSize,
      snapshotMtimeMs: snapshot.localMtimeMs,
      completedBytes: 0,
      totalBytes: snapshot.localSize,
      message: "正在上传。",
    })
    try {
      const remoteItem = await deps.accountService.uploadDriveSyncFile({
        parentId: targetParentId,
        path: snapshot.uploadPath,
        name: binding.driveItemName,
        signal: activeWorkSignals.get(binding.id),
      })
      const remoteItemId = remoteItem.id
      await recordOperation({
        id: operation.id,
        bindingId: binding.id,
        kind: "upload",
        status: "running",
        driveItemId: remoteItemId,
        relativePath: "",
        localPath: binding.localPath,
        source: "initialization",
        snapshotPath: snapshot.uploadPath,
        snapshotHash: snapshot.localHash,
        snapshotSize: snapshot.localSize,
        snapshotMtimeMs: snapshot.localMtimeMs,
        completedBytes: snapshot.localSize,
        totalBytes: snapshot.localSize,
        message: "正在确认上传结果。",
      })
      await updateBindingDriveItemId(binding.id, remoteItemId)
      await baselineStore.upsert({
        bindingId: binding.id,
        relativePath: "",
        kind: "file",
        remoteItemId,
        remoteVersionId: null,
        remoteEtag: null,
        localSize: snapshot.localSize,
        localMtimeMs: snapshot.localMtimeMs,
        localHash: snapshot.localHash,
        deletedAt: null,
      })
      await recordOperation({
        id: operation.id,
        bindingId: binding.id,
        kind: "upload",
        status: "succeeded",
        driveItemId: remoteItemId,
        relativePath: "",
        localPath: binding.localPath,
        remotePathHint: null,
        message: null,
        source: "initialization",
        completedBytes: snapshot.localSize,
        totalBytes: snapshot.localSize,
      })
      if (await hasInitialFileChangedSinceSnapshot(binding.localPath, snapshot)) {
        await recordOperation({
          bindingId: binding.id,
          kind: "upload",
          status: "retry_wait",
          driveItemId: remoteItemId,
          relativePath: "",
          localPath: binding.localPath,
          remotePathHint: null,
          message: "初始上传期间本地文件发生变化，等待下次同步上传最新内容。",
        })
      }
      return remoteItemId
    } finally {
      await rm(snapshot.uploadDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function findUploadedRemoteItemId(parentId: string | null, name: string, expectedType: "file" | "folder", expectedPath: string = name): Promise<string> {
    const itemId = await findOptionalUploadedRemoteItemId(parentId, name, expectedType, expectedPath)
    if (itemId) return itemId
    throw new Error("上传已完成，但无法确认云盘条目身份。")
  }

  async function findOptionalUploadedRemoteItemId(parentId: string | null, name: string, expectedType: "file" | "folder", expectedPath: string = name): Promise<string | null> {
    const normalizedExpectedPath = normalizeRemoteTreePathSegments(expectedPath)
    let offset: number | null = 0
    while (offset !== null) {
      const page = await deps.accountService.listDriveItemTree({ parentId, offset, limit: 200 })
      const item = page.items.find((candidate) => isDirectUploadedRemoteMatch(candidate, name, normalizedExpectedPath, expectedType))
      if (item) return item.id
      offset = page.nextOffset ?? null
    }
    return null
  }

  async function assertNoRemoteUploadRootConflict(parentId: string | null, name: string): Promise<void> {
    let offset: number | null = 0
    while (offset !== null) {
      const page = await deps.accountService.listDriveItemTree({ parentId, offset, limit: 200 })
      const item = page.items.find((candidate) => isDirectRemoteItemMatch(candidate, parentId, name))
      if (item) {
        const itemLabel = item.type === "folder" ? "文件夹" : "文件"
        throw new Error(`目标云盘位置已存在同名${itemLabel}，请改用绑定已有云盘条目，或选择新的名称或位置。`)
      }
      offset = page.nextOffset ?? null
    }
  }

  async function downloadInitialFolder(binding: DriveSyncBindingDto, drivePathHint?: string | null): Promise<void> {
    const operation = await recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "running",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      source: "initialization",
      message: "正在下载。",
    })
    await createDriveSyncDirectoryTarget(binding.localPath, binding.localPath)
    await assertRemoteFolderTreeLocallyRepresentable({
      driveItemId: binding.driveItemId,
      driveItemName: binding.driveItemName,
      drivePathHint,
      excludeRules: binding.excludeRules,
    })
    await baselineStore.upsert({
      bindingId: binding.id,
      relativePath: "",
      kind: "folder",
      remoteItemId: binding.driveItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    await downloadRemoteFolderTree(binding, drivePathHint, operation.id)
    await recordOperation({
      id: operation.id,
      bindingId: binding.id,
      kind: "download",
      status: "succeeded",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: null,
      message: null,
      source: "initialization",
    })
  }

  async function downloadRemoteFolderTree(
    binding: DriveSyncBindingDto,
    drivePathHint?: string | null,
    operationRecordId?: string,
  ): Promise<void> {
    const remoteEntries = await listAllRemoteTreeEntries(binding.driveItemId)
    const baselineByPath = new Map((await baselineStore.listByBinding(binding.id)).map((entry) => [entry.relativePath, entry] as const))
    assertNoRemoteFolderPathCollisions(remoteEntries, binding.driveItemName, binding.excludeRules, drivePathHint)
    let completedBytes = 0
    const totalBytes = remoteEntries.reduce((total, item) => {
      const relativePath = normalizeRemoteTreePath(item.path, binding.driveItemName, drivePathHint)
      return !relativePath || item.type !== "file" || isDriveSyncExcluded(relativePath, binding.excludeRules, item.type)
        ? total
        : total + safeRemoteFileSize(item.size)
    }, 0)
    let progressWrites = Promise.resolve()
    for (const item of remoteEntries) {
      const relativePath = normalizeRemoteTreePath(item.path, binding.driveItemName, drivePathHint)
      if (!relativePath || isDriveSyncExcluded(relativePath, binding.excludeRules, item.type)) continue
      const localPath = path.join(binding.localPath, relativePath)
      if (item.type === "folder") {
        const current = await inspectDriveSyncLocalPath(localPath)
        if (current.kind !== "missing" && current.kind !== "folder") {
          await recordConflict({
            bindingId: binding.id,
            driveItemId: item.id,
            relativePath,
            localPath,
            remotePathHint: item.path,
            type: "type_mismatch",
            localSnapshot: { kind: current.kind },
            remoteSnapshot: { kind: "folder", itemId: item.id },
          })
          continue
        }
        await createDriveSyncDirectoryTarget(binding.localPath, localPath)
        await baselineStore.upsert({
          bindingId: binding.id,
          relativePath,
          kind: "folder",
          remoteItemId: item.id,
          remoteVersionId: null,
          remoteEtag: null,
          localSize: null,
          localMtimeMs: null,
          localHash: null,
          deletedAt: null,
        })
      } else {
        const current = await inspectDriveSyncLocalPath(localPath)
        const previous = baselineByPath.get(relativePath)
        const localChanged = current.kind !== "missing" && (
          current.kind !== "file"
          || !previous?.localHash
          || await hashDriveSyncFile(localPath) !== previous.localHash
        )
        if (localChanged) {
          await recordConflict({
            bindingId: binding.id,
            driveItemId: item.id,
            relativePath,
            localPath,
            remotePathHint: item.path,
            type: current.kind === "file" ? "both_modified" : "type_mismatch",
            localSnapshot: { kind: current.kind },
            remoteSnapshot: { kind: "file", itemId: item.id },
          })
          continue
        }
        const writtenPath = await writeDriveSyncFileTarget(
          binding.localPath,
          localPath,
          (outputPath) => deps.accountService.downloadDriveFile({
            itemId: item.id,
            outputPath,
            signal: activeWorkSignals.get(binding.id),
            onProgress: operationRecordId
              ? (fileCompletedBytes) => {
                  progressWrites = progressWrites.then(() => recordOperation({
                    id: operationRecordId,
                    bindingId: binding.id,
                    kind: "download",
                    status: "running",
                    driveItemId: binding.driveItemId,
                    relativePath: "",
                    localPath: binding.localPath,
                    remoteItemKind: "folder",
                    source: "initialization",
                    completedBytes: completedBytes + fileCompletedBytes,
                    totalBytes: Math.max(totalBytes, completedBytes + fileCompletedBytes),
                  })).then(() => undefined)
                }
              : undefined,
          }),
        )
        const stats = await lstat(writtenPath)
        completedBytes += Math.max(safeRemoteFileSize(item.size), stats.size)
        await progressWrites
        await baselineStore.upsert({
          bindingId: binding.id,
          relativePath,
          kind: "file",
          remoteItemId: item.id,
          remoteVersionId: null,
          remoteEtag: null,
          localSize: stats.size,
          localMtimeMs: stats.mtimeMs,
          localHash: await hashDriveSyncFile(writtenPath),
          deletedAt: null,
        })
      }
    }
  }

  async function assertRemoteFolderTreeLocallyRepresentable(input: {
    readonly driveItemId: string
    readonly driveItemName: string
    readonly drivePathHint?: string | null
    readonly excludeRules: DriveSyncBindingEntryV1["excludeRules"]
  }): Promise<void> {
    assertNoRemoteFolderPathCollisions(await listAllRemoteTreeEntries(input.driveItemId), input.driveItemName, input.excludeRules, input.drivePathHint)
  }

  async function assertLocalFolderTreeFullySyncable(
    localPath: string,
    excludeRules: DriveSyncBindingEntryV1["excludeRules"],
  ): Promise<void> {
    const snapshot = await scanDriveSyncLocalTreeDetailed({
      rootPath: localPath,
      rules: excludeRules,
      hashFiles: false,
    })
    const skippedReason = formatDriveSyncSkippedLocalEntries(snapshot.skipped)
    if (skippedReason) throw new Error(skippedReason)
  }

  async function uploadInitialFolder(binding: DriveSyncBindingDto, targetParentId: string | null, drivePathHint: string | null): Promise<string> {
    await assertNoRemoteUploadRootConflict(targetParentId, binding.driveItemName)
    const operation = await recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "running",
      driveItemId: null,
      relativePath: "",
      localPath: binding.localPath,
      source: "initialization",
      message: "正在生成上传快照。",
    })
    const snapshot = await scanDriveSyncLocalTree({
      rootPath: binding.localPath,
      rules: binding.excludeRules,
      hashFiles: true,
    })
    const verificationDirectory = await createVerificationDirectory(binding.id)
    let createdRemoteRootId: string | null = null
    const failInitialFolderUpload = async (uploadError: unknown): Promise<never> => {
      if (createdRemoteRootId) {
        const remoteRootId = createdRemoteRootId
        try {
          await deps.accountService.deleteDriveItem(remoteRootId)
          createdRemoteRootId = null
        } catch (cleanupError) {
          await updateBindingDriveItemId(binding.id, remoteRootId)
          throw new Error("初始化上传未完成，云端临时文件夹清理失败。已保留同步绑定，请处理后重试。", {
            cause: cleanupError,
          })
        }
      }
      throw uploadError
    }
    try {
      const files = [] as Array<{ path: string; relativePath: string; mimeType: null }>
      for (const entry of snapshot.filter((candidate) => candidate.kind === "file")) {
        const snapshotPath = path.join(verificationDirectory, entry.relativePath)
        await mkdir(path.dirname(snapshotPath), { recursive: true })
        const verified = await copyLocalFileToVerifiedSnapshot(
          binding.localPath,
          path.join(binding.localPath, entry.relativePath),
          snapshotPath,
        )
        if (!verified || entry.hash === null || verified.hash !== entry.hash) {
          throw new Error("生成文件夹上传快照时内容发生变化，请重试。")
        }
        files.push({ path: snapshotPath, relativePath: entry.relativePath, mimeType: null })
      }
      const current = await scanDriveSyncLocalTree({
        rootPath: binding.localPath,
        rules: binding.excludeRules,
        hashFiles: true,
      })
      if (folderLocalManifest(snapshot) !== folderLocalManifest(current)) {
        throw new Error("生成文件夹上传快照时内容发生变化，请重试。")
      }
      if (files.length > 0) {
        const uploadedBytesByItem = new Map<string, number>()
        const totalBytes = files.reduce((total, file) => total + (snapshot.find((entry) => entry.relativePath === file.relativePath)?.size ?? 0), 0)
        let progressWrites = Promise.resolve()
        let upload: Awaited<ReturnType<DriveSyncAccountService["uploadDriveLocalItems"]>> | null = null
        try {
          upload = await deps.accountService.uploadDriveLocalItems({
            taskId: `drive-sync-initial-${binding.id}`,
            parentId: targetParentId,
            items: [{ kind: "folder", folderName: binding.driveItemName, files }],
          }, {
            signal: activeWorkSignals.get(binding.id),
            onProgress: (event) => {
              if (event.type !== "item-progress") return
              uploadedBytesByItem.set(event.itemKey, event.uploadedBytes)
              const completedBytes = Array.from(uploadedBytesByItem.values()).reduce((total, value) => total + value, 0)
              progressWrites = progressWrites.then(() => recordOperation({
                id: operation.id,
                bindingId: binding.id,
                kind: "upload",
                status: "running",
                driveItemId: createdRemoteRootId,
                relativePath: "",
                localPath: binding.localPath,
                remoteItemKind: "folder",
                source: "initialization",
                completedBytes,
                totalBytes: Math.max(totalBytes, completedBytes),
              })).then(() => undefined)
            },
            onFolderPrepared: ({ id, created }) => {
              if (created) createdRemoteRootId = id
            },
          })
        } catch (error) {
          await progressWrites
          await failInitialFolderUpload(error)
        }
        await progressWrites
        if (!upload) throw new Error("初始化上传未返回结果。")
        if (upload.failed > 0 || upload.completed === 0) {
          await failInitialFolderUpload(new Error(upload.message ?? "上传失败。"))
        }
      } else {
        const created = await deps.accountService.createDriveFolder({ parentId: targetParentId, name: binding.driveItemName })
        createdRemoteRootId = created.id
      }
    } finally {
      await rm(verificationDirectory, { recursive: true, force: true })
    }

    const remoteRootId = createdRemoteRootId ?? await findUploadedRemoteItemId(targetParentId, binding.driveItemName, "folder", drivePathHint ?? binding.driveItemName)
    await updateBindingDriveItemId(binding.id, remoteRootId)
    await baselineStore.upsert({
      bindingId: binding.id,
      relativePath: "",
      kind: "folder",
      remoteItemId: remoteRootId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    await recordUploadedFolderBaseline({
      binding,
      remoteRootId,
      drivePathHint,
      localEntries: snapshot,
    })
    await createMissingUploadedFolders({
      binding,
      localEntries: snapshot,
    })
    await recordOperation({
      id: operation.id,
      bindingId: binding.id,
      kind: "upload",
      status: "succeeded",
      driveItemId: remoteRootId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: null,
      message: null,
      source: "initialization",
    })
    return remoteRootId
  }

  async function recordUploadedFolderBaseline(input: {
    readonly binding: DriveSyncBindingDto
    readonly remoteRootId: string
    readonly drivePathHint: string | null
    readonly localEntries: readonly { readonly relativePath: string; readonly kind: "file" | "folder"; readonly size: number | null; readonly mtimeMs: number | null; readonly hash: string | null }[]
  }): Promise<void> {
    const remoteEntries = await listAllRemoteTreeEntries(input.remoteRootId)
    const localByPath = new Map(input.localEntries.map((entry) => [entry.relativePath, entry]))
    for (const item of remoteEntries) {
      const relativePath = normalizeRemoteTreePath(item.path, input.binding.driveItemName, input.drivePathHint)
      const localEntry = localByPath.get(relativePath)
      if (!localEntry) continue
      await baselineStore.upsert({
        bindingId: input.binding.id,
        relativePath,
        kind: item.type === "folder" ? "folder" : "file",
        remoteItemId: item.id,
        remoteVersionId: null,
        remoteEtag: null,
        localSize: localEntry.size,
        localMtimeMs: localEntry.mtimeMs,
        localHash: localEntry.hash,
        deletedAt: null,
      })
    }
  }

  async function createMissingUploadedFolders(input: {
    readonly binding: DriveSyncBindingDto
    readonly localEntries: readonly { readonly relativePath: string; readonly kind: "file" | "folder"; readonly size: number | null; readonly mtimeMs: number | null; readonly hash: string | null }[]
  }): Promise<void> {
    const baselineByPath = new Map(
      (await baselineStore.listByBinding(input.binding.id))
        .filter((entry) => entry.deletedAt === null)
        .map((entry) => [entry.relativePath, entry] as const),
    )
    const folderEntries = input.localEntries
      .filter((entry) => entry.kind === "folder")
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    for (const folder of folderEntries) {
      if (baselineByPath.has(folder.relativePath)) continue
      const parentRelativePath = parentRelativePathForSync(folder.relativePath)
      const parentRemoteId = parentRelativePath === null
        ? baselineByPath.get("")?.remoteItemId ?? input.binding.driveItemId
        : baselineByPath.get(parentRelativePath)?.remoteItemId ?? input.binding.driveItemId
      const created = await deps.accountService.createDriveFolder({
        parentId: parentRemoteId,
        name: path.posix.basename(folder.relativePath),
      })
      const entry = await baselineStore.upsert({
        bindingId: input.binding.id,
        relativePath: folder.relativePath,
        kind: "folder",
        remoteItemId: created.id,
        remoteVersionId: null,
        remoteEtag: null,
        localSize: null,
        localMtimeMs: folder.mtimeMs,
        localHash: null,
        deletedAt: null,
      })
      baselineByPath.set(folder.relativePath, entry)
    }
  }

  async function applyConflictResolution(
    conflict: DriveSyncConflictEntryV1,
    action: Exclude<DriveSyncConflictResolutionInput["action"], "skip">,
  ): Promise<boolean> {
    const binding = await requireBinding(conflict.bindingId)
    if (action === "keep_local") {
      const localPath = conflictLocalPath(binding, conflict)
      const local = await inspectDriveSyncLocalPath(localPath)
      if (local.kind === "folder") {
        await mirrorLocalConflictFolder(binding, conflict, localPath)
        return false
      }
      const operation = plannedConflictOperation(binding, conflict, "upload", conflict.localPath)
      const driveItemId = conflict.type === "delete_vs_modify" && !remoteConflictSideExists(conflict)
        ? null
        : operation.driveItemId
      await executeConflictResolutionOperations([{ ...operation, driveItemId }])
      await updateBindingRootIdAfterRecreation(binding, conflict)
      return false
    }
    if (action === "keep_remote") {
      await executeConflictResolutionOperations([plannedConflictOperation(binding, conflict, "download", conflictLocalPath(binding, conflict))])
      return false
    }
    if (action === "confirm_delete") {
      return applyConflictDeleteResolution(binding, conflict)
    }
    await applyConflictKeepBothResolution(binding, conflict)
    return false
  }

  async function mirrorLocalConflictFolder(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
    localRootPath: string,
  ): Promise<void> {
    const rootRelativePath = normalizeConflictRelativePath(conflict.relativePath)
    const snapshot = await scanDriveSyncLocalTreeDetailed({
      rootPath: localRootPath,
      rules: binding.excludeRules,
      hashFiles: true,
    })
    const skippedReason = formatDriveSyncSkippedLocalEntries(snapshot.skipped)
    if (skippedReason) throw new Error(skippedReason)
    const rootStats = await lstat(localRootPath)
    const localEntries: DriveSyncLocalSnapshotEntry[] = [
      { relativePath: rootRelativePath, kind: "folder", size: null, mtimeMs: rootStats.mtimeMs, hash: null },
      ...snapshot.entries.map((entry) => ({
        ...entry,
        relativePath: rootRelativePath ? path.posix.join(rootRelativePath, entry.relativePath) : entry.relativePath,
      })),
    ]
    const localByPath = new Map(localEntries.map((entry) => [entry.relativePath, entry] as const))
    const existingBaselines = (await baselineStore.listByBinding(binding.id)).filter((entry) => entry.deletedAt === null)
    const baselineByPath = new Map(existingBaselines.map((entry) => [entry.relativePath, entry] as const))
    const remoteRoot = await existingRemoteConflictFolder(conflict)
    const remoteRootId = remoteRoot?.id ?? await createRemoteConflictFolderRoot(binding, rootRelativePath, localRootPath, baselineByPath)
    if (rootRelativePath === "" && remoteRootId !== binding.driveItemId) await updateBindingDriveItemId(binding.id, remoteRootId)
    await baselineStore.upsert({
      bindingId: binding.id,
      relativePath: rootRelativePath,
      kind: "folder",
      remoteItemId: remoteRootId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: rootStats.mtimeMs,
      localHash: null,
      deletedAt: null,
    })
    baselineByPath.set(rootRelativePath, (await baselineStore.listByBinding(binding.id))
      .find((entry) => entry.relativePath === rootRelativePath && entry.deletedAt === null)!)

    const remoteEntries = remoteRoot ? await listAllRemoteTreeEntries(remoteRootId) : []
    const remoteRootName = remoteRoot?.name ?? path.basename(localRootPath)
    const remoteByPath = new Map<string, DriveSyncRemoteTreeEntry>()
    for (const remote of remoteEntries) {
      const relativeWithinRoot = normalizeRemoteTreePath(remote.path, remoteRootName, conflict.remotePathHint)
      const relativePath = rootRelativePath
        ? path.posix.join(rootRelativePath, relativeWithinRoot)
        : relativeWithinRoot
      if (!relativePath || isDriveSyncExcluded(relativePath, binding.excludeRules, remote.type)) continue
      remoteByPath.set(relativePath, remote)
    }

    const folders = localEntries.filter((entry) => entry.kind === "folder").sort(compareLocalEntryDepth)
    for (const folder of folders) {
      if (folder.relativePath === rootRelativePath) continue
      const remote = remoteByPath.get(folder.relativePath)
      if (remote && remote.type !== "folder") {
        await deps.accountService.deleteDriveItem(remote.id)
        remoteByPath.delete(folder.relativePath)
      }
      let remoteItemId = remote?.type === "folder" ? remote.id : null
      if (!remoteItemId) {
        const parentPath = parentRelativePathForSync(folder.relativePath) ?? rootRelativePath
        const parentId = baselineByPath.get(parentPath)?.remoteItemId
        if (!parentId) throw new Error(`无法确认云盘父目录：${folder.relativePath}`)
        remoteItemId = (await deps.accountService.createDriveFolder({
          parentId,
          name: path.posix.basename(folder.relativePath),
        })).id
      }
      const entry = await baselineStore.upsert({
        bindingId: binding.id,
        relativePath: folder.relativePath,
        kind: "folder",
        remoteItemId,
        remoteVersionId: null,
        remoteEtag: null,
        localSize: null,
        localMtimeMs: folder.mtimeMs,
        localHash: null,
        deletedAt: null,
      })
      baselineByPath.set(folder.relativePath, entry)
    }

    for (const file of localEntries.filter((entry) => entry.kind === "file").sort(compareLocalEntryDepth)) {
      const remote = remoteByPath.get(file.relativePath)
      if (remote && remote.type !== "file") {
        await deps.accountService.deleteDriveItem(remote.id)
        remoteByPath.delete(file.relativePath)
      }
      await executeConflictResolutionOperations([{
        bindingId: binding.id,
        kind: "upload",
        driveItemId: remote?.type === "file" ? remote.id : null,
        relativePath: file.relativePath,
        localPath: localPathForRelative(binding, file.relativePath),
        remotePathHint: remote?.path ?? null,
        remoteItemKind: "file",
      }])
    }

    const remoteExtras = [...remoteByPath]
      .filter(([relativePath]) => !localByPath.has(relativePath))
      .sort(([left], [right]) => pathDepth(right) - pathDepth(left))
    for (const [relativePath, remote] of remoteExtras) {
      if (isDescendantOfPathSet(relativePath, new Set(remoteExtras
        .filter(([candidate]) => candidate !== relativePath && pathDepth(candidate) < pathDepth(relativePath))
        .map(([candidate]) => candidate)))) continue
      await deps.accountService.deleteDriveItem(remote.id)
    }
    for (const baseline of existingBaselines) {
      if (
        baseline.relativePath !== rootRelativePath
        && isPathInSubtreeForSync(baseline.relativePath, rootRelativePath)
        && !localByPath.has(baseline.relativePath)
      ) await baselineStore.removePath(binding.id, baseline.relativePath)
    }
  }

  async function existingRemoteConflictFolder(conflict: DriveSyncConflictEntryV1): Promise<DriveItemDto | null> {
    if (!conflict.driveItemId || !deps.accountService.getDriveItem) return null
    try {
      const item = await deps.accountService.getDriveItem(conflict.driveItemId)
      return item.type === "folder" ? item : null
    } catch (error) {
      if (isRemoteNotFoundError(error)) return null
      throw error
    }
  }

  async function createRemoteConflictFolderRoot(
    binding: DriveSyncBindingEntryV1,
    rootRelativePath: string,
    localRootPath: string,
    baselineByPath: ReadonlyMap<string, DriveSyncBaselineEntryV1>,
  ): Promise<string> {
    const parentPath = parentRelativePathForSync(rootRelativePath)
    const parentId = rootRelativePath === ""
      ? binding.remoteParentId ?? null
      : parentPath === null
        ? binding.driveItemId
        : baselineByPath.get(parentPath)?.remoteItemId ?? null
    if (rootRelativePath !== "" && parentId === null) throw new Error("无法确认冲突目录的云盘父目录。")
    return (await deps.accountService.createDriveFolder({ parentId, name: path.basename(localRootPath) })).id
  }

  async function applyConflictDeleteResolution(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
  ): Promise<boolean> {
    const localPath = conflictLocalPath(binding, conflict)
    const local = await inspectDriveSyncLocalPath(localPath)
    if (local.kind !== "missing") {
      await executeConflictResolutionOperations([plannedConflictOperation(binding, conflict, "delete_local", localPath)])
    } else if (remoteConflictSideExists(conflict)) {
      await executeConflictResolutionOperations([plannedConflictOperation(binding, conflict, "delete_remote", localPath)])
    }
    if (conflict.relativePath === "") {
      await removeBinding(binding.id)
      return true
    }
    return false
  }

  async function updateBindingRootIdAfterRecreation(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
  ): Promise<void> {
    if (conflict.relativePath !== "" || remoteConflictSideExists(conflict)) return
    const root = await activeRootBaseline(binding.id)
    if (root && root.remoteItemId !== binding.driveItemId) await updateBindingDriveItemId(binding.id, root.remoteItemId)
  }

  async function applyConflictKeepBothResolution(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
  ): Promise<void> {
    const localPath = conflictLocalPath(binding, conflict)
    const stats = await lstat(localPath)
    if (!stats.isFile()) throw new Error("仅文件冲突支持保留两份。")
    const copyLocalPath = await createConflictLocalCopy(localPath)
    const copyRelativePath = path.posix.join(path.posix.dirname(conflict.relativePath), path.basename(copyLocalPath))
      .replace(/^\.\//u, "")
    await executeConflictResolutionOperations([
      {
        bindingId: binding.id,
        kind: "upload",
        driveItemId: null,
        relativePath: copyRelativePath,
        localPath: copyLocalPath,
        remotePathHint: conflict.remotePathHint,
        remoteItemKind: null,
      },
      plannedConflictOperation(binding, conflict, "download", localPath),
    ])
  }

  async function executeConflictResolutionOperations(operations: readonly DriveSyncPlannedOperation[]): Promise<void> {
    await executePlannedOperations(operations, {
      throwOnError: true,
      allowMissingRoot: true,
      skipLocalPrecondition: true,
    })
  }

  function plannedConflictOperation(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
    kind: DriveSyncPlannedOperation["kind"],
    localPath: string | null,
  ): DriveSyncPlannedOperation {
    return {
      bindingId: binding.id,
      kind,
      driveItemId: conflict.driveItemId,
      relativePath: conflict.relativePath,
      localPath,
      remotePathHint: conflict.remotePathHint,
      remoteItemKind: kind === "download" ? remoteItemKindForConflict(conflict) : null,
    }
  }

  function remoteItemKindForConflict(conflict: DriveSyncConflictEntryV1): DriveSyncPlannedOperation["remoteItemKind"] {
    return driveItemKindFromSnapshotValue(conflictSnapshotValue(conflict.remoteSnapshot))
  }

  function driveItemKindFromSnapshotValue(value: unknown): DriveSyncPlannedOperation["remoteItemKind"] {
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    const kind = record.itemKind ?? record.localKind ?? record.remoteItemKind ?? record.kind
    return kind === "file" || kind === "folder" ? kind : null
  }

  function conflictLocalPath(binding: DriveSyncBindingEntryV1, conflict: DriveSyncConflictEntryV1): string {
    return conflict.localPath ?? path.join(binding.localPath, conflict.relativePath)
  }

  async function handleLocalChanges(changes: readonly DriveSyncLocalChange[]): Promise<void> {
    const changesByBinding = new Map<string, DriveSyncLocalChange[]>()
    for (const change of changes) {
      const group = changesByBinding.get(change.bindingId) ?? []
      group.push(change)
      changesByBinding.set(change.bindingId, group)
    }

    await Promise.all([...changesByBinding].map(([bindingId, bindingChanges]) =>
      runBindingActionSingleFlight(bindingId, () => handleBindingLocalChanges(bindingId, bindingChanges)),
    ))
  }

  async function handleBindingLocalChanges(
    bindingId: string,
    bindingChanges: readonly DriveSyncLocalChange[],
  ): Promise<void> {
      let binding = await requireBinding(bindingId)
      if (!isAutomaticallySyncableBinding(binding) || !isCurrentAccountOnline()) return
      const rootReady = await ensureBindingRootReady(binding, { checkRemote: true, throwOnIssue: false })
      if (!rootReady) return
      let baseline = await baselineStore.listByBinding(bindingId)
      let changesForPlan = await localChangesForPlanning(binding, baseline, bindingChanges)
      if (changesForPlan.length > 0) {
        await pollActiveBindingRemoteChanges(binding, true)
        binding = await requireBinding(bindingId)
        if (!isAutomaticallySyncableBinding(binding)) return
        baseline = await baselineStore.listByBinding(bindingId)
        changesForPlan = await localChangesForPlanning(binding, baseline, bindingChanges)
      }
      const openConflictPaths = await listOpenConflictPaths(bindingId)
      changesForPlan = changesForPlan.filter((change) =>
        !openConflictPaths.some((conflictPath) => relativePathsOverlap(conflictPath, change.relativePath)),
      )
      const plan = planDriveSyncLocalChanges({
        binding,
        baseline,
        changes: changesForPlan,
      })
      await recordPlannedConflicts(plan.conflicts)
      await executePlannedOperations(plan.operations)
  }

  async function listOpenConflictPaths(bindingId: string): Promise<string[]> {
    return (await deps.conflicts.list({ bindingId }))
      .filter((conflict) => conflict.status === "open")
      .map((conflict) => normalizeConflictRelativePath(conflict.relativePath))
  }

  async function recordLocalChangeFlushError(changes: readonly DriveSyncLocalChange[], error: unknown): Promise<void> {
    const message = `本地变更处理失败，稍后重试：${errorMessage(error)}`
    for (const change of changes) {
      await recordOperation({
        bindingId: change.bindingId,
        kind: change.kind === "deleted" ? "delete_remote" : "upload",
        status: "retry_wait",
        driveItemId: null,
        relativePath: change.relativePath,
        localPath: change.localPath,
        remotePathHint: null,
        message,
      })
    }
  }

  async function localChangesForPlanning(
    binding: DriveSyncBindingEntryV1,
    baseline: readonly DriveSyncBaselineEntryV1[],
    changes: readonly DriveSyncLocalChange[],
  ): Promise<readonly DriveSyncLocalChange[]> {
    if (binding.kind !== "folder" || !hasLocalRescanSignal(changes)) return changes
    return localWatcher.scanBinding({
      binding,
      baseline,
      forceHashPaths: new Set(changes.map((change) => change.relativePath)),
    })
  }

  function hasLocalRescanSignal(changes: readonly DriveSyncLocalChange[]): boolean {
    if (changes.some((change) =>
      (change.kind === "created" || change.kind === "modified") && change.localKind === "folder",
    )) return true
    return changes.some((change) => change.kind === "created")
      && changes.some((change) => change.kind === "deleted")
  }

  async function handleMissingFileBindingRoot(input: {
    readonly binding: DriveSyncBindingEntryV1
    readonly baseline: readonly DriveSyncBaselineEntryV1[]
    readonly localChangedPaths: ReadonlySet<string>
  }): Promise<boolean> {
    if (input.binding.kind !== "file" || !deps.accountService.getDriveItem) return false
    const activeRootBaseline = input.baseline.find((entry) => entry.relativePath === "" && entry.deletedAt === null)
    if (!activeRootBaseline) return false

    try {
      await deps.accountService.getDriveItem(input.binding.driveItemId)
      return false
    } catch (error) {
      if (!isRemoteNotFoundError(error)) throw error
    }

    const change = deletedFileRootChange(input.binding)
    const plan = planDriveSyncRemoteChanges({
      binding: input.binding,
      baseline: input.baseline,
      changes: [change],
      localChangedPaths: input.localChangedPaths,
    })
    await recordPlannedConflicts(plan.conflicts)
    await executePlannedOperations(plan.operations)
    return true
  }

  async function fullRescanBinding(binding: DriveSyncBindingEntryV1): Promise<void> {
    if (fullRescanBindingIds.has(binding.id)) {
      throw new Error("完整校验后云盘游标仍然过期，请稍后重试。")
    }
    const signal = activeWorkSignals.get(binding.id)
    signal?.throwIfAborted()
    const scanCursor = await currentRemoteCursor()
    const operation = await recordOperation({
      bindingId: binding.id,
      kind: "resync",
      status: "running",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: binding.drivePathHint,
      source: "manual",
      message: "正在完整校验本地与云盘内容。",
      completedBytes: 0,
      totalBytes: 0,
    })
    let verificationDirectory: string | null = null
    fullRescanBindingIds.add(binding.id)
    try {
      verificationDirectory = await createVerificationDirectory(binding.id)
      const baseline = (await baselineStore.listByBinding(binding.id)).filter((entry) => entry.deletedAt === null)
      const [localEntries, remoteEntries] = await Promise.all([
        localEntriesForFullRescan(binding),
        remoteEntriesForFullRescan(binding),
      ])
      const remoteHashes = await hashRemoteFilesForFullRescan({
        binding,
        entries: remoteEntries,
        verificationDirectory,
        operationId: operation.id,
        signal,
      })
      const plan = await planFullRescan({ binding, baseline, localEntries, remoteEntries, remoteHashes })
      await recordPlannedConflicts(plan.conflicts)
      await executePlannedOperations(plan.operations, { throwOnError: true })
      await updateBindingCursor(binding.id, scanCursor)
      await recordOperation({
        id: operation.id,
        bindingId: binding.id,
        kind: "resync",
        status: "succeeded",
        driveItemId: binding.driveItemId,
        relativePath: "",
        localPath: binding.localPath,
        remotePathHint: binding.drivePathHint,
        source: "manual",
        message: null,
      })
      const current = await requireBinding(binding.id)
      if (isAutomaticallySyncableBinding(current) || current.status === "initializing") {
        await pollActiveBindingRemoteChanges(current, true)
      }
    } catch (error) {
      const retryable = isRetryableSyncError(error) && isCurrentAccountOnline()
      await recordOperation({
        id: operation.id,
        bindingId: binding.id,
        kind: "resync",
        status: signal?.aborted ? "retry_wait" : "error",
        driveItemId: binding.driveItemId,
        relativePath: "",
        localPath: binding.localPath,
        remotePathHint: binding.drivePathHint,
        source: "manual",
        message: signal?.aborted ? "完整校验已中断，恢复后重试。" : errorMessage(error),
      })
      if (!signal?.aborted && !retryable) await markBindingError(binding.id, errorMessage(error), { emitChanged: true })
      throw error
    } finally {
      if (verificationDirectory) await rm(verificationDirectory, { recursive: true, force: true })
      fullRescanBindingIds.delete(binding.id)
    }
  }

  async function localEntriesForFullRescan(binding: DriveSyncBindingEntryV1): Promise<readonly DriveSyncLocalSnapshotEntry[]> {
    if (binding.kind === "folder") {
      const descendants = await scanDriveSyncLocalTree({
        rootPath: binding.localPath,
        rules: binding.excludeRules,
        hashFiles: true,
      })
      const stats = await lstat(binding.localPath)
      return [{ relativePath: "", kind: "folder", size: null, mtimeMs: stats.mtimeMs, hash: null }, ...descendants]
    }
    const local = await inspectDriveSyncLocalPath(binding.localPath)
    if (local.kind === "missing") return []
    if (local.kind !== "file") throw new Error("本地同步路径类型已变化。")
    const stats = await lstat(binding.localPath)
    return [{
      relativePath: "",
      kind: "file",
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      hash: await hashDriveSyncFile(binding.localPath),
    }]
  }

  async function remoteEntriesForFullRescan(binding: DriveSyncBindingEntryV1): Promise<readonly DriveSyncRemoteTreeEntry[]> {
    const root = await getDriveItemFromAccountService(deps.accountService, binding.driveItemId)
    const rootEntry: DriveSyncRemoteTreeEntry = {
      id: root.id,
      name: root.name,
      type: root.type,
      path: binding.drivePathHint ?? root.name,
      size: root.size,
    }
    return binding.kind === "folder"
      ? [rootEntry, ...await listAllRemoteTreeEntries(binding.driveItemId)]
      : [rootEntry]
  }

  async function hashRemoteFilesForFullRescan(input: {
    readonly binding: DriveSyncBindingEntryV1
    readonly entries: readonly DriveSyncRemoteTreeEntry[]
    readonly verificationDirectory: string
    readonly operationId: string
    readonly signal?: AbortSignal
  }): Promise<ReadonlyMap<string, string>> {
    const files = input.entries.filter((entry) => entry.type === "file")
    const totalBytes = files.reduce((total, entry) => total + safeRemoteFileSize(entry.size), 0)
    let completedBytes = 0
    const hashes = new Map<string, string>()
    await recordOperation({
      id: input.operationId,
      bindingId: input.binding.id,
      kind: "resync",
      status: "running",
      driveItemId: input.binding.driveItemId,
      relativePath: "",
      localPath: input.binding.localPath,
      remotePathHint: input.binding.drivePathHint,
      source: "manual",
      message: "正在验证云盘文件内容。",
      completedBytes,
      totalBytes,
    })
    await mapWithConcurrency(files, 2, async (entry, index) => {
      input.signal?.throwIfAborted()
      const outputPath = path.join(input.verificationDirectory, `remote-${index}`)
      try {
        await deps.accountService.downloadDriveFile({ itemId: entry.id, outputPath, signal: input.signal })
        hashes.set(entry.id, await hashDriveSyncFile(outputPath))
        completedBytes += safeRemoteFileSize(entry.size)
        await recordOperation({
          id: input.operationId,
          bindingId: input.binding.id,
          kind: "resync",
          status: "running",
          driveItemId: input.binding.driveItemId,
          relativePath: "",
          localPath: input.binding.localPath,
          remotePathHint: input.binding.drivePathHint,
          source: "manual",
          message: "正在验证云盘文件内容。",
          completedBytes,
          totalBytes,
        })
      } finally {
        await rm(outputPath, { force: true })
      }
    })
    return hashes
  }

  async function planFullRescan(input: {
    readonly binding: DriveSyncBindingEntryV1
    readonly baseline: readonly DriveSyncBaselineEntryV1[]
    readonly localEntries: readonly DriveSyncLocalSnapshotEntry[]
    readonly remoteEntries: readonly DriveSyncRemoteTreeEntry[]
    readonly remoteHashes: ReadonlyMap<string, string>
  }): Promise<{ readonly operations: readonly DriveSyncPlannedOperation[]; readonly conflicts: readonly DriveSyncPlannedConflict[] }> {
    const localByPath = new Map(input.localEntries.map((entry) => [entry.relativePath, entry] as const))
    const remoteByPath = new Map<string, DriveSyncRemoteTreeEntry>()
    const remoteById = new Map<string, DriveSyncRemoteTreeEntry>()
    const remotePathById = new Map<string, string>()
    for (const remote of input.remoteEntries) {
      const relativePath = remote.id === input.binding.driveItemId
        ? ""
        : normalizeRemoteTreePath(remote.path, input.binding.driveItemName, input.binding.drivePathHint)
      if (isDriveSyncExcluded(relativePath, input.binding.excludeRules, remote.type)) continue
      remoteByPath.set(relativePath, remote)
      remoteById.set(remote.id, remote)
      remotePathById.set(remote.id, relativePath)
    }
    const baselineByPath = new Map(input.baseline.map((entry) => [entry.relativePath, entry] as const))
    const baselineById = new Map(input.baseline.map((entry) => [entry.remoteItemId, entry] as const))
    const operations: DriveSyncPlannedOperation[] = []
    const conflicts: DriveSyncPlannedConflict[] = []
    const recursiveRemoteRoots = new Set<string>()
    const recursiveDeletedRoots = new Set<string>()

    for (const [relativePath, remote] of [...remoteByPath].sort(compareRelativePathDepth)) {
      if (isDescendantOfPathSet(relativePath, recursiveRemoteRoots)) continue
      const previous = baselineById.get(remote.id)
      const previousPath = previous?.relativePath ?? relativePath
      const localAtPrevious = localByPath.get(previousPath)
      const localAtRemote = localByPath.get(relativePath)
      const remoteKind = remote.type === "folder" ? "folder" : "file"
      const remoteHash = input.remoteHashes.get(remote.id) ?? null
      if (!previous) {
        if (!localAtRemote) {
          operations.push(fullRescanOperation(input.binding, "download", relativePath, remote.id, remote.path, remoteKind))
          if (remoteKind === "folder") recursiveRemoteRoots.add(relativePath)
        } else if (localAtRemote.kind !== remoteKind) {
          conflicts.push(fullRescanConflict(input.binding, relativePath, remote, "type_mismatch", localAtRemote, remoteHash))
        } else if (remoteKind === "file" && localAtRemote.hash !== remoteHash) {
          conflicts.push(fullRescanConflict(input.binding, relativePath, remote, "both_modified", localAtRemote, remoteHash))
        } else {
          await upsertFullRescanBaseline(input.binding.id, relativePath, localAtRemote, remote, remoteHash)
        }
        continue
      }

      const localUnchanged = localMatchesBaseline(localAtPrevious, previous)
      if (previousPath !== relativePath) {
        if (!localUnchanged || (localAtRemote && relativePath !== previousPath)) {
          conflicts.push(fullRescanConflict(input.binding, previousPath, remote, "both_modified", localAtPrevious ?? null, remoteHash))
          continue
        }
        operations.push(fullRescanOperation(input.binding, "move_local", relativePath, remote.id, remote.path, remoteKind))
      }
      if (remoteKind !== previous.kind) {
        conflicts.push(fullRescanConflict(input.binding, previousPath, remote, "type_mismatch", localAtPrevious ?? null, remoteHash))
        continue
      }
      if (remoteKind === "file" && remoteHash !== previous.localHash) {
        const currentLocal = previousPath === relativePath ? localAtPrevious : localAtRemote ?? localAtPrevious
        if (currentLocal?.hash === remoteHash) {
          await upsertFullRescanBaseline(input.binding.id, relativePath, currentLocal, remote, remoteHash)
        } else if (localUnchanged) {
          operations.push(fullRescanOperation(input.binding, "download", relativePath, remote.id, remote.path, remoteKind))
        } else {
          conflicts.push(fullRescanConflict(input.binding, previousPath, remote, "both_modified", localAtPrevious ?? null, remoteHash))
        }
      } else if (previousPath !== relativePath && remoteKind === "folder") {
        recursiveRemoteRoots.add(relativePath)
      }
    }

    for (const baseline of [...input.baseline].sort(compareBaselineDepth)) {
      if (remoteById.has(baseline.remoteItemId) || isDescendantOfPathSet(baseline.relativePath, recursiveDeletedRoots)) continue
      const local = localByPath.get(baseline.relativePath)
      if (!local) {
        await baselineStore.markDeleted(input.binding.id, baseline.relativePath)
      } else if (localMatchesBaseline(local, baseline)) {
        operations.push(fullRescanOperation(input.binding, "delete_local", baseline.relativePath, baseline.remoteItemId, null, baseline.kind))
        if (baseline.kind === "folder") recursiveDeletedRoots.add(baseline.relativePath)
      } else {
        conflicts.push({
          bindingId: input.binding.id,
          driveItemId: baseline.remoteItemId,
          relativePath: baseline.relativePath,
          localPath: localPathForRelative(input.binding, baseline.relativePath),
          remotePathHint: null,
          type: "delete_vs_modify",
          localSnapshot: { local },
          remoteSnapshot: null,
        })
      }
    }

    for (const baseline of input.baseline) {
      const remote = remoteById.get(baseline.remoteItemId)
      const remotePath = remotePathById.get(baseline.remoteItemId)
      if (!remote || remotePath !== baseline.relativePath || hasFullRescanDecision(baseline.relativePath, operations, conflicts)) continue
      const local = localByPath.get(baseline.relativePath)
      const remoteUnchanged = baseline.kind === "folder"
        ? remote.type === "folder"
        : remote.type === "file" && input.remoteHashes.get(remote.id) === baseline.localHash
      if (!local) {
        if (remoteUnchanged) {
          operations.push(fullRescanOperation(input.binding, "delete_remote", baseline.relativePath, remote.id, remote.path, baseline.kind))
        } else {
          conflicts.push(fullRescanConflict(input.binding, baseline.relativePath, remote, "delete_vs_modify", null, input.remoteHashes.get(remote.id) ?? null))
        }
        continue
      }
      if (!localMatchesBaseline(local, baseline) && remoteUnchanged) {
        operations.push(fullRescanOperation(input.binding, "upload", baseline.relativePath, remote.id, remote.path, local.kind))
      }
    }

    for (const local of [...input.localEntries].sort(compareLocalEntryDepth)) {
      if (local.relativePath === "" || baselineByPath.has(local.relativePath) || remoteByPath.has(local.relativePath)) continue
      operations.push(fullRescanOperation(input.binding, "upload", local.relativePath, null, null, local.kind))
    }
    return { operations, conflicts }
  }

  async function upsertFullRescanBaseline(
    bindingId: string,
    relativePath: string,
    local: DriveSyncLocalSnapshotEntry,
    remote: DriveSyncRemoteTreeEntry,
    remoteHash: string | null,
  ): Promise<void> {
    await baselineStore.upsert({
      bindingId,
      relativePath,
      kind: local.kind,
      remoteItemId: remote.id,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: local.size,
      localMtimeMs: local.mtimeMs,
      localHash: local.kind === "file" ? remoteHash : null,
      deletedAt: null,
    })
  }

  function fullRescanOperation(
    binding: DriveSyncBindingEntryV1,
    kind: DriveSyncPlannedOperation["kind"],
    relativePath: string,
    driveItemId: string | null,
    remotePathHint: string | null,
    remoteItemKind: "file" | "folder",
  ): DriveSyncPlannedOperation {
    return {
      bindingId: binding.id,
      kind,
      driveItemId,
      relativePath,
      localPath: localPathForRelative(binding, relativePath),
      remotePathHint,
      remoteItemKind,
    }
  }

  function fullRescanConflict(
    binding: DriveSyncBindingEntryV1,
    relativePath: string,
    remote: DriveSyncRemoteTreeEntry,
    type: DriveSyncPlannedConflict["type"],
    local: DriveSyncLocalSnapshotEntry | null,
    remoteHash: string | null,
  ): DriveSyncPlannedConflict {
    return {
      bindingId: binding.id,
      driveItemId: remote.id,
      relativePath,
      localPath: localPathForRelative(binding, relativePath),
      remotePathHint: remote.path,
      type,
      localSnapshot: local ? { local } : null,
      remoteSnapshot: { kind: remote.type, hash: remoteHash, path: remote.path },
    }
  }

  async function executePlannedOperations(
    operations: readonly DriveSyncPlannedOperation[],
    options: {
      readonly throwOnError?: boolean
      readonly allowMissingRoot?: boolean
      readonly skipLocalPrecondition?: boolean
    } = {},
  ): Promise<void> {
    const failedBindingIds = new Set<string>()
    for (const operation of operations) {
      if (!options.throwOnError && failedBindingIds.has(operation.bindingId)) continue
      const binding = await requireBinding(operation.bindingId)
      if (!options.throwOnError && !isAutomaticallySyncableBinding(binding)) {
        failedBindingIds.add(operation.bindingId)
        continue
      }
      const rootReady = options.allowMissingRoot
        || await ensureBindingRootReady(binding, { checkRemote: true, throwOnIssue: false })
      if (!rootReady) {
        failedBindingIds.add(operation.bindingId)
        continue
      }
      if (operation.kind === "resync") {
        try {
          await fullRescanBinding(binding)
        } catch (error) {
          failedBindingIds.add(operation.bindingId)
          if (options.throwOnError) throw error
        }
        continue
      }
      try {
        const retryOperation = (await deps.operations.list({ bindingId: operation.bindingId }))
          .filter((entry) => entry.status === "retry_wait"
            && entry.kind === operation.kind
            && entry.relativePath === operation.relativePath)
          .sort(compareUpdatedDesc)[0]
        if (operation.kind === "upload" && retryOperation && await recoverCompletedUpload(retryOperation)) continue
        const remoteChangeTypes: DriveChangeDto["type"][] = [...(retryOperation?.completedRemoteMutations ?? [])]
        await authorizeOperationLocalPath(binding, operation)
        markSelfWriteForOperation(operation)
        await executeDriveSyncOperation({
          binding,
          operation,
          baselineStore,
          accountService: deps.accountService,
          recordOperation,
          trashLocalPath: deps.trashLocalPath ?? moveLocalPathToRecoverableTrash,
          markSelfWrite: (input) => localWatcher.markSelfWrite(input),
          stagingRootPath: deps.stagingRootPath,
          signal: activeWorkSignals.get(operation.bindingId),
          onRemoteMutation: async (changeType) => {
            if (!remoteChangeTypes.includes(changeType)) remoteChangeTypes.push(changeType)
            await recordCompletedRemoteMutation(operation, remoteChangeTypes)
            await rememberPendingRemoteEcho(operation, [changeType])
          },
          skipLocalPrecondition: options.skipLocalPrecondition,
          uploadSnapshot: uploadSnapshotFromOperation(retryOperation),
          retainUploadSnapshotOnError: (error) =>
            isDriveSyncWorkCancelledError(error)
            || Boolean(activeWorkSignals.get(operation.bindingId)?.aborted)
            || isRetryableSyncError(error),
        })
        await updateBindingDrivePathHintAfterRootMove(binding, operation)
        await rememberPendingRemoteEcho(operation, remoteChangeTypes)
      } catch (error) {
        if (isDriveSyncWorkCancelledError(error) || activeWorkSignals.get(operation.bindingId)?.aborted) {
          throw error
        }
        if (error instanceof DriveSyncLocalPreconditionError) {
          await recordConflict({
            bindingId: operation.bindingId,
            driveItemId: operation.driveItemId,
            relativePath: error.relativePath,
            localPath: localPathForRelative(binding, error.relativePath),
            remotePathHint: operation.remotePathHint,
            type: operation.kind === "delete_local" ? "delete_vs_modify" : "both_modified",
            localSnapshot: { changedAfterPlanning: true },
            remoteSnapshot: { operation },
          })
          failedBindingIds.add(operation.bindingId)
          if (options.throwOnError) throw error
          continue
        }
        if (isRetryableSyncError(error) && isCurrentAccountOnline()) {
          await markOperationForRetry(operation, error)
        } else {
          await updateBindingStatus(operation.bindingId, "error", errorMessage(error))
        }
        failedBindingIds.add(operation.bindingId)
        if (options.throwOnError) throw error
      }
    }
  }

  async function updateBindingDrivePathHintAfterRootMove(
    binding: DriveSyncBindingEntryV1,
    operation: DriveSyncPlannedOperation,
  ): Promise<void> {
    if (
      operation.kind !== "move_local"
      || operation.driveItemId !== binding.driveItemId
      || operation.remotePathHint === null
      || operation.remotePathHint === binding.drivePathHint
    ) {
      return
    }
    const current = await requireBinding(binding.id)
    if (current.driveItemId !== binding.driveItemId || current.drivePathHint === operation.remotePathHint) return
    await deps.bindings.upsert({
      ...current,
      drivePathHint: operation.remotePathHint,
      driveItemName: driveItemNameFromPathHint(operation.remotePathHint, current.driveItemName),
      updatedAt: timestamp(),
    })
    await emitChanged()
  }

  async function authorizeOperationLocalPath(
    binding: DriveSyncBindingEntryV1,
    operation: DriveSyncPlannedOperation,
  ): Promise<void> {
    const action = operationLocalPermissionAction(operation.kind)
    if (!action || !operation.localPath) return
    await authorizeLocalPath({
      action,
      localPath: operation.localPath,
      source: "driveSync.executeOperation",
      metadata: {
        bindingId: binding.id,
        driveItemId: operation.driveItemId,
        driveItemName: binding.driveItemName,
        kind: binding.kind,
        operationKind: operation.kind,
        relativePath: operation.relativePath,
      },
    })
  }

  async function authorizeLocalPath(input: {
    readonly action: PermissionAction
    readonly localPath: string
    readonly source: DriveSyncLocalPermissionSource
    readonly metadata: Record<string, unknown>
  }): Promise<void> {
    if (!deps.permissionGuard) return
    const actor: ActorIdentity = { kind: "user" }
    const context = { source: input.source, ...input.metadata }
    const permission = await deps.permissionGuard.check({
      action: input.action,
      actor,
      resource: input.localPath,
      context,
    })
    if (!permission.allowed) {
      deps.auditSink?.record({
        action: input.action,
        actor,
        resource: input.localPath,
        outcome: "denied",
        metadata: {
          ...context,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    deps.auditSink?.record({
      action: input.action,
      actor,
      resource: input.localPath,
      outcome: "allowed",
      metadata: context,
    })
  }

  async function recordPlannedConflicts(conflicts: readonly DriveSyncPlannedConflict[]): Promise<void> {
    for (const conflict of conflicts) {
      await recordConflict({
        bindingId: conflict.bindingId,
        driveItemId: conflict.driveItemId,
        relativePath: conflict.relativePath,
        localPath: conflict.localPath,
        remotePathHint: conflict.remotePathHint,
        type: conflict.type,
        localSnapshot: conflict.localSnapshot,
        remoteSnapshot: conflict.remoteSnapshot,
      })
    }
  }

  function markSelfWriteForOperation(operation: DriveSyncPlannedOperation): void {
    if (operation.kind !== "download" && operation.kind !== "delete_local" && operation.kind !== "move_local") return
    localWatcher.markSelfWrite({
      bindingId: operation.bindingId,
      relativePath: operation.relativePath,
    })
  }

  async function rememberPendingRemoteEcho(
    operation: DriveSyncPlannedOperation,
    actualChangeTypes?: readonly DriveChangeDto["type"][],
  ): Promise<void> {
    const changeTypes = actualChangeTypes ?? remoteEchoChangeTypes(operation.kind) ?? []
    if (changeTypes.length === 0) return
    const baseline = (await baselineStore.listByBinding(operation.bindingId))
      .find((entry) => entry.relativePath === operation.relativePath)
    const itemId = baseline?.remoteItemId ?? operation.driveItemId
    if (!itemId) return
    const echoes = pendingRemoteEchoes.get(operation.bindingId) ?? []
    pendingRemoteEchoes.set(operation.bindingId, [
      ...echoes,
      {
        itemId,
        relativePath: operation.relativePath,
        changeTypes,
        expiresAt: (deps.now?.() ?? new Date()).getTime() + 2 * 60_000,
      },
    ])
  }

  async function recordCompletedRemoteMutation(
    operation: DriveSyncPlannedOperation,
    completedRemoteMutations: readonly DriveChangeDto["type"][],
  ): Promise<void> {
    const current = (await deps.operations.list({ bindingId: operation.bindingId }))
      .filter((entry) => entry.kind === operation.kind && entry.relativePath === operation.relativePath)
      .sort(compareUpdatedDesc)[0]
    if (!current) return
    await deps.operations.upsert({
      ...current,
      completedRemoteMutations: [...new Set(completedRemoteMutations)],
      updatedAt: timestamp(),
    })
  }

  function consumePendingRemoteEcho(bindingId: string, change: DriveChangeDto, relativePath: string): boolean {
    const now = (deps.now?.() ?? new Date()).getTime()
    const echoes = pendingRemoteEchoes.get(bindingId)?.filter((echo) => echo.expiresAt > now)
    if (!echoes || echoes.length === 0) return false
    const index = echoes.findIndex((echo) =>
      echo.itemId === change.itemId
      && echo.relativePath === relativePath
      && echo.changeTypes.includes(change.type),
    )
    if (index < 0) return false
    const matched = echoes[index]
    const remainingTypes = matched.changeTypes.filter((type) => type !== change.type)
    const next = remainingTypes.length > 0
      ? echoes.slice(0, index).concat([{ ...matched, changeTypes: remainingTypes }], echoes.slice(index + 1))
      : echoes.slice(0, index).concat(echoes.slice(index + 1))
    if (next.length > 0) {
      pendingRemoteEchoes.set(bindingId, next)
    } else {
      pendingRemoteEchoes.delete(bindingId)
    }
    return true
  }

  function remoteEchoChangeTypes(kind: DriveSyncPlannedOperation["kind"]): readonly DriveChangeDto["type"][] | null {
    switch (kind) {
      case "upload":
        return ["created", "content_updated"]
      case "delete_remote":
        return ["trashed", "deleted"]
      case "move_remote":
        return ["renamed", "moved"]
      default:
        return null
    }
  }

  async function updateBindingCursor(bindingId: string, cursor: string | null): Promise<void> {
    const binding = await requireBinding(bindingId)
    await deps.bindings.upsert({
      ...binding,
      remoteCursor: cursor,
      updatedAt: timestamp(),
    })
    await emitChanged()
  }

  async function updateBindingStatusAfterConflictResolution(bindingId: string): Promise<void> {
    const open = (await deps.conflicts.list({ bindingId }))
      .some((conflict) => conflict.status === "open")
    if (!open) {
      const binding = await requireBinding(bindingId)
      if (binding.initialPhase !== null) {
        await updateBindingStatus(bindingId, "initializing")
        await resumeInitializingBinding(await requireBinding(bindingId))
      } else {
        await updateBindingStatus(bindingId, "active")
      }
    }
  }

  async function reconcileLocalWatcher(): Promise<void> {
    localWatcher.reconcile(await listOwnerBindings())
  }

  async function rescanActiveBindingsAfterWatcherStart(): Promise<void> {
    const bindings = (await listOwnerBindings()).filter(isAutomaticallySyncableBinding)
    for (const binding of bindings) {
      await runBindingActionSingleFlight(binding.id, async () => {
        const current = await requireBinding(binding.id)
        if (!isAutomaticallySyncableBinding(current)) return
        const rootReady = await ensureBindingRootReady(current, { checkRemote: true, throwOnIssue: false })
        if (!rootReady) return
        await scanBindingForLocalChanges(current, { throwOnScanError: false })
      }).catch(async (error) => {
        await markBindingError(binding.id, errorMessage(error), { emitChanged: true })
      })
    }
  }

  async function scanBindingForLocalChanges(
    binding: DriveSyncBindingEntryV1,
    options: { readonly throwOnScanError: boolean },
  ): Promise<void> {
    const baseline = await baselineStore.listByBinding(binding.id)
    let changes: readonly DriveSyncLocalChange[]
    try {
      changes = await localWatcher.scanBinding({ binding, baseline, forceFullHash: true })
    } catch (error) {
      const message = `本地变更扫描失败：${errorMessage(error)}`
      await markBindingError(binding.id, message, { emitChanged: true })
      if (options.throwOnScanError) throw new Error(message, { cause: error })
      return
    }
    await handleBindingLocalChanges(binding.id, changes)
  }

  async function assertBindingRootReady(
    binding: DriveSyncBindingEntryV1,
    input: { readonly checkRemote: boolean },
  ): Promise<void> {
    const ready = await ensureBindingRootReady(binding, {
      checkRemote: input.checkRemote,
      throwOnIssue: true,
    })
    if (!ready) throw new Error("同步根对象缺失，请先处理冲突。")
  }

  async function ensureBindingRootReady(
    binding: DriveSyncBindingEntryV1,
    input: { readonly checkRemote: boolean; readonly throwOnIssue: boolean },
  ): Promise<boolean> {
    const rootBaseline = await activeRootBaseline(binding.id)
    if (!rootBaseline) return true

    const localIssue = await inspectLocalRootIssue(binding)
    if (localIssue && localIssue !== LOCAL_ROOT_MISSING_ERROR) {
      return handleBindingRootIssue(binding, localIssue, input.throwOnIssue)
    }

    let remoteMissing = false
    if (input.checkRemote && deps.accountService.getDriveItem) {
      try {
        await deps.accountService.getDriveItem(rootBaseline.remoteItemId)
      } catch (error) {
        if (!isRemoteNotFoundError(error)) throw error
        remoteMissing = true
      }
    }

    if (localIssue === LOCAL_ROOT_MISSING_ERROR || remoteMissing) {
      await recordRootMissingConflict(binding, rootBaseline, {
        local: localIssue === LOCAL_ROOT_MISSING_ERROR,
        remote: remoteMissing,
      })
      return false
    }

    return true
  }

  async function recordRootMissingConflict(
    binding: DriveSyncBindingEntryV1,
    rootBaseline: DriveSyncBaselineEntryV1,
    missing: { readonly local: boolean; readonly remote: boolean },
  ): Promise<void> {
    await recordConflict({
      bindingId: binding.id,
      driveItemId: rootBaseline.remoteItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: binding.drivePathHint,
      type: "delete_vs_modify",
      localSnapshot: missing.local ? null : { baseline: rootBaseline },
      remoteSnapshot: missing.remote ? null : { baseline: rootBaseline },
    })
  }

  async function activeRootBaseline(bindingId: string): Promise<DriveSyncBaselineEntryV1 | null> {
    return (await baselineStore.listByBinding(bindingId))
      .find((entry) => entry.relativePath === "" && entry.deletedAt === null) ?? null
  }

  async function inspectLocalRootIssue(binding: DriveSyncBindingEntryV1): Promise<string | null> {
    return binding.kind === "folder"
      ? inspectLocalFolderRootIssue(binding)
      : inspectLocalFileRootIssue(binding)
  }

  async function inspectLocalFileRootIssue(binding: DriveSyncBindingEntryV1): Promise<string | null> {
    try {
      const local = await inspectDriveSyncLocalPath(binding.localPath)
      if (local.kind === "missing") return LOCAL_ROOT_MISSING_ERROR
      if (local.kind !== "file") return LOCAL_ROOT_INACCESSIBLE_ERROR
      return null
    } catch {
      return LOCAL_ROOT_INACCESSIBLE_ERROR
    }
  }

  async function inspectLocalFolderRootIssue(binding: DriveSyncBindingEntryV1): Promise<string | null> {
    try {
      const local = await inspectDriveSyncLocalPath(binding.localPath)
      if (local.kind === "missing") return LOCAL_ROOT_MISSING_ERROR
      if (local.kind !== "folder") return LOCAL_ROOT_INACCESSIBLE_ERROR
      return null
    } catch {
      return LOCAL_ROOT_INACCESSIBLE_ERROR
    }
  }

  async function handleBindingRootIssue(
    binding: DriveSyncBindingEntryV1,
    issue: string,
    throwOnIssue: boolean,
  ): Promise<false> {
    await markBindingError(binding.id, issue, { emitChanged: true })
    if (throwOnIssue) throw new Error(issue)
    return false
  }

  async function markBindingError(
    id: string,
    lastError: string,
    options: { readonly emitChanged: boolean },
  ): Promise<DriveSyncBindingEntryV1> {
    const existing = await requireBinding(id)
    const entry: DriveSyncBindingEntryV1 = {
      ...existing,
      status: "error",
      lastError: sanitizeRequiredDriveSyncMessage(lastError),
      updatedAt: timestamp(),
    }
    await deps.bindings.upsert(entry)
    await reconcileLocalWatcher()
    if (options.emitChanged) await emitChanged()
    return entry
  }

  async function recordOperation(input: DriveSyncRecordOperationInput): Promise<DriveSyncOperationDto> {
    const binding = await requireBinding(input.bindingId)
    const now = timestamp()
    const existing = input.id
      ? await deps.operations.get(input.id)
      : await findReusableRetryOperation(input)
    const entry: DriveSyncOperationEntryV1 = {
      id: existing?.id ?? input.id ?? createId("drive-sync-operation"),
      schemaVersion: 2,
      bindingId: input.bindingId,
      kind: input.kind,
      status: input.status,
      driveItemId: input.driveItemId ?? null,
      relativePath: input.relativePath,
      localPath: input.localPath ?? null,
      remotePathHint: input.remotePathHint ?? null,
      message: sanitizeNullableDriveSyncMessage(input.message),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      startedAt: input.status === "running" ? existing?.startedAt ?? now : existing?.startedAt ?? null,
      completedAt: isTerminalOperationStatus(input.status) ? now : null,
      attemptCount: input.attemptCount ?? existing?.attemptCount ?? 0,
      nextRetryAt: input.nextRetryAt ?? null,
      completedBytes: input.completedBytes ?? existing?.completedBytes ?? null,
      totalBytes: input.totalBytes ?? existing?.totalBytes ?? null,
      remoteItemKind: input.remoteItemKind ?? existing?.remoteItemKind ?? null,
      source: input.source ?? existing?.source ?? "manual",
      snapshotPath: input.snapshotPath ?? existing?.snapshotPath ?? null,
      snapshotHash: input.snapshotHash ?? existing?.snapshotHash ?? null,
      snapshotSize: input.snapshotSize ?? existing?.snapshotSize ?? null,
      snapshotMtimeMs: input.snapshotMtimeMs ?? existing?.snapshotMtimeMs ?? null,
      completedRemoteMutations: [...(input.completedRemoteMutations ?? existing?.completedRemoteMutations ?? [])],
    }
    await deps.operations.upsert(entry)
    await pruneOperationsForBinding(input.bindingId)
    if (input.status === "succeeded") {
      await deps.bindings.upsert({
        ...binding,
        lastSyncedAt: now,
        updatedAt: now,
      })
    }
    await emitChanged()
    return toOperationDto(entry)
  }

  async function findReusableRetryOperation(input: DriveSyncRecordOperationInput): Promise<DriveSyncOperationEntryV1 | null> {
    if (input.status !== "retry_wait" && input.status !== "running") return null
    const retryOperations = (await deps.operations.list({ bindingId: input.bindingId }))
      .filter((operation) => operation.status === "retry_wait" && operation.relativePath === input.relativePath)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return retryOperations[0] ?? null
  }

  async function pruneOperationsForBinding(bindingId: string): Promise<void> {
    const terminalOperations = (await deps.operations.list({ bindingId }))
      .filter((operation) => isTerminalOperationStatus(operation.status))
      .sort(compareUpdatedDesc)
    const expired = terminalOperations.slice(OPERATION_HISTORY_LIMIT_PER_BINDING)
    await Promise.all(expired.map((operation) => deps.operations.remove(operation.id)))
  }

  async function recordConflict(input: DriveSyncRecordConflictInput): Promise<DriveSyncConflictDto> {
    await requireBinding(input.bindingId)
    const now = timestamp()
    const relativePath = normalizeConflictRelativePath(input.relativePath)
    const existing = await findOpenConflict({
      bindingId: input.bindingId,
      driveItemId: input.driveItemId ?? null,
      relativePath,
      type: input.type,
    })
    if (existing) {
      const entry: DriveSyncConflictEntryV1 = {
        ...existing,
        driveItemId: input.driveItemId ?? null,
        relativePath,
        localPath: input.localPath ?? existing.localPath,
        remotePathHint: input.remotePathHint ?? existing.remotePathHint,
        localSnapshot: input.localSnapshot
          ? normalizeStoredConflictSnapshot(input.localSnapshot)
          : existing.localSnapshot,
        remoteSnapshot: input.remoteSnapshot
          ? normalizeStoredConflictSnapshot(input.remoteSnapshot)
          : existing.remoteSnapshot,
      }
      await deps.conflicts.upsert(entry)
      await updateBindingStatus(input.bindingId, "conflict")
      return toConflictDto(entry)
    }
    const entry: DriveSyncConflictEntryV1 = {
      id: createId("drive-sync-conflict"),
      schemaVersion: 2,
      bindingId: input.bindingId,
      driveItemId: input.driveItemId ?? null,
      relativePath,
      localPath: input.localPath ?? null,
      remotePathHint: input.remotePathHint ?? null,
      type: input.type,
      status: "open",
      localSnapshot: input.localSnapshot ? normalizeStoredConflictSnapshot(input.localSnapshot) : null,
      remoteSnapshot: input.remoteSnapshot ? normalizeStoredConflictSnapshot(input.remoteSnapshot) : null,
      resolution: null,
      createdAt: now,
      resolvedAt: null,
    }
    await deps.conflicts.upsert(entry)
    await updateBindingStatus(input.bindingId, "conflict")
    return toConflictDto(entry)
  }

  async function findOpenConflict(input: {
    readonly bindingId: string
    readonly driveItemId: string | null
    readonly relativePath: string
    readonly type: DriveSyncConflictEntryV1["type"]
  }): Promise<DriveSyncConflictEntryV1 | null> {
    const conflicts = await deps.conflicts.list({ bindingId: input.bindingId })
    return conflicts.find((conflict) =>
      conflict.status === "open"
      && normalizeConflictRelativePath(conflict.relativePath) === input.relativePath
      && conflict.type === input.type
      && conflict.driveItemId === input.driveItemId,
    ) ?? null
  }

  async function setHealth(input: DriveSyncSetHealthInput): Promise<DriveSyncStateEntryV1> {
    const current = await loadState()
    const stored = await deps.state.getSingleton()
    const now = timestamp()
    const entry: DriveSyncStateEntryV1 = {
      ...current,
      schemaVersion: 2,
      ownerUserId: currentOwnerUserId(),
      health: input.health,
      lastCursor: input.lastCursor ?? current.lastCursor,
      lastError: sanitizeNullableDriveSyncMessage(input.lastError),
      lastStartedAt: input.health === "syncing" ? now : current.lastStartedAt,
      lastStoppedAt: input.health === "idle" || input.health === "paused" || input.health === "error"
        ? now
        : current.lastStoppedAt,
      updatedAt: now,
    }
    const ownerUserId = currentOwnerUserId()
    await deps.state.setSingleton({
      ...entry,
      healthByOwner: ownerUserId
        ? { ...(stored?.healthByOwner ?? {}), [ownerUserId]: ownerHealthState(entry) }
        : stored?.healthByOwner ?? {},
    })
    await emitChanged()
    return entry
  }

  async function ensureStoredOwnerState(ownerUserId: string): Promise<void> {
    const stored = await deps.state.getSingleton()
    if (stored?.schemaVersion === 2 && stored.healthByOwner?.[ownerUserId]) return
    const ownerState = ownerHealthState(defaultState(timestamp(), ownerUserId))
    await deps.state.setSingleton({
      ...(stored?.schemaVersion === 2 ? stored : defaultState(timestamp(), ownerUserId)),
      schemaVersion: 2,
      ownerUserId,
      healthByOwner: {
        ...(stored?.schemaVersion === 2 ? stored.healthByOwner ?? {} : {}),
        [ownerUserId]: ownerState,
      },
    })
  }

  async function recoverInterruptedOperations(): Promise<void> {
    const online = isCurrentAccountOnline()
    const bindingIds = new Set((await listOwnerBindings()).map((binding) => binding.id))
    const operations = (await deps.operations.list()).filter((operation) => bindingIds.has(operation.bindingId))
    for (const operation of operations) {
      if (
        online
        && (operation.status === "running" || operation.status === "retry_wait")
        && await recoverCompletedUpload(operation)
      ) continue
      if (operation.status === "running") {
        await deps.operations.upsert({
          ...operation,
          schemaVersion: 2,
          status: "retry_wait",
          attemptCount: (operation.attemptCount ?? 0) + 1,
          nextRetryAt: timestamp(),
          message: "应用重启后继续同步。",
          completedAt: null,
          updatedAt: timestamp(),
        })
      }
      if (online && (operation.status === "running" || operation.status === "retry_wait")) {
        scheduleBindingRetry(operation.bindingId, operation.attemptCount ?? 0)
      }
    }

    const initializing = (await listOwnerBindings()).filter((binding) => binding.status === "initializing")
    if (online) {
      for (const binding of initializing) {
        if (!await deps.bindings.get(binding.id)) continue
        await runBindingActionSingleFlight(binding.id, () => resumeInitializingBinding(binding)).catch(async (error) => {
          if (isDriveSyncWorkCancelledError(error)) return
          if ((await deps.bindings.get(binding.id))?.status === "conflict") return
          if (isRetryableSyncError(error)) {
            scheduleBindingRetry(binding.id, 1)
            return
          }
          await markBindingError(binding.id, errorMessage(error), { emitChanged: false })
        })
      }
    }
  }

  async function resumeInitializingBinding(binding: DriveSyncBindingEntryV1): Promise<void> {
    if (binding.initialPhase === "replay") {
      await finishRecoveredInitialization(binding.id)
      return
    }
    if (binding.initialPhase === "reconcile") {
      await fullRescanBinding(binding)
      const reconciled = await requireBinding(binding.id)
      if (reconciled.status === "conflict" || reconciled.status === "error") return
      await updateBindingInitialization(binding.id, "replay", reconciled.remoteCursor)
      await finishRecoveredInitialization(binding.id)
      return
    }
    if (binding.initialDirection === "bind_existing") {
      const remote = await getDriveItemFromAccountService(deps.accountService, binding.driveItemId)
      const prepared = binding.kind === "file"
        ? await prepareExistingFileBaseline(binding.localPath, remote.id, binding.id)
        : await prepareExistingFolderBaselines({
          bindingId: binding.id,
          driveItemId: remote.id,
          driveItemName: remote.name,
          drivePathHint: binding.drivePathHint,
          localPath: binding.localPath,
          excludeRules: binding.excludeRules,
      })
      for (const entry of prepared) await baselineStore.upsert({ ...entry, bindingId: binding.id })
      await updateBindingInitialization(binding.id, "replay", binding.initialCursor ?? null)
      await finishRecoveredInitialization(binding.id)
      return
    }
    if (binding.initialDirection === "remote_to_local") {
      if (binding.kind === "file") await downloadInitialFile(toBindingDto(binding))
      else await downloadInitialFolder(toBindingDto(binding), binding.drivePathHint)
      await updateBindingInitialization(binding.id, "replay", binding.initialCursor ?? null)
      await finishRecoveredInitialization(binding.id)
      return
    }
    if (binding.initialDirection === "local_to_remote") {
      await recoverLocalToRemoteInitialization(binding)
      await finishRecoveredInitialization(binding.id)
    }
  }

  async function recoverLocalToRemoteInitialization(binding: DriveSyncBindingEntryV1): Promise<void> {
    const rootBaseline = await activeRootBaseline(binding.id)
    if (rootBaseline) return
    const candidateId = await findOptionalUploadedRemoteItemId(
      binding.remoteParentId ?? null,
      binding.driveItemName,
      binding.kind,
      binding.drivePathHint ?? binding.driveItemName,
    )
    if (!candidateId) {
      if (binding.kind === "file") {
        await updateBindingDriveItemId(binding.id, await uploadInitialFile(toBindingDto(binding), binding.remoteParentId ?? null))
      } else {
        await updateBindingDriveItemId(binding.id, await uploadInitialFolder(toBindingDto(binding), binding.remoteParentId ?? null, binding.drivePathHint))
      }
      return
    }

    try {
      const prepared = binding.kind === "file"
        ? await prepareExistingFileBaseline(binding.localPath, candidateId, binding.id)
        : await prepareExistingFolderBaselines({
            bindingId: binding.id,
            driveItemId: candidateId,
            driveItemName: binding.driveItemName,
            drivePathHint: binding.drivePathHint,
            localPath: binding.localPath,
            excludeRules: binding.excludeRules,
          })
      await updateBindingDriveItemId(binding.id, candidateId)
      for (const entry of prepared) await baselineStore.upsert({ ...entry, bindingId: binding.id })
    } catch (error) {
      await recordConflict({
        bindingId: binding.id,
        driveItemId: candidateId,
        relativePath: "",
        localPath: binding.localPath,
        remotePathHint: binding.drivePathHint,
        type: "both_modified",
        localSnapshot: { recovery: "local_to_remote" },
        remoteSnapshot: { driveItemId: candidateId },
      })
      throw new Error("无法确认中断前的文件夹上传结果，已生成冲突。", { cause: error })
    }
  }

  async function finishRecoveredInitialization(bindingId: string): Promise<void> {
    const binding = await requireBinding(bindingId)
    if (binding.status === "conflict" || binding.status === "error") return
    if (binding.initialDirection !== "local_to_remote") {
      await replayInitialRemoteChanges(bindingId, binding.initialCursor ?? null)
      const afterReplay = await requireBinding(bindingId)
      if (afterReplay.status === "conflict" || afterReplay.status === "error") return
    }
    const operations = await deps.operations.list({ bindingId })
    const now = timestamp()
    await Promise.all(operations
      .filter((operation) =>
        operation.source === "initialization"
        && (operation.status === "pending" || operation.status === "running" || operation.status === "retry_wait"),
      )
      .map((operation) => deps.operations.upsert({
        ...operation,
        status: "succeeded",
        nextRetryAt: null,
        message: null,
        completedAt: now,
        updatedAt: now,
      })))
    clearBindingRetry(bindingId)
    if (binding.initialDirection === "local_to_remote") {
      await activateBindingAtCurrentRemoteCursor(bindingId)
    } else {
      await activateBindingAfterInitialReplay(bindingId)
    }
  }

  async function recoverCompletedUpload(operation: DriveSyncOperationEntryV1): Promise<boolean> {
    if (
      operation.kind !== "upload"
      || !operation.snapshotPath
      || !operation.snapshotHash
      || operation.snapshotSize === null
      || operation.snapshotSize === undefined
      || operation.snapshotMtimeMs === null
      || operation.snapshotMtimeMs === undefined
      || (operation.completedBytes ?? 0) < operation.snapshotSize
    ) return false
    if (!isManagedStagingPath(operation.snapshotPath, deps.stagingRootPath)) return false
    try {
      const stats = await lstat(operation.snapshotPath)
      if (!stats.isFile() || await hashDriveSyncFile(operation.snapshotPath) !== operation.snapshotHash) {
        await markRecoveredUploadTerminalError(operation, "上传快照缺失或已损坏，无法自动恢复。")
        return true
      }
    } catch {
      await markRecoveredUploadTerminalError(operation, "上传快照缺失或已损坏，无法自动恢复。")
      return true
    }
    let recoveredOperation = operation
    if (!operation.driveItemId) {
      const candidateId = await findUploadRecoveryCandidateId(operation)
      if (!candidateId) return false
      recoveredOperation = { ...operation, driveItemId: candidateId, updatedAt: timestamp() }
      await deps.operations.upsert(recoveredOperation)
    }

    const verificationDirectory = await createVerificationDirectory(operation.bindingId)
    try {
      const remotePath = path.join(verificationDirectory, "remote")
      await deps.accountService.downloadDriveFile({ itemId: recoveredOperation.driveItemId!, outputPath: remotePath, signal: activeWorkSignals.get(operation.bindingId) })
      const remoteHash = await hashDriveSyncFile(remotePath)
      if (remoteHash !== operation.snapshotHash) {
        const baseline = (await baselineStore.listByBinding(operation.bindingId))
          .find((entry) => entry.relativePath === operation.relativePath && entry.deletedAt === null)
        if (
          operation.driveItemId
          && baseline?.remoteItemId === operation.driveItemId
          && baseline.localHash === remoteHash
        ) return false
        await recordConflict({
          bindingId: operation.bindingId,
          driveItemId: recoveredOperation.driveItemId,
          relativePath: operation.relativePath,
          localPath: operation.localPath,
          remotePathHint: operation.remotePathHint,
          type: "both_modified",
          localSnapshot: { operation },
          remoteSnapshot: { driveItemId: recoveredOperation.driveItemId },
        })
        await deps.operations.upsert({
          ...recoveredOperation,
          status: "conflict",
          completedAt: timestamp(),
          updatedAt: timestamp(),
          message: "无法确认崩溃前上传结果，已生成冲突。",
        })
        return true
      }
      if (operation.relativePath === "") {
        await updateBindingDriveItemId(operation.bindingId, recoveredOperation.driveItemId!)
      }
      await baselineStore.upsert({
        bindingId: operation.bindingId,
        relativePath: operation.relativePath,
        kind: "file",
        remoteItemId: recoveredOperation.driveItemId!,
        remoteVersionId: null,
        remoteEtag: null,
        localSize: operation.snapshotSize,
        localMtimeMs: operation.snapshotMtimeMs,
        localHash: operation.snapshotHash,
        deletedAt: null,
      })
      await deps.operations.upsert({
        ...recoveredOperation,
        status: "succeeded",
        completedBytes: operation.snapshotSize,
        totalBytes: operation.snapshotSize,
        nextRetryAt: null,
        completedAt: timestamp(),
        updatedAt: timestamp(),
        message: null,
      })
      await removeManagedSnapshot(operation.snapshotPath, deps.stagingRootPath)
      return true
    } catch (error) {
      if (isRetryableSyncError(error)) return false
      throw error
    } finally {
      await rm(verificationDirectory, { recursive: true, force: true })
    }
  }

  async function findUploadRecoveryCandidateId(operation: DriveSyncOperationEntryV1): Promise<string | null> {
    if (!operation.localPath) return null
    const binding = await requireBinding(operation.bindingId)
    const parentRelativePath = parentRelativePathForSync(operation.relativePath)
    const parentId = operation.relativePath === "" && binding.kind === "file"
      ? binding.remoteParentId ?? null
      : parentRelativePath === null
        ? binding.driveItemId
        : (await baselineStore.listByBinding(binding.id))
            .find((entry) => entry.relativePath === parentRelativePath && entry.deletedAt === null)?.remoteItemId ?? null
    if (parentRelativePath !== null && !parentId) return null
    const name = path.basename(operation.localPath)
    return findOptionalUploadedRemoteItemId(parentId, name, "file", name)
  }

  async function markRecoveredUploadTerminalError(
    operation: DriveSyncOperationEntryV1,
    message: string,
  ): Promise<void> {
    await deps.operations.upsert({
      ...operation,
      status: "error",
      message,
      nextRetryAt: null,
      completedAt: timestamp(),
      updatedAt: timestamp(),
    })
    await markBindingError(operation.bindingId, message, { emitChanged: false })
  }

  async function markOperationForRetry(operation: DriveSyncPlannedOperation, error: unknown): Promise<void> {
    const recent = (await deps.operations.list({ bindingId: operation.bindingId }))
      .filter((entry) => entry.relativePath === operation.relativePath && entry.kind === operation.kind)
      .sort(compareUpdatedDesc)[0]
    const attemptCount = (recent?.attemptCount ?? 0) + 1
    const delayMs = retryDelayMs(attemptCount)
    const nextRetryAt = new Date((deps.now?.() ?? new Date()).getTime() + delayMs).toISOString()
    await recordOperation({
      id: recent?.id,
      bindingId: operation.bindingId,
      kind: operation.kind,
      status: "retry_wait",
      driveItemId: operation.driveItemId,
      relativePath: operation.relativePath,
      localPath: operation.localPath,
      remotePathHint: operation.remotePathHint,
      remoteItemKind: operation.remoteItemKind,
      source: operation.kind === "upload" || operation.kind === "delete_remote" || operation.kind === "move_remote"
        ? "local"
        : "remote",
      attemptCount,
      nextRetryAt,
      message: `暂时无法同步，将自动重试：${errorMessage(error)}`,
    })
    await setHealth({ health: "retrying", lastError: errorMessage(error) })
    scheduleBindingRetry(operation.bindingId, attemptCount, delayMs)
  }

  async function ensureBindingRetryForError(
    bindingId: string,
    error: unknown,
    incrementExisting: boolean,
  ): Promise<void> {
    const existing = (await deps.operations.list({ bindingId }))
      .filter((operation) => operation.status === "retry_wait")
      .sort(compareUpdatedDesc)[0]
    if (existing && !incrementExisting) {
      await setHealth({ health: "retrying", lastError: errorMessage(error) })
      scheduleBindingRetry(bindingId, Math.max(1, existing.attemptCount ?? 1))
      return
    }
    const binding = await requireBinding(bindingId)
    const attemptCount = (existing?.attemptCount ?? 0) + 1
    const delayMs = retryDelayMs(attemptCount)
    const nextRetryAt = new Date((deps.now?.() ?? new Date()).getTime() + delayMs).toISOString()
    await recordOperation({
      id: existing?.id,
      bindingId,
      kind: existing?.kind ?? "resync",
      status: "retry_wait",
      driveItemId: existing?.driveItemId ?? binding.driveItemId,
      relativePath: existing?.relativePath ?? "",
      localPath: existing?.localPath ?? binding.localPath,
      remotePathHint: existing?.remotePathHint ?? binding.drivePathHint,
      remoteItemKind: existing?.remoteItemKind ?? binding.kind,
      source: existing?.source ?? "remote",
      attemptCount,
      nextRetryAt,
      completedBytes: existing?.completedBytes ?? null,
      totalBytes: existing?.totalBytes ?? null,
      snapshotPath: existing?.snapshotPath ?? null,
      snapshotHash: existing?.snapshotHash ?? null,
      snapshotSize: existing?.snapshotSize ?? null,
      snapshotMtimeMs: existing?.snapshotMtimeMs ?? null,
      message: `暂时无法同步，将自动重试：${errorMessage(error)}`,
    })
    await setHealth({ health: "retrying", lastError: errorMessage(error) })
    scheduleBindingRetry(bindingId, attemptCount, delayMs)
  }

  function scheduleBindingRetry(bindingId: string, attemptCount: number, explicitDelayMs?: number): void {
    clearBindingRetry(bindingId)
    const timer = setTimeout(() => {
      retryTimers.delete(bindingId)
      void retryBinding(bindingId)
    }, explicitDelayMs ?? retryDelayMs(Math.max(1, attemptCount)))
    timer.unref?.()
    retryTimers.set(bindingId, timer)
  }

  async function retryBinding(bindingId: string): Promise<void> {
    if (!isCurrentAccountOnline()) return
    await runBindingActionSingleFlight(bindingId, async () => {
      const binding = await requireBinding(bindingId)
      if (!isAutomaticallySyncableBinding(binding)) return
      const retryOperations = (await deps.operations.list({ bindingId }))
        .filter((operation) => operation.status === "retry_wait"
          && (operation.kind === "move_remote" || operation.kind === "delete_remote"))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      for (const operation of retryOperations) {
        await executePlannedOperations([plannedOperationFromStoredOperation(operation)], { throwOnError: true })
      }
      const retryUploads = (await deps.operations.list({ bindingId }))
        .filter((operation) => operation.status === "retry_wait" && operation.kind === "upload")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      for (const operation of retryUploads) await recoverCompletedUpload(operation)
      await catchUpBinding(binding, false)
      await setHealth({ health: "idle", lastError: null })
    }).catch(async (error) => {
      if (!isRetryableSyncError(error)) return
      await ensureBindingRetryForError(bindingId, error, true)
    })
  }

  function plannedOperationFromStoredOperation(operation: DriveSyncOperationEntryV1): DriveSyncPlannedOperation {
    return {
      bindingId: operation.bindingId,
      kind: operation.kind,
      driveItemId: operation.driveItemId,
      relativePath: operation.relativePath,
      localPath: operation.localPath,
      remotePathHint: operation.remotePathHint,
      remoteItemKind: operation.remoteItemKind ?? null,
    }
  }

  function clearBindingRetry(bindingId: string): void {
    const timer = retryTimers.get(bindingId)
    if (timer) clearTimeout(timer)
    retryTimers.delete(bindingId)
  }

  function clearAllRetries(): void {
    for (const timer of retryTimers.values()) clearTimeout(timer)
    retryTimers.clear()
  }

  async function requireBinding(id: string): Promise<DriveSyncBindingEntryV1> {
    const binding = await deps.bindings.get(id)
    if (
      !binding
      || binding.status === "removed"
      || binding.schemaVersion !== 3
      || binding.ownerUserId !== currentOwnerUserId()
    ) throw new Error("同步绑定不存在。")
    return binding
  }

  async function loadState(): Promise<DriveSyncStateEntryV1> {
    const state = await deps.state.getSingleton()
    const ownerUserId = currentOwnerUserId()
    const ownerState = ownerUserId ? state?.healthByOwner?.[ownerUserId] : null
    if (state?.schemaVersion === 2 && ownerState) return { ...state, ...ownerState, ownerUserId }
    return state?.schemaVersion === 2 && state.ownerUserId === ownerUserId
      ? state
      : defaultState(timestamp(), ownerUserId)
  }

  async function runBindingActionSingleFlight<T>(
    bindingId: string,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return workCoordinator.run(bindingId, async (signal) => {
      activeWorkSignals.set(bindingId, signal)
      try {
        return await action(signal)
      } finally {
        if (activeWorkSignals.get(bindingId) === signal) activeWorkSignals.delete(bindingId)
      }
    })
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", await getSnapshot())
  }

  return {
    events,
    getSnapshot,
    createBinding,
    previewBinding,
    createSafeBinding,
    rescanBinding,
    pollRemoteChanges,
    startRemotePolling,
    startLocalWatcher,
    stopRemotePolling,
    stopLocalWatcher,
    pauseBinding,
    resumeBinding,
    updateExcludeRules,
    resolveConflict,
    updateBindingStatus,
    removeBinding,
    recordOperation,
    recordConflict,
    setHealth,
  }
}

export type DriveSyncService = ReturnType<typeof createDriveSyncService>

function deletedFileRootChange(binding: DriveSyncBindingEntryV1): DriveChangeDto {
  const now = new Date().toISOString()
  return {
    id: `drive-sync-root-deleted:${binding.id}:${binding.driveItemId}`,
    sequence: binding.remoteCursor ?? "root-deleted",
    itemId: binding.driveItemId,
    parentId: null,
    type: "deleted",
    versionId: null,
    etag: null,
    name: binding.driveItemName,
    pathHint: binding.drivePathHint ?? binding.driveItemName,
    itemKind: binding.kind,
    actor: "system",
    occurredAt: now,
  }
}

function isRemoteNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & {
    readonly status?: unknown
    readonly statusCode?: unknown
    readonly code?: unknown
  }
  if (details.status === 404 || details.statusCode === 404) return true
  if (typeof details.code === "string" && details.code.toUpperCase().includes("NOT_FOUND")) return true
  const message = error.message.toUpperCase()
  return message.includes("NOT_FOUND") || message.includes("HTTP 404")
}

function toBindingDto(
  entry: DriveSyncBindingEntryV1,
  override?: { readonly status: DriveSyncBindingStatus; readonly lastError: string },
): DriveSyncBindingDto {
  return {
    id: entry.id,
    driveItemId: entry.driveItemId,
    driveItemName: entry.driveItemName,
    drivePathHint: entry.drivePathHint,
    kind: entry.kind,
    localPath: entry.localPath,
    status: override?.status ?? entry.status,
    remoteCursor: entry.remoteCursor,
    excludeRules: entry.excludeRules,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastSyncedAt: entry.lastSyncedAt,
    lastError: sanitizeNullableDriveSyncMessage(override?.lastError ?? entry.lastError),
  }
}

function toOperationDto(entry: DriveSyncOperationEntryV1): DriveSyncOperationDto {
  return {
    id: entry.id,
    bindingId: entry.bindingId,
    kind: entry.kind,
    relativePath: entry.relativePath,
    status: entry.status,
    message: sanitizeNullableDriveSyncMessage(entry.message),
    attemptCount: entry.attemptCount ?? 0,
    nextRetryAt: entry.nextRetryAt ?? null,
    completedBytes: entry.completedBytes ?? null,
    totalBytes: entry.totalBytes ?? null,
    updatedAt: entry.updatedAt,
  }
}

function selectSnapshotOperations(
  operationEntries: readonly DriveSyncOperationEntryV1[],
  bindingEntries: readonly DriveSyncBindingEntryV1[],
): readonly DriveSyncOperationEntryV1[] {
  const bindingIds = new Set(bindingEntries.map((binding) => binding.id))
  const selectedById = new Map<string, DriveSyncOperationEntryV1>()
  for (const operation of operationEntries.slice(0, SNAPSHOT_GLOBAL_OPERATION_LIMIT)) {
    selectedById.set(operation.id, operation)
  }

  const selectedCountByBinding = new Map<string, number>()
  for (const operation of operationEntries) {
    if (!bindingIds.has(operation.bindingId)) continue
    const selectedCount = selectedCountByBinding.get(operation.bindingId) ?? 0
    if (selectedCount >= SNAPSHOT_BINDING_OPERATION_LIMIT) continue
    selectedById.set(operation.id, operation)
    selectedCountByBinding.set(operation.bindingId, selectedCount + 1)
  }

  return Array.from(selectedById.values()).sort(compareUpdatedDesc)
}

function toConflictDto(entry: DriveSyncConflictEntryV1): DriveSyncConflictDto {
  return {
    id: entry.id,
    bindingId: entry.bindingId,
    relativePath: entry.relativePath,
    type: entry.type,
    localSummary: conflictSideSummary("本地", entry.localSnapshot, entry.relativePath),
    remoteSummary: conflictSideSummary("云端", entry.remoteSnapshot, entry.remotePathHint ?? entry.relativePath),
    availableActions: availableConflictActions(entry),
    createdAt: entry.createdAt,
  }
}

function conflictSideSummary(
  label: "本地" | "云端",
  snapshot: Record<string, unknown> | null,
  pathHint: string,
): string | null {
  const record = snapshotRecord(snapshot)
  if (!record) return null
  const parts = [
    conflictKindLabel(driveItemKindFromSnapshotRecord(record)),
    conflictSnapshotPath(record, pathHint),
    conflictSnapshotSize(record),
    conflictSnapshotVersion(record),
  ].filter((part): part is string => Boolean(part))
  return `${label}：${parts.join("，")}`
}

function snapshotRecord(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  return conflictSnapshotValue(snapshot)
}

function conflictSnapshotValue(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!snapshot) return null
  for (const key of ["change", "baseline", "local", "operation"] as const) {
    const value = snapshot[key]
    if (value && typeof value === "object") return value as Record<string, unknown>
  }
  return snapshot
}

function normalizeStoredConflictSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const record = conflictSnapshotValue(snapshot) ?? snapshot
  const itemKind = driveItemKindFromSnapshotRecord(record)
  const changeType = record.type ?? record.kind
  const exists = typeof record.exists === "boolean"
    ? record.exists
    : changeType === "deleted" || changeType === "trashed" ? false : true
  const pathHint = record.currentPathHint ?? record.pathHint ?? record.relativePath ?? record.path
  return {
    ...record,
    exists,
    ...(itemKind ? { itemKind } : {}),
    ...(typeof pathHint === "string" ? { pathHint } : {}),
  }
}

function conflictKindLabel(kind: "file" | "folder" | null): string {
  if (kind === "file") return "文件"
  if (kind === "folder") return "文件夹"
  return "未知类型"
}

function conflictSnapshotPath(record: Record<string, unknown>, fallback: string): string | null {
  const pathValue = record.currentPathHint ?? record.pathHint ?? record.relativePath ?? fallback
  return typeof pathValue === "string" && pathValue.trim() ? `路径 ${pathValue}` : null
}

function conflictSnapshotSize(record: Record<string, unknown>): string | null {
  const size = record.localSize ?? record.size
  if (typeof size === "number" && Number.isFinite(size)) return `大小 ${size} B`
  if (typeof size === "string" && size.trim()) return `大小 ${size} B`
  return null
}

function conflictSnapshotVersion(record: Record<string, unknown>): string | null {
  const version = record.remoteVersionId ?? record.versionId ?? record.remoteEtag ?? record.etag
  return typeof version === "string" && version.trim() ? `版本 ${version}` : null
}

function availableConflictActions(entry: DriveSyncConflictEntryV1): readonly DriveSyncConflictResolutionAction[] {
  if (entry.type === "delete_vs_modify") {
    const actions: DriveSyncConflictResolutionAction[] = []
    if (localConflictSideExists(entry)) actions.push("keep_local")
    if (remoteConflictSideExists(entry)) actions.push("keep_remote")
    actions.push("confirm_delete", "skip")
    return actions
  }
  const actions: DriveSyncConflictResolutionAction[] = ["keep_local", "keep_remote"]
  if (isFileBackedConflict(entry)) actions.push("keep_both")
  actions.push("skip")
  return actions
}

function localConflictSideExists(entry: DriveSyncConflictEntryV1): boolean {
  return conflictSnapshotExists(entry.localSnapshot)
}

function remoteConflictSideExists(entry: DriveSyncConflictEntryV1): boolean {
  return conflictSnapshotExists(entry.remoteSnapshot)
}

function conflictSnapshotExists(snapshot: Record<string, unknown> | null): boolean {
  const record = conflictSnapshotValue(snapshot)
  if (!record) return false
  if (typeof record.exists === "boolean") return record.exists
  const changeType = record.type ?? record.kind
  return changeType !== "deleted" && changeType !== "trashed"
}

function conflictSnapshotChanged(
  previousSnapshot: Record<string, unknown> | null,
  currentSnapshot: Record<string, unknown> | null,
): boolean {
  if (!previousSnapshot) return false
  if (conflictSnapshotExists(previousSnapshot) !== conflictSnapshotExists(currentSnapshot)) return true
  if (!currentSnapshot) return false
  const previous = conflictSnapshotValue(previousSnapshot)
  const current = conflictSnapshotValue(currentSnapshot)
  if (!previous || !current) return false
  const previousKind = driveItemKindFromSnapshotRecord(previous)
  const currentKind = driveItemKindFromSnapshotRecord(current)
  if (previousKind !== null && previousKind !== currentKind) return true
  return [
    [previous.localHash ?? previous.hash, current.localHash ?? current.hash],
    [previous.localSize ?? previous.size, current.localSize ?? current.size],
    [previous.localMtimeMs ?? previous.mtimeMs, current.localMtimeMs ?? current.mtimeMs],
    [previous.name, current.name],
    [previous.parentId, current.parentId],
    [previous.updatedAt, current.updatedAt],
    [previous.currentPathHint ?? previous.pathHint, current.currentPathHint ?? current.pathHint],
    [previous.remoteVersionId ?? previous.versionId, current.remoteVersionId ?? current.versionId],
    [previous.remoteEtag ?? previous.etag, current.remoteEtag ?? current.etag],
  ].some(([before, after]) => before !== undefined && before !== null && after !== undefined && after !== null && before !== after)
}

function isFileBackedConflict(entry: DriveSyncConflictEntryV1): boolean {
  return localItemKindForConflict(entry) === "file" && remoteItemKindForConflictEntry(entry) === "file"
}

function localItemKindForConflict(entry: DriveSyncConflictEntryV1): "file" | "folder" | null {
  return driveItemKindFromSnapshotRecord(conflictSnapshotValue(entry.localSnapshot))
}

function remoteItemKindForConflictEntry(entry: DriveSyncConflictEntryV1): "file" | "folder" | null {
  return driveItemKindFromSnapshotRecord(conflictSnapshotValue(entry.remoteSnapshot))
}

function driveItemKindFromSnapshotRecord(value: unknown): "file" | "folder" | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const kind = record.itemKind ?? record.localKind ?? record.remoteItemKind ?? record.kind
  return kind === "file" || kind === "folder" ? kind : null
}

function normalizeRequiredString(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function preserveRequiredString(value: string, message: string): string {
  if (!value.trim()) throw new Error(message)
  return value
}

async function readBindingImportedGitignoreRules(input: DriveSyncCreateSafeBindingInput): Promise<readonly string[]> {
  if (!input.importGitignore || input.kind !== "folder") return []
  return readDriveSyncGitignoreRules(normalizeLocalPath(input.localPath))
}

function createBindingExcludeRules(
  userRules: readonly string[],
  importedGitignoreRules: readonly string[] = [],
  useDefaultExcludes: boolean | undefined = true,
): DriveSyncBindingEntryV1["excludeRules"] {
  const defaults = createDefaultDriveSyncExcludeRules()
  return {
    forced: defaults.forced,
    defaults: useDefaultExcludes === false ? [] : defaults.defaults,
    importedGitignore: [...importedGitignoreRules],
    user: [...userRules],
  }
}

async function getDriveItemFromAccountService(
  accountService: DriveSyncAccountService,
  itemId: string,
): Promise<DriveItemDto> {
  if (!accountService.getDriveItem) throw new Error("云盘条目加载能力不可用。")
  return accountService.getDriveItem(itemId)
}

function toRemoteTreeEntry(item: Partial<DriveItemTreeListPageDto["items"][number]> & {
  readonly id: string
  readonly name: string
  readonly type: string
}): DriveSyncRemoteTreeEntry {
  if (typeof item.path !== "string" || typeof item.size !== "string") {
    throw new Error("云盘目录树数据不完整。")
  }
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    path: item.path,
    size: item.size,
  }
}

function isDirectUploadedRemoteMatch(
  item: Partial<DriveItemTreeListPageDto["items"][number]> & {
    readonly name: string
    readonly type: string
  },
  name: string,
  expectedPath: string,
  expectedType: "file" | "folder",
): boolean {
  const expectedDepth = expectedPath.split("/").filter(Boolean).length - 1
  return item.name === name
    && item.type === expectedType
    && item.path === expectedPath
    && item.depth === expectedDepth
}

function isDirectRemoteItemMatch(
  item: Partial<DriveItemTreeListPageDto["items"][number]> & {
    readonly name: string
    readonly type: string
  },
  parentId: string | null,
  name: string,
): boolean {
  if (normalizeDriveSyncCollisionName(item.name) !== normalizeDriveSyncCollisionName(name)) return false
  if (Object.hasOwn(item, "parentId")) return (item.parentId ?? null) === parentId
  if (typeof item.depth === "number") return item.depth === 0
  if (typeof item.path === "string") {
    const pathName = normalizeRemoteTreePathSegments(item.path).split("/").filter(Boolean).at(-1) ?? ""
    return normalizeDriveSyncCollisionName(pathName) === normalizeDriveSyncCollisionName(name)
  }
  return true
}

function normalizeDriveSyncCollisionName(value: string): string {
  return value.normalize("NFC").toLowerCase()
}

function isRunningOperationStatus(status: DriveSyncOperationStatus): boolean {
  return status === "pending" || status === "running"
}

function isTerminalOperationStatus(status: DriveSyncOperationStatus): boolean {
  return status === "succeeded" || status === "conflict" || status === "error"
}

function compareUpdatedDesc(left: { readonly updatedAt: string }, right: { readonly updatedAt: string }): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
}

function compareCreatedAsc(left: { readonly createdAt: string }, right: { readonly createdAt: string }): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt)
}

function errorMessage(error: unknown): string {
  return sanitizeRequiredDriveSyncMessage(error instanceof Error ? error.message : "同步操作失败。", "同步操作失败。")
}

function retryDelayMs(attemptCount: number): number {
  const base = Math.min(RETRY_MAX_DELAY_MS, 1_000 * 2 ** Math.max(0, attemptCount - 1))
  const jitter = 0.8 + Math.random() * 0.4
  return Math.min(RETRY_MAX_DELAY_MS, Math.max(1_000, Math.round(base * jitter)))
}

function isRetryableSyncError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as Error & { readonly status?: unknown; readonly statusCode?: unknown; readonly code?: unknown }
  const status = typeof details.status === "number"
    ? details.status
    : typeof details.statusCode === "number" ? details.statusCode : null
  if (status !== null) return status === 408 || status === 425 || status === 429 || status >= 500
  const code = typeof details.code === "string" ? details.code.toUpperCase() : ""
  return [
    "EBUSY", "EMFILE", "ENFILE", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET",
    "EHOSTUNREACH", "ENETDOWN", "ENETRESET", "ENETUNREACH", "ETIMEDOUT", "EAI_AGAIN",
  ].includes(code)
}

function sanitizeNullableDriveSyncMessage(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const sanitized = sanitizeError(value)
  return sanitized ? sanitized : null
}

function sanitizeRequiredDriveSyncMessage(value: string, fallback = "同步失败。"): string {
  return sanitizeNullableDriveSyncMessage(value) ?? fallback
}

function operationLocalPermissionAction(kind: DriveSyncOperationEntryV1["kind"]): PermissionAction | null {
  switch (kind) {
    case "download":
    case "delete_local":
    case "move_local":
      return "fs.write.outside-userdata"
    case "upload":
      return "fs.read.outside-userdata"
    case "delete_remote":
    case "move_remote":
    case "scan":
    case "resync":
      return null
  }
}

function formatFolderDifferenceReason(differences: readonly string[]): string {
  return `本地文件夹与云盘文件夹内容不一致：${differences.slice(0, 3).join("；")}`
}

function normalizeConflictRelativePath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.split(/[\\/]+/u).filter(Boolean).join("/"))
  return normalized === "." ? "" : normalized
}

function normalizeRemoteTreePath(remotePath: string, rootName: string, rootPath?: string | null): string {
  const normalized = normalizeRemoteTreePathSegments(remotePath)
  const roots = [rootPath, rootName]
    .map((candidate) => normalizeRemoteTreePathSegments(candidate ?? ""))
    .filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index)
  for (const root of roots) {
    if (normalized === root) return ""
    const rootPrefix = `${root}/`
    if (normalized.startsWith(rootPrefix)) return normalized.slice(rootPrefix.length)
  }
  return normalized
}

function normalizeRemoteTreePathSegments(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join("/")
}

function driveItemNameFromPathHint(pathHint: string, fallback: string): string {
  return normalizeRemoteTreePathSegments(pathHint).split("/").filter(Boolean).at(-1) ?? fallback
}

function assertNoRemoteFolderPathCollisions(
  remoteEntries: readonly DriveSyncRemoteTreeEntry[],
  rootName: string,
  excludeRules: DriveSyncBindingEntryV1["excludeRules"],
  rootPath?: string | null,
): void {
  const seen = new Map<string, string>()
  for (const item of remoteEntries) {
    const relativePath = normalizeRemoteTreePath(item.path, rootName, rootPath)
    if (!relativePath || isDriveSyncExcluded(relativePath, excludeRules, item.type)) continue
    assertDriveSyncLocalRelativePathPortable(relativePath)
    const key = pathCollisionKey(relativePath)
    const existing = seen.get(key)
    if (existing) {
      throw new Error(`云盘文件夹包含本地无法区分的路径：${existing} / ${relativePath}`)
    }
    seen.set(key, relativePath)
  }
}

async function createConflictLocalCopy(localPath: string): Promise<string> {
  for (let index = 1; index <= 1000; index += 1) {
    const copyLocalPath = conflictCopyLocalPath(localPath, index)
    try {
      await copyFile(localPath, copyLocalPath, fsConstants.COPYFILE_EXCL)
      return copyLocalPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
      throw error
    }
  }
  throw new Error("无法创建冲突副本，已有过多同名文件。")
}

function conflictCopyLocalPath(localPath: string, index = 1): string {
  const extension = path.extname(localPath)
  const baseName = path.basename(localPath, extension)
  const suffix = index === 1 ? ".local" : `.local-${index}`
  return path.join(path.dirname(localPath), `${baseName}${suffix}${extension}`)
}

function parentRelativePathForSync(relativePath: string): string | null {
  const parent = path.posix.dirname(relativePath)
  return parent === "." ? null : parent
}

async function moveLocalPathToRecoverableTrash(localPath: string): Promise<void> {
  const trashRoot = path.join(path.dirname(localPath), ".synapse-sync-trash")
  await mkdir(trashRoot, { recursive: true })
  const targetPath = path.join(trashRoot, `${Date.now()}-${path.basename(localPath)}`)
  await rename(localPath, targetPath)
}

function defaultState(now: string, ownerUserId: string | null = null): DriveSyncStateEntryV1 {
  return {
    schemaVersion: 2,
    ownerUserId,
    health: "idle",
    lastCursor: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastError: null,
    updatedAt: now,
    healthByOwner: {},
  }
}

function ownerHealthState(state: DriveSyncStateEntryV1) {
  return {
    health: state.health,
    lastCursor: state.lastCursor,
    lastStartedAt: state.lastStartedAt,
    lastStoppedAt: state.lastStoppedAt,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
  }
}

function isAutomaticallySyncableBinding(binding: DriveSyncBindingEntryV1): boolean {
  return binding.status === "active" || binding.status === "conflict"
}

function relativePathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeConflictRelativePath(left)
  const normalizedRight = normalizeConflictRelativePath(right)
  if (normalizedLeft === "" || normalizedRight === "") return true
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`)
}

function localPathForRelative(binding: DriveSyncBindingEntryV1, relativePath: string): string {
  return relativePath ? path.join(binding.localPath, relativePath) : binding.localPath
}

function localMatchesBaseline(
  local: DriveSyncLocalSnapshotEntry | undefined,
  baseline: DriveSyncBaselineEntryV1,
): boolean {
  if (!local || local.kind !== baseline.kind) return false
  return local.kind === "folder" || Boolean(local.hash && baseline.localHash && local.hash === baseline.localHash)
}

function safeRemoteFileSize(value: string): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function compareRelativePathDepth(
  [left]: readonly [string, DriveSyncRemoteTreeEntry],
  [right]: readonly [string, DriveSyncRemoteTreeEntry],
): number {
  return pathDepth(left) - pathDepth(right) || left.localeCompare(right)
}

function compareBaselineDepth(left: DriveSyncBaselineEntryV1, right: DriveSyncBaselineEntryV1): number {
  return pathDepth(left.relativePath) - pathDepth(right.relativePath) || left.relativePath.localeCompare(right.relativePath)
}

function compareLocalEntryDepth(left: DriveSyncLocalSnapshotEntry, right: DriveSyncLocalSnapshotEntry): number {
  return pathDepth(left.relativePath) - pathDepth(right.relativePath) || left.relativePath.localeCompare(right.relativePath)
}

function pathDepth(relativePath: string): number {
  return relativePath ? relativePath.split("/").length : 0
}

function isDescendantOfPathSet(relativePath: string, roots: ReadonlySet<string>): boolean {
  for (const root of roots) {
    if (relativePath !== root && (root === "" || relativePath.startsWith(`${root}/`))) return true
  }
  return false
}

function isPathInSubtreeForSync(relativePath: string, root: string): boolean {
  return root === "" || relativePath === root || relativePath.startsWith(`${root}/`)
}

function hasFullRescanDecision(
  relativePath: string,
  operations: readonly DriveSyncPlannedOperation[],
  conflicts: readonly DriveSyncPlannedConflict[],
): boolean {
  return operations.some((operation) => operation.relativePath === relativePath)
    || conflicts.some((conflict) => conflict.relativePath === relativePath)
}

function safeStagingSegment(bindingId: string): string {
  return bindingId.replace(/[^a-zA-Z0-9._-]/gu, "_")
}

function isManagedStagingPath(snapshotPath: string, configuredRoot?: string): boolean {
  const stagingRoot = path.resolve(configuredRoot ?? path.join(os.tmpdir(), "synapse-drive-sync-staging"))
  const resolvedSnapshot = path.resolve(snapshotPath)
  return resolvedSnapshot.startsWith(`${stagingRoot}${path.sep}`)
}

async function copyLocalFileToVerifiedSnapshot(
  rootPath: string,
  localPath: string,
  snapshotPath: string,
): Promise<{ readonly size: number; readonly mtimeMs: number; readonly hash: string } | null> {
  await assertNoSymlinkPathComponents(rootPath, localPath)
  const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
  const source = await open(localPath, fsConstants.O_RDONLY | noFollow)
  let before: Stats
  let after: Stats
  let snapshotHash: string
  try {
    before = await source.stat()
    if (!before.isFile()) throw new Error("本地条目类型不支持同步。")
    const hasher = createHash("sha256")
    await pipeline(
      source.createReadStream({ autoClose: false }),
      new Transform({
        transform(chunk, _encoding, callback) {
          hasher.update(chunk)
          callback(null, chunk)
        },
      }),
      createWriteStream(snapshotPath, { flags: "wx" }),
    )
    snapshotHash = `sha256:${hasher.digest("hex")}`
    after = await source.stat()
  } finally {
    await source.close()
  }
  await assertNoSymlinkPathComponents(rootPath, localPath)
  const [current, snapshotStats, verifiedHash] = await Promise.all([
    lstat(localPath),
    lstat(snapshotPath),
    hashDriveSyncFile(snapshotPath),
  ])
  if (
    !current.isFile()
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.dev !== after.dev
    || before.ino !== after.ino
    || after.dev !== current.dev
    || after.ino !== current.ino
    || snapshotStats.size !== after.size
    || snapshotHash !== verifiedHash
  ) return null
  return { size: snapshotStats.size, mtimeMs: after.mtimeMs, hash: snapshotHash }
}

function uploadSnapshotFromOperation(operation: DriveSyncOperationEntryV1 | undefined): UploadSnapshot | null {
  if (
    !operation?.snapshotPath
    || !operation.snapshotHash
    || operation.snapshotSize === null
    || operation.snapshotSize === undefined
    || operation.snapshotMtimeMs === null
    || operation.snapshotMtimeMs === undefined
  ) return null
  return {
    directory: path.dirname(operation.snapshotPath),
    path: operation.snapshotPath,
    hash: operation.snapshotHash,
    size: operation.snapshotSize,
    sourceMtimeMs: operation.snapshotMtimeMs,
  }
}

async function removeManagedSnapshot(snapshotPath: string, configuredRoot?: string): Promise<void> {
  if (!isManagedStagingPath(snapshotPath, configuredRoot)) return
  await rm(path.dirname(snapshotPath), { recursive: true, force: true })
}

function folderLocalManifest(entries: readonly {
  readonly relativePath: string
  readonly kind: "file" | "folder"
  readonly size: number | null
  readonly mtimeMs: number | null
  readonly hash: string | null
}[]): string {
  return JSON.stringify(entries
    .map((entry) => [entry.relativePath, entry.kind, entry.size, entry.mtimeMs, entry.hash])
    .sort(([left], [right]) => String(left).localeCompare(String(right))))
}

function folderRemoteManifest(entries: ReadonlyMap<string, DriveSyncRemoteTreeEntry>): string {
  return JSON.stringify([...entries]
    .map(([relativePath, entry]) => [relativePath, entry.id, entry.type, entry.size])
    .sort(([left], [right]) => String(left).localeCompare(String(right))))
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  action: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await action(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}
