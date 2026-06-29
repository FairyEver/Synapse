import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { copyFile, lstat, mkdir, rename } from "node:fs/promises"
import path from "node:path"
import type {
  DriveChangeDto,
  DriveItemDto,
  DriveItemTreeListPageDto,
  DriveSyncBindingPreviewDto,
  DriveSyncConflictResolutionInput,
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
import { isDriveSyncExcluded } from "./drive-sync-excludes"
import { hashDriveSyncFile, inspectDriveSyncLocalPath, scanDriveSyncLocalTree } from "./drive-sync-local-snapshot"
import {
  planDriveSyncLocalChanges,
  planDriveSyncRemoteChanges,
  type DriveSyncPlannedConflict,
  type DriveSyncPlannedOperation,
} from "./drive-sync-planner"
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

type DriveSyncRemoteTreeEntry = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly path: string
  readonly size: string
}

export interface DriveSyncAccountService {
  readonly getDriveItem?: (itemId: string) => Promise<DriveItemDto>
  readonly downloadDriveFile: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<{ readonly ok: true; readonly path: string }>
  readonly downloadDriveFolderZip: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<{ readonly ok: true; readonly path: string }>
  readonly uploadDriveLocalItems: (input: {
    readonly parentId?: string | null
    readonly items: Array<
      | { kind: "file"; path: string; name: string; mimeType?: string | null }
      | {
        kind: "folder"
        folderName: string
        files: Array<{ path: string; relativePath: string; mimeType?: string | null }>
      }
    >
  }) => Promise<{ readonly completed: number; readonly failed: number; readonly skipped: number; readonly message?: string }>
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
  readonly kind: "file" | "folder"
  readonly drivePathHint?: string | null
  readonly localPath: string
  readonly remoteCursor?: string | null
  readonly excludeRules?: readonly string[]
  readonly deferWatcher?: boolean
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
    const bindingEntries = (await deps.bindings.list())
      .filter((binding) => binding.status !== "removed")
      .sort(compareUpdatedDesc)
    const bindings = await Promise.all(bindingEntries.map(toSnapshotBindingDto))
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
        errorCount: bindings.filter((binding) => binding.status === "error").length,
      },
    }
  }

  async function toSnapshotBindingDto(entry: DriveSyncBindingEntryV1): Promise<DriveSyncBindingDto> {
    if (entry.status !== "active") return toBindingDto(entry)
    const rootBaseline = (await baselineStore.listByBinding(entry.id))
      .find((baseline) => baseline.relativePath === "")
    if (!rootBaseline) return toBindingDto(entry)
    if (rootBaseline.deletedAt !== null) {
      return toBindingDto(entry, { status: "error", lastError: "同步根对象已删除。" })
    }

    try {
      const local = await inspectDriveSyncLocalPath(entry.localPath)
      if (local.kind === "missing") {
        return toBindingDto(entry, { status: "error", lastError: "本地路径不存在。" })
      }
    } catch {
      return toBindingDto(entry, { status: "error", lastError: "本地路径无法访问。" })
    }

    return toBindingDto(entry)
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

  async function pauseBinding(id: string): Promise<DriveSyncBindingDto> {
    return updateBindingStatus(id, "paused")
  }

  async function resumeBinding(id: string): Promise<DriveSyncBindingDto> {
    return updateBindingStatus(id, "active")
  }

  async function updateExcludeRules(input: {
    readonly id: string
    readonly user: readonly string[]
  }): Promise<DriveSyncBindingDto> {
    const binding = await requireBinding(input.id)
    const entry: DriveSyncBindingEntryV1 = {
      ...binding,
      excludeRules: {
        ...binding.excludeRules,
        user: [...input.user],
      },
      updatedAt: timestamp(),
    }
    await deps.bindings.upsert(entry)
    await reconcileLocalWatcher()
    await emitChanged()
    return toBindingDto(entry)
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
      const localChangedPaths = new Set(localChanges.map((change) => change.relativePath))
      if (await handleMissingFileBindingRoot({ binding, baseline, localChangedPaths })) continue
      await pollDriveSyncRemoteChanges({
        binding,
        baseline,
        accountService: deps.accountService,
        onOperations: executePlannedOperations,
        onConflicts: recordPlannedConflicts,
        updateBindingCursor,
        localChangedPaths,
      })
    }
  }

  async function stopLocalWatcher(): Promise<void> {
    localWatcher.stop()
  }

  async function resolveConflict(input: DriveSyncConflictResolutionInput): Promise<void> {
    const conflict = await deps.conflicts.get(input.conflictId)
    if (!conflict || conflict.status !== "open") throw new Error("同步冲突不存在。")
    if (input.action !== "skip") {
      await applyConflictResolution(conflict, input.action)
    }
    const resolved: DriveSyncConflictEntryV1 = {
      ...conflict,
      status: input.action === "skip" ? "ignored" : "resolved",
      resolution: input.action,
      resolvedAt: timestamp(),
    }
    await deps.conflicts.upsert(resolved)
    await updateBindingStatusAfterConflictResolution(conflict.bindingId)
    await emitChanged()
  }

  async function previewBinding(input: Omit<DriveSyncCreateSafeBindingInput, "direction"> & {
    readonly remoteExists: boolean
    readonly directionHint?: DriveSyncCreateSafeBindingInput["direction"] | null
  }): Promise<DriveSyncBindingPreviewDto> {
    const remoteItem = input.remoteExists ? await getDriveItemFromAccountService(deps.accountService, input.driveItemId) : null
    const preview = await previewDriveSyncBinding({
      ...input,
      remoteSize: remoteItem?.size ?? null,
      activeBindings: await deps.bindings.list(),
    })
    if (
      preview.status === "ready"
      && preview.direction === "bind_existing"
      && input.kind === "folder"
      && remoteItem?.type === "folder"
    ) {
      const { differences } = await compareExistingFolderTree({
        driveItemId: input.driveItemId,
        driveItemName: remoteItem.name,
        localPath: input.localPath,
        excludeRules: createBindingExcludeRules(input.excludeRules ?? []),
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
    return preview
  }

  async function createSafeBinding(input: DriveSyncCreateSafeBindingInput): Promise<DriveSyncBindingDto> {
    if (input.direction === "bind_existing") {
      return createBindExistingBinding(input)
    }

    let binding = await createBinding({
      driveItemId: input.driveItemId,
      driveItemName: input.driveItemName,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath: input.localPath,
      excludeRules: input.excludeRules ?? [],
      deferWatcher: true,
    })

    try {
      if (input.kind === "file" && input.direction === "remote_to_local") {
        await downloadInitialFile(binding)
      } else if (input.kind === "file" && input.direction === "local_to_remote") {
        binding = await updateBindingDriveItemId(binding.id, await uploadInitialFile(binding))
      } else if (input.kind === "folder" && input.direction === "remote_to_local") {
        await downloadInitialFolder(binding)
      } else if (input.kind === "folder" && input.direction === "local_to_remote") {
        binding = await updateBindingDriveItemId(binding.id, await uploadInitialFolder(binding))
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

  async function createBindExistingBinding(input: DriveSyncCreateSafeBindingInput): Promise<DriveSyncBindingDto> {
    const remoteItem = await getDriveItemFromAccountService(deps.accountService, input.driveItemId)
    if (remoteItem.type !== input.kind) throw new Error("云盘条目类型与绑定类型不一致。")
    const preview = await previewDriveSyncBinding({
      ...input,
      remoteExists: true,
      remoteSize: remoteItem.size,
      directionHint: input.direction,
      activeBindings: await deps.bindings.list(),
    })
    if (preview.status !== "ready" || preview.direction !== "bind_existing") {
      throw new Error(preview.reason ?? "本地路径不能和已有云盘条目建立绑定。")
    }

    const prepared = input.kind === "file"
      ? await prepareExistingFileBaseline(input.localPath, remoteItem.id)
      : await prepareExistingFolderBaselines({
        driveItemId: input.driveItemId,
        driveItemName: remoteItem.name,
        localPath: input.localPath,
        excludeRules: createBindingExcludeRules(input.excludeRules ?? []),
      })

    const binding = await createBinding({
      driveItemId: input.driveItemId,
      driveItemName: input.driveItemName,
      kind: input.kind,
      drivePathHint: input.drivePathHint ?? null,
      localPath: input.localPath,
      excludeRules: input.excludeRules ?? [],
      deferWatcher: true,
    })
    for (const entry of prepared) {
      await baselineStore.upsert({ ...entry, bindingId: binding.id })
    }
    return await updateBindingStatus(binding.id, "active")
  }

  async function prepareExistingFileBaseline(
    localPath: string,
    remoteItemId: string,
  ): Promise<Array<Omit<Parameters<typeof baselineStore.upsert>[0], "bindingId">>> {
    const stats = await lstat(localPath)
    return [{
      relativePath: "",
      kind: "file",
      remoteItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: stats.size,
      localMtimeMs: stats.mtimeMs,
      localHash: await hashDriveSyncFile(localPath),
      deletedAt: null,
    }]
  }

  async function prepareExistingFolderBaselines(input: {
    readonly driveItemId: string
    readonly driveItemName: string
    readonly localPath: string
    readonly excludeRules: DriveSyncBindingEntryV1["excludeRules"]
  }): Promise<Array<Omit<Parameters<typeof baselineStore.upsert>[0], "bindingId">>> {
    const { differences, localEntries, remoteByPath } = await compareExistingFolderTree({
      ...input,
      hashFiles: true,
    })
    if (differences.length > 0) {
      throw new Error(formatFolderDifferenceReason(differences))
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
      ...localEntries.map((local) => {
        const remote = remoteByPath.get(local.relativePath)
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
    const remoteByPath = new Map(remoteEntries.map((entry) => [normalizeRemoteTreePath(entry.path, input.driveItemName), entry]))
    const localByPath = new Map(localEntries.map((entry) => [entry.relativePath, entry]))

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

  async function downloadInitialFile(binding: DriveSyncBindingDto): Promise<void> {
    await mkdir(path.dirname(binding.localPath), { recursive: true })
    await deps.accountService.downloadDriveFile({ itemId: binding.driveItemId, outputPath: binding.localPath })
    const local = await inspectDriveSyncLocalPath(binding.localPath)
    const stats = local.kind === "file" ? await lstat(binding.localPath) : null
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

  async function uploadInitialFile(binding: DriveSyncBindingDto): Promise<string> {
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
    return remoteItemId
  }

  async function findUploadedRemoteItemId(name: string): Promise<string> {
    const tree = await deps.accountService.listDriveItemTree({ parentId: null })
    return tree.items.find((item) => item.name === name)?.id ?? name
  }

  async function downloadInitialFolder(binding: DriveSyncBindingDto): Promise<void> {
    await mkdir(binding.localPath, { recursive: true })
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
    await downloadRemoteFolderTree(binding)
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

  async function downloadRemoteFolderTree(binding: DriveSyncBindingDto): Promise<void> {
    const remoteEntries = await listAllRemoteTreeEntries(binding.driveItemId)
    for (const item of remoteEntries) {
      const relativePath = normalizeRemoteTreePath(item.path, binding.driveItemName)
      if (!relativePath || isDriveSyncExcluded(relativePath, binding.excludeRules)) continue
      const localPath = path.join(binding.localPath, relativePath)
      if (item.type === "folder") {
        await mkdir(localPath, { recursive: true })
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
        await mkdir(path.dirname(localPath), { recursive: true })
        await deps.accountService.downloadDriveFile({ itemId: item.id, outputPath: localPath })
        const stats = await lstat(localPath)
        await baselineStore.upsert({
          bindingId: binding.id,
          relativePath,
          kind: "file",
          remoteItemId: item.id,
          remoteVersionId: null,
          remoteEtag: null,
          localSize: stats.size,
          localMtimeMs: stats.mtimeMs,
          localHash: await hashDriveSyncFile(localPath),
          deletedAt: null,
        })
      }
    }
  }

  async function uploadInitialFolder(binding: DriveSyncBindingDto): Promise<string> {
    const snapshot = await scanDriveSyncLocalTree({
      rootPath: binding.localPath,
      rules: binding.excludeRules,
      hashFiles: true,
    })
    let createdRemoteRootId: string | null = null
    const files = snapshot
      .filter((entry) => entry.kind === "file")
      .map((entry) => ({
        path: path.join(binding.localPath, entry.relativePath),
        relativePath: entry.relativePath,
        mimeType: null,
      }))
    if (files.length > 0) {
      const upload = await deps.accountService.uploadDriveLocalItems({
        parentId: null,
        items: [{
          kind: "folder",
          folderName: binding.driveItemName,
          files,
        }],
      })
      if (upload.failed > 0 || upload.completed === 0) throw new Error(upload.message ?? "上传失败。")
    } else {
      const created = await deps.accountService.createDriveFolder({ parentId: null, name: binding.driveItemName })
      createdRemoteRootId = created.id
    }

    const remoteRootId = createdRemoteRootId ?? await findUploadedRemoteItemId(binding.driveItemName)
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
      parentId: remoteRootId,
      relativeRoot: "",
      localEntries: snapshot,
    })
    await createMissingUploadedFolders({
      binding,
      localEntries: snapshot,
    })
    await recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "succeeded",
      driveItemId: remoteRootId,
      relativePath: "",
      localPath: binding.localPath,
      remotePathHint: null,
      message: null,
    })
    return remoteRootId
  }

  async function recordUploadedFolderBaseline(input: {
    readonly binding: DriveSyncBindingDto
    readonly parentId: string
    readonly relativeRoot: string
    readonly localEntries: readonly { readonly relativePath: string; readonly kind: "file" | "folder"; readonly size: number | null; readonly mtimeMs: number | null; readonly hash: string | null }[]
  }): Promise<void> {
    const tree = await deps.accountService.listDriveItemTree({ parentId: input.parentId })
    for (const item of tree.items) {
      const relativePath = joinRelativePath(input.relativeRoot, item.name)
      const localEntry = input.localEntries.find((entry) => entry.relativePath === relativePath)
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
      if (item.type === "folder") {
        await recordUploadedFolderBaseline({
          binding: input.binding,
          parentId: item.id,
          relativeRoot: relativePath,
          localEntries: input.localEntries,
        })
      }
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
  ): Promise<void> {
    const binding = await requireBinding(conflict.bindingId)
    if (action === "keep_local") {
      await executePlannedOperations([plannedConflictOperation(binding, conflict, "upload", conflict.localPath)])
      return
    }
    if (action === "keep_remote") {
      await executePlannedOperations([plannedConflictOperation(binding, conflict, "download", conflictLocalPath(binding, conflict))])
      return
    }
    if (action === "confirm_delete") {
      await applyConflictDeleteResolution(binding, conflict)
      return
    }
    await applyConflictKeepBothResolution(binding, conflict)
  }

  async function applyConflictDeleteResolution(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
  ): Promise<void> {
    const localPath = conflictLocalPath(binding, conflict)
    const local = await inspectDriveSyncLocalPath(localPath)
    if (local.kind !== "missing") {
      await executePlannedOperations([plannedConflictOperation(binding, conflict, "delete_local", localPath)])
      return
    }
    await executePlannedOperations([plannedConflictOperation(binding, conflict, "delete_remote", localPath)])
  }

  async function applyConflictKeepBothResolution(
    binding: DriveSyncBindingEntryV1,
    conflict: DriveSyncConflictEntryV1,
  ): Promise<void> {
    const localPath = conflictLocalPath(binding, conflict)
    const stats = await lstat(localPath)
    if (!stats.isFile()) throw new Error("仅文件冲突支持保留两份。")
    const copyLocalPath = conflictCopyLocalPath(localPath)
    await copyFile(localPath, copyLocalPath)
    const copyRelativePath = path.posix.join(path.posix.dirname(conflict.relativePath), path.basename(copyLocalPath))
      .replace(/^\.\//u, "")
    await executePlannedOperations([
      {
        bindingId: binding.id,
        kind: "upload",
        driveItemId: null,
        relativePath: copyRelativePath,
        localPath: copyLocalPath,
        remotePathHint: conflict.remotePathHint,
      },
      plannedConflictOperation(binding, conflict, "download", localPath),
    ])
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
    }
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
      try {
        await executeDriveSyncOperation({
          binding,
          operation,
          baselineStore,
          accountService: deps.accountService,
          recordOperation,
          trashLocalPath: deps.trashLocalPath ?? moveLocalPathToRecoverableTrash,
        })
      } catch (error) {
        await updateBindingStatus(operation.bindingId, "error", errorMessage(error))
      }
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

  async function updateBindingStatusAfterConflictResolution(bindingId: string): Promise<void> {
    const open = (await deps.conflicts.list({ bindingId }))
      .some((conflict) => conflict.status === "open")
    if (!open) {
      await updateBindingStatus(bindingId, "active")
    }
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
    kind: entry.kind,
    localPath: entry.localPath,
    status: override?.status ?? entry.status,
    remoteCursor: entry.remoteCursor,
    excludeRules: entry.excludeRules,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastSyncedAt: entry.lastSyncedAt,
    lastError: override?.lastError ?? entry.lastError,
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

function formatFolderDifferenceReason(differences: readonly string[]): string {
  return `本地文件夹与云盘文件夹内容不一致：${differences.slice(0, 3).join("；")}`
}

function joinRelativePath(parent: string, name: string): string {
  return parent ? path.posix.join(parent, name) : name
}

function normalizeRemoteTreePath(remotePath: string, rootName: string): string {
  const normalized = remotePath.split(/[\\/]+/u).filter(Boolean).join("/")
  if (normalized === rootName) return ""
  const rootPrefix = `${rootName}/`
  return normalized.startsWith(rootPrefix) ? normalized.slice(rootPrefix.length) : normalized
}

function conflictCopyLocalPath(localPath: string): string {
  const extension = path.extname(localPath)
  const baseName = path.basename(localPath, extension)
  return path.join(path.dirname(localPath), `${baseName}.local${extension}`)
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
