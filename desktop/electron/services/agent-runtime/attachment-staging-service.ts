import { createHash, randomUUID } from "node:crypto"
import { constants, createWriteStream } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"

import type {
  AgentAttachmentImageMimeType,
  AgentAttachmentRef,
  AgentDirectoryAttachmentRef,
  AgentFileAttachmentRef,
  AgentImageAttachmentRef,
  CommittedAttachment,
  StagedAttachment,
} from "../../../src/types/agent-attachment"
import {
  AGENT_ATTACHMENT_CONTRACT_VERSION,
  AGENT_ATTACHMENT_IMAGE_MIME_TYPES,
} from "../../../src/types/agent-attachment"
import type { DataNamespace } from "../../runtime/data-repo"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import { agentArtifactUrlForRelativePath } from "./artifact-url"
import type { AgentAttachment } from "./types"

export const MAX_AGENT_STAGED_IMAGES = 50
export const MAX_AGENT_STAGED_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_AGENT_STAGED_TURN_BYTES = 500 * 1024 * 1024
export const MAX_AGENT_STAGED_PROJECT_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_AGENT_STAGED_GLOBAL_BYTES = 5 * 1024 * 1024 * 1024
export const AGENT_STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_AGENT_ATTACHMENT_DIRECTORY_ENTRIES = 50_000
const MAX_AGENT_ATTACHMENT_DIRECTORY_DEPTH = 64

export class AgentAttachmentQuotaError extends Error {
  override readonly name = "AgentAttachmentQuotaError"
}

interface AgentAttachmentMetadataBase extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 2
  readonly projectId: string
  readonly draftScopeId: string
  readonly lifecycle: "staged" | "committed" | "orphaned"
  readonly originalName: string
  readonly byteSize: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly expiresAt: string
  readonly conversationId?: string
  readonly turnId?: string
  readonly committedAt?: string
  readonly lastError?: string
}

export interface AgentStoredAttachmentMetadataEntry extends AgentAttachmentMetadataBase {
  readonly kind: "image" | "file"
  readonly mimeType?: string
  readonly sha256: string
  readonly storagePath: string
  readonly previewStoragePath?: string
  readonly thumbnailStoragePath?: string
  readonly previewMimeType?: AgentAttachmentImageMimeType
  readonly previewSha256?: string
  readonly previewByteSize?: number
  readonly width?: number
  readonly height?: number
  readonly previewWidth?: number
  readonly previewHeight?: number
}

export interface AgentDirectoryAttachmentMetadataEntry extends AgentAttachmentMetadataBase {
  readonly kind: "directory"
  readonly sourcePath: string
}

export type AgentAttachmentMetadataEntry =
  | AgentStoredAttachmentMetadataEntry
  | AgentDirectoryAttachmentMetadataEntry

export interface AgentImageDerivativeResult {
  readonly preview: Uint8Array
  readonly thumbnail: Uint8Array
  readonly previewMimeType: AgentAttachmentImageMimeType
  readonly thumbnailMimeType: AgentAttachmentImageMimeType
  readonly width?: number
  readonly height?: number
  readonly previewWidth?: number
  readonly previewHeight?: number
}

interface AttachmentStagingServiceDeps {
  readonly rootDirectory: string
  readonly metadata: DataNamespace<AgentAttachmentMetadataEntry>
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger?: Pick<StructuredLogger, "warn">
  readonly now?: () => Date
  readonly randomId?: () => string
  readonly createImageDerivatives?: (
    bytes: Uint8Array,
    mimeType: AgentAttachmentImageMimeType,
  ) => Promise<AgentImageDerivativeResult>
}

interface StageImageInput {
  readonly kind: "image"
  readonly name: string
  readonly mimeType: AgentAttachmentImageMimeType
  readonly data: ArrayBuffer | Uint8Array
}

interface StageFileBytesInput {
  readonly kind: "file"
  readonly name: string
  readonly mimeType?: string
  readonly data: ArrayBuffer | Uint8Array
}

type StageBytesAttachmentInput = StageImageInput | StageFileBytesInput

export interface StageBytesInput {
  readonly actor: ActorIdentity
  readonly projectId: string
  readonly draftScopeId: string
  readonly attachments: readonly StageBytesAttachmentInput[]
}

export interface StagePathsInput {
  readonly actor: ActorIdentity
  readonly projectId: string
  readonly draftScopeId: string
  readonly paths: readonly string[]
}

export interface CommitInput {
  readonly actor: ActorIdentity
  readonly projectId: string
  readonly draftScopeId: string
  readonly attachmentIds: readonly string[]
  readonly conversationId: string
  readonly turnId: string
}

