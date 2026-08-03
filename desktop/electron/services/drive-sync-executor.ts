import { createHash } from "node:crypto"
import { constants as fsConstants, createWriteStream, type Stats } from "node:fs"
import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { DriveChangeType, DriveItemDto, DriveSyncOperationStatus } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBaselineStore } from "./drive-sync-baseline"
import type { DriveSyncAccountService, DriveSyncRecordOperationInput } from "./drive-sync-service"
import type { DriveSyncPlannedOperation } from "./drive-sync-planner"
import type { DriveSyncBindingEntryV1, DriveSyncOperationEntryV1 } from "../runtime/data-repo"
import { sanitizeError } from "./error-sanitize"
import { hashDriveSyncFile, scanDriveSyncLocalTree } from "./drive-sync-local-snapshot"
import { isDriveSyncExcluded } from "./drive-sync-excludes"
import {
  createDriveSyncDirectoryTarget,
  assertNoSymlinkPathComponents,
  driveSyncLocalWriteRootPath,
  prepareDriveSyncTargetPath,
  writeDriveSyncFileTarget,
} from "./drive-sync-paths"

export interface DriveSyncExecutorDeps {
  readonly binding: DriveSyncBindingEntryV1
  readonly operation: DriveSyncPlannedOperation
  readonly baselineStore: DriveSyncBaselineStore
  readonly accountService: DriveSyncAccountService
  readonly recordOperation: (input: DriveSyncRecordOperationInput) => Promise<{ readonly id: string }>
  readonly trashLocalPath: (localPath: string) => Promise<void>
  readonly markSelfWrite?: (input: { readonly bindingId: string; readonly relativePath: string }) => void
  readonly stagingRootPath?: string
  readonly signal?: AbortSignal
  readonly onRemoteMutation?: (changeType: DriveChangeType) => void | Promise<void>
  readonly skipLocalPrecondition?: boolean
  readonly uploadSnapshot?: UploadSnapshot | null
  readonly retainUploadSnapshotOnError?: (error: unknown) => boolean
}

export class DriveSyncLocalPreconditionError extends Error {
  constructor(readonly relativePath: string) {
    super("本地内容在远端操作执行前已变化。")
    this.name = "DriveSyncLocalPreconditionError"
  }
}

export async function executeDriveSyncOperation(deps: DriveSyncExecutorDeps): Promise<void> {
  deps.signal?.throwIfAborted()
  const runningOperation = await record(deps, "running", null)
  try {
    await executeOperationBody(deps, runningOperation.id)
    await record(deps, "succeeded", null, runningOperation.id)
  } catch (error) {
    await record(
      deps,
      deps.signal?.aborted ? "retry_wait" : error instanceof DriveSyncLocalPreconditionError ? "conflict" : "error",
      deps.signal?.aborted ? "同步已中断，恢复后继续。" : errorMessage(error),
      runningOperation.id,
    )
    throw error
  }
}

async function executeOperationBody(deps: DriveSyncExecutorDeps, operationRecordId: string): Promise<void> {
  switch (deps.operation.kind) {
    case "download":
      await downloadRemoteItem(deps, operationRecordId)
      return
    case "upload":
      await uploadLocalItem(deps, operationRecordId)
      return
    case "delete_remote":
      await deleteRemoteItem(deps)
      return
    case "delete_local":
      await deleteLocalItem(deps)
      return
    case "move_local":
      await moveLocalItem(deps, operationRecordId)
      return
    case "move_remote":
      await moveRemoteItem(deps)
      return
    default:
      throw new Error(`暂不支持的同步操作：${deps.operation.kind}`)
  }
}

async function downloadRemoteItem(deps: DriveSyncExecutorDeps, operationRecordId: string): Promise<void> {
  if (deps.operation.remoteItemKind === "folder") {
    await downloadFolder(deps, operationRecordId)
    return
  }
  await downloadFile(deps, operationRecordId)
}

