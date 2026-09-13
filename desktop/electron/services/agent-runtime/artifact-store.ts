import { createReadStream } from "node:fs"
import { AGENT_HISTORY_CHUNK_BYTES } from "../../../config"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, open, realpath, rename, rm, unlink, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"

import type {
  AgentArtifactEntry,
  AgentArtifactEntryV1,
  AgentArtifactEntryV2,
  AgentArtifactEntryV3,
  DataNamespace,
} from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type {
  AgentArtifactImageMimeType,
  AgentImageArtifact,
  AgentToolResultImageBlock,
} from "./types"
import { agentArtifactUrlForRelativePath } from "./artifact-url"

interface AgentArtifactStoreDeps {
  readonly rootDirectory: string
  readonly artifacts: DataNamespace<AgentArtifactEntry>
  readonly logger?: StructuredLogger
  readonly now?: () => Date
  readonly randomId?: () => string
}

interface MaterializeToolResultImagesInput {
  readonly projectId: string
  readonly conversationId: string
  readonly turnId: string
  readonly toolUseId?: string
  readonly toolName?: string
  readonly imageBlocks?: readonly AgentToolResultImageBlock[]
}

const MAX_STORED_TOOL_OUTPUT_BYTES = 16 * 1024 * 1024

export interface PersistedToolOutputText {
  readonly id: string
  readonly storagePath: string
  readonly originalByteSize: number
  readonly storedByteSize: number
  readonly contentTruncated: boolean
}

export class AgentArtifactStore {
  private readonly deps: AgentArtifactStoreDeps

  constructor(deps: AgentArtifactStoreDeps) {
    this.deps = deps
  }

  async materializeToolResultImages(input: MaterializeToolResultImagesInput): Promise<readonly AgentImageArtifact[]> {
    const blocks = input.imageBlocks ?? []
    if (blocks.length === 0) return []

    const artifacts: AgentImageArtifact[] = []
    for (const block of blocks) {
      const bytes = Buffer.from(block.base64, "base64")
      if (bytes.length === 0) continue

      artifacts.push(await this.persistImage({
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        origin: "tool-result",
        mimeType: block.mimeType,
        bytes,
      }))
    }
    return artifacts
  }

  toolOutputDirectory(projectId: string, conversationId: string): string {
    return path.join(
      this.deps.rootDirectory,
      safePathSegment(projectId),
      safePathSegment(conversationId),
      "tool-output",
    )
  }

  async prepareToolOutputDirectory(projectId: string, conversationId: string): Promise<string> {
    const directory = this.toolOutputDirectory(projectId, conversationId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return directory
  }

  async persistToolOutputText(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly turnId: string
    readonly toolUseId?: string
    readonly toolName?: string
    readonly content: string
  }): Promise<PersistedToolOutputText | undefined> {
    const originalByteSize = Buffer.byteLength(input.content, "utf8")
    if (originalByteSize === 0) return undefined

    if (originalByteSize > MAX_STORED_TOOL_OUTPUT_BYTES) {
      const parts: string[] = []
      for (let offset = 0; offset < input.content.length;) {
        const content = limitUtf8(input.content.slice(offset), MAX_STORED_TOOL_OUTPUT_BYTES)
        const part = await this.persistToolOutputText({ ...input, content })
        if (!part || part.contentTruncated) throw new Error("工具结果未能完整保存。")
        parts.push(JSON.stringify(part.storagePath))
        offset += content.length
      }
      return this.persistToolOutputText({
        ...input,
        content: `Full tool output (${originalByteSize} UTF-8 bytes), split into ordered files. Read narrow ranges; do not rerun the original tool.\n${parts.join("\n")}`,
      })
    }

    const id = this.deps.randomId?.() ?? randomUUID()
    const directory = this.toolOutputDirectory(input.projectId, input.conversationId)
    const storagePath = path.join(directory, `${safePathSegment(id)}.txt`)
    const temporaryPath = `${storagePath}.${process.pid}.tmp`
    const storedContent = limitUtf8(input.content, MAX_STORED_TOOL_OUTPUT_BYTES)
    const storedByteSize = Buffer.byteLength(storedContent, "utf8")
    const sha256 = createHash("sha256").update(storedContent).digest("hex")
    const createdAt = (this.deps.now?.() ?? new Date()).toISOString()

    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(temporaryPath, storedContent, { encoding: "utf8", mode: 0o600 })
      await rename(temporaryPath, storagePath)
      const entry: AgentArtifactEntryV3 = {
        id,
        schemaVersion: 3,
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        kind: "tool-output-text",
        mimeType: "text/plain",
        originalByteSize,
        storedByteSize,
        contentTruncated: storedByteSize < originalByteSize,
        sha256,
        storagePath,
        createdAt,
      }
      await this.deps.artifacts.upsert(entry)
    } catch (error) {
      for (const rollbackPath of [temporaryPath, storagePath]) {
        try {
          await unlink(rollbackPath)
        } catch (cleanupError) {
          if (cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT") {
            continue
          }
          this.deps.logger?.warn("Agent tool-output artifact rollback cleanup failed.", {
            boundary: "agent-runtime.artifact.tool-output.rollback",
            projectId: input.projectId,
            conversationId: input.conversationId,
            errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
          })
        }
      }
      throw error
    }