export interface ReleaseInput {
  readonly actor: ActorIdentity
  readonly projectId: string
  readonly draftScopeId: string
  readonly attachmentIds: readonly string[]
}

export interface RollbackCommitInput extends CommitInput {}

export interface ResolveStagedInput {
  readonly projectId: string
  readonly attachmentIds: readonly string[]
}

export interface ResolvedRuntimeAttachments {
  readonly attachments: readonly AgentAttachment[]
  readonly controlledDirectories: readonly string[]
}

export class AttachmentStagingService {
  private readonly deps: AttachmentStagingServiceDeps
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(deps: AttachmentStagingServiceDeps) {
    this.deps = deps
  }

  async stageBytes(input: StageBytesInput): Promise<readonly StagedAttachment[]> {
    return this.withMutationLock(async () => {
      if (input.attachments.length === 0) return []
      await this.assertPermission({
        action: "fs.write",
        actor: input.actor,
        resource: "agent-attachment:staging",
        context: {
          source: "agent.attachment.stageBytes",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: input.attachments.length,
        },
      })

      const prepared = input.attachments.map((attachment) => {
        const bytes = toUint8Array(attachment.data)
        if (bytes.byteLength === 0) throw new Error("附件不能为空。")
        if (attachment.kind === "image") {
          if (bytes.byteLength > MAX_AGENT_STAGED_IMAGE_BYTES) throw new Error("图片附件过大。")
          assertImageMimeMatches(bytes, attachment.mimeType)
        }
        return { attachment, bytes }
      })
      await this.assertQuotas(
        input.projectId,
        input.draftScopeId,
        prepared.filter((item) => item.attachment.kind === "image").length,
        prepared.reduce((total, item) => total + item.bytes.byteLength, 0),
      )

      const created: AgentAttachmentMetadataEntry[] = []
      try {
        for (const item of prepared) {
          created.push(await this.persistBytes({
            projectId: input.projectId,
            draftScopeId: input.draftScopeId,
            attachment: item.attachment,
            bytes: item.bytes,
          }))
        }
        this.recordAudit("fs.write", input.actor, "allowed", "agent-attachment:staging", {
          source: "agent.attachment.stageBytes",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: created.length,
          byteSize: created.reduce((total, item) => total + item.byteSize, 0),
        })
        return created.map((entry) => this.toStagedAttachment(entry))
      } catch (error) {
        await this.rollbackCreated(created)
        this.recordAudit("fs.write", input.actor, "failed", "agent-attachment:staging", {
          source: "agent.attachment.stageBytes",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: input.attachments.length,
          errorName: error instanceof Error ? error.name : typeof error,
        })
        throw error
      }
    })
  }

  async stagePaths(input: StagePathsInput): Promise<readonly StagedAttachment[]> {
    return this.withMutationLock(async () => {
      if (input.paths.length === 0) return []
      await this.assertPermission({
        action: "fs.read.outside-userdata",
        actor: input.actor,
        resource: "agent-attachment:selected-paths",
        context: {
          source: "agent.attachment.stagePaths",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: input.paths.length,
        },
      })

      const created: AgentAttachmentMetadataEntry[] = []
      try {
        for (const sourcePath of input.paths) {
          const resolvedPath = path.resolve(sourcePath)
          const sourceStat = await assertSelectedPathSafe(resolvedPath)
          if (sourceStat.isDirectory()) {
            await assertDirectoryTreeSafe(resolvedPath)
            created.push(await this.persistDirectory({
              projectId: input.projectId,
              draftScopeId: input.draftScopeId,
              sourcePath: resolvedPath,
            }))
            continue
          }
          if (!sourceStat.isFile()) throw new Error("附件路径必须是文件或文件夹。")
          const imageMimeType = imageMimeTypeForPath(resolvedPath)
          if (imageMimeType) {
            const bytes = await readSelectedFile(resolvedPath, MAX_AGENT_STAGED_IMAGE_BYTES, this.deps.logger)
            if (bytes.byteLength === 0) throw new Error("附件不能为空。")
            assertImageMimeMatches(bytes, imageMimeType)
            await this.assertQuotas(input.projectId, input.draftScopeId, 1, bytes.byteLength)
            created.push(await this.persistBytes({
              projectId: input.projectId,
              draftScopeId: input.draftScopeId,
              attachment: {
                kind: "image",
                name: path.basename(resolvedPath),
                mimeType: imageMimeType,
                data: bytes,
              },
              bytes,
            }))
            continue
          }
          await this.assertQuotas(input.projectId, input.draftScopeId, 0, Number(sourceStat.size))
          created.push(await this.persistFilePath({
            projectId: input.projectId,
            draftScopeId: input.draftScopeId,
            sourcePath: resolvedPath,
          }))
        }
        this.recordAudit("fs.read.outside-userdata", input.actor, "allowed", "agent-attachment:selected-paths", {
          source: "agent.attachment.stagePaths",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: created.length,
          byteSize: created.reduce((total, item) => total + item.byteSize, 0),
        })
        return created.map((entry) => this.toStagedAttachment(entry))
      } catch (error) {
        await this.rollbackCreated(created)
        this.recordAudit("fs.read.outside-userdata", input.actor, "failed", "agent-attachment:selected-paths", {
          source: "agent.attachment.stagePaths",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: input.paths.length,
          errorName: error instanceof Error ? error.name : typeof error,
        })
        throw error
      }
    })
  }

