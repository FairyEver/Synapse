import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { inflateRawSync } from "node:zlib"
import { app } from "electron"
import { z } from "zod"

import type { ContentStoreInstallManifest } from "@synapse/shared" with { "resolution-mode": "import" }
import type { SynapseAccountState } from "../../src/types/account"
import type {
  SynapseContentStoreInstallPrepareResult,
  SynapseContentStoreInstallResolveResult,
  SynapseContentStoreInstallSession,
  SynapseContentStorePreparedSource,
} from "../../src/types/content-store-install"
import type { SynapseContentDetail } from "../../src/types/content"
import {
  AccountAuthenticationRequiredError,
  accountService,
} from "./account-service"
import { LiveClientIdStore } from "./live-client-id-store"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.content-store-install")

const DEFAULT_LIMITS: ContentStoreInstallLimits = {
  maxCompressedBytes: 64 * 1024 * 1024,
  maxEntries: 512,
  maxFileBytes: 32 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxUncompressedBytes: 128 * 1024 * 1024,
}

const installSessionSchema = z.object({
  id: z.string().min(1),
  contentId: z.string().min(1),
  versionId: z.string().min(1),
  type: z.enum(["skill", "rule"]),
  title: z.string(),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  packageSize: z.string().regex(/^\d+$/).optional(),
  expiresAt: z.string().min(1),
}).strict()

const manifestFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  kind: z.enum(["text", "binary"]),
}).strict()

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  contentId: z.string().min(1),
  versionId: z.string().min(1),
  type: z.enum(["skill", "rule"]),
  title: z.string(),
  mainFile: z.enum(["content/SKILL.md", "content/RULE.md"]),
  files: z.array(manifestFileSchema),
}).strict()

export type ContentStoreInstallLimits = {
  readonly maxCompressedBytes: number
  readonly maxEntries: number
  readonly maxFileBytes: number
  readonly maxManifestBytes: number
  readonly maxUncompressedBytes: number
}

export type ContentStoreInstallAccountPort = {
  readonly getState: () => SynapseAccountState
  readonly fetchAuthenticated: (
    pathOrUrl: string,
    init?: RequestInit,
    errorMessage?: string,
  ) => Promise<Response>
}

type ContentStoreInstallClientIdPort = {
  readonly getOrCreate: () => Promise<string>
}

type ContentStoreInstallServiceDeps = {
  readonly accountService?: ContentStoreInstallAccountPort
  readonly clientIdStore?: ContentStoreInstallClientIdPort
  readonly createId?: () => string
  readonly limits?: ContentStoreInstallLimits
  readonly tempRoot?: string
}

type PreparedInstall = {
  readonly directoryPath: string
  readonly manifest: ContentStoreInstallManifest
  readonly sessionId: string
  readonly source: SynapseContentStorePreparedSource
}

export type ZipEntry = {
  readonly name: string
  readonly bytes: Buffer
}

export class ContentStoreInstallService {
  private readonly account: ContentStoreInstallAccountPort
  private readonly clientIdStore: ContentStoreInstallClientIdPort
  private readonly createId: () => string
  private readonly limits: ContentStoreInstallLimits
  private readonly tempRoot: string
  private readonly preparedById = new Map<string, PreparedInstall>()
  private readonly sourceIdBySession = new Map<string, string>()
  private readonly prepareBySession = new Map<string, Promise<SynapseContentStoreInstallPrepareResult>>()
  private readonly installedSourceIds = new Set<string>()
  private readonly installingSourceIds = new Set<string>()
  private readonly releaseAfterInstallSourceIds = new Set<string>()

  constructor(deps: ContentStoreInstallServiceDeps = {}) {
    this.account = deps.accountService ?? accountService
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.createId = deps.createId ?? randomUUID
    this.limits = deps.limits ?? DEFAULT_LIMITS
    this.tempRoot = deps.tempRoot ?? path.join(app.getPath("temp"), "synapse-content-store-install")
  }

  async resolveInstallSession(sessionId: string): Promise<SynapseContentStoreInstallResolveResult> {
    if (this.account.getState().status !== "authenticated") {
      return { status: "unauthenticated" }
    }

    try {
      const response = await this.account.fetchAuthenticated(
        `/content-store/install-sessions/${encodeURIComponent(sessionId)}`,
        { method: "GET" },
        "安装信息加载失败。",
      )
      const session = installSessionSchema.parse(await response.json())
      return { status: "ready", session }
    } catch (error) {
      if (error instanceof AccountAuthenticationRequiredError) {
        return { status: "unauthenticated" }
      }
      throw error
    }
  }

