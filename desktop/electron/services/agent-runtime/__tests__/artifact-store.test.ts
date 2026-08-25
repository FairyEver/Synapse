import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { AgentArtifactEntry, DataNamespace } from "../../../runtime/data-repo"
import { AgentArtifactStore } from "../artifact-store"

describe("AgentArtifactStore", () => {
  it("writes image bytes and stores metadata without base64", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntry>("agent.artifacts")
      const store = new AgentArtifactStore({
        rootDirectory: root,
        artifacts: namespace,
        now: () => new Date("2026-07-03T00:00:00.000Z"),
        randomId: () => "artifact_1",
      })

      const artifacts = await store.materializeToolResultImages({
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        toolUseId: "toolu_1",
        toolName: "Read",
        imageBlocks: [{
          kind: "image",
          mimeType: "image/png",
          base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
        }],
      })

      expect(artifacts).toEqual([expect.objectContaining({
        id: "artifact_1",
        kind: "image",
        mimeType: "image/png",
        byteSize: 4,
        url: "synapse-agent-artifact://local/project_1/conversation_1/artifact_1.png",
      })])
      const rows = await namespace.list()
      expect(rows).toHaveLength(1)
      expect(rows[0]).not.toHaveProperty("base64")
      expect(rows[0]).toEqual(expect.objectContaining({
        id: "artifact_1",
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        toolUseId: "toolu_1",
        toolName: "Read",
        origin: "tool-result",
        byteSize: 4,
      }))
      const storagePath = requiredStoragePath(rows[0])
      expect(await readFile(storagePath)).toEqual(Buffer.from([137, 80, 78, 71]))
      await expect(stat(storagePath)).resolves.toMatchObject({ size: 4 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("removes legacy user-message image artifacts with the conversation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-user-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntry>("agent.artifacts")
      const storagePath = path.join(root, "project_1", "conversation_1", "user_image_1.png")
      await mkdir(path.dirname(storagePath), { recursive: true })
      await writeFile(storagePath, Buffer.from([1, 2, 3]))
      await namespace.upsert({
        id: "user_image_1",
        schemaVersion: 1,
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        origin: "user-message",
        originalName: "screen.png",
        kind: "image",
        mimeType: "image/png",
        byteSize: 3,
        sha256: "a".repeat(64),
        storagePath,
        createdAt: "2026-08-25T00:00:00.000Z",
      })
      const store = new AgentArtifactStore({ rootDirectory: root, artifacts: namespace })

      await store.removeConversationArtifacts("conversation_1")

      expect(await namespace.list()).toEqual([])
      await expect(stat(storagePath)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("removes committed v2 attachment directories with the conversation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-v2-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntry>("agent.artifacts")
      const attachmentDirectory = path.join(root, "staged", "project_1", "draft_1", "attachment_1")
      const storagePath = path.join(attachmentDirectory, "original.png")
      await mkdir(attachmentDirectory, { recursive: true })
      await writeFile(storagePath, Buffer.from([137, 80, 78, 71]))
      await namespace.upsert({
        id: "attachment_1",
        schemaVersion: 2,
        projectId: "project_1",
        draftScopeId: "draft_1",
        lifecycle: "committed",
        kind: "image",
        originalName: "screen.png",
        mimeType: "image/png",
        byteSize: 4,
        sha256: "a".repeat(64),
        storagePath,
        previewStoragePath: path.join(attachmentDirectory, "preview.png"),
        thumbnailStoragePath: path.join(attachmentDirectory, "thumbnail.png"),
        conversationId: "conversation_1",
        turnId: "turn_1",
        committedAt: "2026-08-25T00:00:00.000Z",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2026-08-26T00:00:00.000Z",
      })
      const store = new AgentArtifactStore({ rootDirectory: root, artifacts: namespace })

      await store.removeConversationArtifacts("conversation_1")

      expect(await namespace.list()).toEqual([])
      await expect(stat(attachmentDirectory)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps metadata and warns when cleanup points outside the controlled root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-cleanup-root-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntry>("agent.artifacts")
      const warn = vi.fn()
      await namespace.upsert({
        id: "unsafe-artifact",
        schemaVersion: 1,
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        origin: "user-message",
        kind: "image",
        mimeType: "image/png",
        byteSize: 3,
        sha256: "a".repeat(64),
        storagePath: path.join(root, "..", "outside.png"),
        createdAt: "2026-08-25T00:00:00.000Z",
      })
      const store = new AgentArtifactStore({
        rootDirectory: root,
        artifacts: namespace,
        logger: { warn } as never,
      })

      await store.removeConversationArtifacts("conversation_1")

      expect(await namespace.list()).toHaveLength(1)
      expect(warn).toHaveBeenCalledWith(
        "Agent artifact cleanup failed.",
        expect.objectContaining({ artifactSchemaVersion: 1, artifactKind: "user-message" }),
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain("unsafe-artifact")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("retries cleanup for artifacts whose conversations no longer exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-orphan-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntry>("agent.artifacts")
      const store = new AgentArtifactStore({
        rootDirectory: root,
        artifacts: namespace,
      })
      for (const conversationId of ["kept-conversation", "orphan-conversation"]) {
        const id = `image_${conversationId}`
        const storagePath = path.join(root, "project_1", conversationId, `${id}.png`)
        await mkdir(path.dirname(storagePath), { recursive: true })
        await writeFile(storagePath, Buffer.from([1, 2, 3]))
        await namespace.upsert({
          id,
          schemaVersion: 1,
          projectId: "project_1",
          conversationId,
          turnId: `turn-${conversationId}`,
          origin: "user-message",
          kind: "image",
          mimeType: "image/png",
          byteSize: 3,
          sha256: "a".repeat(64),
          storagePath,
          createdAt: "2026-08-25T00:00:00.000Z",
        })
      }
      const otherProjectStoragePath = path.join(root, "project_2", "other-conversation", "image_other.png")
      await mkdir(path.dirname(otherProjectStoragePath), { recursive: true })
      await writeFile(otherProjectStoragePath, Buffer.from([4, 5, 6]))
      await namespace.upsert({
        id: "image_other",
        schemaVersion: 1,
        projectId: "project_2",
        conversationId: "other-conversation",
        turnId: "turn-other",
        origin: "user-message",
        kind: "image",
        mimeType: "image/png",
        byteSize: 3,
        sha256: "b".repeat(64),
        storagePath: otherProjectStoragePath,
        createdAt: "2026-08-25T00:00:00.000Z",
      })
      const orphan = (await namespace.list()).find((row) => row.conversationId === "orphan-conversation")

      await store.retryOrphanCleanup("project_1", new Set(["kept-conversation"]))

      expect(await namespace.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ conversationId: "kept-conversation" }),
        expect.objectContaining({ projectId: "project_2", conversationId: "other-conversation" }),
      ]))
      await expect(stat(otherProjectStoragePath)).resolves.toMatchObject({ size: 3 })
      await expect(stat(orphan?.storagePath ?? "")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

class MemoryNamespace<T extends { readonly id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "sqlite" as const
  private readonly rows = new Map<string, T>()

  constructor(readonly name: string) {}

  getSingleton(): Promise<T | null> {
    return Promise.resolve(null)
  }

  setSingleton(_value: T): Promise<void> {
    return Promise.resolve()
  }

  list(filter?: Partial<T>): Promise<T[]> {
    const values = Array.from(this.rows.values())
    if (!filter) return Promise.resolve(values)
    return Promise.resolve(values.filter((row) =>
      Object.entries(filter).every(([key, value]) => row[key as keyof T] === value)))
  }

  get(id: string): Promise<T | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }

  upsert(item: T): Promise<void> {
    this.rows.set(item.id, item)
    return Promise.resolve()
  }

  remove(id: string): Promise<void> {
    this.rows.delete(id)
    return Promise.resolve()
  }

  onChange(): () => void {
    return () => {}
  }
}

function requiredStoragePath(entry: AgentArtifactEntry | undefined): string {
  if (!entry || typeof entry.storagePath !== "string") {
    throw new Error("Expected artifact storage path")
  }
  return entry.storagePath
}