    return {
      id,
      storagePath,
      originalByteSize,
      storedByteSize,
      contentTruncated: storedByteSize < originalByteSize,
    }
  }

  async verifyContextCheckpoint(projectId: string, conversationId: string, artifactIds: readonly string[]): Promise<void> {
    if (!artifactIds.length) throw new Error("上下文检查点不完整。")
    const directory = await realpath(this.toolOutputDirectory(projectId, conversationId))
    for (const id of artifactIds) {
      const entry = await this.deps.artifacts.get(id)
      if (!entry || entry.kind !== "tool-output-text" || entry.projectId !== projectId
        || entry.conversationId !== conversationId || entry.contentTruncated) throw new Error("上下文检查点不完整。")
      const filePath = await realpath(entry.storagePath)
      if (path.dirname(filePath) !== directory || (await lstat(entry.storagePath)).isSymbolicLink()) throw new Error("上下文检查点路径无效。")
      const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size !== entry.storedByteSize) throw new Error("上下文检查点已变化。")
        const hash = createHash("sha256")
        let bytes = 0
        for await (const chunk of createReadStream(filePath, { fd: handle.fd, autoClose: false })) {
          bytes += chunk.length
          if (bytes > entry.storedByteSize) throw new Error("上下文检查点已变化。")
          hash.update(chunk)
        }
        if (bytes !== entry.storedByteSize || hash.digest("hex") !== entry.sha256) throw new Error("上下文检查点校验失败。")
      } finally { await handle.close() }
    }
  }

  async readToolOutputBlock(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly artifactId: string
  }): Promise<string> {
    const entry = await this.deps.artifacts.get(input.artifactId)
    if (!entry || entry.schemaVersion !== 3 || entry.kind !== "tool-output-text"
      || entry.projectId !== input.projectId || entry.conversationId !== input.conversationId
      || entry.contentTruncated || entry.storedByteSize > AGENT_HISTORY_CHUNK_BYTES) {
      throw new Error("正文块不存在、越权或超出读取预算。")
    }
    const directory = await realpath(this.toolOutputDirectory(input.projectId, input.conversationId))
    const filePath = await realpath(entry.storagePath)
    if (path.dirname(filePath) !== directory || (await lstat(entry.storagePath)).isSymbolicLink()) {
      throw new Error("正文块路径无效。")
    }
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== entry.storedByteSize) throw new Error("正文块大小校验失败。")
      const buffer = Buffer.alloc(entry.storedByteSize)
      let offset = 0
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (read.bytesRead === 0) throw new Error("正文块读取不完整。")
        offset += read.bytesRead
      }
      if (createHash("sha256").update(buffer).digest("hex") !== entry.sha256) throw new Error("正文块校验失败。")
      return buffer.toString("utf8")
    } finally {
      await handle.close()
    }
  }

  async removeConversationArtifacts(conversationId: string): Promise<void> {
    let artifacts: AgentArtifactEntry[]
    try {
      artifacts = await this.deps.artifacts.list({ conversationId } as Partial<AgentArtifactEntryV1>)
    } catch (error) {
      this.deps.logger?.warn("Agent artifact cleanup metadata read failed.", {
        boundary: "agent-runtime.artifact.cleanup",
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return
    }
    for (const artifact of artifacts) {
      try {
        await this.removeArtifact(artifact)
      } catch (error) {
        this.deps.logger?.warn("Agent artifact cleanup failed.", {
          boundary: "agent-runtime.artifact.cleanup",
          conversationId,
          artifactSchemaVersion: artifact.schemaVersion,
          artifactKind: artifact.schemaVersion === 1 ? artifact.origin : artifact.kind,
          errorName: error instanceof Error ? error.name : typeof error,
        })
      }
    }
  }

  async removeUserMessageArtifactsForTurn(conversationId: string, turnId: string): Promise<void> {
    let artifacts: AgentArtifactEntry[]
    try {
      artifacts = await this.deps.artifacts.list({ conversationId, turnId } as Partial<AgentArtifactEntryV1>)
    } catch (error) {
      this.deps.logger?.warn("Agent user attachment rollback metadata read failed.", {
        boundary: "agent-runtime.artifact.rollback",
        conversationId,
        turnId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return
    }
    for (const artifact of artifacts.filter(isLegacyUserMessageArtifact)) {
      try {
        await this.removeArtifact(artifact)
      } catch (error) {
        this.deps.logger?.warn("Agent user attachment rollback failed.", {
          boundary: "agent-runtime.artifact.rollback",
          conversationId,
          turnId,
          artifactSchemaVersion: artifact.schemaVersion,
          artifactKind: artifact.origin,
          errorName: error instanceof Error ? error.name : typeof error,
        })
      }
    }
  }

  async retryOrphanCleanup(
    projectId: string,
    existingConversationIds: ReadonlySet<string>,
  ): Promise<void> {
    const artifacts = await this.deps.artifacts.list({ projectId } as Partial<AgentArtifactEntryV1>)
    const orphanConversationIds = new Set(
      artifacts
        .filter(hasCommittedConversation)
        .map((artifact) => artifact.conversationId)
        .filter((conversationId) => !existingConversationIds.has(conversationId)),
    )
    for (const conversationId of orphanConversationIds) {
      await this.removeConversationArtifacts(conversationId)
    }
  }

  private async persistImage(input: {
    readonly projectId: string
    readonly conversationId: string
    readonly turnId: string
    readonly toolUseId?: string
    readonly toolName?: string
    readonly origin: "user-message" | "tool-result"
    readonly originalName?: string
    readonly mimeType: AgentArtifactImageMimeType
    readonly bytes: Buffer
  }): Promise<AgentImageArtifact> {
    const id = this.deps.randomId?.() ?? randomUUID()
    const extension = extensionForMimeType(input.mimeType)
    const relativePath = path.join(
      safePathSegment(input.projectId),
      safePathSegment(input.conversationId),
      `${safePathSegment(id)}.${extension}`,
    )
    const storagePath = path.join(this.deps.rootDirectory, relativePath)
    const sha256 = createHash("sha256").update(input.bytes).digest("hex")

    await mkdir(path.dirname(storagePath), { recursive: true })
    await writeFile(storagePath, input.bytes)
    try {
      await this.deps.artifacts.upsert({
        id,
        schemaVersion: 1,
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        origin: input.origin,
        ...(input.originalName ? { originalName: input.originalName } : {}),
        kind: "image",
        mimeType: input.mimeType,
        byteSize: input.bytes.length,
        sha256,
        storagePath,
        createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
      })
    } catch (error) {
      try {
        await unlink(storagePath)
      } catch (cleanupError) {
        this.deps.logger?.warn("Agent artifact rollback file cleanup failed.", {
          boundary: "agent-runtime.artifact.persist.rollback",
          projectId: input.projectId,
          conversationId: input.conversationId,
          errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
        })
      }
      throw error
    }
    return {
      id,
      kind: "image",
      ...(input.originalName ? { name: input.originalName } : {}),
      mimeType: input.mimeType,
      byteSize: input.bytes.length,
      url: agentArtifactUrlForRelativePath(relativePath),
      sha256,
    }
  }

  private async removeArtifact(artifact: AgentArtifactEntry): Promise<void> {
    if (artifact.schemaVersion === 3) {
      if (!isPathInsideRoot(this.deps.rootDirectory, artifact.storagePath)) {
        throw new Error("Agent artifact path is outside the controlled root")
      }
      try {
        await unlink(artifact.storagePath)
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      }
      await this.deps.artifacts.remove(artifact.id)
      return
    }
    if (artifact.schemaVersion === 2) {
      await this.removeV2ArtifactFiles(artifact)
      await this.deps.artifacts.remove(artifact.id)
      return
    }
    if (!isPathInsideRoot(this.deps.rootDirectory, artifact.storagePath)) {
      throw new Error("Agent artifact path is outside the controlled root")
    }
    try {
      await unlink(artifact.storagePath)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    await this.deps.artifacts.remove(artifact.id)
  }

  private async removeV2ArtifactFiles(artifact: AgentArtifactEntryV2): Promise<void> {
    if (artifact.kind === "directory") return
    if (!artifact.storagePath || !isPathInsideRoot(this.deps.rootDirectory, artifact.storagePath)) {
      throw new Error("Agent artifact path is outside the controlled root")
    }
    for (const storagePath of [artifact.previewStoragePath, artifact.thumbnailStoragePath]) {
      if (storagePath && !isPathInsideRoot(this.deps.rootDirectory, storagePath)) {
        throw new Error("Agent artifact path is outside the controlled root")
      }
    }
    await rm(path.dirname(artifact.storagePath), { recursive: true, force: true })
  }
}

function isLegacyUserMessageArtifact(artifact: AgentArtifactEntry): artifact is AgentArtifactEntryV1 {
  return artifact.schemaVersion === 1 && artifact.origin === "user-message"
}

function hasCommittedConversation(
  artifact: AgentArtifactEntry,
): artifact is AgentArtifactEntryV1 | AgentArtifactEntryV3 | (AgentArtifactEntryV2 & { conversationId: string }) {
  return artifact.schemaVersion === 1 || artifact.schemaVersion === 3
    || (artifact.lifecycle === "committed" && typeof artifact.conversationId === "string")
}

function isPathInsideRoot(rootDirectory: string, targetPath: string): boolean {
  const relativePath = path.relative(path.resolve(rootDirectory), path.resolve(targetPath))
  return relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
}

function extensionForMimeType(mimeType: AgentArtifactImageMimeType): string {
  switch (mimeType) {
    case "image/png":
      return "png"
    case "image/jpeg":
      return "jpg"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    default: {
      const exhaustive: never = mimeType
      return exhaustive
    }
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact"
}

function limitUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) low = middle
    else high = middle - 1
  }
  let bounded = value.slice(0, low)
  if (isHighSurrogate(bounded.charCodeAt(bounded.length - 1))) bounded = bounded.slice(0, -1)
  return bounded
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}
