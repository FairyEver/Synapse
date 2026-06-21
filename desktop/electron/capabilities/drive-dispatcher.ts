import path from "node:path"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"

import type {
  DriveAccessExpiresIn,
  DriveAccessSettingsInput,
  DriveBrowserSnapshotDto,
  DriveFileVersionDto,
  DriveFileVersionListInput,
  DriveFileVersionListPageDto,
  DriveFolderUploadPrepareResult,
  DriveFolderPathEnsureInput,
  DriveFolderPathEnsureResultDto,
  DriveItemDto,
  DriveItemTreeListInput,
  DriveItemTreeListPageDto,
  DrivePublicAssetDto,
  DrivePublicAssetListPageDto,
  DrivePublicLinksPageInput,
  DriveReorganizationApplyInput,
  DriveReorganizationApplyResultDto,
  DriveReorganizationPreviewDto,
  DriveReorganizationPreviewInput,
  DriveShareAccessMode,
  DriveShareDto,
  DriveShareListPageDto,
  DriveStatsDto,
  DriveTrashItemDto,
  DriveTrashListPageDto,
  DriveUploadPrepareResult,
  DriveUsageDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { checkCapabilityPermission } from "./permission-audit"
import {
  DRIVE_LOCAL_UPLOAD_MAX_FILES,
  DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
  createDriveLocalUploadTooDeepError,
  createDriveLocalUploadTooManyFilesError,
} from "../../src/lib/drive-local-upload-limits"

type DriveAccountServicePort = {
  readonly listDriveItems: (parentId: string | null) => Promise<DriveItemDto[]>
  readonly getDriveItem: (itemId: string) => Promise<DriveItemDto>
  readonly prepareDriveUpload: (input: {
    readonly parentId?: string | null
    readonly name: string
    readonly size: string
    readonly mimeType?: string | null
  }) => Promise<DriveUploadPrepareResult>
  readonly prepareDriveFolderUpload: (input: {
    readonly parentId?: string | null
    readonly folderName: string
    readonly files: Array<{ readonly relativePath: string; readonly size: string; readonly mimeType?: string | null }>
  }) => Promise<DriveFolderUploadPrepareResult>
  readonly completeDriveUpload: (sessionId: string) => Promise<DriveItemDto>
  readonly cancelDriveUpload: (sessionId: string) => Promise<{ ok: true }>
  readonly createDriveFolder: (input: { readonly parentId?: string | null; readonly name: string }) => Promise<DriveItemDto>
  readonly renameDriveItem: (itemId: string, name: string) => Promise<DriveItemDto>
  readonly moveDriveItem: (itemId: string, parentId: string | null) => Promise<DriveItemDto>
  readonly deleteDriveItem: (itemId: string) => Promise<{ ok: true }>
  readonly shareDriveItem: (itemId: string, settings?: DriveAccessSettingsInput) => Promise<DriveShareDto>
  readonly disableDriveShare: (shareId: string) => Promise<{ ok: true }>
  readonly getDriveUsage: () => Promise<DriveUsageDto>
  readonly getDriveStats: () => Promise<DriveStatsDto>
  readonly listDriveItemTree: (input: DriveItemTreeListInput) => Promise<DriveItemTreeListPageDto>
  readonly ensureDriveFolderPath: (input: DriveFolderPathEnsureInput) => Promise<DriveFolderPathEnsureResultDto>
  readonly previewDriveReorganization: (input: DriveReorganizationPreviewInput) => Promise<DriveReorganizationPreviewDto>
  readonly applyDriveReorganization: (input: DriveReorganizationApplyInput) => Promise<DriveReorganizationApplyResultDto>
  readonly listDriveShares: (input?: DrivePublicLinksPageInput) => Promise<DriveShareListPageDto>
  readonly getDriveItemPreview: (input: {
    readonly itemId: string
    readonly surface?: "standalone" | "console"
    readonly childrenOffset?: number
    readonly childrenLimit?: number
  }) => Promise<DriveBrowserSnapshotDto>
  readonly readDriveFileContent: (input: {
    readonly itemId: string
    readonly maxBytes?: number
  }) => Promise<unknown>
  readonly downloadDriveFile: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<unknown>
  readonly listDriveFileVersions: (itemId: string, input?: DriveFileVersionListInput) => Promise<DriveFileVersionListPageDto>
  readonly downloadDriveFileVersion: (input: {
    readonly itemId: string
    readonly versionId: string
    readonly outputPath: string
  }) => Promise<unknown>
  readonly restoreDriveFileVersion: (itemId: string, versionId: string) => Promise<DriveItemDto>
  readonly deleteDriveFileVersion: (itemId: string, versionId: string) => Promise<{ ok: true }>
  readonly updateDriveFileVersionPin: (itemId: string, versionId: string, isPinned: boolean) => Promise<DriveFileVersionDto>
  readonly downloadDriveFolderZip: (input: { readonly itemId: string; readonly outputPath: string }) => Promise<unknown>
  readonly listDrivePublicAssets: (input?: DrivePublicLinksPageInput) => Promise<DrivePublicAssetListPageDto>
  readonly getDrivePublicAsset: (assetId: string) => Promise<DrivePublicAssetDto>
  readonly uploadDrivePublicAssets: (input: {
    readonly files: ReadonlyArray<{
      readonly path: string
      readonly name: string
      readonly mimeType?: string | null
    }>
  }) => Promise<{
    readonly results: ReadonlyArray<
      | { readonly status: "fulfilled"; readonly fileName: string; readonly asset: DrivePublicAssetDto }
      | { readonly status: "rejected"; readonly fileName: string; readonly message: string }
    >
  }>
  readonly replaceDrivePublicAssetFile: (input: {
    readonly assetId: string
    readonly path: string
    readonly name: string
    readonly mimeType?: string | null
  }) => Promise<DrivePublicAssetDto>
  readonly renameDrivePublicAsset: (assetId: string, name: string) => Promise<DrivePublicAssetDto>
  readonly trashDrivePublicAsset: (assetId: string) => Promise<DrivePublicAssetDto>
  readonly restoreDrivePublicAsset: (assetId: string) => Promise<DrivePublicAssetDto>
  readonly listDriveTrash: (input?: DrivePublicLinksPageInput) => Promise<DriveTrashListPageDto>
  readonly deleteDriveTrashItem: (itemId: string) => Promise<{ ok: true }>
  readonly restoreDriveTrashItem: (input: {
    readonly itemId: string
    readonly kind?: DriveTrashItemDto["kind"]
    readonly assetId?: string
  }) => Promise<DriveItemDto | DrivePublicAssetDto>
}

type FileSystemPort = {
  readonly createReadStream: typeof createReadStream
  readonly readdir: typeof readdir
  readonly stat: typeof stat
}

type DriveCapabilityDispatcherDeps = {
  readonly accountService: DriveAccountServicePort
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
  readonly fileSystem?: FileSystemPort
  readonly fetch?: typeof fetch
}

type LocalFileEntry = {
  readonly absolutePath: string
  readonly relativePath: string
  readonly size: string
  readonly sizeBytes: number
}

type DriveMutationSecurity = {
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const defaultFileSystem: FileSystemPort = { createReadStream, readdir, stat }
const DRIVE_ACCESS_EXPIRES_IN_VALUES = new Set<DriveAccessExpiresIn>(["3d", "7d", "30d", "1y", "forever"])

export function createDriveCapabilityDispatcher(deps: DriveCapabilityDispatcherDeps) {
  const fileSystem = deps.fileSystem ?? defaultFileSystem
  const fetchImpl = deps.fetch ?? fetch

  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "drive.item.list":
          return dispatchDriveRead(deps, action, params, context, async () => {
            const parentId = optionalNullableString(params.parentId)
            const items = await deps.accountService.listDriveItems(parentId)
            return { ok: true, data: items, total: items.length }
          })
        case "drive.item.get":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.getDriveItem(requireString(params, "itemId")),
          }))
        case "drive.file.upload":
          return dispatchDriveMutation(deps, action, params, context, () =>
            uploadFile(deps, fileSystem, fetchImpl, params, context))
        case "drive.folder.upload":
          return dispatchDriveMutation(deps, action, params, context, () =>
            uploadFolder(deps, fileSystem, fetchImpl, params, context))
        case "drive.folder.create":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const item = await deps.accountService.createDriveFolder({
              parentId: optionalNullableString(params.parentId),
              name: requireString(params, "name"),
            })
            return { ok: true, data: item }
          })
        case "drive.item.rename":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.renameDriveItem(
              requireString(params, "itemId"),
              requireString(params, "name"),
            ),
          }))
        case "drive.item.move":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const item = await deps.accountService.moveDriveItem(
              requireString(params, "itemId"),
              optionalNullableString(params.parentId),
            )
            return { ok: true, data: item }
          })
        case "drive.item.delete":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.deleteDriveItem(requireString(params, "itemId")),
          }))
        case "drive.item_preview.get":
          return dispatchDriveRead(deps, action, params, context, async () => {
            const childrenOffset = optionalNumber(params.childrenOffset)
            const childrenLimit = optionalNumber(params.childrenLimit)
            return {
              ok: true,
              data: await deps.accountService.getDriveItemPreview({
                itemId: requireString(params, "itemId"),
                surface: optionalDrivePreviewSurface(params.surface) ?? "standalone",
                ...(childrenOffset === undefined ? {} : { childrenOffset }),
                ...(childrenLimit === undefined ? {} : { childrenLimit }),
              }),
            }
          })
        case "drive.file_content.read":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.readDriveFileContent({
              itemId: requireString(params, "itemId"),
              maxBytes: optionalNumber(params.maxBytes),
            }),
          }))
        case "drive.file_download.create":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const itemId = requireString(params, "itemId")
            const outputPath = requireAbsoluteOutputPath(params)
            await authorizeFileWrite(deps, action, itemId, outputPath, context)
            return {
              ok: true,
              data: await deps.accountService.downloadDriveFile({ itemId, outputPath }),
            }
          })
        case "drive.file_version.list":
          return dispatchDriveRead(deps, action, params, context, async () => {
            const itemId = requireString(params, "itemId")
            const versions = await deps.accountService.listDriveFileVersions(itemId, parseDriveVersionListInput(params))
            return { ok: true, data: versions, total: versions.total }
          })
        case "drive.file_version_download.create":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const itemId = requireString(params, "itemId")
            const versionId = requireString(params, "versionId")
            const outputPath = requireAbsoluteOutputPath(params)
            await authorizeFileWrite(deps, action, itemId, outputPath, context)
            return {
              ok: true,
              data: await deps.accountService.downloadDriveFileVersion({ itemId, versionId, outputPath }),
            }
          })
        case "drive.file_version.restore":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.restoreDriveFileVersion(
              requireString(params, "itemId"),
              requireString(params, "versionId"),
            ),
          }))
        case "drive.file_version.delete":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.deleteDriveFileVersion(
              requireString(params, "itemId"),
              requireString(params, "versionId"),
            ),
          }))
        case "drive.file_version_pin.update":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.updateDriveFileVersionPin(
              requireString(params, "itemId"),
              requireString(params, "versionId"),
              requireBoolean(params, "isPinned"),
            ),
          }))
        case "drive.folder_zip.create":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const itemId = requireString(params, "itemId")
            const outputPath = requireAbsoluteOutputPath(params)
            await authorizeFileWrite(deps, action, itemId, outputPath, context)
            return {
              ok: true,
              data: await deps.accountService.downloadDriveFolderZip({ itemId, outputPath }),
            }
          })
        case "drive.share.list":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: sanitizeDriveShareList(await deps.accountService.listDriveShares(parsePublicLinksPageInput(params))),
          }))
        case "drive.share.create":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const { DRIVE_DEFAULT_ACCESS_SETTINGS } = await import("@synapse/shared")
            const settings = hasDriveAccessSettingsInput(params)
              ? parseDriveAccessSettings(params, DRIVE_DEFAULT_ACCESS_SETTINGS)
              : undefined
            return {
              ok: true,
              data: await deps.accountService.shareDriveItem(
                requireString(params, "itemId"),
                settings,
              ),
            }
          })
        case "drive.share.disable":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.disableDriveShare(requireString(params, "shareId")),
          }))
        case "drive.usage.get":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.getDriveUsage(),
          }))
        case "drive.stats.get":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.getDriveStats(),
          }))
        case "drive.item_tree.list":
          return dispatchDriveRead(deps, action, params, context, async () => {
            const tree = await deps.accountService.listDriveItemTree(parseDriveTreeListInput(params))
            return { ok: true, data: tree, total: tree.total }
          })
        case "drive.folder_path.ensure":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.ensureDriveFolderPath(parseFolderPathEnsureInput(params)),
          }))
        case "drive.reorganization.preview":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.previewDriveReorganization(parseReorganizationPreviewInput(params)),
          }))
        case "drive.reorganization.apply":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.applyDriveReorganization({ planId: requireString(params, "planId") }),
          }))
        case "drive.direct_link.upload":
          return dispatchDriveMutation(deps, action, params, context, () =>
            uploadPublicAsset(deps, params, context, action))
        case "drive.direct_link.list":
          return dispatchDriveRead(deps, action, params, context, async () => {
            const assets = await deps.accountService.listDrivePublicAssets(parsePublicLinksPageInput(params))
            return { ok: true, data: assets, total: assets.total }
          })
        case "drive.direct_link.get":
          return dispatchDriveRead(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.getDrivePublicAsset(requireString(params, "assetId")),
          }))
        case "drive.direct_link.update":
          return dispatchDriveMutation(deps, action, params, context, () =>
            replacePublicAsset(deps, params, context, action))
        case "drive.direct_link.rename":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.renameDrivePublicAsset(
              requireString(params, "assetId"),
              requireString(params, "name"),
            ),
          }))
        case "drive.direct_link.delete":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.trashDrivePublicAsset(requireString(params, "assetId")),
          }))
        case "drive.direct_link.restore":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.restoreDrivePublicAsset(requireString(params, "assetId")),
          }))
        case "drive.trash.list":
          return dispatchDriveRead(deps, action, params, context, async () => {
            const trash = await deps.accountService.listDriveTrash(parsePublicLinksPageInput(params))
            return { ok: true, data: trash, total: trash.total }
          })
        case "drive.trash.delete":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.deleteDriveTrashItem(requireString(params, "itemId")),
          }))
        case "drive.item.restore":
          return dispatchDriveMutation(deps, action, params, context, async () => ({
            ok: true,
            data: await deps.accountService.restoreDriveTrashItem(parseDriveTrashRestoreInput(params)),
          }))
        default:
          throw new Error(`Unknown drive action: ${action}`)
      }
    },
  }
}

