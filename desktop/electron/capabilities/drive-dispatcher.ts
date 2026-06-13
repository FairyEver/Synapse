import path from "node:path"
import { readdir, readFile, stat } from "node:fs/promises"

import type {
  DriveAccessSettingsInput,
  DriveFolderUploadPrepareResult,
  DriveItemDto,
  DriveShareDto,
  DriveUploadPrepareResult,
  DriveUsageDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"

type DriveAccountServicePort = {
  readonly listDriveItems: (parentId: string | null) => Promise<DriveItemDto[]>
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
  readonly moveDriveItem: (itemId: string, parentId: string | null) => Promise<DriveItemDto>
  readonly deleteDriveItem: (itemId: string) => Promise<{ ok: true }>
  readonly shareDriveItem: (itemId: string, settings: DriveAccessSettingsInput) => Promise<DriveShareDto>
  readonly disableDriveShare: (shareId: string) => Promise<{ ok: true }>
  readonly getDriveUsage: () => Promise<DriveUsageDto>
}

type FileSystemPort = {
  readonly readFile: typeof readFile
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
}

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }
const defaultFileSystem: FileSystemPort = { readFile, readdir, stat }

export function createDriveCapabilityDispatcher(deps: DriveCapabilityDispatcherDeps) {
  const fileSystem = deps.fileSystem ?? defaultFileSystem
  const fetchImpl = deps.fetch ?? fetch

  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      switch (action) {
        case "drive.item.list": {
          const parentId = optionalNullableString(params.parentId)
          const items = await deps.accountService.listDriveItems(parentId)
          return { ok: true, data: items, total: items.length }
        }
        case "drive.file.upload":
          return uploadFile(deps, fileSystem, fetchImpl, params, context)
        case "drive.folder.upload":
          return uploadFolder(deps, fileSystem, fetchImpl, params, context)
        case "drive.folder.create": {
          await authorizeDriveMutation(deps, action, context)
          const item = await deps.accountService.createDriveFolder({
            parentId: optionalNullableString(params.parentId),
            name: requireString(params, "name"),
          })
          return { ok: true, data: item }
        }
        case "drive.item.move": {
          await authorizeDriveMutation(deps, action, context)
          const item = await deps.accountService.moveDriveItem(
            requireString(params, "itemId"),
            optionalNullableString(params.parentId),
          )
          return { ok: true, data: item }
        }
        case "drive.item.delete": {
          await authorizeDriveMutation(deps, action, context)
          return { ok: true, data: await deps.accountService.deleteDriveItem(requireString(params, "itemId")) }
        }
        case "drive.share.create": {
          await authorizeDriveMutation(deps, action, context)
          const { DRIVE_DEFAULT_ACCESS_SETTINGS } = await import("@synapse/shared")
          return {
            ok: true,
            data: await deps.accountService.shareDriveItem(
              requireString(params, "itemId"),
              DRIVE_DEFAULT_ACCESS_SETTINGS,
            ),
          }
        }
        case "drive.share.disable": {
          await authorizeDriveMutation(deps, action, context)
          return { ok: true, data: await deps.accountService.disableDriveShare(requireString(params, "shareId")) }
        }
        case "drive.usage.get":
          return { ok: true, data: await deps.accountService.getDriveUsage() }
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
  await authorizeDriveMutation(deps, "drive.file.upload", context)
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
    await putPreparedUpload(fetchImpl, prepared.upload, await fileSystem.readFile(filePath))
    const item = await deps.accountService.completeDriveUpload(prepared.sessionId)
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
  await authorizeDriveMutation(deps, "drive.folder.upload", context)
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

  for (const entry of entries) {
    const preparedEntry = preparedByPath.get(entry.relativePath)
    if (!preparedEntry) {
      failures.push({ relativePath: entry.relativePath, error: "Missing upload session." })
      continue
    }
    try {
      await putPreparedUpload(fetchImpl, preparedEntry.upload, await fileSystem.readFile(entry.absolutePath))
      await deps.accountService.completeDriveUpload(preparedEntry.sessionId)
      completed += 1
    } catch (error) {
      await deps.accountService.cancelDriveUpload(preparedEntry.sessionId).catch(() => undefined)
      failures.push({ relativePath: entry.relativePath, error: error instanceof Error ? error.message : "Upload failed." })
    }
  }

  return {
    ok: true,
    data: {
      root: prepared.root,
      completed,
      failed: failures.length,
      failures,
    },
  }
}

async function putPreparedUpload(
  fetchImpl: typeof fetch,
  upload: DriveUploadPrepareResult["upload"],
  body: Buffer,
): Promise<void> {
  const bodyBytes = new Uint8Array(body.byteLength)
  bodyBytes.set(body)
  const response = await fetchImpl(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: bodyBytes.buffer,
  })
  if (!response.ok) throw new Error("Drive upload failed.")
}

async function listLocalFiles(fileSystem: FileSystemPort, rootPath: string): Promise<LocalFileEntry[]> {
  const result: LocalFileEntry[] = []

  async function walk(directoryPath: string, relativePrefix: string): Promise<void> {
    const entries = await fileSystem.readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name)
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
      } else if (entry.isFile()) {
        const fileStat = await fileSystem.stat(absolutePath)
        result.push({ absolutePath, relativePath, size: String(fileStat.size) })
      }
    }
  }

  await walk(rootPath, "")
  return result
}

async function authorizeDriveMutation(
  deps: DriveCapabilityDispatcherDeps,
  action: string,
  context: DispatchContext,
): Promise<void> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = { source: context.source ?? "api", driveAction: action }
  const permission = await deps.permissionGuard?.check({
    action: "network.connect",
    actor,
    resource: "synapse-drive",
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "network.connect",
      actor,
      resource: "synapse-drive",
      outcome: "denied",
      metadata: { ...metadata, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
}

async function authorizeFileRead(
  deps: DriveCapabilityDispatcherDeps,
  filePath: string,
  context: DispatchContext,
): Promise<void> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = { source: context.source ?? "api", driveAction: "drive.upload" }
  const permission = await deps.permissionGuard?.check({
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
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new Error("Expected string or null.")
  return value.trim() || null
}
