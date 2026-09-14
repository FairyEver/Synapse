import * as fsPromises from "node:fs/promises"
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SqliteNamespace, openSqliteDatabase } from "../../../runtime/data-repo/backends/sqlite"
import { agentTaskProgressSchema, JsonNamespace, type ConversationEntryV1, type AgentTaskProgressEntryV1 } from "../../../runtime/data-repo"
import { TaskProgressStore, detectCoverageClaim, type WorkReceipt } from "../task-progress"
import { boundedReadDelivery } from "../task-progress-hooks"
import { AgentSessionRepository } from "../session-repository"

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return { ...actual, realpath: vi.fn(actual.realpath) }
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "synapse-progress-"))
  const db = openSqliteDatabase(path.join(dir, "progress.sqlite"))
  const rows = new SqliteNamespace<AgentTaskProgressEntryV1>({ name: agentTaskProgressSchema.name, schemaVersion: 1,
    backend: "sqlite", database: db, validate: agentTaskProgressSchema.validate, sqlite: agentTaskProgressSchema.sqlite })
  cleanups.push(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })
  const store = new TaskProgressStore(rows, "p")
  const session = store.session("c", "/originals")
  await session.begin("t")
  return { dir, rows, store, session }
}
const image = (id: string, file = "/originals/image.png"): WorkReceipt => ({ toolUseId: id, toolName: "Read", path: path.resolve(file),
  version: "original-v1", kind: "image", complete: true, presented: false, outputHash: "response" })
const unit = { id: "image", path: "/originals/image.png", kind: "image", receipts: [] as string[], processed: false }

