import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { AgentArtifactEntryV1, DataNamespace } from "../../../runtime/data-repo"
import { AgentArtifactStore } from "../artifact-store"

describe("AgentArtifactStore", () => {
  it("writes image bytes and stores metadata without base64", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
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
      expect(await readFile(rows[0].storagePath)).toEqual(Buffer.from([137, 80, 78, 71]))
      await expect(stat(rows[0].storagePath)).resolves.toMatchObject({ size: 4 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("persists user message images with display metadata and removes them with the conversation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-user-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
      const store = new AgentArtifactStore({
        rootDirectory: root,
        artifacts: namespace,
        now: () => new Date("2026-08-25T00:00:00.000Z"),
        randomId: () => "user_image_1",
      })

      const artifacts = await store.materializeUserMessageImages({
        projectId: "project_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        images: [{
          kind: "image",
          mimeType: "image/png",
          name: "screen.png",
          size: 3,
          data: new Uint8Array([1, 2, 3]),
        }],
      })

      expect(artifacts).toEqual([expect.objectContaining({
        id: "user_image_1",
        name: "screen.png",
        byteSize: 3,
        url: "synapse-agent-artifact://local/project_1/conversation_1/user_image_1.png",
      })])
      const [stored] = await namespace.list()
      expect(stored).toEqual(expect.objectContaining({
        origin: "user-message",
        originalName: "screen.png",
        byteSize: 3,
      }))
      expect(JSON.stringify(stored)).not.toMatch(/base64|bytes|data/)

      await store.removeConversationArtifacts("conversation_1")

      expect(await namespace.list()).toEqual([])
      await expect(stat(stored.storagePath)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps metadata and warns when cleanup points outside the controlled root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-cleanup-root-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
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
        expect.objectContaining({ artifactId: "unsafe-artifact" }),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("retries cleanup for artifacts whose conversations no longer exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-orphan-artifacts-"))
    try {
      const namespace = new MemoryNamespace<AgentArtifactEntryV1>("agent.artifacts")
      let nextId = 0
      const store = new AgentArtifactStore({
        rootDirectory: root,
        artifacts: namespace,
        randomId: () => `image_${nextId += 1}`,
      })
      for (const conversationId of ["kept-conversation", "orphan-conversation"]) {
        await store.materializeUserMessageImages({
          projectId: "project_1",
          conversationId,
          turnId: `turn-${conversationId}`,
          images: [{
            kind: "image",
            mimeType: "image/png",
            data: new Uint8Array([1, 2, 3]),
          }],
        })
      }
      const orphan = (await namespace.list()).find((row) => row.conversationId === "orphan-conversation")

      await store.retryOrphanCleanup(new Set(["kept-conversation"]))

      expect(await namespace.list()).toEqual([
        expect.objectContaining({ conversationId: "kept-conversation" }),
      ])
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