  async commit(input: CommitInput): Promise<readonly CommittedAttachment[]> {
    return this.withMutationLock(async () => {
      await this.assertPermission({
        action: "fs.write",
        actor: input.actor,
        resource: "agent-attachment:commit",
        context: {
          source: "agent.attachment.commit",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: input.attachmentIds.length,
        },
      })
      const entries = await this.requireOwnedStagedEntries(input)
      const committedAt = this.nowIso()
      const committedEntries: AgentAttachmentMetadataEntry[] = []
      try {
        for (const entry of entries) {
          const committed = {
            ...entry,
            lifecycle: "committed" as const,
            conversationId: input.conversationId,
            turnId: input.turnId,
            committedAt,
            updatedAt: committedAt,
          }
          await this.deps.metadata.upsert(committed)
          committedEntries.push(committed)
        }
      } catch (error) {
        for (const entry of committedEntries) {
          await this.deps.metadata.upsert(entries.find((candidate) => candidate.id === entry.id) ?? entry)
        }
        throw error
      }
      this.recordAudit("fs.write", input.actor, "allowed", "agent-attachment:commit", {
        source: "agent.attachment.commit",
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        attachmentCount: committedEntries.length,
      })
      return committedEntries.map((entry) => ({
        version: AGENT_ATTACHMENT_CONTRACT_VERSION,
        lifecycle: "committed",
        ref: this.toRef(entry),
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        committedAt,
      }))
    })
  }

  async release(input: ReleaseInput): Promise<void> {
    await this.withMutationLock(async () => {
      await this.assertPermission({
        action: "fs.write",
        actor: input.actor,
        resource: "agent-attachment:release",
        context: {
          source: "agent.attachment.release",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          attachmentCount: input.attachmentIds.length,
        },
      })
      for (const attachmentId of input.attachmentIds) {
        const entry = await this.deps.metadata.get(attachmentId)
        if (!entry || entry.projectId !== input.projectId || entry.draftScopeId !== input.draftScopeId) continue
        if (entry.lifecycle !== "staged") continue
        await this.removeEntry(entry)
      }
      this.recordAudit("fs.write", input.actor, "allowed", "agent-attachment:release", {
        source: "agent.attachment.release",
        projectId: input.projectId,
        draftScopeId: input.draftScopeId,
        attachmentCount: input.attachmentIds.length,
      })
    })
  }

  async rollbackCommit(input: RollbackCommitInput): Promise<void> {
    await this.withMutationLock(async () => {
      await this.assertPermission({
        action: "fs.write",
        actor: input.actor,
        resource: "agent-attachment:rollback",
        context: {
          source: "agent.attachment.rollback",
          projectId: input.projectId,
          draftScopeId: input.draftScopeId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          attachmentCount: input.attachmentIds.length,
        },
      })
      const rolledBackAt = this.nowIso()
      let rolledBackCount = 0
      for (const attachmentId of input.attachmentIds) {
        const entry = await this.deps.metadata.get(attachmentId)
        if (
          !entry
          || entry.lifecycle !== "committed"
          || entry.projectId !== input.projectId
          || entry.draftScopeId !== input.draftScopeId
          || entry.conversationId !== input.conversationId
          || entry.turnId !== input.turnId
        ) continue
        const {
          conversationId: _conversationId,
          turnId: _turnId,
          committedAt: _committedAt,
          lastError: _lastError,
          ...stagedEntry
        } = entry
        await this.deps.metadata.upsert({
          ...stagedEntry,
          lifecycle: "staged",
          updatedAt: rolledBackAt,
          expiresAt: new Date(Date.parse(rolledBackAt) + AGENT_STAGED_ATTACHMENT_TTL_MS).toISOString(),
        })
        rolledBackCount += 1
      }
      this.recordAudit("fs.write", input.actor, "allowed", "agent-attachment:rollback", {
        source: "agent.attachment.rollback",
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        attachmentCount: rolledBackCount,
      })
    })
  }