async function uploadFile(
  deps: DriveCapabilityDispatcherDeps,
  fileSystem: FileSystemPort,
  fetchImpl: typeof fetch,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const filePath = requireString(params, "filePath")
  await authorizeFileRead(deps, filePath, context)
  const fileStat = await fileSystem.stat(filePath)
  if (!fileStat.isFile()) throw new Error("filePath must point to a file.")

  const prepared = await deps.accountService.prepareDriveUpload({
    parentId: optionalNullableString(params.parentId),
    name: optionalString(params.name) ?? path.basename(filePath),
    size: String(fileStat.size),
    mimeType: optionalString(params.mimeType) ?? null,
  })

  try {
    await putPreparedUploadFromPath(fetchImpl, fileSystem, prepared.upload, filePath, fileStat.size)
    const item = await completeDriveUploadWithRetry(deps.accountService, prepared.sessionId)
    return { ok: true, data: item }
  } catch (error) {
    await deps.accountService.cancelDriveUpload(prepared.sessionId).catch(() => undefined)
    throw error
  }
}

async function uploadFolder(
  deps: DriveCapabilityDispatcherDeps,
  fileSystem: FileSystemPort,
  fetchImpl: typeof fetch,
  params: Record<string, unknown>,
  context: DispatchContext,
): Promise<DispatchResult> {
  const folderPath = requireString(params, "folderPath")
  await authorizeFileRead(deps, folderPath, context)
  const folderStat = await fileSystem.stat(folderPath)
  if (!folderStat.isDirectory()) throw new Error("folderPath must point to a directory.")

  const entries = await listLocalFiles(fileSystem, folderPath)
  if (entries.length === 0) throw new Error("Folder is empty.")

  const prepared = await deps.accountService.prepareDriveFolderUpload({
    parentId: optionalNullableString(params.parentId),
    folderName: optionalString(params.folderName) ?? path.basename(folderPath),
    files: entries.map((entry) => ({
      relativePath: entry.relativePath,
      size: entry.size,
      mimeType: null,
    })),
  })
  const preparedByPath = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
  const failures: Array<{ readonly relativePath: string; readonly error: string }> = []
  let completed = 0
  let cleanupRootDeleted = false
  let cleanupRootDeleteFailed = false

  for (const entry of entries) {
    const preparedEntry = preparedByPath.get(entry.relativePath)
    if (!preparedEntry) {
      failures.push({ relativePath: entry.relativePath, error: "Missing upload session." })
      continue
    }
    try {
      await putPreparedUploadFromPath(fetchImpl, fileSystem, preparedEntry.upload, entry.absolutePath, entry.sizeBytes)
      await completeDriveUploadWithRetry(deps.accountService, preparedEntry.sessionId)
      completed += 1
    } catch (error) {
      await deps.accountService.cancelDriveUpload(preparedEntry.sessionId).catch(() => undefined)
      failures.push({ relativePath: entry.relativePath, error: error instanceof Error ? error.message : "Upload failed." })
    }
  }

  if (prepared.rootCreated && completed === 0 && failures.length > 0) {
    try {
      await deps.accountService.deleteDriveItem(prepared.root.id)
      cleanupRootDeleted = true
    } catch {
      cleanupRootDeleteFailed = true
    }
  }

  const data = {
    root: prepared.root,
    rootCreated: prepared.rootCreated,
    completed,
    failed: failures.length,
    failures,
    cleanupRootDeleted,
    cleanupRootDeleteFailed,
  }
  if (failures.length > 0) {
    return {
      ok: false,
      error: "Folder upload completed with failed files.",
      code: "DRIVE_FOLDER_UPLOAD_PARTIAL_FAILURE",
      errors: failures,
      data,
    }
  }

  return {
    ok: true,
    data,
  }
}

