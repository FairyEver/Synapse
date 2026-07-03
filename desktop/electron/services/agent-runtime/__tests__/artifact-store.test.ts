import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

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
        byteSize: 4,
      }))
      expect(await readFile(rows[0].storagePath)).toEqual(Buffer.from([137, 80, 78, 71]))
      await expect(stat(rows[0].storagePath)).resolves.toMatchObject({ size: 4 })
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
