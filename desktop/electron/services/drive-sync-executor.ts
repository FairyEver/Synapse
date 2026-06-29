import { mkdir, lstat, rename } from "node:fs/promises"
import path from "node:path"
import type { DriveSyncOperationStatus } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBaselineStore } from "./drive-sync-baseline"
import type { DriveSyncAccountService, DriveSyncRecordOperationInput } from "./drive-sync-service"
import type { DriveSyncPlannedOperation } from "./drive-sync-planner"
import type { DriveSyncBindingEntryV1, DriveSyncOperationEntryV1 } from "../runtime/data-repo"
import { hashDriveSyncFile } from "./drive-sync-local-snapshot"

export interface DriveSyncExecutorDeps {
  readonly binding: DriveSyncBindingEntryV1
  readonly operation: DriveSyncPlannedOperation
  readonly baselineStore: DriveSyncBaselineStore
  readonly accountService: DriveSyncAccountService
  readonly recordOperation: (input: DriveSyncRecordOperationInput) => Promise<unknown>
  readonly trashLocalPath: (localPath: string) => Promise<void>
}

export async function executeDriveSyncOperation(deps: DriveSyncExecutorDeps): Promise<void> {
  try {
    await executeOperationBody(deps)
    await record(deps, "succeeded", null)
  } catch (error) {
    await record(deps, "error", errorMessage(error))
    throw error
  }
}

async function executeOperationBody(deps: DriveSyncExecutorDeps): Promise<void> {
  switch (deps.operation.kind) {
    case "download":
      await downloadFile(deps)
      return
    case "upload":
      await uploadLocalItem(deps)
      return
    case "delete_remote":
      await deleteRemoteItem(deps)
      return
    case "delete_local":
      await deleteLocalItem(deps)
      return
    case "move_local":
      await moveLocalItem(deps)
      return
    default:
      throw new Error(`暂不支持的同步操作：${deps.operation.kind}`)
  }
}

async function downloadFile(deps: DriveSyncExecutorDeps): Promise<void> {
  const localPath = requireLocalPath(deps.operation)
  const driveItemId = requireDriveItemId(deps.operation)
  await mkdir(path.dirname(localPath), { recursive: true })
  await deps.accountService.downloadDriveFile({ itemId: driveItemId, outputPath: localPath })
  const stats = await lstat(localPath)
  await deps.baselineStore.upsert({
    bindingId: deps.binding.id,
    relativePath: deps.operation.relativePath,
    kind: "file",
    remoteItemId: driveItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: stats.size,
    localMtimeMs: stats.mtimeMs,
    localHash: await hashDriveSyncFile(localPath),
    deletedAt: null,
  })
}

async function uploadLocalItem(deps: DriveSyncExecutorDeps): Promise<void> {
  const localPath = requireLocalPath(deps.operation)
  const stats = await lstat(localPath)
  if (stats.isDirectory()) {
    const created = await deps.accountService.createDriveFolder({
      parentId: await parentRemoteId(deps),
      name: path.basename(localPath),
    })
    await deps.baselineStore.upsert({
      bindingId: deps.binding.id,
      relativePath: deps.operation.relativePath,
      kind: "folder",
      remoteItemId: created.id,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: stats.mtimeMs,
      localHash: null,
      deletedAt: null,
    })
    return
  }
  if (!stats.isFile()) throw new Error("本地条目类型不支持同步。")

  const upload = await deps.accountService.uploadDriveLocalItems({
    parentId: await parentRemoteId(deps),
    items: [{ kind: "file", path: localPath, name: path.basename(localPath) }],
  })
  if (upload.failed > 0 || upload.completed === 0) throw new Error(upload.message ?? "上传失败。")
  const remoteItemId = deps.operation.driveItemId ?? await findUploadedRemoteItemId(deps, path.basename(localPath))
  await deps.baselineStore.upsert({
    bindingId: deps.binding.id,
    relativePath: deps.operation.relativePath,
    kind: "file",
    remoteItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: stats.size,
    localMtimeMs: stats.mtimeMs,
    localHash: await hashDriveSyncFile(localPath),
    deletedAt: null,
  })
}