async function completeDriveUploadWithRetry(
  accountService: Pick<DriveAccountServicePort, "completeDriveUpload">,
  sessionId: string,
): Promise<DriveItemDto> {
  try {
    return await accountService.completeDriveUpload(sessionId)
  } catch (firstError) {
    try {
      return await accountService.completeDriveUpload(sessionId)
    } catch {
      throw firstError
    }
  }
}

async function uploadPublicAsset(
  deps: DriveCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
  action: string,
): Promise<DispatchResult> {
  const filePath = requireString(params, "filePath")
  const name = optionalString(params.name) ?? path.basename(filePath)
  await authorizeFileRead(deps, filePath, context, action)
  const result = await deps.accountService.uploadDrivePublicAssets({
    files: [{
      path: filePath,
      name,
      mimeType: await resolvePublicAssetMimeType(path.basename(filePath), optionalString(params.mimeType)),
    }],
  })
  const first = result.results[0]
  if (!first) {
    return { ok: false, error: "Public asset upload did not return a result.", data: result }
  }
  if (first.status === "rejected") {
    return { ok: false, error: first.message, data: first }
  }
  return { ok: true, data: first.asset }
}

async function replacePublicAsset(
  deps: DriveCapabilityDispatcherDeps,
  params: Record<string, unknown>,
  context: DispatchContext,
  action: string,
): Promise<DispatchResult> {
  const assetId = requireString(params, "assetId")
  const filePath = requireString(params, "filePath")
  const name = optionalString(params.name) ?? path.basename(filePath)
  await authorizeFileRead(deps, filePath, context, action)
  return {
    ok: true,
    data: await deps.accountService.replaceDrivePublicAssetFile({
      assetId,
      path: filePath,
      name,
      mimeType: await resolvePublicAssetMimeType(path.basename(filePath), optionalString(params.mimeType)),
    }),
  }
}

