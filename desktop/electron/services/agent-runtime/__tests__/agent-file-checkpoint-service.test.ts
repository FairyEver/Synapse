import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { AgentFileCheckpointEntryV1, DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import { createPermissionGuard, InMemoryAuditSink } from "../../../runtime/security"
import { AgentFileCheckpointService } from "../agent-file-checkpoint-service"

describe("AgentFileCheckpointService", () => {
  it("rejects confirmation without writing when a file changed after prepare", async () => {
    const fixture = await createFixture()
    try {
      const rewind = vi.fn(async (_id: string, dryRun: boolean) => ({
        canRewind: true,
        filesChanged: [fixture.filePath],
        insertions: 1,
        deletions: 1,
        ...(dryRun ? {} : { skippedLinks: 0 }),
      }))
      const prepared = await fixture.service.prepareRewind({
        conversationId: "conversation-1",
        checkpointId: fixture.checkpointId,
        actor: { kind: "user", id: "renderer" },
        busy: false,
        rewind,
      })
      await writeFile(fixture.filePath, "concurrent\n")

      await expect(fixture.service.confirmRewind({
        conversationId: "conversation-1",
        operationId: prepared.operationId,
        busy: false,
        rewind,
      })).rejects.toThrow("文件已在检查点后发生变化")
      expect(rewind).toHaveBeenCalledTimes(1)
      await expect(readFile(fixture.filePath, "utf8")).resolves.toBe("concurrent\n")
    } finally {
      await fixture.cleanup()
    }
  })

  it("rejects a same-content file replacement and a mode change after prepare", async () => {
    for (const mutation of ["replace", "chmod"] as const) {
      const fixture = await createFixture()
      try {
        const rewind = vi.fn(async () => ({
          canRewind: true,
          filesChanged: [fixture.filePath],
          insertions: 1,
          deletions: 1,
        }))
        const prepared = await fixture.service.prepareRewind({
          conversationId: "conversation-1",
          checkpointId: fixture.checkpointId,
          actor: { kind: "user", id: "renderer" },
          busy: false,
          rewind,
        })
        if (mutation === "replace") {
          const replacementPath = path.join(fixture.root, "replacement.md")
          await writeFile(replacementPath, "after\n")
          await rename(replacementPath, fixture.filePath)
        } else {
          await chmod(fixture.filePath, 0o600)
        }

        await expect(fixture.service.confirmRewind({
          conversationId: "conversation-1",
          operationId: prepared.operationId,
          busy: false,
          rewind,
        })).rejects.toThrow("文件已在检查点后发生变化")
        expect(rewind).toHaveBeenCalledTimes(1)
      } finally {
        await fixture.cleanup()
      }
    }
  })

  it("binds a prepared operation to its conversation", async () => {
    const fixture = await createFixture()
    try {
      const rewind = vi.fn(async () => ({
        canRewind: true,
        filesChanged: [fixture.filePath],
      }))
      const prepared = await fixture.service.prepareRewind({
        conversationId: "conversation-1",
        checkpointId: fixture.checkpointId,
        actor: { kind: "user", id: "renderer" },
        busy: false,
        rewind,
      })

      await expect(fixture.service.confirmRewind({
        conversationId: "conversation-2",
        operationId: prepared.operationId,
        busy: false,
        rewind,
      })).rejects.toThrow("不属于当前会话")
      expect(rewind).toHaveBeenCalledTimes(1)
    } finally {
      await fixture.cleanup()
    }
  })

  it("marks the checkpoint partial when the real rewind throws after writing", async () => {
    const fixture = await createFixture()
    try {
      const rewind = vi.fn(async (_id: string, dryRun: boolean) => {
        if (!dryRun) {
          await writeFile(fixture.filePath, "before\n")
          throw new Error("injected rewind failure")
        }
        return {
          canRewind: true,
          filesChanged: [fixture.filePath],
        }
      })
      const prepared = await fixture.service.prepareRewind({
        conversationId: "conversation-1",
        checkpointId: fixture.checkpointId,
        actor: { kind: "user", id: "renderer" },
        busy: false,
        rewind,
      })

      await expect(fixture.service.confirmRewind({
        conversationId: "conversation-1",
        operationId: prepared.operationId,
        busy: false,
        rewind,
      })).rejects.toMatchObject({
        name: "AgentFileCheckpointPartialError",
        event: expect.objectContaining({ status: "partial" }),
      })
      await expect(fixture.namespace.get(fixture.checkpointId)).resolves.toMatchObject({ status: "partial" })
      expect(fixture.auditSink.list()).toContainEqual(expect.objectContaining({
        action: "fs.write",
        outcome: "allowed",
        metadata: expect.objectContaining({ phase: "rewind-result", status: "partial" }),
      }))
    } finally {
      await fixture.cleanup()
    }
  })

  it("rewinds the latest checkpoint and verifies the restored fingerprints", async () => {
    const fixture = await createFixture()
    try {
      const rewind = vi.fn(async (_id: string, dryRun: boolean) => {
        if (!dryRun) await writeFile(fixture.filePath, "before\n")
        return {
          canRewind: true,
          filesChanged: [fixture.filePath],
          insertions: 1,
          deletions: 1,
          ...(dryRun ? {} : { skippedLinks: 0 }),
        }
      })
      const prepared = await fixture.service.prepareRewind({
        conversationId: "conversation-1",
        checkpointId: fixture.checkpointId,
        actor: { kind: "user", id: "renderer" },
        busy: false,
        rewind,
      })
      const result = await fixture.service.confirmRewind({
        conversationId: "conversation-1",
        operationId: prepared.operationId,
        busy: false,
        rewind,
      })

      expect(result.status).toBe("rewound")
      await expect(readFile(fixture.filePath, "utf8")).resolves.toBe("before\n")
      expect(fixture.auditSink.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "fs.write", outcome: "allowed" }),
        expect.objectContaining({ action: "fs.write", outcome: "allowed" }),
        expect.objectContaining({ action: "fs.write", outcome: "allowed" }),
      ]))
      await expect(fixture.namespace.get(fixture.checkpointId)).resolves.toMatchObject({ status: "rewound" })
    } finally {
      await fixture.cleanup()
    }
  })

  it("allows a cancelled confirmation to be prepared again and invalidates the old operation", async () => {
    const fixture = await createFixture()
    try {
      const rewind = vi.fn(async (_id: string, dryRun: boolean) => {
        if (!dryRun) await writeFile(fixture.filePath, "before\n")
        return {
          canRewind: true,
          filesChanged: [fixture.filePath],
          insertions: 1,
          deletions: 1,
          ...(dryRun ? {} : { skippedLinks: 0 }),
        }
      })
      const prepare = () => fixture.service.prepareRewind({
        conversationId: "conversation-1",
        checkpointId: fixture.checkpointId,
        actor: { kind: "user", id: "renderer" } as const,
        busy: false,
        rewind,
      })

      const first = await prepare()
      const second = await prepare()

      expect(second.operationId).not.toBe(first.operationId)
      await expect(fixture.service.confirmRewind({
        conversationId: "conversation-1",
        operationId: first.operationId,
        busy: false,
        rewind,
      })).rejects.toThrow("撤销确认已过期")
      await expect(fixture.service.confirmRewind({
        conversationId: "conversation-1",
        operationId: second.operationId,
        busy: false,
        rewind,
      })).resolves.toMatchObject({ status: "rewound" })
    } finally {
      await fixture.cleanup()
    }
  })

  it("marks a checkpoint unavailable when the SDK file history is gone", async () => {
    const fixture = await createFixture()
    try {
      await expect(fixture.service.prepareRewind({
        conversationId: "conversation-1",
        checkpointId: fixture.checkpointId,
        actor: { kind: "user", id: "renderer" },
        busy: false,
        rewind: async () => ({ canRewind: false, error: "history expired" }),
      })).rejects.toMatchObject({
        name: "AgentFileCheckpointUnavailableError",
        message: "history expired",
        event: expect.objectContaining({ type: "fileCheckpoint", status: "unavailable" }),
      })
      await expect(fixture.namespace.get(fixture.checkpointId)).resolves.toMatchObject({ status: "unavailable" })
    } finally {
      await fixture.cleanup()
    }
  })

  it("clears only superseded patch payloads when the storage quota is exceeded", async () => {
    const fixture = await createFixture({ maxStoredPatchBytes: 1 })
    try {
      const events = await fixture.service.persistCapture("conversation-1", {
        turnId: "turn-2",
        sdkSessionId: "sdk-session-1",
        sdkUserMessageId: "user-message-2",
        status: "available",
        insertions: 1,
        deletions: 1,
        fileCount: 1,
        coverageWarning: false,
        files: [{
          displayPath: "notes.md",
          absolutePath: fixture.filePath,
          kind: "modified",
          insertions: 1,
          deletions: 1,
          beforeExists: true,
          afterExists: true,
          beforeFingerprint: await fingerprintForContent(fixture.filePath, "before\n"),
          afterFingerprint: await fingerprintForContent(fixture.filePath, "after\n"),
          binary: false,
          truncated: false,
          patch: "--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-before\n+after\n",
        }],
      })
      const nextEvent = events.find((event) => (
        event.type === "fileCheckpoint" && event.turnId === "turn-2" && event.status === "available"
      ))
      if (nextEvent?.type !== "fileCheckpoint") throw new Error("expected checkpoint event")

      const oldEntry = await fixture.namespace.get(fixture.checkpointId)
      const newEntry = await fixture.namespace.get(nextEvent.checkpointId)
      expect(oldEntry).toMatchObject({
        status: "superseded",
        files: [expect.objectContaining({ truncated: true, diffCleared: true })],
      })
      expect(oldEntry?.files[0]?.patch).toBeUndefined()
      expect(newEntry).toMatchObject({
        status: "available",
        files: [expect.objectContaining({ patch: expect.any(String) })],
      })
      expect(newEntry?.files[0]?.diffCleared).toBeUndefined()
    } finally {
      await fixture.cleanup()
    }
  })
})