describe("durable task evidence and coverage", () => {
  it("explicit continuation after restart reuses the logical task; a new request starts a separate scope", async () => {
    const { dir, rows } = await setup()
    const conversations = new JsonNamespace<ConversationEntryV1>({ name: "conversations", backend: "json", schemaVersion: 1,
      filePath: path.join(dir, "conversations.json") })
    const repository = new AgentSessionRepository({ projectId: "p", conversations, taskProgress: rows })
    const conversation = await repository.createSession({ sessionKey: "scope" })
    const first = repository.createTaskProgressSession(conversation.id, "/originals")!
    await first.begin("runtime-1")
    await first.commit({ version: 1, baseRevision: 0, units: [unit], seal: true })
    first.close()
    const reopened = new AgentSessionRepository({ projectId: "p", conversations, taskProgress: rows })
    const continuation = reopened.createTaskProgressSession(conversation.id, "/originals")!
    await continuation.begin("runtime-2", true)
    expect(await continuation.assessment()).toMatchObject({ declaredUnits: 1, revision: 1 })
    const rotation = reopened.createTaskProgressSession(conversation.id, "/originals")!
    await rotation.begin("runtime-2")
    expect(await rotation.assessment()).toMatchObject({ declaredUnits: 1 })
    const newTask = reopened.createTaskProgressSession(conversation.id, "/originals")!
    await newTask.begin("runtime-3")
    expect(await newTask.assessment()).toMatchObject({ declaredUnits: 0, status: "unverified" })
    await reopened.deleteSession(conversation.id)
    expect(await rows.count({ conversationId: conversation.id })).toBe(0)
    await expect(newTask.receipt(image("late"))).rejects.toThrow("旧执行代")
  })
  it("does not promote acquisition or Task completion to verified work; resumes the same evidence after replacement", async () => {
    const { rows, store, session } = await setup()
    await session.commit({ version: 1, baseRevision: 0, units: [unit], seal: true })
    await session.receipt(image("read-1"))
    await expect(session.commit({ version: 1, baseRevision: 1, units: [{ ...unit, receipts: ["read-1"], processed: true }] })).rejects.toThrow("尚未呈现")
    const newStore = new TaskProgressStore(rows, "p") // durable state; no implicit execution on restart
    expect(await newStore.assessment("c", "t")).toMatchObject({ status: "partial", declaredUnits: 1, processedUnits: 0 })
    const next = store.session("c", "/originals")
    await next.begin("t")
    await expect(session.receipt(image("late"))).rejects.toThrow("旧执行代")
    await next.presented(["read-1"])
    await next.commit({ version: 1, baseRevision: 1, units: [{ ...unit, receipts: ["read-1"], processed: true }] })
    expect(await next.assessment()).toMatchObject({ status: "coverage-complete", processedUnits: 1, semanticCorrectness: "unverified" })
    expect(await newStore.assessment("other", "t")).toMatchObject({ status: "unverified", declaredUnits: 0 })
  })

  it("preserves scope and conflicting facts, requires both sources to reconcile, and rejects stale revisions", async () => {
    const { session } = await setup()
    await session.receipt(image("a")); await session.receipt(image("b"))
    await session.presented(["a", "b"])
    await session.commit({ version: 1, baseRevision: 0, units: [unit], findings: [{ id: "count", value: 20, evidence: ["a"] }], seal: true })
    await expect(session.commit({ version: 1, baseRevision: 0 })).rejects.toThrow("版本过期")
    await expect(session.commit({ version: 1, baseRevision: 1, units: [{ ...unit, path: "/other.png" }] })).rejects.toThrow("替换")
    await session.commit({ version: 1, baseRevision: 1, findings: [{ id: "count", value: 21, evidence: ["b"] }] })
    expect(await session.assessment()).toMatchObject({ conflictingFindings: 1, declaredUnits: 1 })
    await session.commit({ version: 1, baseRevision: 2, findings: [{ id: "count", value: 20, evidence: ["a", "b"], resolves: true }] })
    expect(await session.assessment()).toMatchObject({ conflictingFindings: 0, declaredUnits: 1 })
  })

  it("tiles coverage inside one version and never regresses when a later read adds a new version", async () => {
    const { session } = await setup()
    const textUnit = { ...unit, kind: "text", path: "/originals/log.txt" }
    await session.commit({ version: 1, baseRevision: 0, units: [textUnit], seal: true })
    const receipt = (id: string, range: [number, number], complete = true, version = "original-v1"): WorkReceipt =>
      ({ ...image(id, textUnit.path), kind: "text", range, totalLines: 6, complete, version })
    await session.receipt(receipt("first", [1, 2]))
    await session.receipt(receipt("last", [4, 6]))
    await session.presented(["first", "last"])
    await session.commit({ version: 1, baseRevision: 1, units: [{ ...textUnit, receipts: ["first", "last"], processed: true }] })
    expect(await session.assessment()).toMatchObject({ status: "partial", coveredUnits: 0 })
    // A shortened result only covers the lines it actually delivered.
    await session.receipt(receipt("truncated", [3, 3], false)); await session.presented(["truncated"])
    await session.commit({ version: 1, baseRevision: 2, units: [{ ...textUnit, receipts: ["truncated"] }] })
    expect(await session.assessment()).toMatchObject({ coveredUnits: 0 })
    await session.receipt(receipt("gap", [3, 4])); await session.presented(["gap"])
    await session.commit({ version: 1, baseRevision: 3, units: [{ ...textUnit, receipts: ["gap"] }] })
    expect(await session.assessment()).toMatchObject({ status: "coverage-complete" })
    // The material changed after the read: the new version covers the unit again
    // and the earlier version's receipts must never drag coverage back down.
    await session.receipt(receipt("changed", [1, 6], true, "log-v2")); await session.presented(["changed"])
    await session.commit({ version: 1, baseRevision: 4, units: [{ ...textUnit, receipts: ["changed"] }] })
    expect(await session.assessment()).toMatchObject({ status: "coverage-complete", coveredUnits: 1, processedUnits: 1 })
  })

  it("never stitches ranges across versions and restores coverage by re-reading one version", async () => {
    const { session } = await setup()
    const textUnit = { ...unit, kind: "text", path: "/originals/paged.txt" }
    await session.commit({ version: 1, baseRevision: 0, units: [textUnit], seal: true })
    const receipt = (id: string, range: [number, number], version: string): WorkReceipt =>
      ({ ...image(id, textUnit.path), kind: "text", range, totalLines: 6, complete: true, version })
    await session.receipt(receipt("old-head", [1, 3], "paged-v1"))
    await session.receipt(receipt("new-tail", [4, 6], "paged-v2"))
    await session.presented(["old-head", "new-tail"])
    await session.commit({ version: 1, baseRevision: 1, units: [{ ...textUnit, receipts: ["old-head", "new-tail"], processed: true }] })
    expect(await session.assessment()).toMatchObject({ status: "partial", coveredUnits: 0 })
    await session.receipt(receipt("new-head", [1, 3], "paged-v2")); await session.presented(["new-head"])
    await session.commit({ version: 1, baseRevision: 2, units: [{ ...textUnit, receipts: ["new-head"] }] })
    expect(await session.assessment()).toMatchObject({ status: "coverage-complete", coveredUnits: 1, processedUnits: 1 })
  })

  it("keys completion retries to unit outcomes instead of acquired receipts", async () => {
    const { session } = await setup()
    const textUnit = { ...unit, kind: "text", path: "/originals/fingerprint.txt" }
    await session.commit({ version: 1, baseRevision: 0, units: [textUnit], seal: true })
    const receipt = (id: string, range: [number, number]): WorkReceipt =>
      ({ ...image(id, textUnit.path), kind: "text", range, totalLines: 4, complete: true, version: "fingerprint-v1" })
    const declared = await session.completionMarker()
    // Acquiring and presenting evidence never moves the fingerprint on its own.
    await session.receipt(receipt("chunk", [1, 2]))
    expect(await session.completionMarker()).toBe(declared)
    await session.presented(["chunk"])
    expect(await session.completionMarker()).toBe(declared)
    await session.commit({ version: 1, baseRevision: 1, units: [{ ...textUnit, receipts: ["chunk"], processed: true }] })
    const processed = await session.completionMarker()
    expect(processed).not.toBe(declared)
    // Another partial read that changes no outcome keeps the fingerprint stable.
    await session.receipt(receipt("repeat", [1, 2])); await session.presented(["repeat"])
    await session.commit({ version: 1, baseRevision: 2, units: [{ ...textUnit, receipts: ["repeat"] }] })
    expect(await session.completionMarker()).toBe(processed)
    await session.receipt(receipt("rest", [3, 4])); await session.presented(["rest"])
    await session.commit({ version: 1, baseRevision: 3, units: [{ ...textUnit, receipts: ["rest"] }] })
    const covered = await session.completionMarker()
    expect(covered).not.toBe(processed)
    // Re-reading an already covered material never re-arms a correction.
    await session.receipt(receipt("again", [1, 4])); await session.presented(["again"])
    await session.commit({ version: 1, baseRevision: 4, units: [{ ...textUnit, receipts: ["again"] }] })
    expect(await session.completionMarker()).toBe(covered)
  })

  it("requires processing a delivered original before reading another declared original, without blocking its evidence or repair", async () => {
    const { session } = await setup()
    const next = { ...unit, id: "next", path: "/originals/next.png" }
    await session.commit({ version: 1, baseRevision: 0, units: [unit, next], seal: true })
    await session.receipt(image("seen"))
    expect(await session.pendingProcessingBeforeRead(next.path)).toBeUndefined()
    await session.presented(["seen"])
    expect(await session.pendingProcessingBeforeRead(next.path)).toContain('"receipts":["seen"]')
    expect(await session.pendingProcessingBeforeRead(unit.path)).toBeUndefined()
    expect(await session.pendingProcessingBeforeRead("/private/checkpoint.txt")).toBeUndefined()
    await session.commit({ version: 1, baseRevision: 1, units: [{ ...unit, receipts: ["seen"], processed: true }] })
    expect(await session.pendingProcessingBeforeRead(next.path)).toBeUndefined()
  })

  it("matches a declared original through a directory alias before its first Read", async () => {
    const { dir, session } = await setup()
    const original = path.join(dir, "original.txt"), nextPath = path.join(dir, "next.txt")
    await writeFile(original, "value"); await writeFile(nextPath, "next")
    const first = { id: "first", path: original, kind: "text", receipts: [], processed: false }
    const second = { ...first, id: "second", path: nextPath }
    await session.commit({ version: 1, baseRevision: 0, units: [first, second], seal: true })
    const canonical = await realpath(original)
    await session.receipt({ ...image("read", canonical), canonicalPath: canonical, kind: "text", range: [1, 1], totalLines: 1 })
    await session.presented(["read"])
    expect(await session.pendingProcessingBeforeRead(await realpath(nextPath))).toContain('"receipts":["read"]')
    await session.commit({ version: 1, baseRevision: 1, units: [{ ...first, receipts: ["read"], processed: true }] })
    expect(await session.assessment()).toMatchObject({ coveredUnits: 1, processedUnits: 1 })
  })

  it("rejects duplicate IDs and duplicate resources within one commit without dropping earlier scope or facts", async () => {
    const { session } = await setup()
    await expect(session.commit({ version: 1, baseRevision: 0, units: [unit, { ...unit, path: "/other.png" }] })).rejects.toThrow("重复任务单元 ID")
    await expect(session.commit({ version: 1, baseRevision: 0, units: [unit, { ...unit, id: "duplicate" }] })).rejects.toThrow("不能重复计数")
    await session.receipt(image("read")); await session.presented(["read"])
    await expect(session.commit({ version: 1, baseRevision: 0, findings: [
      { id: "count", value: 20, evidence: ["read"] }, { id: "count", value: 21, evidence: ["read"] },
    ] })).rejects.toThrow("重复发现 ID")
    expect(await session.assessment()).toMatchObject({ declaredUnits: 0, revision: 0, conflictingFindings: 0 })
  })

  it("does not resolve paths without inventory and bounds a stalled canonical path lookup", async () => {
    const { session } = await setup()
    const lookup = vi.spyOn(fsPromises, "realpath").mockClear().mockImplementation(() => new Promise(() => {}))
    try {
      expect(await session.pendingProcessingBeforeRead("/unavailable/remote.txt")).toBeUndefined()
      expect(lookup).not.toHaveBeenCalled()
      vi.useFakeTimers()
      const pending = session.commit({ version: 1, baseRevision: 0, units: [unit] })
      await vi.advanceTimersByTimeAsync(3_001)
      await pending
      expect(await session.assessment()).toMatchObject({ declaredUnits: 1, status: "partial" })
    } finally { vi.useRealTimers(); lookup.mockRestore() }
  })

  it("rejects sealing a partial inventory and permits append-only correction after premature sealing", async () => {
    const { session } = await setup()
    await session.receipt(image("read-first"))
    const second = { ...unit, id: "second", path: "/originals/second.png" }
    await expect(session.commit({ version: 1, baseRevision: 0, units: [second], seal: true })).rejects.toThrow("尚未包含")
    expect(await session.assessment()).toMatchObject({ revision: 0, declaredUnits: 0 })
    await session.commit({ version: 1, baseRevision: 0, units: [unit], seal: true })
    await expect(session.commit({ version: 1, baseRevision: 1, units: [second] })).rejects.toThrow("reopen:true")
    await session.commit({ version: 1, baseRevision: 1, units: [second], reopen: true })
    expect(await session.assessment()).toMatchObject({ revision: 2, declaredUnits: 2, status: "partial" })
    await expect(session.commit({ version: 1, baseRevision: 2, units: [{ ...unit, path: "/replacement.png" }], reopen: true })).rejects.toThrow("替换")
    await session.receipt(image("read-second", second.path)); await session.presented(["read-first", "read-second"])
    await session.commit({ version: 1, baseRevision: 2, units: [{ ...unit, receipts: ["read-first"], processed: true },
      { ...second, receipts: ["read-second"], processed: true }], seal: true })
    expect(await session.assessment()).toMatchObject({ declaredUnits: 2, processedUnits: 2, status: "coverage-complete" })
  })

  it("keeps sealing idempotent when a completed scope is followed by output verification", async () => {
    const { session } = await setup()
    await session.receipt(image("source")); await session.presented(["source"])
    await session.commit({ version: 1, baseRevision: 0, units: [{ ...unit, receipts: ["source"], processed: true }], seal: true })
    await session.receipt({ ...image("output", "/originals/answers.txt"), kind: "text", range: [1, 1], totalLines: 1 })
    await session.presented(["output"])
    await session.commit({ version: 1, baseRevision: 1, seal: true })
    expect(await session.assessment()).toMatchObject({ status: "coverage-complete", declaredUnits: 1, processedUnits: 1 })
  })

  it("serializes parallel receipts, pages more than 100 rows, and preserves prior state on write failure", async () => {
    const { rows, store, session } = await setup()
    await Promise.all(Array.from({ length: 105 }, (_, n) => session.receipt(image(`read-${n}`))))
    expect(await rows.count()).toBe(105)
    await session.receipt(image("read-1"))
    expect(await rows.count()).toBe(105)
    const before = await store.state("c", "t")
    vi.spyOn(rows, "upsert").mockRejectedValueOnce(new Error("disk full"))
    await expect(session.commit({ version: 1, baseRevision: 0, units: [unit] })).rejects.toThrow("disk full")
    expect(await store.state("c", "t")).toEqual(before)
    await session.commit({ version: 1, baseRevision: 0, units: [unit] })
    const snapshot = []
    for await (const line of store.checkpoint("c", "t")) snapshot.push(JSON.parse(line))
    expect(snapshot.filter((r) => r.recordType === "receipt")).toHaveLength(105)
    expect(Buffer.byteLength(JSON.stringify(snapshot[0]))).toBeLessThan(8 * 1024)
    expect(snapshot[0].resume).toMatchObject({ pendingUnitIds: ["image"], omittedRows: { recentReads: 97 } })
    expect(await session.claimOutputRepair()).toBe(true)
    const replacement = store.session("c", "/originals")
    await replacement.begin("t")
    expect(await replacement.claimOutputRepair()).toBe(false)
    replacement.close()
    await expect(replacement.receipt(image("after-cancel"))).rejects.toThrow("旧执行代")
  })
})