async function resolvePublicAssetMimeType(name: string, mimeType?: string): Promise<string | null> {
  if (mimeType) return mimeType
  const { inferDrivePublicAssetMimeType } = await import("@synapse/shared")
  return inferDrivePublicAssetMimeType(name)
}

async function putPreparedUpload(
  fetchImpl: typeof fetch,
  upload: DriveUploadPrepareResult["upload"],
  body: RequestInit["body"],
  sizeBytes: number,
): Promise<void> {
  const init: RequestInit & { duplex: "half" } = {
    method: upload.method,
    headers: withContentLengthHeader(upload.headers, sizeBytes),
    body,
    duplex: "half",
  }
  const response = await fetchImpl(upload.url, init)
  if (!response.ok) throw new Error("Drive upload failed.")
}

async function putPreparedUploadFromPath(
  fetchImpl: typeof fetch,
  fileSystem: FileSystemPort,
  upload: DriveUploadPrepareResult["upload"],
  filePath: string,
  sizeBytes: number,
): Promise<void> {
  const stream = fileSystem.createReadStream(filePath)
  try {
    await putPreparedUpload(fetchImpl, upload, stream as unknown as RequestInit["body"], sizeBytes)
  } finally {
    stream.destroy()
  }
}

async function listLocalFiles(fileSystem: FileSystemPort, rootPath: string): Promise<LocalFileEntry[]> {
  const result: LocalFileEntry[] = []

  async function walk(directoryPath: string, relativePrefix: string, depth: number): Promise<void> {
    if (depth > DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH) {
      throw createDriveLocalUploadTooDeepError()
    }

    const entries = await fileSystem.readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name)
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath, depth + 1)
      } else if (entry.isFile()) {
        if (result.length >= DRIVE_LOCAL_UPLOAD_MAX_FILES) {
          throw createDriveLocalUploadTooManyFilesError()
        }

        const fileStat = await fileSystem.stat(absolutePath)
        result.push({ absolutePath, relativePath, size: String(fileStat.size), sizeBytes: fileStat.size })
      }
    }
  }

  await walk(rootPath, "", 0)
  return result
}

