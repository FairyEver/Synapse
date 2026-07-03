import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { AgentArtifactEntryV1, DataNamespace } from "../../runtime/data-repo"
import type { AgentArtifactImageMimeType, AgentImageArtifact, AgentToolResultImageBlock } from "./types"
import { agentArtifactUrlForRelativePath } from "./artifact-url"

interface AgentArtifactStoreDeps {
  readonly rootDirectory: string
  readonly artifacts: DataNamespace<AgentArtifactEntryV1>
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

      const id = this.deps.randomId?.() ?? randomUUID()
      const extension = extensionForMimeType(block.mimeType)
      const relativePath = path.join(
        safePathSegment(input.projectId),
        safePathSegment(input.conversationId),
        `${safePathSegment(id)}.${extension}`,
      )
      const storagePath = path.join(this.deps.rootDirectory, relativePath)
      const sha256 = createHash("sha256").update(bytes).digest("hex")

      await mkdir(path.dirname(storagePath), { recursive: true })
      await writeFile(storagePath, bytes)
      await this.deps.artifacts.upsert({
        id,
        schemaVersion: 1,
        projectId: input.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        ...(input.toolName ? { toolName: input.toolName } : {}),
        kind: "image",
        mimeType: block.mimeType,
        byteSize: bytes.length,
        sha256,
        storagePath,
        createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
      })
      artifacts.push({
        id,
        kind: "image",
        mimeType: block.mimeType,
        byteSize: bytes.length,
        url: agentArtifactUrlForRelativePath(relativePath),
        sha256,
      })
    }
    return artifacts
  }
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
