import { mkdir, lstat, rename } from "node:fs/promises"
import path from "node:path"
import type { DriveSyncOperationStatus } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBaselineStore } from "./drive-sync-baseline"
import type { DriveSyncAccountService, DriveSyncRecordOperationInput } from "./drive-sync-service"
import type { DriveSyncPlannedOperation } from "./drive-sync-planner"
import type { DriveSyncBindingEntryV1, DriveSyncOperationEntryV1 } from "../runtime/data-repo"
import { sanitizeError } from "./error-sanitize"
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
      await downloadRemoteItem(deps)
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
    case "move_remote":
      await moveRemoteItem(deps)
      return
    default:
      throw new Error(`暂不支持的同步操作：${deps.operation.kind}`)
  }
}

async function downloadRemoteItem(deps: DriveSyncExecutorDeps): Promise<void> {
  if (deps.operation.remoteItemKind === "folder") {
    await downloadFolder(deps)
    return
  }
  await downloadFile(deps)
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

async function downloadFolder(deps: DriveSyncExecutorDeps): Promise<void> {
  const localPath = requireLocalPath(deps.operation)
  const driveItemId = requireDriveItemId(deps.operation)
  await mkdir(localPath, { recursive: true })
  const stats = await lstat(localPath)
  await deps.baselineStore.upsert({
    bindingId: deps.binding.id,
    relativePath: deps.operation.relativePath,
    kind: "folder",
    remoteItemId: driveItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: null,
    localMtimeMs: stats.mtimeMs,
    localHash: null,
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
  const remoteItemId = deps.operation.driveItemId ?? await findUploadedRemoteItemId(deps, path.basename(localPath), "file")
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
    await downloadRemoteItem(deps)
    return
  }

  const previousLocalPath = path.join(deps.binding.localPath, existing.relativePath)
  if (previousLocalPath !== localPath) {
    await mkdir(path.dirname(localPath), { recursive: true })
    await rename(previousLocalPath, localPath)
  }
  const stats = await lstat(localPath)
  if (existing.kind === "folder" && stats.isDirectory()) {
    await rewriteDescendantBaselines(deps, existing.relativePath, deps.operation.relativePath)
  }
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

async function moveRemoteItem(deps: DriveSyncExecutorDeps): Promise<void> {
  const driveItemId = requireDriveItemId(deps.operation)
  const localPath = requireLocalPath(deps.operation)
  const stats = await lstat(localPath)
  const parentId = await parentRemoteId(deps)
  await deps.accountService.moveDriveItem(driveItemId, parentId)
  await deps.accountService.renameDriveItem(driveItemId, path.basename(localPath))

  const existing = (await deps.baselineStore.listByBinding(deps.binding.id))
    .find((entry) => entry.remoteItemId === driveItemId && entry.deletedAt === null)
  if (existing?.kind === "folder" && stats.isDirectory()) {
    await rewriteDescendantBaselines(deps, existing.relativePath, deps.operation.relativePath)
  }
  if (existing) await deps.baselineStore.removePath(deps.binding.id, existing.relativePath)
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

async function rewriteDescendantBaselines(
  deps: DriveSyncExecutorDeps,
  fromPrefix: string,
  toPrefix: string,
): Promise<void> {
  const sourcePrefix = fromPrefix === "" ? "" : `${fromPrefix}/`
  if (sourcePrefix === "") return
  const entries = await deps.baselineStore.listByBinding(deps.binding.id)
  const descendants = entries.filter((entry) =>
    entry.deletedAt === null && entry.relativePath.startsWith(sourcePrefix),
  )
  for (const entry of descendants) {
    const suffix = entry.relativePath.slice(sourcePrefix.length)
    const nextRelativePath = toPrefix ? `${toPrefix}/${suffix}` : suffix
    await deps.baselineStore.removePath(deps.binding.id, entry.relativePath)
    await deps.baselineStore.upsert({
      bindingId: entry.bindingId,
      relativePath: nextRelativePath,
      kind: entry.kind,
      remoteItemId: entry.remoteItemId,
      remoteVersionId: entry.remoteVersionId,
      remoteEtag: entry.remoteEtag,
      localSize: entry.localSize,
      localMtimeMs: entry.localMtimeMs,
      localHash: entry.localHash,
      deletedAt: null,
    })
  }
}

async function findUploadedRemoteItemId(deps: DriveSyncExecutorDeps, name: string, expectedType: "file" | "folder"): Promise<string> {
  const parentId = await parentRemoteId(deps)
  const expectedPath = uploadedRemotePath(deps, name)
  let offset: number | null = 0
  while (offset !== null) {
    const page = await deps.accountService.listDriveItemTree({ parentId, offset, limit: 200 })
    const item = page.items.find((candidate) => isDirectUploadedRemoteMatch(candidate, name, expectedPath, expectedType))
    if (item) return item.id
    offset = page.nextOffset ?? null
  }
  return name
}

function uploadedRemotePath(deps: DriveSyncExecutorDeps, name: string): string {
  if (deps.binding.kind !== "folder" || !deps.operation.relativePath) return name
  return path.posix.join(deps.binding.driveItemName, deps.operation.relativePath)
}

function isDirectUploadedRemoteMatch(
  item: Awaited<ReturnType<DriveSyncAccountService["listDriveItemTree"]>>["items"][number],
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
  const sanitized = sanitizeError(error instanceof Error ? error.message : "同步操作失败。")
  return sanitized || "同步操作失败。"
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