  async cleanupExpired(now = this.deps.now?.() ?? new Date()): Promise<number> {
    return this.withMutationLock(async () => {
      const entries = await this.deps.metadata.list()
      let removed = 0
      for (const entry of entries) {
        if (entry.lifecycle === "committed" || Date.parse(entry.expiresAt) > now.getTime()) continue
        try {
          await this.removeEntry(entry)
          removed += 1
        } catch (error) {
          await this.deps.metadata.upsert({
            ...entry,
            lifecycle: "orphaned",
            updatedAt: now.toISOString(),
            lastError: error instanceof Error ? error.name : typeof error,
          })
        }
      }
      return removed
    })
  }

  async listForTurn(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly turnId: string
  }): Promise<readonly AgentAttachmentMetadataEntry[]> {
    const entries = await this.deps.metadata.list({
      projectId: input.projectId,
      conversationId: input.conversationId,
      turnId: input.turnId,
    } as Partial<AgentAttachmentMetadataEntry>)
    return entries.filter((entry) => entry.lifecycle === "committed")
  }

  async resolveStaged(input: ResolveStagedInput): Promise<{
    readonly draftScopeId: string
    readonly refs: readonly AgentAttachmentRef[]
  }> {
    const entries = await this.requireStagedEntries(input)
    const draftScopeId = entries[0]?.draftScopeId ?? ""
    if (entries.some((entry) => entry.draftScopeId !== draftScopeId)) {
      throw new Error("附件不属于同一草稿。")
    }
    return { draftScopeId, refs: entries.map((entry) => this.toRef(entry)) }
  }

  async resolveCommittedForRuntime(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly turnId: string
    readonly attachmentIds: readonly string[]
  }): Promise<ResolvedRuntimeAttachments> {
    const attachments: AgentAttachment[] = []
    const controlledDirectories = new Set<string>()
    for (const attachmentId of input.attachmentIds) {
      const entry = await this.deps.metadata.get(attachmentId)
      if (
        !entry
        || entry.lifecycle !== "committed"
        || entry.projectId !== input.projectId
        || entry.conversationId !== input.conversationId
        || entry.turnId !== input.turnId
      ) {
        throw new Error("附件引用已失效。")
      }
      if (entry.kind === "directory") {
        const directoryStat = await assertSelectedPathSafe(entry.sourcePath)
        if (!directoryStat.isDirectory()) throw new Error("附件文件夹已失效。")
        await assertDirectoryTreeSafe(entry.sourcePath)
        attachments.push({
          kind: "path",
          path: entry.sourcePath,
          entryType: "directory",
          name: entry.originalName,
        })
        continue
      }
      if (entry.kind === "file") {
        await this.assertControlledRuntimeFile(entry)
        attachments.push({
          kind: "path",
          path: entry.storagePath,
          entryType: "file",
          name: entry.originalName,
          size: entry.byteSize,
        })
        controlledDirectories.add(this.controlledDraftDirectory(entry))
        continue
      }
      if (!isAgentImageMimeType(entry.mimeType)) throw new Error("图片附件元数据不完整。")
      await this.assertControlledRuntimeFile(entry)
      attachments.push({
        kind: "path",
        path: entry.storagePath,
        entryType: "image",
        name: entry.originalName,
        size: entry.byteSize,
      })
      controlledDirectories.add(this.controlledDraftDirectory(entry))
    }
    return {
      attachments,
      controlledDirectories: [...controlledDirectories],
    }
  }

  private async assertControlledRuntimeFile(entry: AgentStoredAttachmentMetadataEntry): Promise<void> {
    if (!this.isInsideRoot(entry.storagePath)) throw new Error("附件路径不在受控目录中。")
    const expectedDirectory = this.controlledDraftDirectory(entry)
    const relative = path.relative(expectedDirectory, entry.storagePath)
    if (!isSafeRelativePath(relative)) throw new Error("附件路径不在当前草稿目录中。")
    const fileStat = await assertSelectedPathSafe(entry.storagePath)
    if (!fileStat.isFile()) throw new Error("附件文件已失效。")
  }

  private controlledDraftDirectory(entry: AgentStoredAttachmentMetadataEntry): string {
    return path.join(
      this.deps.rootDirectory,
      "staged",
      safeSegment(entry.projectId),
      safeSegment(entry.draftScopeId),
    )
  }

  private async persistBytes(input: {
    readonly projectId: string
    readonly draftScopeId: string
    readonly attachment: StageBytesAttachmentInput
    readonly bytes: Uint8Array
  }): Promise<AgentStoredAttachmentMetadataEntry> {
    const id = this.deps.randomId?.() ?? randomUUID()
    const now = this.nowIso()
    const extension = extensionForAttachment(input.attachment.name, input.attachment.mimeType)
    const relativeDirectory = path.join("staged", safeSegment(input.projectId), safeSegment(input.draftScopeId), safeSegment(id))
    const originalRelativePath = path.join(relativeDirectory, `original.${extension}`)
    const storagePath = path.join(this.deps.rootDirectory, originalRelativePath)
    await atomicWrite(storagePath, input.bytes, this.deps.logger)

    let previewStoragePath: string | undefined
    let thumbnailStoragePath: string | undefined
    let width: number | undefined
    let height: number | undefined
    let previewWidth: number | undefined
    let previewHeight: number | undefined
    let previewMimeType: AgentAttachmentImageMimeType | undefined
    let previewSha256: string | undefined
    let previewByteSize: number | undefined
    try {
      if (input.attachment.kind === "image") {
        const derivatives = this.deps.createImageDerivatives
          ? await this.deps.createImageDerivatives(input.bytes, input.attachment.mimeType)
          : {
              preview: input.bytes,
              thumbnail: input.bytes,
              previewMimeType: input.attachment.mimeType,
              thumbnailMimeType: input.attachment.mimeType,
            }
        const previewExtension = extensionForAttachment("preview", derivatives.previewMimeType)
        const thumbnailExtension = extensionForAttachment("thumbnail", derivatives.thumbnailMimeType)
        previewStoragePath = path.join(this.deps.rootDirectory, relativeDirectory, `preview.${previewExtension}`)
        thumbnailStoragePath = path.join(this.deps.rootDirectory, relativeDirectory, `thumbnail.${thumbnailExtension}`)
        await atomicWrite(previewStoragePath, derivatives.preview, this.deps.logger)
        await atomicWrite(thumbnailStoragePath, derivatives.thumbnail, this.deps.logger)
        width = derivatives.width
        height = derivatives.height
        previewWidth = derivatives.previewWidth
        previewHeight = derivatives.previewHeight
        previewMimeType = derivatives.previewMimeType
        previewSha256 = createHash("sha256").update(derivatives.preview).digest("hex")
        previewByteSize = derivatives.preview.byteLength
      }
      const entry: AgentStoredAttachmentMetadataEntry = {
        id,
        schemaVersion: 2,
        projectId: input.projectId,
        draftScopeId: input.draftScopeId,
        lifecycle: "staged",
        kind: input.attachment.kind,
        originalName: safeDisplayName(input.attachment.name),
        ...(input.attachment.mimeType ? { mimeType: input.attachment.mimeType } : {}),
        byteSize: input.bytes.byteLength,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        storagePath,
        ...(previewStoragePath ? { previewStoragePath } : {}),
        ...(thumbnailStoragePath ? { thumbnailStoragePath } : {}),
        ...(previewMimeType ? { previewMimeType } : {}),
        ...(previewSha256 ? { previewSha256 } : {}),
        ...(previewByteSize !== undefined ? { previewByteSize } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(previewWidth !== undefined ? { previewWidth } : {}),
        ...(previewHeight !== undefined ? { previewHeight } : {}),
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.parse(now) + AGENT_STAGED_ATTACHMENT_TTL_MS).toISOString(),
      }
      await this.deps.metadata.upsert(entry)
      return entry
    } catch (error) {
      await rm(path.dirname(storagePath), { recursive: true, force: true })
      throw error
    }
  }

  private async persistFilePath(input: {
    readonly projectId: string
    readonly draftScopeId: string
    readonly sourcePath: string
  }): Promise<AgentStoredAttachmentMetadataEntry> {
    const id = this.deps.randomId?.() ?? randomUUID()
    const now = this.nowIso()
    const originalName = safeDisplayName(path.basename(input.sourcePath))
    const relativePath = path.join(
      "staged",
      safeSegment(input.projectId),
      safeSegment(input.draftScopeId),
      safeSegment(id),
      `original${path.extname(originalName)}`,
    )
    const storagePath = path.join(this.deps.rootDirectory, relativePath)
    await mkdir(path.dirname(storagePath), { recursive: true })
    const tempPath = `${storagePath}.${randomUUID()}.tmp`
    const sourceHandle = await open(
      input.sourcePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
    try {
      const sourceStat = await sourceHandle.stat()
      if (!sourceStat.isFile()) throw new Error("附件路径必须是普通文件。")
      const hash = createHash("sha256")
      let byteSize = 0
      const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.byteLength
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        sourceHandle.createReadStream({ autoClose: false }),
        hasher,
        createWriteStream(tempPath, { flags: "wx" }),
      )
      await rename(tempPath, storagePath)
      const entry: AgentStoredAttachmentMetadataEntry = {
        id,
        schemaVersion: 2,
        projectId: input.projectId,
        draftScopeId: input.draftScopeId,
        lifecycle: "staged",
        kind: "file",
        originalName,
        byteSize,
        sha256: hash.digest("hex"),
        storagePath,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.parse(now) + AGENT_STAGED_ATTACHMENT_TTL_MS).toISOString(),
      }
      await this.assertQuotas(input.projectId, input.draftScopeId, 0, entry.byteSize)
      await this.deps.metadata.upsert(entry)
      return entry
    } catch (error) {
      try {
        await unlink(tempPath)
      } catch (cleanupError) {
        warnCleanupFailure(this.deps.logger, "agent.attachment.file-copy.temp-cleanup", cleanupError)
      }
      await rm(path.dirname(storagePath), { recursive: true, force: true })
      throw error
    } finally {
      try {
        await sourceHandle.close()
      } catch (cleanupError) {
        warnCleanupFailure(this.deps.logger, "agent.attachment.file-copy.handle-close", cleanupError)
      }
    }
  }

  private async persistDirectory(input: {
    readonly projectId: string
    readonly draftScopeId: string
    readonly sourcePath: string
  }): Promise<AgentDirectoryAttachmentMetadataEntry> {
    const id = this.deps.randomId?.() ?? randomUUID()
    const now = this.nowIso()
    const entry: AgentDirectoryAttachmentMetadataEntry = {
      id,
      schemaVersion: 2,
      projectId: input.projectId,
      draftScopeId: input.draftScopeId,
      lifecycle: "staged",
      kind: "directory",
      originalName: safeDisplayName(path.basename(input.sourcePath)),
      byteSize: 0,
      sourcePath: input.sourcePath,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.parse(now) + AGENT_STAGED_ATTACHMENT_TTL_MS).toISOString(),
    }
    await this.deps.metadata.upsert(entry)
    return entry
  }

  private async requireOwnedStagedEntries(input: CommitInput): Promise<AgentAttachmentMetadataEntry[]> {
    const entries: AgentAttachmentMetadataEntry[] = []
    const seen = new Set<string>()
    for (const attachmentId of input.attachmentIds) {
      if (seen.has(attachmentId)) throw new Error("附件引用重复。")
      seen.add(attachmentId)
      const entry = await this.deps.metadata.get(attachmentId)
      if (
        !entry
        || entry.lifecycle !== "staged"
        || entry.projectId !== input.projectId
        || entry.draftScopeId !== input.draftScopeId
      ) {
        throw new Error("附件引用已失效。")
      }
      entries.push(entry)
    }
    return entries
  }

  private async requireStagedEntries(input: ResolveStagedInput): Promise<AgentAttachmentMetadataEntry[]> {
    const entries: AgentAttachmentMetadataEntry[] = []
    const seen = new Set<string>()
    for (const attachmentId of input.attachmentIds) {
      if (seen.has(attachmentId)) throw new Error("附件引用重复。")
      seen.add(attachmentId)
      const entry = await this.deps.metadata.get(attachmentId)
      if (!entry || entry.lifecycle !== "staged" || entry.projectId !== input.projectId) {
        throw new Error("附件引用已失效。")
      }
      entries.push(entry)
    }
    return entries
  }

  private async assertQuotas(
    projectId: string,
    draftScopeId: string,
    addedImageCount: number,
    addedBytes: number,
  ): Promise<void> {
    const entries = await this.deps.metadata.list()
    const active = entries.filter((entry) => entry.lifecycle !== "orphaned")
    const draftEntries = active.filter((entry) => entry.projectId === projectId && entry.draftScopeId === draftScopeId)
    const imageCount = draftEntries.filter((entry) => entry.kind === "image").length + addedImageCount
    if (imageCount > MAX_AGENT_STAGED_IMAGES) {
      throw new AgentAttachmentQuotaError(`图片附件最多 ${MAX_AGENT_STAGED_IMAGES} 张。`)
    }
    const draftBytes = sumBytes(draftEntries) + addedBytes
    if (draftBytes > MAX_AGENT_STAGED_TURN_BYTES) throw new AgentAttachmentQuotaError("本轮附件总大小过大。")
    const projectBytes = sumBytes(active.filter((entry) => entry.projectId === projectId)) + addedBytes
    if (projectBytes > MAX_AGENT_STAGED_PROJECT_BYTES) throw new AgentAttachmentQuotaError("当前项目附件空间不足。")
    if (sumBytes(active) + addedBytes > MAX_AGENT_STAGED_GLOBAL_BYTES) {
      throw new AgentAttachmentQuotaError("附件存储空间不足。")
    }
  }

  private toStagedAttachment(entry: AgentAttachmentMetadataEntry): StagedAttachment {
    return {
      version: AGENT_ATTACHMENT_CONTRACT_VERSION,
      lifecycle: "staged",
      ref: this.toRef(entry),
      draftScopeId: entry.draftScopeId,
      stagedAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    }
  }

  private toRef(entry: AgentAttachmentMetadataEntry): AgentAttachmentRef {
    if (entry.kind === "directory") {
      const ref: AgentDirectoryAttachmentRef = {
        version: AGENT_ATTACHMENT_CONTRACT_VERSION,
        attachmentId: entry.id,
        kind: "directory",
        name: entry.originalName,
        byteSize: 0,
      }
      return ref
    }
    if (entry.kind === "file") {
      const ref: AgentFileAttachmentRef = {
        version: AGENT_ATTACHMENT_CONTRACT_VERSION,
        attachmentId: entry.id,
        kind: "file",
        name: entry.originalName,
        byteSize: entry.byteSize,
        ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
        sha256: entry.sha256,
      }
      return ref
    }
    if (!isAgentImageMimeType(entry.mimeType) || !entry.previewStoragePath || !entry.thumbnailStoragePath) {
      throw new Error("图片附件元数据不完整。")
    }
    const ref: AgentImageAttachmentRef = {
      version: AGENT_ATTACHMENT_CONTRACT_VERSION,
      attachmentId: entry.id,
      kind: "image",
      name: entry.originalName,
      byteSize: entry.byteSize,
      mimeType: entry.mimeType,
      previewUrl: this.urlForStoragePath(entry.previewStoragePath),
      thumbnailUrl: this.urlForStoragePath(entry.thumbnailStoragePath),
      ...(entry.previewByteSize !== undefined ? { previewByteSize: entry.previewByteSize } : {}),
      ...(entry.width !== undefined ? { width: entry.width } : {}),
      ...(entry.height !== undefined ? { height: entry.height } : {}),
      sha256: entry.sha256,
    }
    return ref
  }

  private urlForStoragePath(storagePath: string): string {
    const relativePath = path.relative(this.deps.rootDirectory, storagePath)
    if (!isSafeRelativePath(relativePath)) throw new Error("附件路径不在受控目录中。")
    return agentArtifactUrlForRelativePath(relativePath)
  }

  private async removeEntry(entry: AgentAttachmentMetadataEntry): Promise<void> {
    if (entry.kind !== "directory") {
      for (const storagePath of [entry.storagePath, entry.previewStoragePath, entry.thumbnailStoragePath]) {
        if (!storagePath) continue
        if (!this.isInsideRoot(storagePath)) throw new Error("附件路径不在受控目录中。")
      }
      await rm(path.dirname(entry.storagePath), { recursive: true, force: true })
    }
    await this.deps.metadata.remove(entry.id)
  }

  private async rollbackCreated(entries: readonly AgentAttachmentMetadataEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.removeEntry(entry).catch(async () => {
        await this.deps.metadata.upsert({
          ...entry,
          lifecycle: "orphaned",
          updatedAt: this.nowIso(),
          lastError: "rollback_failed",
        })
      })
    }
  }

  private isInsideRoot(targetPath: string): boolean {
    const relativePath = path.relative(path.resolve(this.deps.rootDirectory), path.resolve(targetPath))
    return isSafeRelativePath(relativePath)
  }

  private async assertPermission(request: Parameters<PermissionGuard["check"]>[0]): Promise<void> {
    const permission = await this.deps.permissionGuard.check(request)
    if (permission.allowed) return
    this.recordAudit(request.action, request.actor, "denied", request.resource, {
      ...request.context,
      reason: permission.reason,
    })
    throw new Error("没有附件操作权限。")
  }

  private recordAudit(
    action: PermissionAction,
    actor: ActorIdentity,
    outcome: "allowed" | "denied" | "failed",
    resource: string,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink.record({ action, actor, resource, outcome, metadata })
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release: (() => void) | undefined
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release?.()
    }
  }
}