it("accepts a proven canonical alias without replacing a unit and rejects an unproven replacement", async () => {
  const { dir, session, store } = await setup()
  const original = path.join(dir, "original.txt"), alias = path.join(dir, "ORIGINAL.txt")
  await writeFile(original, "evidence")
  const canonical = await realpath(original)
  const entry = { id: "original", path: original, kind: "text", receipts: [], processed: false }
  await session.commit({ version: 1, baseRevision: 0, units: [entry], seal: true })
  await session.receipt({ ...image("read", original), canonicalPath: canonical, kind: "text", range: [1, 1], totalLines: 1 })
  await session.presented(["read"])
  // Simulate a filesystem-confirmed casing alias; never lowercase paths to grant identity.
  const lookup = vi.spyOn(fsPromises, "realpath").mockResolvedValueOnce(canonical)
  try {
    await session.commit({ version: 1, baseRevision: 1, units: [{ ...entry, path: alias, receipts: ["read"], processed: true }] })
    expect(await session.assessment()).toMatchObject({ status: "coverage-complete", declaredUnits: 1 })
    expect((await store.state("c", "t")).units.get("original")?.path).toBe(original)
  } finally { lookup.mockRestore() }
  await writeFile(path.join(dir, "other.txt"), "different")
  await expect(session.commit({ version: 1, baseRevision: 2, units: [{ ...entry, path: path.join(dir, "other.txt") }] })).rejects.toThrow("替换")
})

