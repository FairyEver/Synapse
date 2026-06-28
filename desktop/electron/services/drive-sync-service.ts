import { createHash, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { watch as watchFs, type FSWatcher } from "node:fs"
import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises"
import path from "node:path"
import type {
  DriveChangeDto,
  DriveChangeListPageDto,
  DriveItemDto,
  DriveSyncBindingDto,
  DriveSyncBindingStatus,
  DriveSyncConflictDto,
  DriveSyncOperationDto,
  DriveSyncOperationStatus,
  DriveSyncSnapshotDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveLocalUploadRequest, DriveLocalUploadResult } from "../../src/types/bridge"
import type {
  DataNamespace,
  DriveSyncBaselineEntryV1,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
  DriveSyncStateEntryV1,
} from "../runtime/data-repo"

export interface DriveSyncDriveApi {
  readonly listDriveChanges: (input: { readonly cursor?: string | null; readonly limit?: number }) => Promise<DriveChangeListPageDto>
  readonly listDriveItems?: (parentId: string | null) => Promise<readonly DriveItemDto[]>
  readonly downloadDriveFile: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<unknown>
  readonly uploadDriveLocalItems: (input: DriveLocalUploadRequest) => Promise<DriveLocalUploadResult>
  readonly renameDriveItem: (itemId: string, name: string) => Promise<unknown>
  readonly moveDriveItem: (itemId: string, parentId: string | null) => Promise<unknown>
  readonly deleteDriveItem: (itemId: string) => Promise<unknown>
  readonly createDriveFolder: (input: { readonly parentId?: string | null; readonly name: string }) => Promise<DriveItemDto>
}

export interface DriveSyncLocalScanEntry {
  readonly kind: "file" | "folder"
  readonly relativePath: string
  readonly absolutePath: string
  readonly hash: string | null
  readonly mtimeMs: number | null
}

export interface DriveSyncFileSystem {
  readonly watch: (rootPath: string, onChange: () => void) => { readonly close: () => void }
  readonly scan: (
    rootPath: string,
    options: { readonly kind: "file" | "folder"; readonly excludeRules: readonly string[] },
  ) => Promise<readonly DriveSyncLocalScanEntry[]>
  readonly ensureParentDirectory: (filePath: string) => Promise<void>
  readonly ensureDirectory?: (dirPath: string) => Promise<void>
  readonly isInitialDownloadTargetAvailable?: (targetPath: string, kind: "file" | "folder") => Promise<boolean>
  readonly trashLocalPath: (targetPath: string, rootPath: string) => Promise<void>
  readonly moveLocalPath?: (fromPath: string, toPath: string) => Promise<void>
}

export interface DriveSyncServiceDeps {
  readonly baselines?: DataNamespace<DriveSyncBaselineEntryV1>
  readonly bindings: DataNamespace<DriveSyncBindingEntryV1>
  readonly operations: DataNamespace<DriveSyncOperationEntryV1>
  readonly conflicts: DataNamespace<DriveSyncConflictEntryV1>
  readonly state: DataNamespace<DriveSyncStateEntryV1>
  readonly drive?: DriveSyncDriveApi
  readonly fs?: DriveSyncFileSystem
  readonly syncIntervalMs?: number
  readonly now?: () => Date
  readonly createId?: (prefix: string) => string
}

export interface DriveSyncCreateBindingInput {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly drivePathHint?: string | null
  readonly localPath: string
  readonly remoteCursor?: string | null
  readonly excludeRules?: readonly string[]
  readonly initialDirection?: "download_remote" | "none"
}

export interface DriveSyncRecordOperationInput {
  readonly bindingId: string
  readonly kind: DriveSyncOperationEntryV1["kind"]
  readonly status: DriveSyncOperationStatus
  readonly driveItemId?: string | null
  readonly relativePath: string
  readonly localPath?: string | null
  readonly remotePathHint?: string | null
  readonly message?: string | null
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

type DriveSyncConflictResolutionAction = "use_local" | "use_remote" | "keep_both" | "skip" | "confirm_delete"

interface PlannedOperation {
  readonly kind: DriveSyncOperationEntryV1["kind"]
  readonly driveItemId?: string | null
  readonly relativePath: string
  readonly localPath?: string | null
  readonly remotePathHint?: string | null
  readonly previousRelativePath?: string | null
  readonly localHash?: string | null
  readonly localMtimeMs?: number | null
  readonly itemKind?: "file" | "folder"
}

type DriveSyncServiceEvents = {
  changed: [snapshot: DriveSyncSnapshotDto]
}

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

export function createDriveSyncService(deps: DriveSyncServiceDeps) {
  const events = new TypedDriveSyncEventEmitter()
  const baselines = deps.baselines ?? createVolatileNamespace<DriveSyncBaselineEntryV1>("drive.sync.baselines")
  const localFs = deps.fs ?? createNodeDriveSyncFileSystem()
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = (prefix: string) => deps.createId?.(prefix) ?? `${prefix}:${randomUUID()}`
  const syncIntervalMs = deps.syncIntervalMs ?? 60_000
  const watchers = new Map<string, { readonly rootPath: string; readonly close: () => void; timer: ReturnType<typeof setTimeout> | null }>()
  let interval: ReturnType<typeof setInterval> | null = null
  let syncPassRunning = false

  async function start(): Promise<void> {
    if (interval) return
    await setHealth({ health: "syncing" })
    await reconcileLocalWatcher()
    await runSyncPass({ includeLocalRescan: true, includeRemotePoll: true })
    interval = setInterval(() => {
      void runSyncPass({ includeLocalRescan: false, includeRemotePoll: true })
    }, syncIntervalMs)
    await setHealth({ health: "idle" })
  }

  async function stop(): Promise<void> {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
    stopLocalWatcher()
    await setHealth({ health: "paused" })
  }

  async function getSnapshot(): Promise<DriveSyncSnapshotDto> {
    const bindings = (await deps.bindings.list())
      .filter((binding) => binding.status !== "removed")
      .sort(compareUpdatedDesc)
      .map(toBindingDto)
    const conflicts = (await deps.conflicts.list())
      .filter((conflict) => conflict.status === "open")
      .sort(compareCreatedAsc)
      .map(toConflictDto)
    const operations = (await deps.operations.list())
      .sort(compareUpdatedDesc)
      .slice(0, 20)
      .map(toOperationDto)

    return {
      bindings,
      conflicts,
      operations,
      summary: {
        activeBindingCount: bindings.filter((binding) => binding.status === "active").length,
        runningOperationCount: operations.filter((operation) => isRunningOperationStatus(operation.status)).length,
        conflictCount: conflicts.length,
        errorCount: bindings.filter((binding) => binding.status === "error").length
          + operations.filter((operation) => operation.status === "error").length,
      },
    }
  }

  async function createBinding(input: DriveSyncCreateBindingInput): Promise<DriveSyncBindingDto> {
    const localPath = normalizeRequiredString(input.localPath, "本地路径不能为空。")
    const driveItemId = normalizeRequiredString(input.driveItemId, "云盘条目不能为空。")
    const driveItemName = normalizeRequiredString(input.driveItemName, "云盘条目名称不能为空。")
    if (input.kind !== "file" && input.kind !== "folder") throw new Error("云盘条目类型无效。")

    const activeBindings = (await deps.bindings.list()).filter((binding) => binding.status !== "removed")
    if (activeBindings.some((binding) => binding.driveItemId === driveItemId)) {
      throw new Error("云盘条目已绑定。")
    }
    if (activeBindings.some((binding) => binding.localPath === localPath)) {
      throw new Error("本地路径已绑定。")
    }

    const now = timestamp()
    const entry: DriveSyncBindingEntryV1 = {
      id: createId("drive-sync-binding"),
      schemaVersion: 1,
      driveItemId,
      driveItemName,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath,
      status: "active",
      remoteCursor: input.remoteCursor ?? null,
      lastSyncedAt: null,
      lastError: null,
      excludeRules: normalizeExcludeRules(input.excludeRules),
      createdAt: now,
      updatedAt: now,
    }

    if (input.initialDirection === "download_remote") {
      await assertInitialDownloadTargetAvailable(entry)
    }

    await deps.bindings.upsert(entry)
    if (input.initialDirection === "download_remote") {
      try {
        await downloadInitialRemoteTree(entry)
      } catch (error) {
        await cleanupBindingData(entry.id)
        await deps.bindings.upsert({
          ...entry,
          status: "removed",
          lastError: errorMessage(error),
          updatedAt: timestamp(),
        })
        throw error
      }
    }
    await reconcileLocalWatcher()
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
      lastError,
      updatedAt: timestamp(),
    }
    await deps.bindings.upsert(entry)
    await reconcileLocalWatcher()
    await emitChanged()
    return toBindingDto(entry)
  }

  async function pauseBinding(input: { readonly id: string }): Promise<DriveSyncBindingDto> {
    return updateBindingStatus(input.id, "paused")
  }

  async function resumeBinding(input: { readonly id: string }): Promise<DriveSyncBindingDto> {
    const openConflicts = (await deps.conflicts.list()).some((conflict) =>
      conflict.bindingId === input.id && conflict.status === "open",
    )
    if (openConflicts) throw new Error("请先处理同步冲突。")
    return updateBindingStatus(input.id, "active")
  }

  async function removeBinding(id: string): Promise<void> {
    await updateBindingStatus(id, "removed")
  }

  async function updateExcludeRules(input: { readonly id: string; readonly excludeRules: readonly string[] }): Promise<DriveSyncBindingDto> {
    const existing = await requireBinding(input.id)
    const entry: DriveSyncBindingEntryV1 = {
      ...existing,
      excludeRules: normalizeExcludeRules(input.excludeRules),
      updatedAt: timestamp(),
    }
    await deps.bindings.upsert(entry)
    await emitChanged()
    return toBindingDto(entry)
  }

  async function rescanBinding(id: string): Promise<void> {
    const binding = await requireBinding(id)
    if (binding.status === "paused" || binding.status === "removed") return
    try {
      const localEntries = await localFs.scan(binding.localPath, {
        kind: binding.kind,
        excludeRules: binding.excludeRules,
      })
      await planAndApplyLocalScan(binding, localEntries)
      await clearBindingErrorIfHealthy(binding.id)
    } catch (error) {
      await recordOperation({
        bindingId: binding.id,
        kind: "scan",
        status: "error",
        relativePath: "",
        message: errorMessage(error),
      })
      await updateBindingStatus(binding.id, "error", errorMessage(error))
    }
  }

  async function pollRemoteChanges(id: string): Promise<void> {
    const binding = await requireBinding(id)
    if (binding.status === "paused" || binding.status === "removed") return
    const drive = requireDriveApi()
    try {
      const page = await drive.listDriveChanges({ cursor: binding.remoteCursor, limit: 100 })
      if (page.resyncRequired) {
        await recordOperation({
          bindingId: binding.id,
          kind: "resync",
          status: "retry_wait",
          relativePath: "",
          message: "远端变更游标已失效，需要重新扫描。",
        })
        await rescanBinding(binding.id)
      } else {
        for (const change of page.items) {
          await applyRemoteChange(binding, change)
        }
      }
      await updateBindingCursor(binding.id, page.nextCursor)
    } catch (error) {
      await recordOperation({
        bindingId: binding.id,
        kind: "resync",
        status: "error",
        relativePath: "",
        message: errorMessage(error),
      })
      await updateBindingStatus(binding.id, "error", errorMessage(error))
    }
  }

  async function retryOperation(input: { readonly id: string }): Promise<void> {
    const operation = await deps.operations.get(input.id)
    if (!operation) throw new Error("同步操作不存在。")
    const binding = await requireBinding(operation.bindingId)
    await executeOperation(binding, {
      kind: operation.kind,
      driveItemId: operation.driveItemId,
      relativePath: operation.relativePath,
      localPath: operation.localPath,
      remotePathHint: operation.remotePathHint,
    }, operation)
  }

  async function resolveConflict(input: { readonly id: string; readonly action: DriveSyncConflictResolutionAction }): Promise<void> {
    const conflict = await deps.conflicts.get(input.id)
    if (!conflict || conflict.status !== "open") throw new Error("同步冲突不存在。")
    const binding = await requireBinding(conflict.bindingId)

    if (input.action === "use_local") {
      await executeOperation(binding, {
        kind: "upload",
        driveItemId: conflict.driveItemId,
        relativePath: conflict.relativePath,
        localPath: conflict.localPath,
        remotePathHint: conflict.remotePathHint,
      })
    } else if (input.action === "use_remote") {
      await executeOperation(binding, {
        kind: "download",
        driveItemId: conflict.driveItemId,
        relativePath: conflict.relativePath,
        localPath: conflict.localPath,
        remotePathHint: conflict.remotePathHint,
      })
    } else if (input.action === "keep_both" && conflict.driveItemId) {
      const copyPath = conflictCopyLocalPath(conflict.localPath ?? localPathFor(binding, conflict.relativePath))
      await requireDriveApi().downloadDriveFile({ itemId: conflict.driveItemId, outputPath: copyPath })
      await recordOperation({
        bindingId: binding.id,
        kind: "download",
        status: "succeeded",
        driveItemId: conflict.driveItemId,
        relativePath: normalizeRelativePath(path.relative(binding.localPath, copyPath)),
        localPath: copyPath,
        remotePathHint: conflict.remotePathHint,
      })
    } else if (input.action === "confirm_delete") {
      const operationKind = conflict.driveItemId ? "delete_remote" : "delete_local"
      await executeOperation(binding, {
        kind: operationKind,
        driveItemId: conflict.driveItemId,
        relativePath: conflict.relativePath,
        localPath: conflict.localPath,
        remotePathHint: conflict.remotePathHint,
      })
    }

    await deps.conflicts.upsert({
      ...conflict,
      status: input.action === "skip" ? "ignored" : "resolved",
      resolution: input.action === "confirm_delete" ? "skip" : input.action,
      resolvedAt: timestamp(),
    })
    await restoreBindingWhenNoOpenConflicts(binding.id)
    await emitChanged()
  }

  function stopLocalWatcher(): void {
    for (const watcher of watchers.values()) {
      if (watcher.timer) clearTimeout(watcher.timer)
      watcher.close()
    }
    watchers.clear()
  }

  async function recordOperation(input: DriveSyncRecordOperationInput): Promise<DriveSyncOperationDto> {
    await requireBinding(input.bindingId)
    const now = timestamp()
    const entry: DriveSyncOperationEntryV1 = {
      id: createId("drive-sync-operation"),
      schemaVersion: 1,
      bindingId: input.bindingId,
      kind: input.kind,
      status: input.status,
      driveItemId: input.driveItemId ?? null,
      relativePath: input.relativePath,
      localPath: input.localPath ?? null,
      remotePathHint: input.remotePathHint ?? null,
      message: input.message ?? null,
      createdAt: now,
      updatedAt: now,
      startedAt: input.status === "running" ? now : null,
      completedAt: isTerminalOperationStatus(input.status) ? now : null,
    }
    await deps.operations.upsert(entry)
    await emitChanged()
    return toOperationDto(entry)
  }

  async function recordConflict(input: DriveSyncRecordConflictInput): Promise<DriveSyncConflictDto> {
    await requireBinding(input.bindingId)
    const existing = (await deps.conflicts.list()).find((conflict) =>
      conflict.status === "open"
      && conflict.bindingId === input.bindingId
      && conflict.relativePath === input.relativePath
      && conflict.type === input.type,
    )
    const now = timestamp()
    const entry: DriveSyncConflictEntryV1 = {
      id: existing?.id ?? createId("drive-sync-conflict"),
      schemaVersion: 1,
      bindingId: input.bindingId,
      driveItemId: input.driveItemId ?? null,
      relativePath: input.relativePath,
      localPath: input.localPath ?? null,
      remotePathHint: input.remotePathHint ?? null,
      type: input.type,
      status: "open",
      localSnapshot: input.localSnapshot ?? null,
      remoteSnapshot: input.remoteSnapshot ?? null,
      resolution: null,
      createdAt: existing?.createdAt ?? now,
      resolvedAt: null,
    }
    await deps.conflicts.upsert(entry)
    await updateBindingStatus(input.bindingId, "conflict")
    return toConflictDto(entry)
  }

  async function setHealth(input: DriveSyncSetHealthInput): Promise<DriveSyncStateEntryV1> {
    const current = await loadState()
    const now = timestamp()
    const entry: DriveSyncStateEntryV1 = {
      ...current,
      health: input.health,
      lastCursor: input.lastCursor ?? current.lastCursor,
      lastError: input.lastError ?? null,
      lastStartedAt: input.health === "syncing" ? now : current.lastStartedAt,
      lastStoppedAt: input.health === "idle" || input.health === "paused" || input.health === "error"
        ? now
        : current.lastStoppedAt,
      updatedAt: now,
    }
    await deps.state.setSingleton(entry)
    await emitChanged()
    return entry
  }

  async function runSyncPass(options: { readonly includeLocalRescan: boolean; readonly includeRemotePoll: boolean }): Promise<void> {
    if (syncPassRunning) return
    syncPassRunning = true
    try {
      const activeBindings = (await deps.bindings.list()).filter((binding) => binding.status === "active")
      for (const binding of activeBindings) {
        if (options.includeLocalRescan) await rescanBinding(binding.id)
        if (options.includeRemotePoll) await pollRemoteChanges(binding.id)
      }
    } finally {
      syncPassRunning = false
    }
  }

  async function reconcileLocalWatcher(): Promise<void> {
    const activeBindings = (await deps.bindings.list()).filter((binding) => binding.status === "active")
    const activeIds = new Set(activeBindings.map((binding) => binding.id))
    for (const [id, watcher] of watchers) {
      if (!activeIds.has(id)) {
        if (watcher.timer) clearTimeout(watcher.timer)
        watcher.close()
        watchers.delete(id)
      }
    }

    for (const binding of activeBindings) {
      const existing = watchers.get(binding.id)
      if (existing?.rootPath === binding.localPath) continue
      existing?.close()
      const watcher = localFs.watch(binding.localPath, () => {
        const current = watchers.get(binding.id)
        if (!current) return
        if (current.timer) clearTimeout(current.timer)
        current.timer = setTimeout(() => {
          const latest = watchers.get(binding.id)
          if (latest) latest.timer = null
          void rescanBinding(binding.id)
        }, 500)
      })
      watchers.set(binding.id, { rootPath: binding.localPath, close: watcher.close, timer: null })
    }
  }

  async function planAndApplyLocalScan(
    binding: DriveSyncBindingEntryV1,
    localEntries: readonly DriveSyncLocalScanEntry[],
  ): Promise<void> {
    const bindingBaselines = await listBaselines(binding.id)
    const baselineByPath = new Map(bindingBaselines.map((entry) => [entry.relativePath, entry]))
    const baselineByLowerPath = new Map(bindingBaselines.map((entry) => [normalizeCasePath(entry.relativePath), entry]))
    const localByPath = new Map(localEntries.map((entry) => [entry.relativePath, entry]))
    const usedLocalPaths = new Set<string>()
    const movedBaselinePaths = new Set<string>()
    const deletedBaselines = bindingBaselines.filter((entry) => !localByPath.has(entry.relativePath))

    for (const deleted of deletedBaselines) {
      const movedTo = localEntries.find((entry) =>
        !usedLocalPaths.has(entry.relativePath)
        && isSameLocalIdentity(deleted, entry),
      )
      if (!movedTo) continue
      usedLocalPaths.add(movedTo.relativePath)
      movedBaselinePaths.add(deleted.relativePath)
      const conflict = await findMoveTargetConflict(binding, deleted, movedTo, baselineByPath, baselineByLowerPath)
      if (conflict) {
        await recordConflict(conflict)
        continue
      }
      await executeOperation(binding, {
        kind: "move_remote",
        driveItemId: deleted.driveItemId,
        relativePath: movedTo.relativePath,
        localPath: movedTo.absolutePath,
        remotePathHint: remotePathHintFor(binding, movedTo.relativePath),
        previousRelativePath: deleted.relativePath,
        localHash: movedTo.hash,
        localMtimeMs: movedTo.mtimeMs,
        itemKind: movedTo.kind,
      })
    }

    for (const localEntry of localEntries) {
      if (usedLocalPaths.has(localEntry.relativePath)) continue
      const baseline = baselineByPath.get(localEntry.relativePath)
      const lowerBaseline = baselineByLowerPath.get(normalizeCasePath(localEntry.relativePath))
      if (!baseline && lowerBaseline) {
        await recordConflict({
          bindingId: binding.id,
          driveItemId: lowerBaseline.driveItemId,
          relativePath: localEntry.relativePath,
          localPath: localEntry.absolutePath,
          remotePathHint: remotePathHintFor(binding, localEntry.relativePath),
          type: "path_conflict",
          localSnapshot: localScanSnapshot(localEntry),
          remoteSnapshot: lowerBaseline,
        })
        continue
      }
      if (!baseline) {
        await executeOperation(binding, {
          kind: "upload",
          relativePath: localEntry.relativePath,
          localPath: localEntry.absolutePath,
          remotePathHint: remotePathHintFor(binding, localEntry.relativePath),
          localHash: localEntry.hash,
          localMtimeMs: localEntry.mtimeMs,
          itemKind: localEntry.kind,
        })
        continue
      }
      if (baseline.kind !== localEntry.kind) {
        await recordConflict({
          bindingId: binding.id,
          driveItemId: baseline.driveItemId,
          relativePath: localEntry.relativePath,
          localPath: localEntry.absolutePath,
          remotePathHint: baseline.remotePathHint,
          type: "type_mismatch",
          localSnapshot: localScanSnapshot(localEntry),
          remoteSnapshot: baseline,
        })
        continue
      }
      if (localEntry.kind === "file" && baseline.localHash !== localEntry.hash) {
        await executeOperation(binding, {
          kind: "upload",
          driveItemId: baseline.driveItemId,
          relativePath: localEntry.relativePath,
          localPath: localEntry.absolutePath,
          remotePathHint: baseline.remotePathHint,
          localHash: localEntry.hash,
          localMtimeMs: localEntry.mtimeMs,
          itemKind: localEntry.kind,
        })
      }
    }

    for (const baseline of deletedBaselines) {
      if (movedBaselinePaths.has(baseline.relativePath)) continue
      await executeOperation(binding, {
        kind: "delete_remote",
        driveItemId: baseline.driveItemId,
        relativePath: baseline.relativePath,
        remotePathHint: baseline.remotePathHint,
        itemKind: baseline.kind,
      })
    }
  }

  async function findMoveTargetConflict(
    binding: DriveSyncBindingEntryV1,
    deleted: DriveSyncBaselineEntryV1,
    target: DriveSyncLocalScanEntry,
    baselineByPath: ReadonlyMap<string, DriveSyncBaselineEntryV1>,
    baselineByLowerPath: ReadonlyMap<string, DriveSyncBaselineEntryV1>,
  ): Promise<DriveSyncRecordConflictInput | null> {
    const occupied = baselineByPath.get(target.relativePath)
    const caseOccupied = baselineByLowerPath.get(normalizeCasePath(target.relativePath))
    if ((occupied && occupied.driveItemId !== deleted.driveItemId)
      || (caseOccupied && caseOccupied.relativePath !== target.relativePath && caseOccupied.driveItemId !== deleted.driveItemId)) {
      return {
        bindingId: binding.id,
        driveItemId: deleted.driveItemId,
        relativePath: target.relativePath,
        localPath: target.absolutePath,
        remotePathHint: remotePathHintFor(binding, target.relativePath),
        type: "path_conflict",
        localSnapshot: localScanSnapshot(target),
        remoteSnapshot: occupied ?? caseOccupied ?? deleted,
      }
    }
    const parentRelativePath = parentPath(target.relativePath)
    if (parentRelativePath && !baselineByPath.get(parentRelativePath)) {
      return {
        bindingId: binding.id,
        driveItemId: deleted.driveItemId,
        relativePath: target.relativePath,
        localPath: target.absolutePath,
        remotePathHint: remotePathHintFor(binding, target.relativePath),
        type: "path_conflict",
        localSnapshot: localScanSnapshot(target),
        remoteSnapshot: { reason: "missing_parent_baseline", parentRelativePath },
      }
    }
    return null
  }

  async function applyRemoteChange(binding: DriveSyncBindingEntryV1, change: DriveChangeDto): Promise<void> {
    const baseline = await findBaselineForRemoteChange(binding.id, change)
    if (!baseline && change.itemId !== binding.driveItemId) return
    const relativePath = baseline?.relativePath ?? relativePathFromRemoteHint(binding, change.pathHint) ?? ""
    if (isExcludedPath(relativePath, binding.excludeRules)) return

    if (change.type === "created" || change.type === "content_updated" || change.type === "restored") {
      await executeOperation(binding, {
        kind: "download",
        driveItemId: change.itemId,
        relativePath,
        localPath: path.join(binding.localPath, relativePath),
        remotePathHint: change.pathHint ?? baseline?.remotePathHint ?? null,
      })
      return
    }
    if (change.type === "renamed" || change.type === "moved") {
      await executeOperation(binding, {
        kind: "move_local",
        driveItemId: change.itemId,
        relativePath,
        localPath: path.join(binding.localPath, relativePath),
        remotePathHint: change.pathHint ?? baseline?.remotePathHint ?? null,
        previousRelativePath: baseline?.relativePath ?? null,
      })
      return
    }
    if (change.type === "trashed" || change.type === "deleted") {
      await executeOperation(binding, {
        kind: "delete_local",
        driveItemId: change.itemId,
        relativePath,
        localPath: path.join(binding.localPath, relativePath),
        remotePathHint: change.pathHint ?? baseline?.remotePathHint ?? null,
      })
    }
  }

  async function downloadInitialRemoteTree(binding: DriveSyncBindingEntryV1): Promise<void> {
    const drive = requireDriveApi()
    if (binding.kind === "file") {
      await localFs.ensureParentDirectory(binding.localPath)
      await drive.downloadDriveFile({ itemId: binding.driveItemId, outputPath: binding.localPath })
      const [localEntry] = await localFs.scan(binding.localPath, { kind: "file", excludeRules: binding.excludeRules })
      await baselines.upsert({
        id: baselineId(binding.id, ""),
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "",
        driveItemId: binding.driveItemId,
        parentDriveItemId: null,
        kind: "file",
        localHash: localEntry?.hash ?? null,
        localMtimeMs: localEntry?.mtimeMs ?? null,
        remotePathHint: binding.drivePathHint,
        remoteVersionId: null,
        remoteEtag: null,
        updatedAt: timestamp(),
      })
      await recordOperation({
        bindingId: binding.id,
        kind: "download",
        status: "succeeded",
        driveItemId: binding.driveItemId,
        relativePath: "",
        localPath: binding.localPath,
        remotePathHint: binding.drivePathHint,
      })
      return
    }

    if (!drive.listDriveItems) throw new Error("云盘文件夹列表能力不可用。")
    await ensureLocalDirectory(binding.localPath)
    await baselines.upsert({
      id: baselineId(binding.id, ""),
      schemaVersion: 1,
      bindingId: binding.id,
      relativePath: "",
      driveItemId: binding.driveItemId,
      parentDriveItemId: null,
      kind: "folder",
      localHash: null,
      localMtimeMs: null,
      remotePathHint: binding.drivePathHint,
      remoteVersionId: null,
      remoteEtag: null,
      updatedAt: timestamp(),
    })
    await downloadRemoteFolderChildren(binding, binding.driveItemId, "", drive)
    await recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "succeeded",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: binding.drivePathHint,
    })
  }

  async function downloadRemoteFolderChildren(
    binding: DriveSyncBindingEntryV1,
    parentDriveItemId: string,
    parentRelativePath: string,
    drive: DriveSyncDriveApi,
  ): Promise<void> {
    const items = await drive.listDriveItems?.(parentDriveItemId) ?? []
    for (const item of items) {
      const relativePath = normalizeRelativePath(path.join(parentRelativePath, item.name))
      if (isExcludedPath(relativePath, binding.excludeRules)) continue
      const targetPath = localPathFor(binding, relativePath)
      if (item.type === "folder") {
        await ensureLocalDirectory(targetPath)
        await baselines.upsert({
          id: baselineId(binding.id, relativePath),
          schemaVersion: 1,
          bindingId: binding.id,
          relativePath,
          driveItemId: item.id,
          parentDriveItemId,
          kind: "folder",
          localHash: null,
          localMtimeMs: null,
          remotePathHint: remotePathHintFor(binding, relativePath),
          remoteVersionId: null,
          remoteEtag: null,
          updatedAt: timestamp(),
        })
        await downloadRemoteFolderChildren(binding, item.id, relativePath, drive)
        continue
      }
      await localFs.ensureParentDirectory(targetPath)
      await drive.downloadDriveFile({ itemId: item.id, outputPath: targetPath })
      const [localEntry] = await localFs.scan(targetPath, { kind: "file", excludeRules: binding.excludeRules })
      await baselines.upsert({
        id: baselineId(binding.id, relativePath),
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath,
        driveItemId: item.id,
        parentDriveItemId,
        kind: "file",
        localHash: localEntry?.hash ?? null,
        localMtimeMs: localEntry?.mtimeMs ?? null,
        remotePathHint: remotePathHintFor(binding, relativePath),
        remoteVersionId: null,
        remoteEtag: null,
        updatedAt: timestamp(),
      })
    }
  }

  async function assertInitialDownloadTargetAvailable(binding: DriveSyncBindingEntryV1): Promise<void> {
    const available = localFs.isInitialDownloadTargetAvailable
      ? await localFs.isInitialDownloadTargetAvailable(binding.localPath, binding.kind)
      : await isNodeInitialDownloadTargetAvailable(binding.localPath, binding.kind)
    if (available) return
    throw new Error(binding.kind === "file"
      ? "本地文件已存在，请选择一个不存在的文件路径。"
      : "本地文件夹必须为空或不存在。")
  }

  async function cleanupBindingData(bindingId: string): Promise<void> {
    await Promise.all([
      removeEntriesForBinding(baselines, bindingId),
      removeEntriesForBinding(deps.operations, bindingId),
      removeEntriesForBinding(deps.conflicts, bindingId),
    ])
  }

  async function ensureLocalDirectory(dirPath: string): Promise<void> {
    if (localFs.ensureDirectory) {
      await localFs.ensureDirectory(dirPath)
      return
    }
    await mkdir(dirPath, { recursive: true })
  }

  async function executeOperation(
    binding: DriveSyncBindingEntryV1,
    operation: PlannedOperation,
    existing?: DriveSyncOperationEntryV1,
  ): Promise<void> {
    const now = timestamp()
    const entry: DriveSyncOperationEntryV1 = existing
      ? {
        ...existing,
        status: "running",
        message: null,
        updatedAt: now,
        startedAt: existing.startedAt ?? now,
        completedAt: null,
      }
      : {
        id: createId("drive-sync-operation"),
        schemaVersion: 1,
        bindingId: binding.id,
        kind: operation.kind,
        status: "running",
        driveItemId: operation.driveItemId ?? null,
        relativePath: operation.relativePath,
        localPath: operation.localPath ?? localPathFor(binding, operation.relativePath),
        remotePathHint: operation.remotePathHint ?? remotePathHintFor(binding, operation.relativePath),
        message: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: null,
      }
    await deps.operations.upsert(entry)
    await emitChanged()

    try {
      await applyOperation(binding, operation)
      await deps.operations.upsert({
        ...entry,
        status: "succeeded",
        message: null,
        updatedAt: timestamp(),
        completedAt: timestamp(),
      })
      await emitChanged()
    } catch (error) {
      await deps.operations.upsert({
        ...entry,
        status: "error",
        message: errorMessage(error),
        updatedAt: timestamp(),
        completedAt: timestamp(),
      })
      await updateBindingStatus(binding.id, "error", errorMessage(error))
      throw error
    }
  }

  async function applyOperation(binding: DriveSyncBindingEntryV1, operation: PlannedOperation): Promise<void> {
    const drive = requireDriveApi()
    const absolutePath = operation.localPath ?? localPathFor(binding, operation.relativePath)
    if (operation.kind === "download") {
      if (!operation.driveItemId) throw new Error("下载缺少云盘条目。")
      await localFs.ensureParentDirectory(absolutePath)
      await drive.downloadDriveFile({ itemId: operation.driveItemId, outputPath: absolutePath })
      await upsertBaselineFromOperation(binding, operation, {
        driveItemId: operation.driveItemId,
        localHash: operation.localHash ?? null,
        localMtimeMs: operation.localMtimeMs ?? null,
      })
      return
    }
    if (operation.kind === "upload") {
      const parentRemoteId = await parentRemoteIdFor(binding, operation.relativePath)
      if (operation.itemKind === "folder") {
        const item = await drive.createDriveFolder({
          parentId: parentRemoteId,
          name: path.basename(operation.relativePath),
        })
        await upsertBaselineFromOperation(binding, operation, {
          driveItemId: item.id,
          localHash: null,
          localMtimeMs: operation.localMtimeMs ?? null,
        })
        return
      }
      const result = await drive.uploadDriveLocalItems({
        parentId: parentRemoteId,
        items: [{ kind: "file", path: absolutePath, name: path.basename(operation.relativePath) }],
      })
      if (result.failed > 0) throw new Error(result.message ?? "上传失败。")
      await upsertBaselineFromOperation(binding, operation, {
        driveItemId: operation.driveItemId ?? baselineSyntheticDriveItemId(binding.id, operation.relativePath),
        localHash: operation.localHash ?? null,
        localMtimeMs: operation.localMtimeMs ?? null,
      })
      return
    }
    if (operation.kind === "delete_remote") {
      if (!operation.driveItemId) throw new Error("删除缺少云盘条目。")
      await drive.deleteDriveItem(operation.driveItemId)
      await removeBaseline(binding.id, operation.relativePath)
      return
    }
    if (operation.kind === "delete_local") {
      await localFs.trashLocalPath(absolutePath, binding.localPath)
      await removeBaseline(binding.id, operation.relativePath)
      return
    }
    if (operation.kind === "move_remote") {
      const baseline = await findMoveBaseline(binding.id, operation)
      if (!baseline) throw new Error("移动缺少同步基线。")
      const parentId = await parentRemoteIdFor(binding, operation.relativePath)
      if (path.basename(baseline.relativePath) !== path.basename(operation.relativePath)) {
        await drive.renameDriveItem(baseline.driveItemId, path.basename(operation.relativePath))
      }
      if (baseline.parentDriveItemId !== parentId) {
        await drive.moveDriveItem(baseline.driveItemId, parentId)
      }
      await removeBaseline(binding.id, baseline.relativePath)
      await upsertBaselineFromOperation(binding, operation, {
        driveItemId: baseline.driveItemId,
        localHash: operation.localHash ?? baseline.localHash,
        localMtimeMs: operation.localMtimeMs ?? baseline.localMtimeMs,
      })
      return
    }
    if (operation.kind === "move_local") {
      const previous = operation.previousRelativePath ? localPathFor(binding, operation.previousRelativePath) : null
      if (!previous) throw new Error("本地移动缺少源路径。")
      await localFs.ensureParentDirectory(absolutePath)
      await (localFs.moveLocalPath ?? rename)(previous, absolutePath)
      await removeBaseline(binding.id, operation.previousRelativePath ?? operation.relativePath)
      await upsertBaselineFromOperation(binding, operation, {
        driveItemId: operation.driveItemId ?? baselineSyntheticDriveItemId(binding.id, operation.relativePath),
        localHash: operation.localHash ?? null,
        localMtimeMs: operation.localMtimeMs ?? null,
      })
      return
    }
  }

  async function upsertBaselineFromOperation(
    binding: DriveSyncBindingEntryV1,
    operation: PlannedOperation,
    input: { readonly driveItemId: string; readonly localHash: string | null; readonly localMtimeMs: number | null },
  ): Promise<void> {
    const parentRelativePath = parentPath(operation.relativePath)
    await baselines.upsert({
      id: baselineId(binding.id, operation.relativePath),
      schemaVersion: 1,
      bindingId: binding.id,
      relativePath: operation.relativePath,
      driveItemId: input.driveItemId,
      parentDriveItemId: await parentRemoteIdFor(binding, operation.relativePath),
      kind: operation.itemKind ?? "file",
      localHash: input.localHash,
      localMtimeMs: input.localMtimeMs,
      remotePathHint: operation.remotePathHint ?? remotePathHintFor(binding, operation.relativePath),
      remoteVersionId: null,
      remoteEtag: null,
      updatedAt: timestamp(),
    })
    if (parentRelativePath) {
      const parent = await baselines.get(baselineId(binding.id, parentRelativePath))
      if (!parent) {
        await baselines.upsert({
          id: baselineId(binding.id, parentRelativePath),
          schemaVersion: 1,
          bindingId: binding.id,
          relativePath: parentRelativePath,
          driveItemId: baselineSyntheticDriveItemId(binding.id, parentRelativePath),
          parentDriveItemId: await parentRemoteIdFor(binding, parentRelativePath),
          kind: "folder",
          localHash: null,
          localMtimeMs: null,
          remotePathHint: remotePathHintFor(binding, parentRelativePath),
          remoteVersionId: null,
          remoteEtag: null,
          updatedAt: timestamp(),
        })
      }
    }
  }

  async function parentRemoteIdFor(binding: DriveSyncBindingEntryV1, relativePath: string): Promise<string | null> {
    const parentRelativePath = parentPath(relativePath)
    if (!parentRelativePath) return binding.kind === "folder" ? binding.driveItemId : null
    const parent = await baselines.get(baselineId(binding.id, parentRelativePath))
    return parent?.driveItemId ?? null
  }

  async function findMoveBaseline(bindingId: string, operation: PlannedOperation): Promise<DriveSyncBaselineEntryV1 | null> {
    if (operation.previousRelativePath !== undefined && operation.previousRelativePath !== null) {
      return baselines.get(baselineId(bindingId, operation.previousRelativePath))
    }
    if (operation.driveItemId) {
      return (await listBaselines(bindingId)).find((entry) => entry.driveItemId === operation.driveItemId) ?? null
    }
    return null
  }

  async function findBaselineForRemoteChange(bindingId: string, change: DriveChangeDto): Promise<DriveSyncBaselineEntryV1 | null> {
    return (await listBaselines(bindingId)).find((entry) => entry.driveItemId === change.itemId) ?? null
  }

  async function listBaselines(bindingId: string): Promise<readonly DriveSyncBaselineEntryV1[]> {
    return (await baselines.list({ bindingId })).sort(compareBaselinePathAsc)
  }

  async function removeBaseline(bindingId: string, relativePath: string): Promise<void> {
    await baselines.remove(baselineId(bindingId, relativePath))
  }

  async function updateBindingCursor(id: string, cursor: string | null): Promise<void> {
    const binding = await requireBinding(id)
    await deps.bindings.upsert({
      ...binding,
      remoteCursor: cursor,
      lastSyncedAt: timestamp(),
      updatedAt: timestamp(),
      lastError: null,
      status: binding.status === "error" ? "active" : binding.status,
    })
    await emitChanged()
  }

  async function clearBindingErrorIfHealthy(id: string): Promise<void> {
    const binding = await requireBinding(id)
    if (binding.status !== "error") return
    await restoreBindingWhenNoOpenConflicts(id)
  }

  async function restoreBindingWhenNoOpenConflicts(id: string): Promise<void> {
    const openConflicts = (await deps.conflicts.list()).some((conflict) =>
      conflict.bindingId === id && conflict.status === "open",
    )
    if (!openConflicts) await updateBindingStatus(id, "active")
  }

  function requireDriveApi(): DriveSyncDriveApi {
    if (!deps.drive) throw new Error("云盘同步 API 尚未配置。")
    return deps.drive
  }

  async function requireBinding(id: string): Promise<DriveSyncBindingEntryV1> {
    const binding = await deps.bindings.get(id)
    if (!binding || binding.status === "removed") throw new Error("同步绑定不存在。")
    return binding
  }

  async function loadState(): Promise<DriveSyncStateEntryV1> {
    return await deps.state.getSingleton() ?? {
      schemaVersion: 1,
      health: "idle",
      lastCursor: null,
      lastStartedAt: null,
      lastStoppedAt: null,
      lastError: null,
      updatedAt: timestamp(),
    }
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", await getSnapshot())
  }

  return {
    events,
    start,
    stop,
    getSnapshot,
    createBinding,
    updateBindingStatus,
    pauseBinding,
    resumeBinding,
    removeBinding,
    updateExcludeRules,
    rescanBinding,
    pollRemoteChanges,
    retryOperation,
    resolveConflict,
    stopLocalWatcher,
    recordOperation,
    recordConflict,
    setHealth,
  }
}