async function dispatchDriveRead(
  deps: DriveCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
  operation: () => Promise<DispatchResult>,
): Promise<DispatchResult> {
  const security = driveMutationSecurity(deps, action, params, context)
  await authorizeDriveMutation(deps, security)
  try {
    const result = await operation()
    deps.auditSink?.record({
      action: "network.connect",
      actor: security.actor,
      resource: security.resource,
      outcome: driveResultAuditOutcome(result),
      metadata: {
        ...security.metadata,
        ...driveReadResultCorrelation(result),
      },
    })
    return result
  } catch (error) {
    deps.auditSink?.record({
      action: "network.connect",
      actor: security.actor,
      resource: security.resource,
      outcome: "failed",
      metadata: {
        ...security.metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}

async function dispatchDriveMutation(
  deps: DriveCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
  operation: () => Promise<DispatchResult>,
): Promise<DispatchResult> {
  const security = driveMutationSecurity(deps, action, params, context)
  await authorizeDriveMutation(deps, security)
  try {
    const result = await operation()
    deps.auditSink?.record({
      action: "network.connect",
      actor: security.actor,
      resource: security.resource,
      outcome: driveResultAuditOutcome(result),
      metadata: {
        ...security.metadata,
        ...driveResultCorrelation(result),
      },
    })
    return result
  } catch (error) {
    deps.auditSink?.record({
      action: "network.connect",
      actor: security.actor,
      resource: security.resource,
      outcome: "failed",
      metadata: {
        ...security.metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}

function driveMutationSecurity(
  deps: DriveCapabilityDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): DriveMutationSecurity {
  const correlation = driveParamCorrelation(params)
  const target = typeof correlation.itemId === "string"
    ? correlation.itemId
    : typeof correlation.assetId === "string"
      ? correlation.assetId
    : typeof correlation.shareId === "string"
      ? correlation.shareId
      : action
  return {
    actor: context.actor ?? deps.actor ?? DEFAULT_ACTOR,
    resource: `synapse-drive:${target}`,
    metadata: {
      source: context.source ?? "api",
      driveAction: action,
      ...correlation,
    },
  }
}

function driveParamCorrelation(params: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const key of ["itemId", "assetId", "versionId", "shareId", "parentId", "name", "folderName", "passwordEnabled", "isPinned", "expiresIn", "planId"]) {
    const value = params[key]
    if (typeof value === "string" || typeof value === "boolean" || value === null) {
      metadata[key] = key === "shareId" && typeof value === "string"
        ? driveShareIdForAudit(value)
        : value
    }
  }
  return metadata
}

function driveShareIdForAudit(value: string): string {
  return /^shr_[A-Za-z0-9_-]+$/.test(value) ? "public-share:[redacted]" : value
}

function driveReadResultCorrelation(result: DispatchResult): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  const total = (result as { readonly total?: unknown }).total
  if (typeof total === "number") metadata.total = total
  const data = result.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return metadata
  const record = data as Record<string, unknown>
  for (const key of ["usedBytes", "reservedBytes", "quotaBytes"]) {
    const value = record[key]
    if (typeof value === "string" || typeof value === "number") metadata[key] = value
  }
  return metadata
}

function driveResultAuditOutcome(result: DispatchResult): "allowed" | "failed" {
  if (!result.ok) return "failed"
  const data = result.data
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const failed = (data as Record<string, unknown>).failed
    if (typeof failed === "number" && failed > 0) return "failed"
  }
  return "allowed"
}

function driveResultCorrelation(result: DispatchResult): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (!result.ok) {
    if (result.error) metadata.error = result.error
  }
  const data = result.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return metadata
  const record = data as Record<string, unknown>
  if (typeof record.itemId === "string") metadata.itemId = record.itemId
  if (typeof record.assetId === "string") metadata.assetId = record.assetId
  if (typeof record.shareId === "string" && typeof record.id === "string") metadata.shareRecordId = record.id
  if (typeof record.id === "string" && !metadata.itemId && !metadata.shareRecordId) metadata.itemId = record.id
  if (typeof record.completed === "number") metadata.completed = record.completed
  if (typeof record.failed === "number") metadata.failed = record.failed
  if (typeof record.rootCreated === "boolean") metadata.rootCreated = record.rootCreated
  if (typeof record.cleanupRootDeleted === "boolean") metadata.cleanupRootDeleted = record.cleanupRootDeleted
  if (typeof record.cleanupRootDeleteFailed === "boolean") metadata.cleanupRootDeleteFailed = record.cleanupRootDeleteFailed
  if (typeof record.movedCount === "number") metadata.movedCount = record.movedCount
  if (typeof record.skippedCount === "number") metadata.skippedCount = record.skippedCount
  const moves = driveReorganizationMoveCorrelation(record.moves)
  if (moves.length > 0) metadata.moves = moves
  if (typeof record.moveDetailsTruncated === "boolean") metadata.moveDetailsTruncated = record.moveDetailsTruncated
  if (record.root && typeof record.root === "object" && !Array.isArray(record.root)) {
    const rootId = (record.root as Record<string, unknown>).id
    if (typeof rootId === "string") metadata.rootItemId = rootId
  }
  return metadata
}

function driveReorganizationMoveCorrelation(value: unknown): Array<{
  readonly itemId: string
  readonly fromParentId: string | null
  readonly targetParentId: string | null
}> {
  if (!Array.isArray(value)) return []
  const moves: Array<{ readonly itemId: string; readonly fromParentId: string | null; readonly targetParentId: string | null }> = []
  for (const move of value) {
    if (!move || typeof move !== "object" || Array.isArray(move)) continue
    const record = move as Record<string, unknown>
    if (typeof record.itemId !== "string") continue
    const fromParentId = record.fromParentId
    const targetParentId = record.targetParentId
    if (!(typeof fromParentId === "string" || fromParentId === null)) continue
    if (!(typeof targetParentId === "string" || targetParentId === null)) continue
    moves.push({ itemId: record.itemId, fromParentId, targetParentId })
  }
  return moves
}

function sanitizeDriveShareList(page: DriveShareListPageDto): DriveShareListPageDto {
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      urlWithPassword: item.url,
      password: null,
    })),
  }
}