it("counts a successful edit receipt as processed evidence without granting read coverage", async () => {
  const { session } = await setup()
  // Receipt and unit paths must resolve identically on every platform, including Windows.
  const file = path.resolve("/originals/notes.md")
  await session.receipt({ toolUseId: "edit-1", toolName: "Edit", path: file, kind: "operation", complete: false,
    presented: false, outputHash: "edit-response",
    mutation: { toolName: "Edit", path: file, versionAfter: "notes-v2" } })
  await session.presented(["edit-1"])
  await session.commit({ version: 1, baseRevision: 0, seal: true,
    units: [{ id: "notes", path: file, kind: "text", receipts: ["edit-1"], processed: true }] })

  expect(await session.assessment()).toMatchObject({ status: "partial", declaredUnits: 1,
    coveredUnits: 0, processedUnits: 1, mutatedUnits: 1, semanticCorrectness: "unverified" })
  await expect(session.evidenceGaps()).resolves.toMatchObject({ missingEvidence: [], overclaim: [] })
  await expect(session.evidenceGaps("已通读全部文件，未遗漏")).resolves.toMatchObject({
    missingEvidence: [], overclaim: [{ id: "notes", path: file }],
  })
  expect(detectCoverageClaim("4 步全部完成，未中断")).toBe(false)
  expect(detectCoverageClaim("I read every file in full.")).toBe(true)
})

