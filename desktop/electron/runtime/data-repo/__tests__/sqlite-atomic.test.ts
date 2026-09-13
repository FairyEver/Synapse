import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { DataRepositoryImpl } from "../repository"
import { SqliteNamespace, openSqliteDatabase } from "../backends/sqlite"
import type { NamespaceSchema } from "../types"

type Row = { id: string; scope: string; seq: number; revision: number; text: string }
const schema: NamespaceSchema<Row> = {
  name: "fixture.entries", backend: "sqlite", currentVersion: 1, migrations: [],
  validate: (value): value is Row => !!value && typeof value === "object"
    && typeof (value as Row).id === "string" && typeof (value as Row).scope === "string"
    && Number.isSafeInteger((value as Row).seq) && Number.isSafeInteger((value as Row).revision)
    && typeof (value as Row).text === "string",
  sqlite: { fields: ["id", "scope", "seq", "revision", "text"], maxRecordBytes: 8192,
    indexes: [{ name: "scope_seq", fields: ["scope", "seq"], unique: true }], atomic: true },
}
const databases: DatabaseSync[] = []
const roots: string[] = []
afterEach(() => {
  for (const db of databases.splice(0)) if (db.isOpen) db.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup(database = new DatabaseSync(":memory:")) {
  databases.push(database)
  const repo = new DataRepositoryImpl()
  const ns = new SqliteNamespace<Row>({ name: schema.name, schemaVersion: 1, backend: "sqlite", database,
    validate: schema.validate, sqlite: schema.sqlite })
  repo.register(schema, ns)
  return { repo, ns, database }
}
const row = (id: string, seq: number, scope = "a"): Row => ({ id, seq, scope, revision: 0, text: "正文" })
const insert = (value: Row) => ({ kind: "insert" as const, namespace: schema.name, id: value.id, value })

it("commits CAS updates and inserts together and publishes only IDs after COMMIT, without previous loads", async () => {
  const { repo, ns, database } = setup()
  await repo.commitBatch({ guards: [], operations: [insert(row("summary", 0))] })
  const get = vi.spyOn(ns, "get")
  const observed: unknown[] = []
  ns.onChange((event) => {
    expect(database.isTransaction).toBe(false)
    expect(event).not.toHaveProperty("value")
    expect(event).not.toHaveProperty("previous")
    observed.push(event.id)
  })
  expect(await repo.commitBatch({ guards: [{ namespace: schema.name, id: "summary", expected: { revision: 0 } }],
    operations: [insert(row("entry", 1)), { kind: "patch", namespace: schema.name, id: "summary", patch: { revision: 1 } }] }))
    .toEqual({ committed: true })
  expect(get).not.toHaveBeenCalled()
  expect(observed).toEqual(["entry", "summary"])
  expect(await ns.get("summary")).toMatchObject({ revision: 1 })
})

it("rolls back every operation on unique conflicts, CAS conflicts, missing patch rows and validation failures", async () => {
  const { repo, ns } = setup()
  await repo.commitBatch({ guards: [], operations: [insert(row("summary", 0))] })
  const notify = vi.fn()
  ns.onChange(notify)
  const patch = { kind: "patch" as const, namespace: schema.name, id: "summary", patch: { revision: 1 } }
  expect(await repo.commitBatch({ guards: [], operations: [patch, insert(row("duplicate", 0))] })).toEqual({ committed: false, reason: "conflict" })
  expect(await repo.commitBatch({ guards: [{ namespace: schema.name, id: "summary", expected: { revision: 10 } }],
    operations: [patch] })).toEqual({ committed: false, reason: "conflict" })
  expect(await repo.commitBatch({ guards: [], operations: [insert(row("new", 1)), { ...patch, id: "missing" }] }))
    .toEqual({ committed: false, reason: "conflict" })
  await expect(repo.commitBatch({ guards: [], operations: [patch, insert({ ...row("bad", 2), text: 4 } as unknown as Row)] })).rejects.toThrow()
  expect(await ns.get("summary")).toMatchObject({ revision: 0 })
  expect(await ns.get("new")).toBeNull()
  expect(notify).not.toHaveBeenCalled()
})

it("rejects unregistered fields, namespaces, ID changes, unsupported backends and oversized batches", async () => {
  const { repo, ns } = setup()
  const operation = insert(row("one", 1))
  await expect(repo.commitBatch({ guards: [], operations: [{ ...operation, namespace: "missing" }] })).rejects.toThrow()
  await expect(repo.commitBatch({ guards: [], operations: [{ ...operation, value: { ...operation.value, surprise: 1 } }] })).rejects.toThrow()
  await expect(repo.commitBatch({ guards: [], operations: [{ kind: "patch", namespace: schema.name, id: "one", patch: { id: "two" } }] })).rejects.toThrow()
  await expect(repo.commitBatch({ guards: [], operations: Array.from({ length: 129 }, () => operation) })).rejects.toThrow()
  await expect(repo.commitBatch({ guards: [], operations: [insert({ ...row("huge", 1), text: "x".repeat(256 * 1024) })] })).rejects.toThrow()
  await expect(repo.commitBatch({ guards: [{ namespace: schema.name, id: "one", expected: { "revision') OR 1=1 --": 0 } }], operations: [operation] })).rejects.toThrow()
  expect(await ns.list()).toEqual([])
})

it("reads keyset ranges through the declared index, excluding other scopes and without OFFSET", async () => {
  const { repo, ns, database } = setup()
  await repo.commitBatch({ guards: [], operations: Array.from({ length: 100 }, (_, i) => insert(row(`a${i}`, i))) })
  await repo.commitBatch({ guards: [], operations: [insert(row("b20", 20, "b"))] })
  expect((await ns.queryRange({ index: "scope_seq", equal: { scope: "a" }, range: { field: "seq", gt: 20, lte: 25 }, direction: "desc", limit: 3 })).map((r) => r.seq)).toEqual([25, 24, 23])
  const plan = database.prepare("EXPLAIN QUERY PLAN SELECT value FROM ns_fixture_entries INDEXED BY idx_ns_fixture_entries_scope_seq WHERE json_extract(value, '$.scope') = ? AND json_extract(value, '$.seq') > ? ORDER BY json_extract(value, '$.seq') ASC LIMIT ?").all("a", 20, 3)
  expect(JSON.stringify(plan)).toContain("USING INDEX idx_ns_fixture_entries_scope_seq")
  await expect(ns.queryRange({ index: "unknown", equal: {}, direction: "asc", limit: 3 })).rejects.toThrow()
  await expect(ns.queryRange({ index: "scope_seq", equal: {}, range: { field: "text", gt: 0 }, direction: "asc", limit: 3 })).rejects.toThrow()
  await expect(ns.queryRange({ index: "scope_seq", equal: { scope: "a" }, direction: "asc", limit: 10000 })).rejects.toThrow()
})

it("two file connections cannot commit the same revision and busy/closed failures do not notify", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "synapse-atomic-")); roots.push(root)
  const first = setup(openSqliteDatabase(path.join(root, "db.sqlite")))
  const second = setup(openSqliteDatabase(path.join(root, "db.sqlite")))
  await first.repo.commitBatch({ guards: [], operations: [insert(row("summary", 0))] })
  await second.ns.get("summary")
  const request = { guards: [{ namespace: schema.name, id: "summary", expected: { revision: 0 } }],
    operations: [{ kind: "patch" as const, namespace: schema.name, id: "summary", patch: { revision: 1 } }] }
  const results = await Promise.all([first.repo.commitBatch(request), second.repo.commitBatch(request)])
  expect(results.filter((r) => r.committed)).toHaveLength(1)
  const notify = vi.fn(); second.ns.onChange(notify)
  first.database.exec("BEGIN IMMEDIATE")
  await expect(second.repo.commitBatch({ guards: [], operations: [insert(row("busy", 2))] })).rejects.toThrow(/locked|busy/)
  first.database.exec("ROLLBACK")
  second.database.close()
  await expect(second.repo.commitBatch({ guards: [], operations: [insert(row("closed", 3))] })).rejects.toThrow()
  expect(notify).not.toHaveBeenCalled()
})