async function atomicWrite(
  targetPath: string,
  bytes: Uint8Array,
  logger?: Pick<StructuredLogger, "warn">,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, bytes, { flag: "wx" })
    const handle = await open(tempPath, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tempPath, targetPath)
  } catch (error) {
    try {
      await unlink(tempPath)
    } catch (cleanupError) {
      warnCleanupFailure(logger, "agent.attachment.atomic-write.temp-cleanup", cleanupError)
    }
    throw error
  }
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data)
}

function assertImageMimeMatches(bytes: Uint8Array, declaredMimeType: AgentAttachmentImageMimeType): void {
  const detected = detectImageMimeType(bytes)
  if (!detected || detected !== declaredMimeType) throw new Error("图片格式无效。")
}

function detectImageMimeType(bytes: Uint8Array): AgentAttachmentImageMimeType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return "image/gif"
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.byteLength >= 12
    && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp"
  }
  return undefined
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function extensionForAttachment(name: string, mimeType?: string): string {
  if (isAgentImageMimeType(mimeType)) {
    switch (mimeType) {
      case "image/jpeg": return "jpg"
      case "image/png": return "png"
      case "image/gif": return "gif"
      case "image/webp": return "webp"
    }
  }
  const extension = path.extname(name).replace(/^\./, "").toLowerCase()
  return /^[a-z0-9]{1,12}$/.test(extension) ? extension : "bin"
}

