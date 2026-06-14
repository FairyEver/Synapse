import path from "node:path"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"

import type {
  DriveAccessExpiresIn,
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
  readonly deleteDriveItem: (
    itemId: string,
    input?: { readonly disablePublications?: boolean },
  ) => Promise<{ ok: true }>
  readonly shareDriveItem: (itemId: string, settings: DriveAccessSettingsInput) => Promise<DriveShareDto>
  readonly disableDriveShare: (shareId: string) => Promise<{ ok: true }>
  readonly getDriveUsage: () => Promise<DriveUsageDto>
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
        case "drive.item.list": {
          const parentId = optionalNullableString(params.parentId)
          const items = await deps.accountService.listDriveItems(parentId)
          return { ok: true, data: items, total: items.length }
        }
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
        case "drive.item.move":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const item = await deps.accountService.moveDriveItem(
              requireString(params, "itemId"),
              optionalNullableString(params.parentId),
            )
            return { ok: true, data: item }
          })
        case "drive.item.delete":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const disablePublications = optionalBoolean(params.disablePublications)
            return {
              ok: true,
              data: await deps.accountService.deleteDriveItem(
                requireString(params, "itemId"),
                disablePublications === undefined ? {} : { disablePublications },
              ),
            }
          })
        case "drive.share.create":
          return dispatchDriveMutation(deps, action, params, context, async () => {
            const { DRIVE_DEFAULT_ACCESS_SETTINGS } = await import("@synapse/shared")
            const settings = parseDriveAccessSettings(params, DRIVE_DEFAULT_ACCESS_SETTINGS)
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
      await putPreparedUploadFromPath(fetchImpl, fileSystem, preparedEntry.upload, entry.absolutePath, entry.sizeBytes)
      await deps.accountService.completeDriveUpload(preparedEntry.sessionId)
      completed += 1
    } catch (error) {
      await deps.accountService.cancelDriveUpload(preparedEntry.sessionId).catch(() => undefined)
      failures.push({ relativePath: entry.relativePath, error: error instanceof Error ? error.message : "Upload failed." })
    }
  }

  const data = {
    root: prepared.root,
    completed,
    failed: failures.length,
    failures,
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

  async function walk(directoryPath: string, relativePrefix: string): Promise<void> {
    const entries = await fileSystem.readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name)
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath)
      } else if (entry.isFile()) {
        const fileStat = await fileSystem.stat(absolutePath)
        result.push({ absolutePath, relativePath, size: String(fileStat.size), sizeBytes: fileStat.size })
      }
    }
  }

  await walk(rootPath, "")
  return result
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
  for (const key of ["itemId", "shareId", "parentId", "name", "folderName", "passwordEnabled", "expiresIn", "disablePublications"]) {
    const value = params[key]
    if (typeof value === "string" || typeof value === "boolean" || value === null) metadata[key] = value
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
  if (typeof record.shareId === "string") metadata.shareId = record.shareId
  if (typeof record.id === "string" && !metadata.itemId && !metadata.shareId) metadata.itemId = record.id
  if (typeof record.completed === "number") metadata.completed = record.completed
  if (typeof record.failed === "number") metadata.failed = record.failed
  if (record.root && typeof record.root === "object" && !Array.isArray(record.root)) {
    const rootId = (record.root as Record<string, unknown>).id
    if (typeof rootId === "string") metadata.rootItemId = rootId
  }
  return metadata
}

async function authorizeDriveMutation(
  deps: DriveCapabilityDispatcherDeps,
  security: DriveMutationSecurity,
): Promise<void> {
  const permission = await deps.permissionGuard?.check({
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
  deps.auditSink?.record({
    action: "fs.read.outside-userdata",
    actor,
    resource: filePath,
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "boolean") throw new Error("Expected boolean parameter.")
  return value
}

function optionalDriveAccessExpiresIn(value: unknown): DriveAccessExpiresIn | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !DRIVE_ACCESS_EXPIRES_IN_VALUES.has(value as DriveAccessExpiresIn)) {
    throw new Error("Expected expiresIn to be one of 3d, 7d, 30d, 1y, or forever.")
  }
  return value as DriveAccessExpiresIn
}

function parseDriveAccessSettings(
  params: Record<string, unknown>,
  defaults: DriveAccessSettingsInput,
): DriveAccessSettingsInput {
  return {
    passwordEnabled: optionalBoolean(params.passwordEnabled) ?? defaults.passwordEnabled,
    expiresIn: optionalDriveAccessExpiresIn(params.expiresIn) ?? defaults.expiresIn,
  }
}

function optionalNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new Error("Expected string or null.")
  return value.trim() || null
}

function withContentLengthHeader(headers: Record<string, string>, sizeBytes: number): Record<string, string> {
  if (Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) return headers
  return { ...headers, "Content-Length": String(sizeBytes) }
}
