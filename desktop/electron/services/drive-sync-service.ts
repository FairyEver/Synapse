import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import type {
  DriveSyncBindingPreviewDto,
  DriveSyncCreateSafeBindingInput,
  DriveChangeListInput,
  DriveChangeListPageDto,
  DriveSyncBindingDto,
  DriveSyncBindingStatus,
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
import { createDriveSyncBaselineStore } from "./drive-sync-baseline"
import { previewDriveSyncBinding } from "./drive-sync-binding-validator"
import { executeDriveSyncOperation } from "./drive-sync-executor"
import { hashDriveSyncFile, inspectDriveSyncLocalPath } from "./drive-sync-local-snapshot"
import { planDriveSyncLocalChanges, type DriveSyncPlannedConflict, type DriveSyncPlannedOperation } from "./drive-sync-planner"
import { pollDriveSyncRemoteChanges } from "./drive-sync-remote-poller"
import { createDriveSyncWatcher, type DriveSyncLocalChange } from "./drive-sync-watcher"

export interface DriveSyncServiceDeps {
  readonly bindings: DataNamespace<DriveSyncBindingEntryV1>
  readonly baseline: DataNamespace<DriveSyncBaselineEntryV1>
  readonly operations: DataNamespace<DriveSyncOperationEntryV1>
  readonly conflicts: DataNamespace<DriveSyncConflictEntryV1>
  readonly state: DataNamespace<DriveSyncStateEntryV1>
  readonly accountService: DriveSyncAccountService
  readonly trashLocalPath?: (localPath: string) => Promise<void>
  readonly now?: () => Date
  readonly createId?: (prefix: string) => string
}

export interface DriveSyncAccountService {
  readonly downloadDriveFile: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<{ readonly ok: true; readonly path: string }>
  readonly downloadDriveFolderZip: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<{ readonly ok: true; readonly path: string }>
  readonly uploadDriveLocalItems: (input: {
    readonly parentId?: string | null
    readonly items: ReadonlyArray<{ readonly kind: "file"; readonly path: string; readonly name: string }>
  }) => Promise<{ readonly completed: number; readonly failed: number; readonly skipped: number; readonly message?: string }>
  readonly createDriveFolder: (input: { readonly parentId?: string | null; readonly name: string }) => Promise<{ readonly id: string; readonly name: string; readonly type: string }>
  readonly renameDriveItem: (itemId: string, name: string) => Promise<unknown>
  readonly moveDriveItem: (itemId: string, parentId: string | null) => Promise<unknown>
  readonly deleteDriveItem: (itemId: string) => Promise<{ readonly ok: true }>
  readonly listDriveChanges: (input: DriveChangeListInput) => Promise<DriveChangeListPageDto>
  readonly listDriveItemTree: (input: { readonly parentId?: string | null }) => Promise<{ readonly items: ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: string }> }>
  readonly ensureDriveFolderPath: (input: unknown) => Promise<unknown>
}