function isAgentImageMimeType(value: string | undefined): value is AgentAttachmentImageMimeType {
  return typeof value === "string"
    && (AGENT_ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

function imageMimeTypeForPath(filePath: string): AgentAttachmentImageMimeType | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case ".gif": return "image/gif"
    case ".jpeg":
    case ".jpg": return "image/jpeg"
    case ".png": return "image/png"
    case ".webp": return "image/webp"
    default: return undefined
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment"
}

function safeDisplayName(value: string): string {
  return path.basename(value).trim().slice(0, 255) || "attachment"
}

function isSafeRelativePath(relativePath: string): boolean {
  return relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
}

async function assertSelectedPathSafe(
  targetPath: string,
): Promise<Awaited<ReturnType<typeof lstat>>> {
  const parsed = path.parse(targetPath)
  let currentPath = parsed.root
  const segments = targetPath.slice(parsed.root.length).split(path.sep).filter(Boolean)
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment)
    const entryStat = await lstat(currentPath)
    if (entryStat.isSymbolicLink() && !isAllowedPlatformPathAlias(currentPath)) {
      throw new Error("附件路径不能包含符号链接。")
    }
  }
  return lstat(targetPath)
}

async function assertDirectoryTreeSafe(rootPath: string): Promise<void> {
  const pending: Array<{ readonly directory: string, readonly depth: number }> = [{
    directory: rootPath,
    depth: 0,
  }]
  let entryCount = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    const entries = await readdir(current.directory, { withFileTypes: true })
    for (const entry of entries) {
      entryCount += 1
      if (entryCount > MAX_AGENT_ATTACHMENT_DIRECTORY_ENTRIES) {
        throw new Error("文件夹内容过多，无法作为附件读取。")
      }
      const entryPath = path.join(current.directory, entry.name)
      const entryStat = await lstat(entryPath)
      if (entryStat.isSymbolicLink()) throw new Error("附件文件夹不能包含符号链接。")
      if (!entryStat.isDirectory()) continue
      const nextDepth = current.depth + 1
      if (nextDepth > MAX_AGENT_ATTACHMENT_DIRECTORY_DEPTH) {
        throw new Error("文件夹层级过深，无法作为附件读取。")
      }
      pending.push({ directory: entryPath, depth: nextDepth })
    }
  }
}