async function createFixture(options: { readonly maxStoredPatchBytes?: number } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-checkpoint-service-"))
  const filePath = path.join(root, "notes.md")
  await writeFile(filePath, "after\n")
  const namespace = new MemoryNamespace<AgentFileCheckpointEntryV1>("agent.file-checkpoints")
  const auditSink = new InMemoryAuditSink()
  const service = new AgentFileCheckpointService({
    projectId: "project-1",
    workspacePath: root,
    checkpoints: namespace,
    permissionGuard: createPermissionGuard(),
    auditSink,
    maxStoredPatchBytes: options.maxStoredPatchBytes,
  })
  const [event] = await service.persistCapture("conversation-1", {
    turnId: "turn-1",
    sdkSessionId: "sdk-session-1",
    sdkUserMessageId: "user-message-1",
    status: "available",
    insertions: 1,
    deletions: 1,
    fileCount: 1,
    coverageWarning: false,
    files: [{
      displayPath: "notes.md",
      absolutePath: filePath,
      kind: "modified",
      insertions: 1,
      deletions: 1,
      beforeExists: true,
      afterExists: true,
      beforeFingerprint: await fingerprintForContent(filePath, "before\n"),
      afterFingerprint: await fingerprintForContent(filePath, "after\n"),
      binary: false,
      truncated: false,
      patch: "--- a/notes.md\n+++ b/notes.md\n@@ -1 +1 @@\n-before\n+after\n",
    }],
  })
  if (event?.type !== "fileCheckpoint") throw new Error("expected checkpoint event")
  return {
    root,
    filePath,
    service,
    namespace,
    auditSink,
    checkpointId: event.checkpointId,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

async function fingerprintForContent(filePath: string, content: string) {
  const stats = await stat(filePath)
  return {
    kind: "regular" as const,
    sha256: sha256(content),
    byteSize: Buffer.byteLength(content),
    mode: stats.mode,
    device: stats.dev,
    inode: stats.ino,
    parentRealPath: await realpath(path.dirname(filePath)),
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "sqlite" as const
  private readonly values = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return this.values.values().next().value ?? null
  }

  async setSingleton(value: T): Promise<void> {
    this.values.set(value.id, value)
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    return [...this.values.values()].filter((value) => !filter || Object.entries(filter).every(
      ([key, expected]) => value[key as keyof T] === expected,
    ))
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T & { id: string }): Promise<void> {
    this.values.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.values.delete(id)
  }

  onChange(_listener: DataChangeListener<T>): () => void {
    return () => {}
  }
}