it("reports an unregistered multi-file claim as advisory without demanding an inventory", async () => {
  const { session } = await setup()
  const first = path.resolve("/originals/one.txt")
  const second = path.resolve("/originals/two.txt")
  const read = (id: string, file: string): WorkReceipt => ({ toolUseId: id, toolName: "Read", path: file, kind: "text",
    range: [1, 1], totalLines: 1, version: "text-v1", complete: true, presented: false, outputHash: id })
  await session.receipt(read("read-1", first))
  await session.receipt(read("read-2", second))
  await session.presented(["read-1", "read-2"])

  expect((await session.evidenceGaps()).unregisteredClaim).toBeUndefined()
  expect((await session.evidenceGaps("编辑已完成，磁盘状态已核对。")).unregisteredClaim).toBeUndefined()
  await expect(session.evidenceGaps("已通读全部文件，未遗漏")).resolves.toMatchObject({
    missingEvidence: [], overclaim: [], unregisteredClaim: true,
  })
  // Without an inventory the ledger stays unverified; the turn is never blocked on it.
  expect(await session.assessment()).toMatchObject({ status: "unverified", declaredUnits: 0 })
})

it("maps a bounded read to the lines it actually delivered", () => {
  expect(boundedReadDelivery({ startLine: 1, totalLines: 8, deliveredContentLines: 3, kept: "head" })).toEqual([1, 3])
  expect(boundedReadDelivery({ startLine: 508, totalLines: 3, deliveredContentLines: 99, kept: "head" })).toEqual([508, 510])
  expect(boundedReadDelivery({ startLine: 1, totalLines: 8, deliveredContentLines: 3, kept: "tail" })).toEqual([6, 8])
  expect(boundedReadDelivery({ startLine: 1, totalLines: 8, deliveredContentLines: 0, kept: "head" })).toBeUndefined()
  expect(boundedReadDelivery({ startLine: 0, totalLines: 8, deliveredContentLines: 3, kept: "head" })).toBeUndefined()
})