async function authorizeDriveMutation(
  deps: DriveCapabilityDispatcherDeps,
  security: DriveMutationSecurity,
): Promise<void> {
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: "network.connect",
    actor: security.actor,
    resource: "synapse-drive",
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "network.connect",
      actor: security.actor,
      resource: "synapse-drive",
      outcome: "denied",
      metadata: { ...security.metadata, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
}

async function authorizeFileRead(
  deps: DriveCapabilityDispatcherDeps,
  filePath: string,
  context: DispatchContext,
  action = "drive.upload",
): Promise<void> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = { source: context.source ?? "api", driveAction: action }
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: "fs.read.outside-userdata",
    actor,
    resource: filePath,
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor,
      resource: filePath,
      outcome: "denied",
      metadata: { ...metadata, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
  deps.auditSink?.record({
    action: "fs.read.outside-userdata",
    actor,
    resource: filePath,
    outcome: "allowed",
    metadata,
  })
}

async function authorizeFileWrite(
  deps: DriveCapabilityDispatcherDeps,
  action: string,
  itemId: string,
  outputPath: string,
  context: DispatchContext,
): Promise<void> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    driveAction: action,
    itemId,
  }
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: "fs.write",
    actor,
    resource: outputPath,
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "fs.write",
      actor,
      resource: outputPath,
      outcome: "denied",
      metadata: { ...metadata, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
  deps.auditSink?.record({
    action: "fs.write",
    actor,
    resource: outputPath,
    outcome: "allowed",
    metadata,
  })
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return value.trim()
}