export interface DriveSyncCreateBindingInput {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly drivePathHint?: string | null
  readonly localPath: string
  readonly remoteCursor?: string | null
  readonly excludeRules?: readonly string[]
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
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = (prefix: string) => deps.createId?.(prefix) ?? `${prefix}:${randomUUID()}`
  const baselineStore = createDriveSyncBaselineStore({ baseline: deps.baseline, now: deps.now })
  const localWatcher = createDriveSyncWatcher({
    onChanges: handleLocalChanges,
  })

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
      excludeRules: createBindingExcludeRules(input.excludeRules ?? []),
      createdAt: now,
      updatedAt: now,
    }

    await deps.bindings.upsert(entry)
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

  async function removeBinding(id: string): Promise<void> {
    await baselineStore.removeBinding(id)
    await updateBindingStatus(id, "removed")
  }

  async function rescanBinding(id: string): Promise<void> {
    const binding = await requireBinding(id)
    const baseline = await baselineStore.listByBinding(id)
    const changes = await localWatcher.scanBinding({ binding, baseline })
    await handleLocalChanges(changes)
  }

  async function pollRemoteChanges(id?: string): Promise<void> {
    const bindings = (id ? [await requireBinding(id)] : await deps.bindings.list())
      .filter((binding) => binding.status === "active")
    for (const binding of bindings) {
      const baseline = await baselineStore.listByBinding(binding.id)
      const localChanges = await localWatcher.scanBinding({ binding, baseline }).catch(() => [])
      await pollDriveSyncRemoteChanges({
        binding,
        baseline,
        accountService: deps.accountService,
        onOperations: executePlannedOperations,
        onConflicts: recordPlannedConflicts,
        updateBindingCursor,
        localChangedPaths: new Set(localChanges.map((change) => change.relativePath)),
      })
    }
  }

  async function stopLocalWatcher(): Promise<void> {
    localWatcher.stop()
  }

  async function previewBinding(input: Omit<DriveSyncCreateSafeBindingInput, "direction"> & {
    readonly remoteExists: boolean
  }): Promise<DriveSyncBindingPreviewDto> {
    return previewDriveSyncBinding({
      ...input,
      activeBindings: await deps.bindings.list(),
    })
  }

  async function createSafeBinding(input: DriveSyncCreateSafeBindingInput): Promise<DriveSyncBindingDto> {
    const binding = await createBinding({
      driveItemId: input.driveItemId,
      driveItemName: input.driveItemName,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath: input.localPath,
      excludeRules: input.excludeRules ?? [],
    })

    try {
      if (input.kind === "file" && input.direction === "remote_to_local") {
        await downloadInitialFile(binding)
      } else if (input.kind === "file" && input.direction === "local_to_remote") {
        await uploadInitialFile(binding)
      }
      return await updateBindingStatus(binding.id, "active")
    } catch (error) {
      await recordOperation({
        bindingId: binding.id,
        kind: input.direction === "remote_to_local" ? "download" : "upload",
        status: "error",
        driveItemId: input.driveItemId,
        relativePath: "",
        localPath: input.localPath,
        remotePathHint: input.drivePathHint ?? null,
        message: errorMessage(error),
      })
      return await updateBindingStatus(binding.id, "error", errorMessage(error))
    }
  }

  async function downloadInitialFile(binding: DriveSyncBindingDto): Promise<void> {
    await mkdir(path.dirname(binding.localPath), { recursive: true })
    await deps.accountService.downloadDriveFile({ itemId: binding.driveItemId, outputPath: binding.localPath })
    const local = await inspectDriveSyncLocalPath(binding.localPath)
    await baselineStore.upsert({
      bindingId: binding.id,
      relativePath: "",
      kind: "file",
      remoteItemId: binding.driveItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: local.kind === "file" ? await hashDriveSyncFile(binding.localPath) : null,
      deletedAt: null,
    })
    await recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "succeeded",
      driveItemId: binding.driveItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: null,
      message: null,
    })
  }

  async function uploadInitialFile(binding: DriveSyncBindingDto): Promise<void> {
    const upload = await deps.accountService.uploadDriveLocalItems({
      parentId: null,
      items: [{ kind: "file", path: binding.localPath, name: binding.driveItemName }],
    })
    if (upload.failed > 0 || upload.completed === 0) throw new Error(upload.message ?? "上传失败。")
    const remoteItemId = await findUploadedRemoteItemId(binding.driveItemName)
    await baselineStore.upsert({
      bindingId: binding.id,
      relativePath: "",
      kind: "file",
      remoteItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: await hashDriveSyncFile(binding.localPath),
      deletedAt: null,
    })
    await recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "succeeded",
      driveItemId: remoteItemId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: null,
      message: null,
    })
  }

  async function findUploadedRemoteItemId(name: string): Promise<string> {
    const tree = await deps.accountService.listDriveItemTree({ parentId: null })
    return tree.items.find((item) => item.name === name)?.id ?? name
  }

  async function handleLocalChanges(changes: readonly DriveSyncLocalChange[]): Promise<void> {
    const changesByBinding = new Map<string, DriveSyncLocalChange[]>()
    for (const change of changes) {
      const group = changesByBinding.get(change.bindingId) ?? []
      group.push(change)
      changesByBinding.set(change.bindingId, group)
    }

    for (const [bindingId, bindingChanges] of changesByBinding) {
      const binding = await requireBinding(bindingId)
      if (binding.status !== "active") continue
      const plan = planDriveSyncLocalChanges({
        binding,
        baseline: await baselineStore.listByBinding(bindingId),
        changes: bindingChanges,
      })
      await recordPlannedConflicts(plan.conflicts)
      await executePlannedOperations(plan.operations)
    }
  }

  async function executePlannedOperations(operations: readonly DriveSyncPlannedOperation[]): Promise<void> {
    for (const operation of operations) {
      const binding = await requireBinding(operation.bindingId)
      if (operation.kind === "resync") {
        await recordOperation({
          bindingId: operation.bindingId,
          kind: "resync",
          status: "retry_wait",
          driveItemId: operation.driveItemId,
          relativePath: operation.relativePath,
          localPath: operation.localPath,
          remotePathHint: operation.remotePathHint,
          message: "需要重新扫描。",
        })
        continue
      }
      markSelfWriteForOperation(operation)
      await executeDriveSyncOperation({
        binding,
        operation,
        baselineStore,
        accountService: deps.accountService,
        recordOperation,
        trashLocalPath: deps.trashLocalPath ?? moveLocalPathToRecoverableTrash,
      })
    }
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

  async function updateBindingCursor(bindingId: string, cursor: string | null): Promise<void> {
    const binding = await requireBinding(bindingId)
    await deps.bindings.upsert({
      ...binding,
      remoteCursor: cursor,
      updatedAt: timestamp(),
    })
    await emitChanged()
  }

  async function reconcileLocalWatcher(): Promise<void> {
    localWatcher.reconcile(await deps.bindings.list())
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
    const now = timestamp()
    const entry: DriveSyncConflictEntryV1 = {
      id: createId("drive-sync-conflict"),
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
      createdAt: now,
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
    getSnapshot,
    createBinding,
    previewBinding,
    createSafeBinding,
    rescanBinding,
    pollRemoteChanges,
    stopLocalWatcher,
    updateBindingStatus,
    removeBinding,
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

function normalizeRequiredString(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function createBindingExcludeRules(userRules: readonly string[]): DriveSyncBindingEntryV1["excludeRules"] {
  return {
    forced: [".git/**", ".git"],
    defaults: [],
    importedGitignore: [],
    user: [...userRules],
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "同步操作失败。"
}

async function moveLocalPathToRecoverableTrash(localPath: string): Promise<void> {
  const trashRoot = path.join(path.dirname(localPath), ".synapse-sync-trash")
  await mkdir(trashRoot, { recursive: true })
  const targetPath = path.join(trashRoot, `${Date.now()}-${path.basename(localPath)}`)
  await rename(localPath, targetPath)
}
