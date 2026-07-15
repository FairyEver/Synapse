import { describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SqliteNamespace, openSqliteDatabase } from "../backends/sqlite"
import { InvalidNamespaceDataError } from "../errors"
import { sqliteIndexesFor } from "../factory"

interface Conversation extends Record<string, unknown> {
  id: string
  title: string
  projectId?: string
  archived?: boolean
  updatedAt?: string
  history?: Array<{ role: string; content: string }>
}

const tempDir = () => mkdtemp(path.join(tmpdir(), "synapse-sqlite-"))

describe("SqliteNamespace (T2.5)", () => {
  it("upsert/get/list/remove roundtrip survives reopen", async () => {
    const dir = await tempDir()
    const file = path.join(dir, "data.db")
    try {
      const db = openSqliteDatabase(file)
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      await ns.upsert({ id: "c1", title: "Hello" })
      await ns.upsert({ id: "c2", title: "World", archived: true })
      expect(await ns.get("c1")).toEqual({ id: "c1", title: "Hello" })
      expect((await ns.list()).map((c) => c.id).sort()).toEqual(["c1", "c2"])
      await ns.remove("c1")
      expect(await ns.get("c1")).toBeNull()
      expect(await ns.list()).toHaveLength(1)
      db.close()

      const db2 = openSqliteDatabase(file)
      const ns2 = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db2,
      })
      expect(await ns2.list()).toHaveLength(1)
      expect(await ns2.get("c2")).toEqual({ id: "c2", title: "World", archived: true })
      db2.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("list filter applies after JSON parse", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      await ns.upsert({ id: "c1", title: "a", archived: false })
      await ns.upsert({ id: "c2", title: "b", archived: true })
      const archived = await ns.list({ archived: true })
      expect(archived.map((c) => c.id)).toEqual(["c2"])
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("pushes simple list filters into SQLite before parsing rows", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
        validate: (value): value is Conversation =>
          typeof value === "object"
          && value !== null
          && typeof (value as { id?: unknown }).id === "string"
          && typeof (value as { title?: unknown }).title === "string",
      })
      await ns.upsert({ id: "c1", title: "target", projectId: "project-1" })
      await ns.upsert({ id: "bad-other-project", projectId: "project-2" } as Conversation)

      await expect(ns.list({ projectId: "project-1" })).resolves.toEqual([
        { id: "c1", title: "target", projectId: "project-1" },
      ])
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("returns a bounded JSON window with exclusions and only the last array item", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      await ns.upsert({
        id: "current-project",
        title: "Current",
        projectId: "project-1",
        updatedAt: "2026-07-15T03:00:00.000Z",
        history: [{ role: "user", content: "excluded" }],
      })
      await ns.upsert({
        id: "older-archive",
        title: "Older",
        projectId: "project-2",
        updatedAt: "2026-07-15T01:00:00.000Z",
        history: [{ role: "user", content: "old" }],
      })
      await ns.upsert({
        id: "newer-archive",
        title: "Newer",
        projectId: "project-3",
        updatedAt: "2026-07-15T02:00:00.000Z",
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "last" },
        ],
      })

      await expect(ns.listWindow({
        exclude: { projectId: ["project-1"] },
        orderBy: "updatedAt",
        order: "desc",
        limit: 1,
        arrayTail: "history",
      })).resolves.toEqual([{
        value: expect.objectContaining({
          id: "newer-archive",
          history: [{ role: "assistant", content: "last" }],
        }),
        arrayLength: 2,
      }])
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("filters, orders, and offsets a bounded JSON window in SQLite", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      await ns.upsert({ id: "c3", title: "Same", projectId: "project-1", updatedAt: "2026-07-15T03:00:00.000Z" })
      await ns.upsert({ id: "c1", title: "Same", projectId: "project-1", updatedAt: "2026-07-15T01:00:00.000Z" })
      await ns.upsert({ id: "c2", title: "Other", projectId: "project-2", updatedAt: "2026-07-15T02:00:00.000Z" })

      await expect(ns.listWindow({
        filter: { projectId: "project-1" },
        orderBy: ["title", "updatedAt"],
        order: "asc",
        limit: 1,
        offset: 1,
      })).resolves.toEqual([{
        value: expect.objectContaining({ id: "c3", projectId: "project-1" }),
      }])
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("singleton mode stores under reserved id", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      expect(await ns.getSingleton()).toBeNull()
      await ns.setSingleton({ id: "active", title: "Current" })
      expect(await ns.getSingleton()).toEqual({ id: "active", title: "Current" })
      // The singleton row must NOT show up in list().
      expect(await ns.list()).toEqual([])
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rejects upsert with reserved __singleton id", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      await expect(
        ns.upsert({ id: "__singleton", title: "nope" }),
      ).rejects.toBeInstanceOf(InvalidNamespaceDataError)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("indexes option creates user-declared indexes", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const _ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
        indexes: ["json_extract(value, '$.archived')"],
      })
      void _ns
      const indexes = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ns_conversations'`)
        .all() as Array<{ name: string }>
      expect(indexes.some((i) => i.name.startsWith("idx_ns_conversations_"))).toBe(true)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("indexes agent events by conversation without scanning the whole event table", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const _ns = new SqliteNamespace<Conversation>({
        name: "agent.events",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
        indexes: sqliteIndexesFor("agent.events"),
      })
      void _ns

      const plan = db
        .prepare(`
          EXPLAIN QUERY PLAN
          SELECT value FROM ns_agent_events
          WHERE id != ? AND json_extract(value, '$.conversationId') = ?
          ORDER BY id;
        `)
        .all("__singleton", "conversation-1") as Array<{ detail: string }>

      expect(plan.some((row) => row.detail.includes("USING INDEX"))).toBe(true)
      expect(plan.some((row) => row.detail.includes("SCAN ns_agent_events"))).toBe(false)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("indexes agent artifacts by conversation without scanning the whole artifact table", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const _ns = new SqliteNamespace<Conversation>({
        name: "agent.artifacts",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
        indexes: sqliteIndexesFor("agent.artifacts"),
      })
      void _ns

      const plan = db
        .prepare(`
          EXPLAIN QUERY PLAN
          SELECT value FROM ns_agent_artifacts
          WHERE id != ?
            AND json_extract(value, '$.projectId') = ?
            AND json_extract(value, '$.conversationId') = ?
          ORDER BY id;
        `)
        .all("__singleton", "project-1", "conversation-1") as Array<{ detail: string }>

      expect(plan.some((row) => row.detail.includes("USING INDEX"))).toBe(true)
      expect(plan.some((row) => row.detail.includes("SCAN ns_agent_artifacts"))).toBe(false)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("indexes outbox by project and status without scanning the whole outbox table", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const _ns = new SqliteNamespace<Conversation>({
        name: "outbox",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
        indexes: sqliteIndexesFor("outbox"),
      })
      void _ns

      const plan = db
        .prepare(`
          EXPLAIN QUERY PLAN
          SELECT value FROM ns_outbox
          WHERE id != ?
            AND json_extract(value, '$.projectId') = ?
            AND json_extract(value, '$.status') = ?
          ORDER BY id;
        `)
        .all("__singleton", "project-1", "sent") as Array<{ detail: string }>

      expect(plan.some((row) => row.detail.includes("USING INDEX"))).toBe(true)
      expect(plan.some((row) => row.detail.includes("SCAN ns_outbox"))).toBe(false)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("invalid namespace name (slashes) is rejected", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      expect(
        () =>
          new SqliteNamespace({
            name: "bad/name",
            schemaVersion: 1,
            backend: "sqlite",
            database: db,
          }),
      ).toThrowError(InvalidNamespaceDataError)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("change events fire on upsert / remove / setSingleton", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      const events: string[] = []
      ns.onChange((e) => events.push(`${e.kind}:${e.id ?? ""}`))

      await ns.upsert({ id: "c1", title: "x" })
      await ns.upsert({ id: "c1", title: "x2" })
      await ns.remove("c1")
      await ns.setSingleton({ id: "active", title: "Current" })
      expect(events).toEqual(["upsert:c1", "upsert:c1", "remove:c1", "replace:"])
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("WAL mode is enabled on the opened database", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const row = db.prepare("PRAGMA journal_mode;").get() as { journal_mode?: string }
      expect(row.journal_mode?.toLowerCase()).toBe("wal")
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("rowCount reports the number of non-singleton rows + singleton not counted", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const ns = new SqliteNamespace<Conversation>({
        name: "conversations",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
      })
      expect(ns.rowCount()).toBe(0)
      await ns.upsert({ id: "c1", title: "x" })
      await ns.upsert({ id: "c2", title: "y" })
      expect(ns.rowCount()).toBeGreaterThanOrEqual(2)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("indexes swarm workers by run and display order", async () => {
    const dir = await tempDir()
    try {
      const db = openSqliteDatabase(path.join(dir, "data.db"))
      const _ns = new SqliteNamespace<Conversation>({
        name: "app.swarm-task.worker-runs",
        schemaVersion: 1,
        backend: "sqlite",
        database: db,
        indexes: sqliteIndexesFor("app.swarm-task.worker-runs"),
      })
      void _ns

      const plan = db
        .prepare(`
          EXPLAIN QUERY PLAN
          SELECT value FROM ns_app_swarm_task_worker_runs
          WHERE id != ? AND json_extract(value, '$.runId') = ?
          ORDER BY json_extract(value, '$.roundIndex'), json_extract(value, '$.workerIndex'), id
          LIMIT ? OFFSET ?;
        `)
        .all("__singleton", "run-1", 100, 0) as Array<{ detail: string }>

      expect(plan.some((row) => row.detail.includes("USING INDEX"))).toBe(true)
      expect(plan.some((row) => row.detail.includes("SCAN ns_app_swarm_task_worker_runs"))).toBe(false)
      db.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