async function downloadFile(deps: DriveSyncExecutorDeps, operationRecordId: string): Promise<void> {
  const requestedLocalPath = requireLocalPath(deps.operation)
  const driveItemId = requireDriveItemId(deps.operation)
  if (!deps.skipLocalPrecondition) await assertLocalTargetStillAtBaseline(deps, requestedLocalPath, deps.operation.relativePath)
  markSelfWrite(deps, deps.operation.relativePath)
  let progressWrites = Promise.resolve()
  let localPath: string
  try {
    localPath = await writeDriveSyncFileTarget(
      driveSyncLocalWriteRootPath(deps.binding),
      requestedLocalPath,
      (outputPath) => deps.accountService.downloadDriveFile({
        itemId: driveItemId,
        outputPath,
        signal: deps.signal,
        onProgress: (completedBytes, totalBytes) => {
          progressWrites = progressWrites.then(() => deps.recordOperation({
            id: operationRecordId,
            bindingId: deps.binding.id,
            kind: deps.operation.kind,
            status: "running",
            driveItemId,
            relativePath: deps.operation.relativePath,
            localPath: requestedLocalPath,
            remotePathHint: deps.operation.remotePathHint,
            remoteItemKind: deps.operation.remoteItemKind,
            completedBytes,
            totalBytes,
          })).then(() => undefined)
        },
      }),
    )
  } finally {
    await progressWrites
  }
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

async function downloadFolder(deps: DriveSyncExecutorDeps, operationRecordId: string): Promise<void> {
  const requestedLocalPath = requireLocalPath(deps.operation)
  const driveItemId = requireDriveItemId(deps.operation)
  if (!deps.skipLocalPrecondition) await assertLocalTargetStillAtBaseline(deps, requestedLocalPath, deps.operation.relativePath)
  markSelfWrite(deps, deps.operation.relativePath)
  const localPath = await createDriveSyncDirectoryTarget(driveSyncLocalWriteRootPath(deps.binding), requestedLocalPath)
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
  await downloadFolderDescendants(deps, {
    rootDriveItemId: driveItemId,
    rootLocalPath: localPath,
    rootRelativePath: deps.operation.relativePath,
    operationRecordId,
  })
}

async function downloadFolderDescendants(
  deps: DriveSyncExecutorDeps,
  input: {
    readonly rootDriveItemId: string
    readonly rootLocalPath: string
    readonly rootRelativePath: string
    readonly operationRecordId: string
  },
): Promise<void> {
  const rootName = path.basename(input.rootLocalPath)
  let completedBytes = 0
  let totalBytes = 0
  let progressWrites = Promise.resolve()
  let offset: number | null = 0
  while (offset !== null) {
    const page = await deps.accountService.listDriveItemTree({ parentId: input.rootDriveItemId, offset, limit: 200 })
    for (const item of page.items) {
      const relativePath = downloadedFolderChildRelativePath(input.rootRelativePath, rootName, item.path ?? item.name, deps.operation.remotePathHint)
      if (!relativePath || isDriveSyncExcluded(relativePath, deps.binding.excludeRules, item.type)) continue
      const localPath = path.join(deps.binding.localPath, relativePath)
      markSelfWrite(deps, relativePath)
      if (item.type === "folder") {
        await createDriveSyncDirectoryTarget(driveSyncLocalWriteRootPath(deps.binding), localPath)
        const stats = await lstat(localPath)
        await deps.baselineStore.upsert({
          bindingId: deps.binding.id,
          relativePath,
          kind: "folder",
          remoteItemId: item.id,
          remoteVersionId: null,
          remoteEtag: null,
          localSize: null,
          localMtimeMs: stats.mtimeMs,
          localHash: null,
          deletedAt: null,
        })
        continue
      }
      const declaredSize = safeByteSize(item.size)
      totalBytes += declaredSize
      if (!deps.skipLocalPrecondition) await assertLocalTargetStillAtBaseline(deps, localPath, relativePath)
      let writtenPath: string
      try {
        writtenPath = await writeDriveSyncFileTarget(
          driveSyncLocalWriteRootPath(deps.binding),
          localPath,
          (outputPath) => deps.accountService.downloadDriveFile({
            itemId: item.id,
            outputPath,
            signal: deps.signal,
            onProgress: (fileCompletedBytes, fileTotalBytes) => {
              progressWrites = progressWrites.then(() => deps.recordOperation({
                id: input.operationRecordId,
                bindingId: deps.binding.id,
                kind: deps.operation.kind,
                status: "running",
                driveItemId: input.rootDriveItemId,
                relativePath: deps.operation.relativePath,
                localPath: input.rootLocalPath,
                remotePathHint: deps.operation.remotePathHint,
                remoteItemKind: "folder",
                completedBytes: completedBytes + fileCompletedBytes,
                totalBytes: Math.max(totalBytes, completedBytes + fileTotalBytes),
              })).then(() => undefined)
            },
          }),
        )
      } finally {
        await progressWrites
      }
      const stats = await lstat(writtenPath)
      completedBytes += Math.max(declaredSize, stats.size)
      totalBytes = Math.max(totalBytes, completedBytes)
      await progressWrites
      await deps.baselineStore.upsert({
        bindingId: deps.binding.id,
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
    offset = page.nextOffset ?? null
  }
}

function safeByteSize(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function markSelfWrite(deps: DriveSyncExecutorDeps, relativePath: string): void {
  deps.markSelfWrite?.({ bindingId: deps.binding.id, relativePath })
}

async function uploadLocalItem(deps: DriveSyncExecutorDeps, operationRecordId: string): Promise<void> {
  const localPath = requireLocalPath(deps.operation)
  const stats = await lstat(localPath)
  if (stats.isDirectory()) {
    const created = await deps.accountService.createDriveFolder({
      parentId: await parentRemoteId(deps),
      name: path.basename(localPath),
    })
    await deps.onRemoteMutation?.("created")
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

  const snapshot = await createUploadSnapshot(deps, localPath)
  let retainSnapshot = false
  try {
    const parentId = await parentRemoteId(deps)
    await recordProgress(deps, operationRecordId, 0, snapshot.size, snapshot)
    let progressWrites = Promise.resolve()
    let item: DriveItemDto
    try {
      item = await deps.accountService.uploadDriveSyncFile({
        parentId,
        path: snapshot.path,
        name: path.basename(localPath),
        expectedItemId: deps.operation.driveItemId ?? null,
        signal: deps.signal,
        onProgress: (completedBytes, totalBytes) => {
          progressWrites = progressWrites.then(async () => {
            await recordProgress(deps, operationRecordId, completedBytes, totalBytes, snapshot)
          })
        },
      })
    } finally {
      await progressWrites
    }
    await deps.onRemoteMutation?.(deps.operation.driveItemId ? "content_updated" : "created")
    const remoteItemId = item.id
    await recordProgress(deps, operationRecordId, snapshot.size, snapshot.size, snapshot, item.id)
    await deps.baselineStore.upsert({
      bindingId: deps.binding.id,
      relativePath: deps.operation.relativePath,
      kind: "file",
      remoteItemId,
      remoteVersionId: null,
      remoteEtag: null,
      localSize: snapshot.size,
      localMtimeMs: snapshot.sourceMtimeMs,
      localHash: snapshot.hash,
      deletedAt: null,
    })
  } catch (error) {
    retainSnapshot = deps.retainUploadSnapshotOnError?.(error) ?? false
    throw error
  } finally {
    if (!retainSnapshot) await rm(snapshot.directory, { recursive: true, force: true })
  }
}

export type UploadSnapshot = {
  readonly directory: string
  readonly path: string
  readonly hash: string
  readonly size: number
  readonly sourceMtimeMs: number
}

async function createUploadSnapshot(deps: DriveSyncExecutorDeps, localPath: string): Promise<UploadSnapshot> {
  const stagingRoot = deps.stagingRootPath ?? path.join(os.tmpdir(), "synapse-drive-sync-staging")
  const bindingRoot = path.join(stagingRoot, safeStagingSegment(deps.binding.id))
  await mkdir(bindingRoot, { recursive: true })
  const existing = deps.uploadSnapshot
  if (existing && isPathInside(bindingRoot, existing.path) && path.dirname(existing.path) === existing.directory) {
    try {
      const stats = await lstat(existing.path)
      if (stats.isFile() && stats.size === existing.size && await hashDriveSyncFile(existing.path) === existing.hash) {
        return existing
      }
    } catch {
      // The retained snapshot is unusable; replace it with a fresh safe snapshot below.
    }
    await rm(existing.directory, { recursive: true, force: true })
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const directory = await mkdtemp(path.join(bindingRoot, "upload-"))
    const snapshotPath = path.join(directory, "content")
    try {
      const rootPath = driveSyncLocalWriteRootPath(deps.binding)
      await assertNoSymlinkPathComponents(rootPath, localPath)
      const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
      const source = await open(localPath, fsConstants.O_RDONLY | noFollow)
      let before: Stats
      let after: Stats
      let snapshotHash = ""
      try {
        before = await source.stat()
        if (!before.isFile()) throw new Error("本地条目类型不支持同步。")
        const hasher = createHash("sha256")
        const hashStream = new Transform({
          transform(chunk, _encoding, callback) {
            hasher.update(chunk)
            callback(null, chunk)
          },
        })
        await pipeline(
          source.createReadStream({ autoClose: false }),
          hashStream,
          createWriteStream(snapshotPath, { flags: "wx" }),
        )
        snapshotHash = `sha256:${hasher.digest("hex")}`
        after = await source.stat()
      } finally {
        await source.close()
      }
      await assertNoSymlinkPathComponents(rootPath, localPath)
      const [current, snapshotStats, verifiedSnapshotHash] = await Promise.all([
        lstat(localPath),
        lstat(snapshotPath),
        hashDriveSyncFile(snapshotPath),
      ])
      if (
        before.isFile()
        && after.isFile()
        && current.isFile()
        && before.size === after.size
        && before.mtimeMs === after.mtimeMs
        && before.dev === after.dev
        && before.ino === after.ino
        && after.dev === current.dev
        && after.ino === current.ino
        && snapshotHash === verifiedSnapshotHash
        && snapshotStats.size === after.size
      ) {
        return {
          directory,
          path: snapshotPath,
          hash: snapshotHash,
          size: snapshotStats.size,
          sourceMtimeMs: after.mtimeMs,
        }
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
    await rm(directory, { recursive: true, force: true })
  }
  throw new Error("本地文件在生成上传快照时持续变化，请稍后重试。")
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

async function recordProgress(
  deps: DriveSyncExecutorDeps,
  operationRecordId: string,
  completedBytes: number,
  totalBytes: number,
  snapshot: UploadSnapshot,
  driveItemId: string | null = deps.operation.driveItemId,
): Promise<void> {
  await deps.recordOperation({
    id: operationRecordId,
    bindingId: deps.operation.bindingId,
    kind: deps.operation.kind,
    status: "running",
    driveItemId,
    relativePath: deps.operation.relativePath,
    localPath: deps.operation.localPath,
    remotePathHint: deps.operation.remotePathHint,
    remoteItemKind: deps.operation.remoteItemKind,
    completedBytes,
    totalBytes,
    snapshotPath: snapshot.path,
    snapshotHash: snapshot.hash,
    snapshotSize: snapshot.size,
    snapshotMtimeMs: snapshot.sourceMtimeMs,
  })
}

function downloadedFolderChildRelativePath(rootRelativePath: string, rootName: string, remotePath: string, remotePathHint: string | null): string {
  const normalizedRemotePath = remotePath.split(/[\\/]+/u).filter(Boolean).join("/")
  const remoteRootPath = remotePathHint?.split(/[\\/]+/u).filter(Boolean).join("/") ?? ""
  if (normalizedRemotePath === remoteRootPath || normalizedRemotePath === rootName) return rootRelativePath
  const rootPrefixes = [remoteRootPath, rootName]
    .filter(Boolean)
    .map((value) => `${value}/`)
  const matchedPrefix = rootPrefixes.find((prefix) => normalizedRemotePath.startsWith(prefix))
  const suffix = matchedPrefix ? normalizedRemotePath.slice(matchedPrefix.length) : normalizedRemotePath
  return [rootRelativePath, suffix].filter(Boolean).join("/")
}

async function deleteRemoteItem(deps: DriveSyncExecutorDeps): Promise<void> {
  try {
    await deps.accountService.deleteDriveItem(requireDriveItemId(deps.operation))
    await deps.onRemoteMutation?.("trashed")
  } catch (error) {
    if (!isRemoteNotFoundError(error)) throw error
  }
  await deps.baselineStore.markDeleted(deps.binding.id, deps.operation.relativePath)
}

async function deleteLocalItem(deps: DriveSyncExecutorDeps): Promise<void> {
  if (!deps.skipLocalPrecondition) {
    await assertLocalTargetStillAtBaseline(deps, requireLocalPath(deps.operation), deps.operation.relativePath, true)
  }
  try {
    await deps.trashLocalPath(requireLocalPath(deps.operation))
  } catch (error) {
    if (!isLocalNotFoundError(error)) throw error
  }
  await deps.baselineStore.markDeleted(deps.binding.id, deps.operation.relativePath)
}

async function moveLocalItem(deps: DriveSyncExecutorDeps, operationRecordId: string): Promise<void> {
  const driveItemId = requireDriveItemId(deps.operation)
  const localPath = requireLocalPath(deps.operation)
  const existing = (await deps.baselineStore.listByBinding(deps.binding.id))
    .find((entry) => entry.remoteItemId === driveItemId && entry.deletedAt === null)
  if (!existing) {
    await downloadRemoteItem(deps, operationRecordId)
    return
  }

  const previousLocalPath = path.join(deps.binding.localPath, existing.relativePath)
  if (previousLocalPath !== localPath) {
    const safeLocalPath = await prepareDriveSyncTargetPath(driveSyncLocalWriteRootPath(deps.binding), localPath)
    await rename(previousLocalPath, safeLocalPath)
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

async function assertLocalTargetStillAtBaseline(
  deps: DriveSyncExecutorDeps,
  localPath: string,
  relativePath: string,
  verifySubtree = false,
): Promise<void> {
  let stats
  try {
    stats = await lstat(localPath)
  } catch (error) {
    if (isLocalNotFoundError(error)) return
    throw error
  }
  const baseline = (await deps.baselineStore.listByBinding(deps.binding.id))
    .find((entry) => entry.relativePath === relativePath && entry.deletedAt === null)
  if (!baseline) throw new DriveSyncLocalPreconditionError(relativePath)
  if (baseline.kind === "file") {
    if (!stats.isFile() || !baseline.localHash || await hashDriveSyncFile(localPath) !== baseline.localHash) {
      throw new DriveSyncLocalPreconditionError(relativePath)
    }
    return
  }
  if (!stats.isDirectory()) throw new DriveSyncLocalPreconditionError(relativePath)
  if (!verifySubtree) return
  const subtree = await scanDriveSyncLocalTree({
    rootPath: localPath,
    rules: deps.binding.excludeRules,
    hashFiles: true,
  })
  const baselines = (await deps.baselineStore.listByBinding(deps.binding.id))
    .filter((entry) => entry.deletedAt === null
      && entry.relativePath !== relativePath
      && (relativePath === "" || entry.relativePath.startsWith(`${relativePath}/`)))
  if (subtree.length !== baselines.length) throw new DriveSyncLocalPreconditionError(relativePath)
  for (const local of subtree) {
    const bindingRelativePath = relativePath ? path.posix.join(relativePath, local.relativePath) : local.relativePath
    const previous = baselines.find((entry) => entry.relativePath === bindingRelativePath)
    if (!previous || previous.kind !== local.kind) throw new DriveSyncLocalPreconditionError(bindingRelativePath)
    if (local.kind === "file" && (!local.hash || local.hash !== previous.localHash)) {
      throw new DriveSyncLocalPreconditionError(bindingRelativePath)
    }
  }
}

async function moveRemoteItem(deps: DriveSyncExecutorDeps): Promise<void> {
  const driveItemId = requireDriveItemId(deps.operation)
  const localPath = requireLocalPath(deps.operation)
  const stats = await lstat(localPath)
  const targetName = path.basename(localPath)
  const targetKind = stats.isDirectory() ? "folder" : "file"
  assertValidDriveSyncRemoteName(targetName)
  const parentId = await parentRemoteId(deps)
  await assertNoRemoteMoveNameConflict(deps, {
    parentId,
    name: targetName,
    kind: targetKind,
    driveItemId,
  })
  const current = deps.accountService.getDriveItem
    ? await deps.accountService.getDriveItem(driveItemId)
    : null
  if (!current || current.parentId !== parentId) {
    await deps.accountService.moveDriveItem(driveItemId, parentId)
    await deps.onRemoteMutation?.("moved")
  }
  if (!current || current.name !== targetName) {
    await deps.accountService.renameDriveItem(driveItemId, targetName)
    await deps.onRemoteMutation?.("renamed")
  }

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

async function assertNoRemoteMoveNameConflict(
  deps: DriveSyncExecutorDeps,
  input: {
    readonly parentId: string | null
    readonly name: string
    readonly kind: "file" | "folder"
    readonly driveItemId: string
  },
): Promise<void> {
  let offset: number | null = 0
  while (offset !== null) {
    const page = await deps.accountService.listDriveItemTree({ parentId: input.parentId, offset, limit: 200 })
    const conflict = page.items.find((item) =>
      item.id !== input.driveItemId
      && item.name === input.name
      && item.type === input.kind
      && (item.parentId ?? null) === input.parentId,
    )
    if (conflict) throw new Error(input.kind === "folder" ? "目标位置已有同名文件夹。" : "目标位置已有同名文件。")
    offset = page.nextOffset ?? null
  }
}

function assertValidDriveSyncRemoteName(value: string): void {
  if (!isValidDriveSyncRemoteName(value)) throw new Error("文件名无效。")
}

function isValidDriveSyncRemoteName(value: string): boolean {
  const name = value.normalize("NFC")
  if (!name) return false
  if (name !== name.trim()) return false
  if (name.length > 255) return false
  if (name === "." || name === "..") return false
  if (/[<>:"/\\|?*]/u.test(name) || Array.from(name).some((character) => character.charCodeAt(0) <= 0x1f)) return false
  if (/[. ]$/u.test(name)) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)) return false
  return true
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

async function parentRemoteId(deps: DriveSyncExecutorDeps): Promise<string | null> {
  const parentPath = parentRelativePath(deps.operation.relativePath)
  if (parentPath === null) {
    if (deps.operation.relativePath === "" && deps.operation.driveItemId === null) {
      return deps.binding.remoteParentId ?? null
    }
    if (deps.binding.kind === "file") {
      const remoteFileId = deps.operation.driveItemId ?? deps.binding.driveItemId
      const remoteFile = deps.accountService.getDriveItem ? await deps.accountService.getDriveItem(remoteFileId) : null
      return remoteFile?.parentId ?? null
    }
    return deps.binding.driveItemId
  }
  const parentBaseline = (await deps.baselineStore.listByBinding(deps.binding.id))
    .find((entry) => entry.relativePath === parentPath && entry.deletedAt === null)
  if (!parentBaseline) throw new Error("云盘父文件夹尚未同步，已停止上传子项。")
  return parentBaseline.remoteItemId
}

function parentRelativePath(relativePath: string): string | null {
  const parent = path.posix.dirname(relativePath)
  return parent === "." ? null : parent
}

function safeStagingSegment(bindingId: string): string {
  return bindingId.replace(/[^a-zA-Z0-9._-]/gu, "_")
}

async function record(
  deps: DriveSyncExecutorDeps,
  status: DriveSyncOperationStatus,
  message: string | null,
  id?: string,
): Promise<{ readonly id: string }> {
  return deps.recordOperation({
    id,
    bindingId: deps.binding.id,
    kind: deps.operation.kind as DriveSyncOperationEntryV1["kind"],
    status,
    driveItemId: deps.operation.driveItemId,
    relativePath: deps.operation.relativePath,
    localPath: deps.operation.localPath,
    remotePathHint: deps.operation.remotePathHint,
    remoteItemKind: deps.operation.remoteItemKind,
    source: deps.operation.kind === "upload" || deps.operation.kind === "delete_remote" || deps.operation.kind === "move_remote"
      ? "local"
      : "remote",
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