async function readSelectedFile(
  targetPath: string,
  maxBytes: number,
  logger?: Pick<StructuredLogger, "warn">,
): Promise<Uint8Array> {
  const handle = await open(targetPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const entryStat = await handle.stat()
    if (!entryStat.isFile()) throw new Error("附件路径必须是普通文件。")
    if (entryStat.size > maxBytes) throw new Error("图片附件过大。")
    const bytes = await handle.readFile()
    if (bytes.byteLength > maxBytes) throw new Error("图片附件过大。")
    return bytes
  } finally {
    try {
      await handle.close()
    } catch (cleanupError) {
      warnCleanupFailure(logger, "agent.attachment.selected-file.handle-close", cleanupError)
    }
  }
}

function warnCleanupFailure(
  logger: Pick<StructuredLogger, "warn"> | undefined,
  boundary: string,
  error: unknown,
): void {
  logger?.warn("Agent attachment cleanup failed.", {
    boundary,
    errorName: error instanceof Error ? error.name : typeof error,
  })
}

function isAllowedPlatformPathAlias(value: string): boolean {
  return process.platform === "darwin" && ["/var", "/tmp", "/etc"].includes(value)
}

function sumBytes(entries: readonly AgentAttachmentMetadataEntry[]): number {
  return entries.reduce((total, entry) => total + entry.byteSize, 0)
}