async function deleteRemoteItem(deps: DriveSyncExecutorDeps): Promise<void> {
  try {
    await deps.accountService.deleteDriveItem(requireDriveItemId(deps.operation))
  } catch (error) {
    if (!isRemoteNotFoundError(error)) throw error
  }
  await deps.baselineStore.markDeleted(deps.binding.id, deps.operation.relativePath)
}

async function deleteLocalItem(deps: DriveSyncExecutorDeps): Promise<void> {
  try {
    await deps.trashLocalPath(requireLocalPath(deps.operation))
  } catch (error) {
    if (!isLocalNotFoundError(error)) throw error
  }
  await deps.baselineStore.markDeleted(deps.binding.id, deps.operation.relativePath)
}

async function moveLocalItem(deps: DriveSyncExecutorDeps): Promise<void> {
  const driveItemId = requireDriveItemId(deps.operation)
  const localPath = requireLocalPath(deps.operation)
  const existing = (await deps.baselineStore.listByBinding(deps.binding.id))
    .find((entry) => entry.remoteItemId === driveItemId && entry.deletedAt === null)
  if (!existing) {
    await downloadFile(deps)
    return
  }

  const previousLocalPath = path.join(deps.binding.localPath, existing.relativePath)
  if (previousLocalPath !== localPath) {
    await mkdir(path.dirname(localPath), { recursive: true })
    await rename(previousLocalPath, localPath)
  }
  const stats = await lstat(localPath)
  await deps.baselineStore.removePath(deps.binding.id, existing.relativePath)
  await deps.baselineStore.upsert({
    bindingId: deps.binding.id,
    relativePath: deps.operation.relativePath,
    kind: stats.isDirectory() ? "folder" : "file",
    remoteItemId: driveItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: stats.isFile() ? stats.size : null,
    localMtimeMs: stats.mtimeMs,
    localHash: stats.isFile() ? await hashDriveSyncFile(localPath) : null,
    deletedAt: null,
  })
}

async function findUploadedRemoteItemId(deps: DriveSyncExecutorDeps, name: string): Promise<string> {
  const tree = await deps.accountService.listDriveItemTree({ parentId: await parentRemoteId(deps) })
  return tree.items.find((item) => item.name === name)?.id ?? name
}

async function parentRemoteId(deps: DriveSyncExecutorDeps): Promise<string | null> {
  const parentPath = parentRelativePath(deps.operation.relativePath)
  if (parentPath === null) {
    if (deps.binding.kind === "file") {
      const remoteFileId = deps.operation.driveItemId ?? deps.binding.driveItemId
      const remoteFile = deps.accountService.getDriveItem ? await deps.accountService.getDriveItem(remoteFileId) : null
      return remoteFile?.parentId ?? null
    }
    return deps.binding.driveItemId
  }
  const parentBaseline = (await deps.baselineStore.listByBinding(deps.binding.id))
    .find((entry) => entry.relativePath === parentPath && entry.deletedAt === null)
  return parentBaseline?.remoteItemId ?? deps.binding.driveItemId
}

function parentRelativePath(relativePath: string): string | null {
  const parent = path.posix.dirname(relativePath)
  return parent === "." ? null : parent
}

async function record(
  deps: DriveSyncExecutorDeps,
  status: DriveSyncOperationStatus,
  message: string | null,
): Promise<void> {
  await deps.recordOperation({
    bindingId: deps.binding.id,
    kind: deps.operation.kind as DriveSyncOperationEntryV1["kind"],
    status,
    driveItemId: deps.operation.driveItemId,
    relativePath: deps.operation.relativePath,
    localPath: deps.operation.localPath,
    remotePathHint: deps.operation.remotePathHint,
    message,
  })
}

function requireLocalPath(operation: DriveSyncPlannedOperation): string {
  if (!operation.localPath) throw new Error("本地路径不能为空。")
  return operation.localPath
}

function requireDriveItemId(operation: DriveSyncPlannedOperation): string {
  if (!operation.driveItemId) throw new Error("云盘条目不能为空。")
  return operation.driveItemId
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "同步操作失败。"
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

function isLocalNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const details = error as NodeJS.ErrnoException
  return details.code === "ENOENT"
}