it("rolls back across namespaces on an injected SQLite statement failure and can retry after reopen", async () => {
  const { repo, database, ns } = setup()
  const otherSchema = { ...schema, name: "fixture.receipts" }
  const receipts = new SqliteNamespace<Row>({ name: otherSchema.name, schemaVersion: 1, backend: "sqlite", database,
    validate: schema.validate, sqlite: schema.sqlite })
  repo.register(otherSchema, receipts)
  await receipts.list()
  database.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON ns_fixture_receipts BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END")
  const notify = vi.fn(); ns.onChange(notify); receipts.onChange(notify)
  const request = { guards: [], operations: [insert(row("history", 1)), { ...insert(row("receipt", 1)), namespace: otherSchema.name }] }
  await expect(repo.commitBatch(request)).rejects.toThrow("injected disk failure")
  expect(await ns.list()).toEqual([])
  expect(await receipts.list()).toEqual([])
  expect(notify).not.toHaveBeenCalled()
  database.exec("DROP TRIGGER fixture_failure")
  expect(await repo.commitBatch(request)).toEqual({ committed: true })
  expect(notify).toHaveBeenCalledTimes(2)
})

it("does not allow ordinary writes or singleton imports to bypass bounded schema validation", async () => {
  const { ns } = setup()
  await expect(ns.upsert({ ...row("huge", 1), text: "x".repeat(8192) })).rejects.toThrow()
  await expect(ns.upsert({ ...row("bad", 1), surprise: 1 } as Row)).rejects.toThrow()
  await expect(ns.setSingleton(row("singleton", 1))).rejects.toThrow()
})
