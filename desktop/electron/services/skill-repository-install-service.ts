import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import { z } from "zod"

import type { SkillRepositoryInstallManifest } from "@synapse/shared" with { "resolution-mode": "import" }
import type { SynapseAccountState } from "../../src/types/account"
import type { SynapseContentDetail } from "../../src/types/content"
import type {
  SynapseSkillRepositoryInstallPrepareResult,
  SynapseSkillRepositoryInstallResolveResult,
  SynapseSkillRepositoryInstallSession,
  SynapseSkillRepositoryPreparedSource,
} from "../../src/types/skill-repository-install"
import {
  AccountAuthenticationRequiredError,
  accountService,
} from "./account-service"
import {
  assertSafeArchivePath,
  decodeUtf8,
  materializeEntries,
  parseContentLength,
  readZipEntries,
  sha256,
  type InstallPackageLimits,
  type ZipEntry,
} from "./install-package-utils"
import type { PreparedContentInstallSourceProvider } from "./editor-install-service"
import { LiveClientIdStore } from "./live-client-id-store"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.skill-repository-install")

const DEFAULT_LIMITS: InstallPackageLimits = {
  maxCompressedBytes: 64 * 1024 * 1024,
  maxEntries: 512,
  maxFileBytes: 32 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxUncompressedBytes: 128 * 1024 * 1024,
}

const installSessionSchema = z.object({
  id: z.string().min(1),
  repository: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    title: z.string(),
    owner: z.object({
      id: z.string().min(1),
      handle: z.string().min(1),
    }).strict(),
  }).strict(),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  packageSize: z.number().int().nonnegative(),
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
  repositoryId: z.string().min(1),
  repositoryName: z.string().min(1),
  ownerHandle: z.string().min(1),
  title: z.string(),
  mainFile: z.literal("content/SKILL.md"),
  files: z.array(manifestFileSchema),
}).strict()

export type SkillRepositoryInstallAccountPort = {
  readonly getState: () => SynapseAccountState
  readonly fetchAuthenticated: (
    pathOrUrl: string,
    init?: RequestInit,
    errorMessage?: string,
  ) => Promise<Response>
}

type SkillRepositoryInstallClientIdPort = {
  readonly getOrCreate: () => Promise<string>
}

type SkillRepositoryInstallServiceDeps = {
  readonly accountService?: SkillRepositoryInstallAccountPort
  readonly clientIdStore?: SkillRepositoryInstallClientIdPort
  readonly createId?: () => string
  readonly limits?: InstallPackageLimits
  readonly tempRoot?: string
}

type PreparedInstall = {
  readonly directoryPath: string
  readonly manifest: SkillRepositoryInstallManifest
  readonly sessionId: string
  readonly source: SynapseSkillRepositoryPreparedSource
}

export class SkillRepositoryInstallService implements PreparedContentInstallSourceProvider {
  private readonly account: SkillRepositoryInstallAccountPort
  private readonly clientIdStore: SkillRepositoryInstallClientIdPort
  private readonly createId: () => string
  private readonly limits: InstallPackageLimits
  private readonly tempRoot: string
  private readonly preparedById = new Map<string, PreparedInstall>()
  private readonly sourceIdBySession = new Map<string, string>()
  private readonly prepareBySession = new Map<string, Promise<SynapseSkillRepositoryInstallPrepareResult>>()
  private readonly installedSourceIds = new Set<string>()
  private readonly installingSourceIds = new Set<string>()
  private readonly releaseAfterInstallSourceIds = new Set<string>()

  constructor(deps: SkillRepositoryInstallServiceDeps = {}) {
    this.account = deps.accountService ?? accountService
    this.clientIdStore = deps.clientIdStore ?? new LiveClientIdStore()
    this.createId = deps.createId ?? randomUUID
    this.limits = deps.limits ?? DEFAULT_LIMITS
    this.tempRoot = deps.tempRoot ?? path.join(app.getPath("temp"), "synapse-skill-repository-install")
  }