function requireAbsoluteOutputPath(params: Record<string, unknown>): string {
  const outputPath = requireString(params, "outputPath")
  if (!path.isAbsolute(outputPath)) {
    throw new Error("Missing or invalid 'outputPath': expected absolute local output path")
  }
  return outputPath
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function parseDriveTrashRestoreInput(params: Record<string, unknown>): {
  readonly itemId: string
  readonly kind?: DriveTrashItemDto["kind"]
  readonly assetId?: string
} {
  const itemId = requireString(params, "itemId")
  const kind = optionalDriveTrashItemKind(params.kind)
  const assetId = optionalString(params.assetId)
  if (kind === "public_asset" && assetId === undefined) {
    throw new Error("Missing or invalid 'assetId': expected non-empty string for public_asset trash items")
  }
  return {
    itemId,
    ...(kind === undefined ? {} : { kind }),
    ...(assetId === undefined ? {} : { assetId }),
  }
}

function optionalDriveTrashItemKind(value: unknown): DriveTrashItemDto["kind"] | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "normal" || value === "public_asset") return value
  throw new Error("Missing or invalid 'kind': expected normal or public_asset")
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "boolean") throw new Error("Expected boolean parameter.")
  return value
}

function requireBoolean(params: Record<string, unknown>, key: string): boolean {
  const value = params[key]
  if (typeof value !== "boolean") {
    throw new Error(`Missing or invalid '${key}': expected boolean`)
  }
  return value
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Expected non-negative number parameter.")
  return value
}

function optionalDrivePreviewSurface(value: unknown): "standalone" | "console" | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "standalone" || value === "console") return value
  throw new Error("Expected surface to be standalone or console.")
}

