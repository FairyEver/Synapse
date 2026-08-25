import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  AgentArtifactEntry,
  AgentArtifactEntryV1,
  AgentArtifactEntryV2,
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
          artifactKind: artifact.schemaVersion === 2 ? artifact.kind : artifact.origin,
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

  async retryOrphanCleanup(existingConversationIds: ReadonlySet<string>): Promise<void> {
    const artifacts = await this.deps.artifacts.list()
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
): artifact is AgentArtifactEntryV1 | (AgentArtifactEntryV2 & { conversationId: string }) {
  return artifact.schemaVersion === 1
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