export type DriveSyncService = ReturnType<typeof createDriveSyncService>

function toBindingDto(entry: DriveSyncBindingEntryV1): DriveSyncBindingDto {
  return {
    id: entry.id,
    driveItemId: entry.driveItemId,
    driveItemName: entry.driveItemName,
    kind: entry.kind,
    localPath: entry.localPath,
    status: entry.status,
    remoteCursor: entry.remoteCursor,
    excludeRules: entry.excludeRules,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastSyncedAt: entry.lastSyncedAt,
  }
}

function toOperationDto(entry: DriveSyncOperationEntryV1): DriveSyncOperationDto {
  return {
    id: entry.id,
    bindingId: entry.bindingId,
    relativePath: entry.relativePath,
    status: entry.status,
    message: entry.message,
    updatedAt: entry.updatedAt,
  }
}

function toConflictDto(entry: DriveSyncConflictEntryV1): DriveSyncConflictDto {
  return {
    id: entry.id,
    bindingId: entry.bindingId,
    relativePath: entry.relativePath,
    type: entry.type,
    createdAt: entry.createdAt,
  }
}

function createNodeDriveSyncFileSystem(): DriveSyncFileSystem {
  return {
    watch(rootPath, onChange) {
      let watcher: FSWatcher | null = null
      try {
        watcher = watchFs(rootPath, { recursive: true }, () => onChange())
      } catch {
        watcher = null
      }
      return {
        close: () => {
          watcher?.close()
        },
      }
    },
    async scan(rootPath, options) {
      if (options.kind === "file") {
        const fileStat = await stat(rootPath)
        if (!fileStat.isFile()) return []
        return [{
          kind: "file",
          relativePath: "",
          absolutePath: rootPath,
          hash: await hashFile(rootPath),
          mtimeMs: fileStat.mtimeMs,
        }]
      }
      const entries: DriveSyncLocalScanEntry[] = []
      await scanDirectory(rootPath, "", options.excludeRules, entries)
      return entries
    },
    async ensureParentDirectory(filePath) {
      await mkdir(path.dirname(filePath), { recursive: true })
    },
    async ensureDirectory(dirPath) {
      await mkdir(dirPath, { recursive: true })
    },
    async isInitialDownloadTargetAvailable(targetPath, kind) {
      return isNodeInitialDownloadTargetAvailable(targetPath, kind)
    },
    async trashLocalPath(targetPath, rootPath) {
      const trashRoot = path.join(rootPath, ".synapse-sync-trash")
      await mkdir(trashRoot, { recursive: true })
      const targetName = `${Date.now()}-${path.basename(targetPath)}`
      await rename(targetPath, path.join(trashRoot, targetName)).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return
        throw error
      })
    },
    async moveLocalPath(fromPath, toPath) {
      await mkdir(path.dirname(toPath), { recursive: true })
      await rename(fromPath, toPath)
    },
  }
}