function parsePublicLinksPageInput(params: Record<string, unknown>): DrivePublicLinksPageInput | undefined {
  const offset = optionalNumber(params.offset)
  const limit = optionalNumber(params.limit)
  const search = optionalString(params.search)
  if (offset === undefined && limit === undefined && search === undefined) return undefined
  return {
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
    ...(search === undefined ? {} : { search }),
  }
}

function parseDriveVersionListInput(params: Record<string, unknown>): DriveFileVersionListInput | undefined {
  const offset = optionalNumber(params.offset)
  const limit = optionalNumber(params.limit)
  if (offset === undefined && limit === undefined) return undefined
  return {
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
  }
}

function parseDriveTreeListInput(params: Record<string, unknown>): DriveItemTreeListInput {
  return {
    parentId: optionalNullableString(params.parentId),
    offset: optionalNumber(params.offset),
    limit: optionalNumber(params.limit),
  }
}

function parseFolderPathEnsureInput(params: Record<string, unknown>): DriveFolderPathEnsureInput {
  return {
    parentId: optionalNullableString(params.parentId),
    segments: requireStringArray(params, "segments"),
  }
}

function parseReorganizationPreviewInput(params: Record<string, unknown>): DriveReorganizationPreviewInput {
  if (!Array.isArray(params.moves)) throw new Error("moves must be an array.")
  return {
    moves: params.moves.map((move, index) => {
      if (!move || typeof move !== "object" || Array.isArray(move)) {
        throw new Error(`moves[${index}] must be an object.`)
      }
      const input = move as Record<string, unknown>
      if (!Object.hasOwn(input, "targetParentId")) {
        throw new Error(`moves[${index}].targetParentId is required. Use null only when moving to Drive root.`)
      }
      return {
        itemId: requireString(input, "itemId"),
        targetParentId: optionalNullableString(input.targetParentId),
      }
    }),
  }
}

function optionalDriveAccessExpiresIn(value: unknown): DriveAccessExpiresIn | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !DRIVE_ACCESS_EXPIRES_IN_VALUES.has(value as DriveAccessExpiresIn)) {
    throw new Error("Expected expiresIn to be one of 3d, 7d, 30d, 1y, or forever.")
  }
  return value as DriveAccessExpiresIn
}

function optionalDriveShareAccessMode(value: unknown): DriveShareAccessMode | undefined {
  if (value === undefined || value === null) return undefined
  if (value === "link_read" || value === "link_edit" || value === "specified_users_edit") return value
  throw new Error("Expected accessMode to be one of link_read, link_edit, or specified_users_edit.")
}

function parseDriveAccessSettings(
  params: Record<string, unknown>,
  defaults: DriveAccessSettingsInput,
): DriveAccessSettingsInput {
  const accessMode = optionalDriveShareAccessMode(params.accessMode) ?? defaults.accessMode ?? "link_read"
  const editorEmails = accessMode === "specified_users_edit"
    ? optionalStringArray(params.editorEmails, "editorEmails") ?? []
    : []
  if (accessMode === "specified_users_edit" && editorEmails.length === 0) {
    throw new Error("editorEmails is required when accessMode is specified_users_edit.")
  }
  return {
    passwordEnabled: optionalBoolean(params.passwordEnabled) ?? defaults.passwordEnabled,
    expiresIn: optionalDriveAccessExpiresIn(params.expiresIn) ?? defaults.expiresIn,
    accessMode,
    editorEmails,
  }
}

function hasDriveAccessSettingsInput(params: Record<string, unknown>): boolean {
  return ["passwordEnabled", "expiresIn", "accessMode", "editorEmails"].some((key) => params[key] !== undefined && params[key] !== null)
}

function optionalStringArray(value: unknown, key: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error(`Missing or invalid '${key}': expected string array`)
  const normalized: string[] = []
  const seen = new Set<string>()
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`Missing or invalid '${key}[${index}]': expected non-empty string`)
    }
    const next = entry.trim().toLowerCase()
    if (seen.has(next)) return
    seen.add(next)
    normalized.push(next)
  })
  return normalized
}

function optionalNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new Error("Expected string or null.")
  return value.trim() || null
}

function requireStringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key]
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Missing or invalid '${key}': expected non-empty string array`)
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`Missing or invalid '${key}[${index}]': expected non-empty string`)
    }
    return entry.trim()
  })
}

function withContentLengthHeader(headers: Record<string, string>, sizeBytes: number): Record<string, string> {
  if (Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) return headers
  return { ...headers, "Content-Length": String(sizeBytes) }
}