it("tiles coverage from bounded reads and honours a declared processing scope", async () => {
  const { session, store } = await setup()
  const file = path.resolve("/originals/records.txt")
  const bounded = (id: string, range: [number, number]): WorkReceipt => ({ toolUseId: id, toolName: "Read",
    path: file, kind: "text", range, deliveredRange: range, bounded: true, totalLines: 8,
    complete: false, presented: false, outputHash: id, version: "records-v1" })
  await session.receipt(bounded("page-1", [1, 4]))
  await session.receipt(bounded("page-2", [5, 8]))
  await session.presented(["page-1", "page-2"])
  await session.commit({ version: 1, baseRevision: 0, seal: true,
    units: [{ id: "records", path: file, kind: "text", receipts: ["page-1", "page-2"], processed: true }] })
  expect(await session.assessment()).toMatchObject({ status: "coverage-complete", coveredUnits: 1, processedUnits: 1 })

  // A declared scope only needs the declared range, and cannot be rewritten later.
  const scoped = store.session("c", "/originals")
  await scoped.begin("t2")
  await scoped.receipt(bounded("head-1", [1, 4]))
  await scoped.presented(["head-1"])
  await scoped.commit({ version: 1, baseRevision: 0, seal: true,
    units: [{ id: "head", path: file, kind: "text", receipts: ["head-1"], processed: true, scope: [1, 4] }] })
  expect(await scoped.assessment()).toMatchObject({ status: "coverage-complete", declaredUnits: 1, coveredUnits: 1 })
  await expect(scoped.commit({ version: 1, baseRevision: 1,
    units: [{ id: "head", path: file, kind: "text", receipts: [], processed: true, scope: [1, 2] }] })).rejects.toThrow("不能修改处理范围")
  const otherFile = path.resolve("/originals/records-2.txt")
  await scoped.receipt({ ...bounded("head-2", [1, 4]), path: otherFile })
  await scoped.presented(["head-2"])
  await expect(scoped.commit({ version: 1, baseRevision: 1, reopen: true,
    units: [{ id: "wide", path: otherFile, kind: "text", receipts: ["head-2"], processed: true, scope: [1, 99] }] }))
    .rejects.toThrow("超出材料行数")
})
