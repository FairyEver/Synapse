import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, expect, it, vi } from "vitest"
import { DataRepositoryImpl } from "../../../runtime/data-repo/repository"
import { SqliteNamespace } from "../../../runtime/data-repo/backends/sqlite"
import type { NamespaceSchema } from "../../../runtime/data-repo/types"
import { agentHistorySchemas, historyContentNamespace, historyRecordNamespace } from "../../../runtime/data-repo/schemas/agent-history"
import { AgentArtifactStore } from "../artifact-store"
import { AgentHistoryRepository } from "../history-repository"
import { HistoryContentStore, historyTextChunks } from "../history-content-store"
import type { AgentArtifactEntry } from "../../../runtime/data-repo"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const action of cleanup.splice(0)) await action() })
const scope = { projectId: "project-a", conversationId: "conversation-a" }
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-history-v2-"))
  const db = new DatabaseSync(":memory:")
  cleanup.push(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  const repo = new DataRepositoryImpl()
  for (const raw of agentHistorySchemas) {
    const schema = raw as unknown as NamespaceSchema<Record<string, unknown> & { id: string }>
    repo.register<Record<string, unknown> & { id: string }>(schema, new SqliteNamespace<Record<string, unknown> & { id: string }>({ name: schema.name, backend: "sqlite", schemaVersion: 1, database: db,
      validate: schema.validate, sqlite: schema.sqlite }))
  }
  const artifacts = new SqliteNamespace<AgentArtifactEntry>({ name: "agent.artifacts", backend: "sqlite", schemaVersion: 3, database: db })
  const store = new AgentArtifactStore({ rootDirectory: root, artifacts })
  const content = new HistoryContentStore(repo, store)
  const history = new AgentHistoryRepository(repo, content)
  await history.create(scope, "History fixture")
  return { repo, artifacts, store, content, history }
}
const input = (operationId: string, content = "正文") => ({ ...scope, operationId, content, turnId: "turn-a", generation: 0,
  role: "assistant" as const, timestamp: "2026-09-13T00:00:00.000Z" })

it("appends 32 concurrent entries with stable receipts and without loading existing history", async () => {
  const { repo, history } = await setup()
  const ns = repo.namespace(historyRecordNamespace.name)
  const list = vi.spyOn(ns, "list")
  const get = vi.spyOn(ns, "get")
  const receipts = await Promise.all(Array.from({ length: 32 }, (_, i) => history.append(input(`op-${i}`))))
  expect(new Set(receipts.map((r) => r.seq)).size).toBe(32)
  expect(await history.getSummary(scope)).toMatchObject({ historyCount: 32, lastHistorySeq: 32, commitRevision: 32 })
  expect(await history.getSummary(scope)).not.toHaveProperty("history")
  expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled()
  const page = await history.page(scope, { limit: 5 })
  expect(page.entries.map((entry) => entry.seq)).toEqual([28, 29, 30, 31, 32])
  expect(page.hasOlder).toBe(true)
  const older = await history.page(scope, { limit: 5, beforeSeq: page.beforeSeq!, snapshot: page.snapshot })
  expect(older.entries.map((entry) => entry.seq)).toEqual([23, 24, 25, 26, 27])
  expect(await history.append(input("op-0"))).toEqual(receipts[0])
  await expect(history.append(input("op-0", "different"))).rejects.toThrow("内容不一致")
  expect((await history.getSummary(scope))?.historyCount).toBe(32)
})

it("reads a 16 MiB body and large metadata by bounded verified blocks without truncation", async () => {
  const { history, content } = await setup()
  const text = "中文😀x".repeat(1_600_000)
  const receipt = await history.append({ ...input("large", text), metadata: { detail: "m".repeat(128 * 1024) } })
  const page = await history.page(scope)
  const entry = page.entries[0]
  expect(entry.entryId).toBe(receipt.entryId)
  expect(Buffer.byteLength(JSON.stringify(entry))).toBeLessThanOrEqual(8192)
  const hash = createHash("sha256")
  let offset: number | null = 0
  let bytes = 0
  do {
    const chunk = await content.read(scope, entry.contentRef, offset)
    expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(32 * 1024)
    hash.update(chunk.text); bytes += Buffer.byteLength(chunk.text)
    offset = chunk.nextOffset
  } while (offset !== null)
  expect(bytes).toBe(Buffer.byteLength(text))
  expect(hash.digest("hex")).toBe(createHash("sha256").update(text).digest("hex"))
  expect(entry.metadataRef?.bytes).toBeGreaterThan(128 * 1024)
}, 30_000)

it("rejects cross-scope, corrupt content, invalid character offsets and stale generations", async () => {
  const { history, content, artifacts } = await setup()
  await history.append(input("one", "😀data"))
  const entry = (await history.page(scope)).entries[0]
  await expect(content.read({ ...scope, projectId: "other" }, entry.contentRef, 0)).rejects.toThrow()
  await expect(content.read(scope, entry.contentRef, 1)).rejects.toThrow("拆分字符")
  await expect(history.append({ ...input("stale"), generation: 1 })).rejects.toThrow("代际")
  const artifact = (await artifacts.list())[0]
  if (!artifact.storagePath) throw new Error("Fixture artifact path missing")
  await writeFile(artifact.storagePath, "corrupt")
  await expect(content.read(scope, entry.contentRef, 0)).rejects.toThrow("校验")
})

it("does not publish or append when artifact persistence fails", async () => {
  const { history, store, repo } = await setup()
  vi.spyOn(store, "persistToolOutputText").mockRejectedValue(new Error("disk full"))
  const notify = vi.fn(); repo.namespace(historyRecordNamespace.name).onChange(notify)
  await expect(history.append(input("failed"))).rejects.toThrow("disk full")
  expect(notify).not.toHaveBeenCalled()
  expect((await history.getSummary(scope))?.historyCount).toBe(0)
  expect(await repo.namespace(historyContentNamespace.name).list()).toEqual([expect.objectContaining({ state: "orphan", chunkCount: 0 })])
})

it("preserves surrogate pairs split across source chunks", async () => {
  async function* source() { yield "a\ud83d"; yield "\ude00中" }
  let actual = ""
  for await (const chunk of historyTextChunks(source())) actual += chunk
  expect(actual).toBe("a😀中")
})

it("marks unused concurrent duplicate content as orphan and publishes a single receipt", async () => {
  const { history, repo } = await setup()
  const results = await Promise.all(Array.from({ length: 8 }, () => history.append(input("same"))))
  expect(results.every((result) => result.entryId === results[0].entryId)).toBe(true)
  expect((await history.getSummary(scope))?.historyCount).toBe(1)
  const manifests = await repo.namespace<{ state: string }>(historyContentNamespace.name).list()
  expect(manifests.filter((manifest) => manifest.state === "committed")).toHaveLength(1)
  expect(manifests.filter((manifest) => manifest.state === "orphan")).toHaveLength(7)
  expect(manifests.filter((manifest) => manifest.state === "staging")).toHaveLength(0)
})