  async resolveInstallSession(sessionId: string): Promise<SynapseSkillRepositoryInstallResolveResult> {
    if (this.account.getState().status !== "authenticated") {
      return { status: "unauthenticated" }
    }

    try {
      const response = await this.account.fetchAuthenticated(
        `/skill-repositories/install-sessions/${encodeURIComponent(sessionId)}`,
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

  async prepare(sessionId: string): Promise<SynapseSkillRepositoryInstallPrepareResult> {
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

  async recordComplete(sessionId: string): Promise<{ ok: true }> {
    const sourceId = this.sourceIdBySession.get(sessionId)
    if (!sourceId) throw new Error("skill repository install source is unavailable")
    if (!this.installedSourceIds.has(sourceId)) {
      throw new Error("skill repository package has not been installed")
    }
    const clientInstanceId = await this.clientIdStore.getOrCreate()
    await this.account.fetchAuthenticated(
      `/skill-repositories/install-sessions/${encodeURIComponent(sessionId)}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientInstanceId }),
      },
      "安装完成记录失败。",
    )
    await this.release(sessionId)
    return { ok: true }
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
    return prepared?.source.repositoryId === contentId
  }

  async readPreparedRule(): Promise<string> {
    throw new Error("prepared source type does not match")
  }

  async readPreparedSkill(sourceId: string, contentId: string): Promise<SynapseContentDetail<"skill">> {
    const prepared = this.requirePrepared(sourceId, contentId)
    return {
      id: prepared.source.repositoryId,
      type: "skill",
      title: prepared.source.title,
      description: "",
      category: "skill-repository",
      icon: "",
      iconBg: "",
      createdBy: "skill-repository",
      createdByDisplayName: "Skill Repository",
      createdAt: new Date(0).toISOString(),
      modifiedBy: "skill-repository",
      modifiedByDisplayName: "Skill Repository",
      modifiedAt: new Date(0).toISOString(),
      deleted: false,
      latestHistoryDirname: prepared.sessionId,
      attachmentCount: prepared.manifest.files.filter((file) => file.path !== prepared.manifest.mainFile).length,
      content: await readFile(path.join(prepared.directoryPath, prepared.manifest.mainFile), "utf8"),
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
    const attachment = prepared.manifest.files.find((file) => (
      file.path !== prepared.manifest.mainFile
      && file.path === `content/${relativePath}`
    ))
    if (!attachment) throw new Error("prepared source attachment is unavailable")
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(path.join(prepared.directoryPath, attachment.path), targetPath)
  }

  async readPreparedSkillAttachmentText(
    sourceId: string,
    contentId: string,
    relativePath: string,
  ): Promise<string | null> {
    const prepared = this.requirePrepared(sourceId, contentId)
    const attachment = prepared.manifest.files.find((file) => (
      file.path !== prepared.manifest.mainFile
      && file.path === `content/${relativePath}`
    ))
    if (!attachment || attachment.kind !== "text") return null
    return readFile(path.join(prepared.directoryPath, attachment.path), "utf8")
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

  private async prepareNew(sessionId: string): Promise<SynapseSkillRepositoryInstallPrepareResult> {
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

      const source: SynapseSkillRepositoryPreparedSource = {
        id: this.createId(),
        repositoryId: manifest.repositoryId,
        repositoryName: manifest.repositoryName,
        ownerHandle: manifest.ownerHandle,
        title: manifest.title,
        mainFile: manifest.mainFile,
        mainContent: decodeUtf8(entries.get(manifest.mainFile)?.bytes ?? Buffer.alloc(0)),
        files: manifest.files.map((file) => ({
          path: file.path,
          size: file.size,
          kind: file.kind,
        })),
      }
      this.preparedById.set(source.id, { directoryPath, manifest, sessionId, source })
      this.sourceIdBySession.set(sessionId, source.id)
      return { status: "prepared", source }
    } catch (error) {
      await rm(directoryPath, { force: true, recursive: true }).catch((cleanupError) => {
        logger.warn("Failed to clean rejected skill repository install package.", {
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
    session: SynapseSkillRepositoryInstallSession,
    packagePath: string,
  ): Promise<void> {
    const response = await this.account.fetchAuthenticated(
      `/skill-repositories/install-sessions/${encodeURIComponent(session.id)}/package`,
      { method: "GET" },
      "安装包下载失败。",
    )
    const contentLength = parseContentLength(response.headers.get("content-length"))
    if (contentLength !== undefined && contentLength > this.limits.maxCompressedBytes) {
      throw new Error("skill repository package exceeds compressed size limit")
    }
    if (!response.body) throw new Error("skill repository package response has no body")

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
          throw new Error("skill repository package exceeds compressed size limit")
        }
        hash.update(chunk)
        await file.write(chunk)
      }
    } finally {
      reader.releaseLock()
      await file.close()
    }

    if (size !== session.packageSize) throw new Error("skill repository package size does not match")
    if (hash.digest("hex").toLowerCase() !== session.packageSha256.toLowerCase()) {
      throw new Error("skill repository package SHA-256 does not match")
    }
  }

  private async release(sessionId: string): Promise<void> {
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
      logger.warn("Failed to clean skill repository install temporary directory.", {
        errorName: error instanceof Error ? error.name : typeof error,
        sessionId,
      })
    })
  }

  private requirePrepared(sourceId: string, repositoryId: string): PreparedInstall {
    const prepared = this.preparedById.get(sourceId)
    if (!prepared) throw new Error("prepared source is unavailable")
    if (prepared.source.repositoryId !== repositoryId) {
      throw new Error("prepared source repository does not match")
    }
    return prepared
  }
}

function validateManifest(
  entries: Map<string, ZipEntry>,
  session: SynapseSkillRepositoryInstallSession,
  limits: InstallPackageLimits,
): SkillRepositoryInstallManifest {
  const manifestEntry = entries.get("manifest.json")
  if (!manifestEntry) throw new Error("skill repository package manifest is missing")
  if (manifestEntry.bytes.length > limits.maxManifestBytes) {
    throw new Error("skill repository package manifest exceeds size limit")
  }

  const manifest = manifestSchema.parse(JSON.parse(decodeUtf8(manifestEntry.bytes)))
  if (
    manifest.repositoryId !== session.repository.id
    || manifest.repositoryName !== session.repository.name
  ) {
    throw new Error("skill repository package manifest does not match install session")
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

export const skillRepositoryInstallService = new SkillRepositoryInstallService()