  async prepare(sessionId: string): Promise<SynapseContentStoreInstallPrepareResult> {
    const existingSourceId = this.sourceIdBySession.get(sessionId)
    const existing = existingSourceId ? this.preparedById.get(existingSourceId) : undefined
    if (existing) {
      return { status: "prepared", source: existing.source }
    }

    const pending = this.prepareBySession.get(sessionId)
    if (pending) return pending

    const request = this.prepareNew(sessionId).finally(() => {
      if (this.prepareBySession.get(sessionId) === request) {
        this.prepareBySession.delete(sessionId)
      }
    })
    this.prepareBySession.set(sessionId, request)
    return request
  }

  async recordInstall(sessionId: string, clientInstanceId: string): Promise<{ ok: true }> {
    await this.account.fetchAuthenticated(
      `/content-store/install-sessions/${encodeURIComponent(sessionId)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientInstanceId }),
      },
      "安装完成记录失败。",
    )
    return { ok: true }
  }

  async recordComplete(sessionId: string): Promise<{ ok: true }> {
    const sourceId = this.sourceIdBySession.get(sessionId)
    if (!sourceId) throw new Error("content store install source is unavailable")
    if (!this.installedSourceIds.has(sourceId)) {
      throw new Error("content store package has not been installed")
    }
    const clientInstanceId = await this.clientIdStore.getOrCreate()
    const result = await this.recordInstall(sessionId, clientInstanceId)
    await this.release(sessionId)
    return result
  }

  async release(sessionId: string): Promise<void> {
    const sourceId = this.sourceIdBySession.get(sessionId)
    if (!sourceId) return
    this.sourceIdBySession.delete(sessionId)
    const prepared = this.preparedById.get(sourceId)
    this.preparedById.delete(sourceId)
    this.installedSourceIds.delete(sourceId)
    this.installingSourceIds.delete(sourceId)
    this.releaseAfterInstallSourceIds.delete(sourceId)
    if (!prepared) return
    await rm(prepared.directoryPath, { force: true, recursive: true }).catch((error) => {
      logger.warn("Failed to clean content store install temporary directory.", {
        errorName: error instanceof Error ? error.name : typeof error,
        sessionId,
      })
    })
  }

  async cleanupIfIdle(sessionId: string): Promise<void> {
    const pending = this.prepareBySession.get(sessionId)
    if (pending) {
      await pending.catch(() => undefined)
    }
    const sourceId = this.sourceIdBySession.get(sessionId)
    if (!sourceId) return
    if (this.installingSourceIds.has(sourceId)) {
      this.releaseAfterInstallSourceIds.add(sourceId)
      return
    }
    await this.release(sessionId)
  }

  hasPreparedSource(sourceId: string, contentId: string): boolean {
    const prepared = this.preparedById.get(sourceId)
    return prepared?.source.contentId === contentId
  }

  async readPreparedRule(sourceId: string, contentId: string): Promise<string> {
    const prepared = this.requirePrepared(sourceId, contentId)
    if (prepared.source.type !== "rule") {
      throw new Error("prepared source type does not match")
    }
    return readFile(
      path.join(prepared.directoryPath, prepared.manifest.mainFile),
      "utf8",
    )
  }

  async copyPreparedSkill(
    sourceId: string,
    contentId: string,
    stagingDirectoryPath: string,
  ): Promise<void> {
    const prepared = this.requirePrepared(sourceId, contentId)
    if (prepared.source.type !== "skill") {
      throw new Error("prepared source type does not match")
    }

    for (const file of prepared.manifest.files) {
      const relativePath = file.path.slice("content/".length)
      const targetPath = path.join(stagingDirectoryPath, ...relativePath.split("/"))
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(path.join(prepared.directoryPath, file.path), targetPath)
    }
  }

  async readPreparedSkill(sourceId: string, contentId: string): Promise<SynapseContentDetail<"skill">> {
    const prepared = this.requirePrepared(sourceId, contentId)
    if (prepared.source.type !== "skill") {
      throw new Error("prepared source type does not match")
    }

    return {
      id: prepared.source.contentId,
      type: "skill",
      title: prepared.source.title,
      description: "",
      category: "content-store",
      icon: "",
      iconBg: "",
      createdBy: "content-store",
      createdByDisplayName: "Content Store",
      createdAt: new Date(0).toISOString(),
      modifiedBy: "content-store",
      modifiedByDisplayName: "Content Store",
      modifiedAt: new Date(0).toISOString(),
      deleted: false,
      latestHistoryDirname: prepared.source.versionId,
      attachmentCount: prepared.manifest.files.filter((file) => file.path !== prepared.manifest.mainFile).length,
      content: await this.readPreparedSkillMain(prepared),
      attachments: prepared.manifest.files
        .filter((file) => file.path !== prepared.manifest.mainFile)
        .map((file) => ({
          originalName: file.path.slice("content/".length),
          sha256: file.sha256,
          size: file.size,
        })),
    }
  }

  async copyPreparedSkillAttachment(
    sourceId: string,
    contentId: string,
    relativePath: string,
    targetPath: string,
  ): Promise<void> {
    const prepared = this.requirePrepared(sourceId, contentId)
    if (prepared.source.type !== "skill") {
      throw new Error("prepared source type does not match")
    }
    const attachment = prepared.manifest.files.find((file) => (
      file.path !== prepared.manifest.mainFile
      && file.path === `content/${relativePath}`
    ))
    if (!attachment) throw new Error("prepared source attachment is unavailable")
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(path.join(prepared.directoryPath, attachment.path), targetPath)
  }

  async markPreparedInstalled(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    this.installedSourceIds.add(sourceId)
  }

  async beginPreparedInstall(sourceId: string, contentId: string): Promise<void> {
    this.requirePrepared(sourceId, contentId)
    this.installingSourceIds.add(sourceId)
  }

  async endPreparedInstall(sourceId: string, contentId: string): Promise<void> {
    const prepared = this.requirePrepared(sourceId, contentId)
    this.installingSourceIds.delete(sourceId)
    if (this.releaseAfterInstallSourceIds.has(sourceId)) {
      await this.release(prepared.sessionId)
    }
  }

  private async prepareNew(sessionId: string): Promise<SynapseContentStoreInstallPrepareResult> {
    const resolved = await this.resolveInstallSession(sessionId)
    if (resolved.status === "unauthenticated") return resolved

    await mkdir(this.tempRoot, { recursive: true })
    const directoryPath = await mkdtemp(path.join(this.tempRoot, "package-"))

    try {
      const packagePath = path.join(directoryPath, "package.zip")
      await this.downloadInstallPackage(resolved.session, packagePath)
      const archive = await readFile(packagePath)
      const entries = readZipEntries(archive, this.limits)
      const manifest = validateManifest(entries, resolved.session, this.limits)
      await materializeEntries(entries, manifest, directoryPath)
      await rm(packagePath, { force: true })

      const source: SynapseContentStorePreparedSource = {
        id: this.createId(),
        contentId: manifest.contentId,
        versionId: manifest.versionId,
        type: manifest.type,
        title: manifest.title,
        mainFile: manifest.mainFile,
        mainContent: decodeUtf8(entries.get(manifest.mainFile)?.bytes ?? Buffer.alloc(0)),
        files: manifest.files.map((file) => ({
          path: file.path,
          size: file.size,
          kind: file.kind,
        })),
      }
      const prepared: PreparedInstall = {
        directoryPath,
        manifest,
        sessionId,
        source,
      }
      this.preparedById.set(source.id, prepared)
      this.sourceIdBySession.set(sessionId, source.id)
      return { status: "prepared", source }
    } catch (error) {
      await rm(directoryPath, { force: true, recursive: true }).catch((cleanupError) => {
        logger.warn("Failed to clean rejected content store install package.", {
          cleanupErrorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
          errorName: error instanceof Error ? error.name : typeof error,
          sessionIdLength: sessionId.length,
        })
      })
      if (error instanceof AccountAuthenticationRequiredError) {
        return { status: "unauthenticated" }
      }
      throw error
    }
  }

  private async downloadInstallPackage(
    session: SynapseContentStoreInstallSession,
    packagePath: string,
  ): Promise<void> {
    const response = await this.account.fetchAuthenticated(
      `/content-store/install-sessions/${encodeURIComponent(session.id)}/package`,
      { method: "GET" },
      "安装包下载失败。",
    )
    const contentLength = parseContentLength(response.headers.get("content-length"))
    if (contentLength !== undefined && contentLength > this.limits.maxCompressedBytes) {
      throw new Error("content store package exceeds compressed size limit")
    }
    if (!response.body) throw new Error("content store package response has no body")

    const file = await open(packagePath, "wx")
    const hash = createHash("sha256")
    const reader = response.body.getReader()
    let size = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        const chunk = Buffer.from(next.value)
        size += chunk.length
        if (size > this.limits.maxCompressedBytes) {
          throw new Error("content store package exceeds compressed size limit")
        }
        hash.update(chunk)
        await file.write(chunk)
      }
    } finally {
      reader.releaseLock()
      await file.close()
    }

    if (session.packageSize !== undefined && BigInt(size) !== BigInt(session.packageSize)) {
      throw new Error("content store package size does not match")
    }
    if (hash.digest("hex").toLowerCase() !== session.packageSha256.toLowerCase()) {
      throw new Error("content store package SHA-256 does not match")
    }
  }

  private requirePrepared(sourceId: string, contentId: string): PreparedInstall {
    const prepared = this.preparedById.get(sourceId)
    if (!prepared) throw new Error("prepared source is unavailable")
    if (prepared.source.contentId !== contentId) {
      throw new Error("prepared source content does not match")
    }
    return prepared
  }

  private readPreparedSkillMain(prepared: PreparedInstall): Promise<string> {
    return readFile(
      path.join(prepared.directoryPath, prepared.manifest.mainFile),
      "utf8",
    )
  }
}

export function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function readZipEntries(archive: Buffer, limits: ContentStoreInstallLimits): Map<string, ZipEntry> {
  const endOffset = findEndOfCentralDirectory(archive)
  const diskNumber = archive.readUInt16LE(endOffset + 4)
  const centralDisk = archive.readUInt16LE(endOffset + 6)
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8)
  const entryCount = archive.readUInt16LE(endOffset + 10)
  const centralSize = archive.readUInt32LE(endOffset + 12)
  const centralOffset = archive.readUInt32LE(endOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("multi-disk ZIP packages are not supported")
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 packages are not supported")
  }
  if (entryCount > limits.maxEntries) throw new Error("too many ZIP entries")
  if (centralOffset + centralSize > endOffset) throw new Error("invalid ZIP central directory")

  const entries = new Map<string, ZipEntry>()
  let cursor = centralOffset
  let totalCompressed = 0
  let totalUncompressed = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("invalid ZIP central directory entry")
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const crc = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const externalAttributes = archive.readUInt32LE(cursor + 38)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (entryEnd > centralOffset + centralSize) throw new Error("invalid ZIP entry metadata")

    const name = decodeUtf8(archive.subarray(cursor + 46, cursor + 46 + nameLength))
    assertSafeArchivePath(name)
    if (entries.has(name)) throw new Error("duplicate ZIP entry")
    if ((flags & 0x0001) !== 0) throw new Error("encrypted ZIP entries are not supported")
    if (method !== 0 && method !== 8) throw new Error("unsupported ZIP compression method")
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      throw new Error("ZIP symbolic links are not supported")
    }
    if (compressedSize > limits.maxCompressedBytes || uncompressedSize > limits.maxFileBytes) {
      throw new Error("ZIP entry exceeds size limit")
    }
    totalCompressed += compressedSize
    totalUncompressed += uncompressedSize
    if (totalCompressed > limits.maxCompressedBytes) throw new Error("ZIP compressed data exceeds size limit")
    if (totalUncompressed > limits.maxUncompressedBytes) throw new Error("ZIP content exceeds size limit")

    const bytes = readZipEntryData(
      archive,
      localOffset,
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      limits.maxFileBytes,
    )
    if (crc32(bytes) !== crc) throw new Error("ZIP entry CRC does not match")
    entries.set(name, { name, bytes })
    cursor = entryEnd
  }

  if (cursor !== centralOffset + centralSize) throw new Error("invalid ZIP central directory size")
  return entries
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error("ZIP end of central directory not found")
}

function readZipEntryData(
  archive: Buffer,
  localOffset: number,
  expectedName: string,
  centralFlags: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  maxFileBytes: number,
): Buffer {
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("invalid ZIP local entry")
  }
  const localFlags = archive.readUInt16LE(localOffset + 6)
  const localMethod = archive.readUInt16LE(localOffset + 8)
  const nameLength = archive.readUInt16LE(localOffset + 26)
  const extraLength = archive.readUInt16LE(localOffset + 28)
  const nameStart = localOffset + 30
  const dataStart = nameStart + nameLength + extraLength
  const dataEnd = dataStart + compressedSize
  if (dataEnd > archive.length) throw new Error("truncated ZIP entry data")
  const localName = decodeUtf8(archive.subarray(nameStart, nameStart + nameLength))
  if (localName !== expectedName || localFlags !== centralFlags || localMethod !== method) {
    throw new Error("ZIP local entry does not match central directory")
  }

  const compressed = archive.subarray(dataStart, dataEnd)
  const maxOutputLength = Math.min(uncompressedSize, maxFileBytes)
  const bytes = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength })
  if (bytes.length !== uncompressedSize) throw new Error("ZIP entry size does not match")
  return bytes
}

function validateManifest(
  entries: Map<string, ZipEntry>,
  session: SynapseContentStoreInstallSession,
  limits: ContentStoreInstallLimits,
): ContentStoreInstallManifest {
  const manifestEntry = entries.get("manifest.json")
  if (!manifestEntry) throw new Error("content store package manifest is missing")
  if (manifestEntry.bytes.length > limits.maxManifestBytes) {
    throw new Error("content store package manifest exceeds size limit")
  }

  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(decodeUtf8(manifestEntry.bytes))
  } catch (error) {
    throw new Error("content store package manifest is invalid", { cause: error })
  }
  const manifest = manifestSchema.parse(rawManifest)
  if (
    manifest.contentId !== session.contentId
    || manifest.versionId !== session.versionId
    || manifest.type !== session.type
  ) {
    throw new Error("content store package manifest does not match install session")
  }
  const expectedMainFile = manifest.type === "skill" ? "content/SKILL.md" : "content/RULE.md"
  if (manifest.mainFile !== expectedMainFile) {
    throw new Error("content store package mainFile does not match content type")
  }
  if (manifest.files.length > limits.maxEntries - 1) throw new Error("too many manifest files")

  const declaredPaths = new Set<string>()
  for (const file of manifest.files) {
    assertSafeArchivePath(file.path)
    if (!file.path.startsWith("content/")) throw new Error("manifest file is outside content directory")
    if (declaredPaths.has(file.path)) throw new Error("duplicate manifest file")
    declaredPaths.add(file.path)
    const entry = entries.get(file.path)
    if (!entry) throw new Error("manifest file is missing from ZIP")
    if (entry.bytes.length !== file.size) throw new Error("manifest file size does not match")
    if (sha256(entry.bytes) !== file.sha256.toLowerCase()) {
      throw new Error("manifest file SHA-256 does not match")
    }
    if (file.kind === "text") decodeUtf8(entry.bytes)
  }
  if (!declaredPaths.has(manifest.mainFile)) throw new Error("manifest mainFile is not declared")

  for (const entryName of entries.keys()) {
    if (entryName !== "manifest.json" && !declaredPaths.has(entryName)) {
      throw new Error("undeclared ZIP payload")
    }
  }
  return manifest
}

export async function materializeEntries(
  entries: Map<string, ZipEntry>,
  manifest: { readonly files: readonly { readonly path: string }[] },
  directoryPath: string,
): Promise<void> {
  for (const file of manifest.files) {
    const entry = entries.get(file.path)
    if (!entry) throw new Error("manifest file is missing from ZIP")
    const targetPath = path.join(directoryPath, ...file.path.split("/"))
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, entry.bytes, { flag: "wx" })
  }
}

export function assertSafeArchivePath(value: string): void {
  const segments = value.split("/")
  if (
    value.length === 0
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    || segments.some(isWindowsHostileArchivePathSegment)
  ) {
    throw new Error("unsafe ZIP entry path")
  }
}

const windowsReservedArchivePathNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const windowsHostileArchivePathSegmentChars = /[<>:"|?*\u0000-\u001f]/u

function isWindowsHostileArchivePathSegment(segment: string): boolean {
  return windowsHostileArchivePathSegmentChars.test(segment)
    || windowsReservedArchivePathNames.test(segment)
    || segment.endsWith(".")
    || segment.endsWith(" ")
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export const contentStoreInstallService = new ContentStoreInstallService()