async function scanDirectory(
  rootPath: string,
  relativeRoot: string,
  excludeRules: readonly string[],
  entries: DriveSyncLocalScanEntry[],
): Promise<void> {
  const absoluteRoot = relativeRoot ? path.join(rootPath, relativeRoot) : rootPath
  const dirents = await readdir(absoluteRoot, { withFileTypes: true })
  for (const dirent of dirents) {
    const relativePath = normalizeRelativePath(path.join(relativeRoot, dirent.name))
    if (isExcludedPath(relativePath, excludeRules)) continue
    const absolutePath = path.join(rootPath, relativePath)
    const stats = await stat(absolutePath)
    if (dirent.isDirectory()) {
      entries.push({
        kind: "folder",
        relativePath,
        absolutePath,
        hash: null,
        mtimeMs: stats.mtimeMs,
      })
      await scanDirectory(rootPath, relativePath, excludeRules, entries)
      continue
    }
    if (dirent.isFile()) {
      entries.push({
        kind: "file",
        relativePath,
        absolutePath,
        hash: await hashFile(absolutePath),
        mtimeMs: stats.mtimeMs,
      })
    }
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  hash.update(await readFile(filePath))
  return `sha256:${hash.digest("hex")}`
}

async function isNodeInitialDownloadTargetAvailable(targetPath: string, kind: "file" | "folder"): Promise<boolean> {
  try {
    const targetStat = await stat(targetPath)
    if (kind === "file") return false
    if (!targetStat.isDirectory()) return false
    return (await readdir(targetPath)).length === 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    throw error
  }
}

async function removeEntriesForBinding<T extends Record<string, unknown> & { readonly id: string; readonly bindingId: string }>(
  namespace: DataNamespace<T>,
  bindingId: string,
): Promise<void> {
  const entries = await namespace.list({ bindingId } as Partial<T>)
  await Promise.all(entries.map((entry) => namespace.remove(entry.id)))
}

function normalizeRequiredString(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function normalizeExcludeRules(rules: readonly string[] | undefined): readonly string[] {
  return Array.from(new Set([".git/", ".synapse-sync/", ".synapse-sync-trash/", ...(rules ?? [])]))
}

function isExcludedPath(relativePath: string, rules: readonly string[]): boolean {
  if (!relativePath) return false
  const segments = normalizeRelativePath(relativePath).split("/")
  if (segments.includes(".git") || segments.includes(".synapse-sync") || segments.includes(".synapse-sync-trash")) {
    return true
  }
  return rules.some((rule) => matchesExcludeRule(relativePath, rule))
}

function matchesExcludeRule(relativePath: string, rawRule: string): boolean {
  const rule = rawRule.trim()
  if (!rule) return false
  const normalized = normalizeRelativePath(rule.replace(/^\//, ""))
  const relative = normalizeRelativePath(relativePath)
  if (normalized.endsWith("/")) {
    const segment = normalized.slice(0, -1)
    return relative === segment || relative.startsWith(`${segment}/`) || relative.split("/").includes(segment)
  }
  if (normalized.startsWith("*.")) return relative.endsWith(normalized.slice(1))
  return relative === normalized || relative.startsWith(`${normalized}/`)
}

function isSameLocalIdentity(baseline: DriveSyncBaselineEntryV1, localEntry: DriveSyncLocalScanEntry): boolean {
  if (baseline.kind !== localEntry.kind) return false
  if (baseline.kind === "file") return baseline.localHash !== null && baseline.localHash === localEntry.hash
  return baseline.relativePath.toLowerCase() === localEntry.relativePath.toLowerCase()
}

function localScanSnapshot(entry: DriveSyncLocalScanEntry): Record<string, unknown> {
  return {
    kind: entry.kind,
    relativePath: entry.relativePath,
    absolutePath: entry.absolutePath,
    hash: entry.hash,
    mtimeMs: entry.mtimeMs,
  }
}

function localPathFor(binding: DriveSyncBindingEntryV1, relativePath: string): string {
  return relativePath ? path.join(binding.localPath, relativePath) : binding.localPath
}

function conflictCopyLocalPath(localPath: string): string {
  const extension = path.extname(localPath)
  const basename = extension ? localPath.slice(0, -extension.length) : localPath
  return `${basename}.cloud-copy${extension}`
}

function remotePathHintFor(binding: DriveSyncBindingEntryV1, relativePath: string): string | null {
  if (!binding.drivePathHint) return relativePath || null
  return relativePath ? `${binding.drivePathHint.replace(/\/$/, "")}/${relativePath}` : binding.drivePathHint
}

function relativePathFromRemoteHint(binding: DriveSyncBindingEntryV1, remotePathHint: string | null | undefined): string | null {
  if (!remotePathHint || !binding.drivePathHint) return null
  const root = binding.drivePathHint.replace(/\/$/, "")
  if (remotePathHint === root) return ""
  if (!remotePathHint.startsWith(`${root}/`)) return null
  return normalizeRelativePath(remotePathHint.slice(root.length + 1))
}

function parentPath(relativePath: string): string | null {
  const parent = normalizeRelativePath(path.dirname(relativePath))
  return parent === "." ? null : parent
}

function baselineId(bindingId: string, relativePath: string): string {
  return `${bindingId}:${relativePath}`
}

function baselineSyntheticDriveItemId(bindingId: string, relativePath: string): string {
  return `local:${bindingId}:${relativePath || "."}`
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/").replace(/^\/+/, "")
}

function normalizeCasePath(value: string): string {
  return normalizeRelativePath(value).toLocaleLowerCase()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRunningOperationStatus(status: DriveSyncOperationStatus): boolean {
  return status === "pending" || status === "running" || status === "retry_wait"
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

function compareBaselinePathAsc(left: DriveSyncBaselineEntryV1, right: DriveSyncBaselineEntryV1): number {
  return left.relativePath.localeCompare(right.relativePath)
}

function createVolatileNamespace<T extends Record<string, unknown>>(name: string): DataNamespace<T> {
  const records = new Map<string, T>()
  let singleton: T | null = null
  return {
    name,
    schemaVersion: 1,
    backend: "sqlite",
    async getSingleton() { return singleton },
    async setSingleton(value) { singleton = value },
    async clearSingleton() { singleton = null },
    async list(filter?: Partial<T>) {
      const values = Array.from(records.values())
      if (!filter) return values
      return values.filter((entry) =>
        Object.entries(filter).every(([key, value]) => entry[key as keyof T] === value),
      )
    },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange() { return () => undefined },
  }
}
