import { DatabaseSync } from "node:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { runDataMaintenance } from "../maintenance/engine"
import type { DataMaintenancePolicy } from "../types"

const NOW = "2026-09-05T12:00:00.000Z"
const OLD = "2026-07-01T00:00:00.000Z"
const RECENT = "2026-09-01T00:00:00.000Z"

describe("runtime data maintenance engine", () => {
  it("removes only redundant rows and preserves delivery failures and conversation history", async () => {
    const fixture = await createFixture()
    try {
      seedConversation(fixture.database, "conversation-live")
      seedOutbox(fixture.database, outbox("local-sent", "local-renderer", "sent", OLD))
      seedOutbox(fixture.database, outbox("local-pending", "local-renderer", "pending", OLD))
      seedOutbox(fixture.database, outbox("external-failed", "wecom", "failed", OLD))
      for (let index = 0; index < 520; index++) {
        seedOutbox(fixture.database, outbox(`external-${index}`, "wecom", "sent", isoAt(index)))
      }
      seedEvent(fixture.database, event("old-sdk", "conversation-live", "sdkEvent", OLD))
      seedEvent(fixture.database, event("recent-sdk", "conversation-live", "sdkEvent", RECENT))
      seedEvent(fixture.database, event("semantic", "conversation-live", "result", OLD))
      seedEvent(fixture.database, event("orphan", "conversation-deleted", "result", RECENT))
      fixture.database.close()

      const result = await runDataMaintenance({
        databasePath: fixture.databasePath,
        policy: policy(),
        now: () => new Date(NOW),
      })

      expect(result.status).toBe("completed")
      expect(result.deleted).toEqual({
        localOutbox: 1,
        retainedOutbox: 20,
        rawAgentDiagnostics: 1,
        orphanAgentEvents: 1,
      })
      const database = new DatabaseSync(fixture.databasePath)
      expect(ids(database, "ns_outbox")).toContain("local-pending")
      expect(ids(database, "ns_outbox")).toContain("external-failed")
      expect(count(database, "ns_outbox")).toBe(502)
      expect(ids(database, "ns_agent_events").sort()).toEqual(["recent-sdk", "semantic"])
      expect(ids(database, "ns_conversations")).toEqual(["conversation-live"])
      database.close()
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })

  it("resumes bounded batches across runs on a large historical outbox", async () => {
    const fixture = await createFixture()
    try {
      fixture.database.exec("BEGIN")
      for (let index = 0; index < 20_000; index++) {
        seedOutbox(fixture.database, outbox(`local-${index}`, "local-renderer", "sent", OLD))
      }
      fixture.database.exec("COMMIT")
      fixture.database.close()

      const first = await runDataMaintenance({
        databasePath: fixture.databasePath,
        policy: policy({ maxDeletions: 7_000 }),
        now: () => new Date(NOW),
      })
      const second = await runDataMaintenance({
        databasePath: fixture.databasePath,
        policy: policy({ maxDeletions: 7_000 }),
        now: () => new Date(NOW),
      })
      const third = await runDataMaintenance({
        databasePath: fixture.databasePath,
        policy: policy({ maxDeletions: 7_000 }),
        now: () => new Date(NOW),
      })

      expect([first.status, second.status, third.status]).toEqual(["partial", "partial", "completed"])
      expect(first.deleted.localOutbox + second.deleted.localOutbox + third.deleted.localOutbox).toBe(20_000)
      const database = new DatabaseSync(fixture.databasePath)
      expect(count(database, "ns_outbox")).toBe(0)
      database.close()
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  }, 30_000)

  it("leaves committed progress recoverable when a later run encounters a database lock", async () => {
    const fixture = await createFixture()
    try {
      seedOutbox(fixture.database, outbox("local-sent", "local-renderer", "sent", OLD))
      fixture.database.exec("BEGIN EXCLUSIVE")

      await expect(runDataMaintenance({
        databasePath: fixture.databasePath,
        policy: policy(),
        now: () => new Date(NOW),
      })).rejects.toThrow(/locked/i)

      fixture.database.exec("ROLLBACK")
      fixture.database.close()
      const recovered = await runDataMaintenance({
        databasePath: fixture.databasePath,
        policy: policy(),
        now: () => new Date(NOW),
      })
      expect(recovered.deleted.localOutbox).toBe(1)
    } finally {
      await rm(fixture.directory, { recursive: true, force: true })
    }
  })
})

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-data-maintenance-"))
  const databasePath = path.join(directory, "runtime.sqlite")
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE ns_outbox (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ns_agent_events (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ns_conversations (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return { directory, databasePath, database }
}

function seedOutbox(database: DatabaseSync, value: Record<string, unknown>): void {
  insert(database, "ns_outbox", value)
}

function seedEvent(database: DatabaseSync, value: Record<string, unknown>): void {
  insert(database, "ns_agent_events", value)
}

function seedConversation(database: DatabaseSync, id: string): void {
  insert(database, "ns_conversations", { id, updatedAt: RECENT })
}

function insert(database: DatabaseSync, table: string, value: Record<string, unknown>): void {
  const id = String(value.id)
  const timestamp = typeof value.updatedAt === "string" ? value.updatedAt : RECENT
  database.prepare(
    `INSERT INTO ${table}(id, value, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(id, JSON.stringify(value), timestamp, timestamp)
}

function outbox(id: string, platform: string, status: string, updatedAt: string): Record<string, unknown> {
  return {
    id,
    projectId: "project-1",
    destination: { platform, connectorId: "connector-1", sessionKey: "session-1" },
    status,
    updatedAt,
  }
}

function event(id: string, conversationId: string, eventType: string, createdAt: string): Record<string, unknown> {
  return { id, conversationId, eventType, createdAt }
}

function isoAt(index: number): string {
  return new Date(Date.parse("2026-08-01T00:00:00.000Z") + index * 1_000).toISOString()
}

function policy(overrides: Partial<DataMaintenancePolicy> = {}): DataMaintenancePolicy {
  return {
    maxDeletions: 10_000,
    batchSize: 100,
    rawAgentDiagnosticCutoff: "2026-08-06T12:00:00.000Z",
    outboxSentRetentionLimit: 500,
    ...overrides,
  }
}

function ids(database: DatabaseSync, table: string): string[] {
  return (database.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>).map((row) => row.id)
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}
