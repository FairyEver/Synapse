import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CcConversationService } from "../cc-conversation-service"
import { parseCcConversationFileChunk } from "../cc-conversation-parser"
import { initUsageAnalysisSchema } from "../db-schema"

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

type Fixture = {
  readonly db: DatabaseSync
  readonly dir: string
  readonly filePath: string
}

const fixtures: Fixture[] = []
const WINDOWS_CI_TEST_TIMEOUT = process.platform === "win32" ? 60_000 : 15_000

function setupFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-conversation-service-"))
  const db = new DatabaseSync(path.join(dir, "usage.db"))
  initUsageAnalysisSchema(db)
  const filePath = path.join(dir, "session-1.jsonl")

  fs.writeFileSync(filePath, [
    JSON.stringify({ type: "ai-title", sessionId: "session-1", aiTitle: "修登录问题" }),
    JSON.stringify({
      type: "user",
      sessionId: "session-1",
      uuid: "u1",
      timestamp: "2026-05-27T01:00:00.000Z",
      message: { role: "user", content: "请修登录问题" },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "session-1",
      uuid: "a1",
      timestamp: "2026-05-27T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "auth.ts" } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }),
  ].join("\n"), "utf8")

  db.prepare(`
    INSERT INTO cc_sessions (
      session_id, file_path, workspace_key, workspace_label, provider, source,
      started_at, ended_at, model_summary, request_count, conversation_count, tool_call_count
    ) VALUES (?, ?, ?, ?, 'anthropic', 'claude-code', ?, ?, ?, 1, 1, 1)
  `).run(
    "session-1",
    filePath,
    "-repo",
    "/repo",
    "2026-05-27T01:00:00.000Z",
    "2026-05-27T01:00:01.000Z",
    "claude-opus-4.6",
  )
  db.prepare(`
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      priced_tokens, unpriced_tokens, total_cost, price_known
    ) VALUES (?, ?, ?, '2026-05-27', '2026-05-27 09', ?, ?, ?, 'anthropic', 10, 5, 0, 0, 0, 15, 0, 0.01, 1)
  `).run(
    "usage-1",
    "session-1",
    Date.parse("2026-05-27T01:00:01.000Z"),
    "-repo",
    "/repo",
    "claude-opus-4.6",
  )
  db.prepare(`
    INSERT INTO cc_tool_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, tool_name, category
    ) VALUES (?, ?, ?, '2026-05-27', '2026-05-27 09', ?, 'Read', 'tool_use')
  `).run("tool-event-1", "session-1", Date.parse("2026-05-27T01:00:01.000Z"), "-repo")

  const fixture = { db, dir, filePath }
  fixtures.push(fixture)
  return fixture
}

function insertSession(db: DatabaseSync, input: { sessionId: string; filePath: string; workspaceLabel: string }): void {
  db.prepare(`
    INSERT INTO cc_sessions (
      session_id, file_path, workspace_key, workspace_label, provider, source,
      started_at, ended_at, model_summary, request_count, conversation_count, tool_call_count
    ) VALUES (?, ?, ?, ?, 'anthropic', 'claude-code', ?, ?, ?, 1, 1, 0)
  `).run(
    input.sessionId,
    input.filePath,
    input.workspaceLabel.replaceAll("/", "-"),
    input.workspaceLabel,
    "2026-05-27T01:00:00.000Z",
    "2026-05-27T01:10:00.000Z",
    "claude-opus-4.6",
  )
}

function insertUsage(
  db: DatabaseSync,
  input: { id: string; sessionId: string; timestampMs: number; input: number; output: number; cost?: number },
): void {
  const total = input.input + input.output
  db.prepare(`
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      priced_tokens, unpriced_tokens, total_cost, price_known
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, ?, 1)
  `).run(
    input.id,
    input.sessionId,
    input.timestampMs,
    "2026-05-27",
    "2026-05-27 09",
    "-repo",
    "/repo",
    "claude-opus-4.6",
    "anthropic",
    input.input,
    input.output,
    total,
    input.cost ?? 0,
  )
}

afterEach(() => {
  vi.clearAllMocks()
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close()
    fs.rmSync(fixture.dir, { recursive: true, force: true })
  }
})

describe("CcConversationService", { timeout: WINDOWS_CI_TEST_TIMEOUT }, () => {
  it("lists conversations from the usage index", { timeout: WINDOWS_CI_TEST_TIMEOUT }, () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })

    const result = service.listConversations({ preset: "all", limit: 20 })

    expect(result).toMatchObject({
      total: 1,
      partial: false,
      items: [expect.objectContaining({
        sessionId: "session-1",
        workspaceLabel: "/repo",
        modelSummary: "claude-opus-4.6",
        tokens: 15,
        estimatedCost: 0.01,
        toolCalls: 1,
        sourceFilePath: expect.stringContaining("session-1.jsonl"),
      })],
    })
    expect(logger.info).toHaveBeenCalledWith("CC conversations listed.", {
      limit: 20,
      offset: 0,
      total: 1,
      returnedCount: 1,
      filters: {
        hasQuery: false,
        rawText: false,
        hasProject: false,
        hasModel: false,
        hasTool: false,
        hasEventType: false,
        preset: "all",
      },
    })
  })

  it("returns record rows with request counts", { timeout: WINDOWS_CI_TEST_TIMEOUT }, () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })
    insertUsage(db, {
      id: "usage-2",
      sessionId: "session-1",
      timestampMs: Date.parse("2026-05-27T01:02:00.000Z"),
      input: 20,
      output: 5,
    })

    const result = service.listRecords({ preset: "all", limit: 20 })

    expect(result.items[0]).toEqual(expect.objectContaining({
      sessionId: "session-1",
      requestCount: 2,
      tokens: 40,
    }))
  })

  it("returns record-level pricing coverage", { timeout: WINDOWS_CI_TEST_TIMEOUT }, () => {
    const { db } = setupFixture()
    db.prepare(`
      UPDATE cc_usage_events
      SET priced_tokens = 0, unpriced_tokens = 0, total_cost = 0, price_known = 0
      WHERE id = 'usage-1'
    `).run()
    const service = new CcConversationService({ db, logger })

    const result = service.listRecords({ preset: "all", limit: 20 })

    expect(result.items[0]).toEqual(expect.objectContaining({
      tokens: 15,
      pricedTokens: 0,
      unpricedTokens: 15,
      estimatedCost: 0,
    }))

    expect(service.listRecordDetails({ sessionId: "session-1" }).rows[0]).toEqual(expect.objectContaining({
      tokens: 15,
      pricedTokens: 0,
      unpricedTokens: 15,
      estimatedCost: 0,
    }))
  })

  it("returns batched record aggregates for visible sessions", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })
    insertUsage(db, {
      id: "usage-2",
      sessionId: "session-1",
      timestampMs: Date.parse("2026-05-27T01:02:00.000Z"),
      input: 20,
      output: 5,
      cost: 0.02,
    })
    insertSession(db, { sessionId: "session-2", filePath: "/tmp/session-2.jsonl", workspaceLabel: "/repo/two" })
    db.prepare("UPDATE cc_sessions SET ended_at = ? WHERE session_id = ?").run("2026-05-27T02:10:00.000Z", "session-2")
    insertUsage(db, {
      id: "usage-3",
      sessionId: "session-2",
      timestampMs: Date.parse("2026-05-27T02:05:00.000Z"),
      input: 7,
      output: 3,
      cost: 0.03,
    })

    const result = service.listRecords({ preset: "all", limit: 2 })
    const sessionOne = result.items.find((item) => item.sessionId === "session-1")
    const sessionTwo = result.items.find((item) => item.sessionId === "session-2")

    expect(result.total).toBe(2)
    expect(result.items.map((item) => item.sessionId)).toEqual(["session-2", "session-1"])
    expect(sessionOne).toEqual(expect.objectContaining({
      requestCount: 2,
      tokens: 40,
      estimatedCost: 0.03,
      lastUsedAt: "2026-05-27T01:02:00.000Z",
    }))
    expect(sessionTwo).toEqual(expect.objectContaining({
      requestCount: 1,
      tokens: 10,
      estimatedCost: 0.03,
      lastUsedAt: "2026-05-27T02:05:00.000Z",
    }))
  })

  it("returns batched conversation aggregates for visible sessions", () => {
    const { db } = setupFixture()
    const prepareSpy = vi.spyOn(db, "prepare")
    const service = new CcConversationService({ db, logger })
    insertUsage(db, {
      id: "usage-2",
      sessionId: "session-1",
      timestampMs: Date.parse("2026-05-27T01:02:00.000Z"),
      input: 20,
      output: 5,
      cost: 0.02,
    })
    insertSession(db, { sessionId: "session-2", filePath: "/tmp/session-2.jsonl", workspaceLabel: "/repo/two" })
    db.prepare("UPDATE cc_sessions SET ended_at = ? WHERE session_id = ?").run("2026-05-27T02:10:00.000Z", "session-2")
    insertUsage(db, {
      id: "usage-3",
      sessionId: "session-2",
      timestampMs: Date.parse("2026-05-27T02:05:00.000Z"),
      input: 7,
      output: 3,
      cost: 0.03,
    })

    const result = service.listConversations({ preset: "all", limit: 2 })
    const preparedSql = prepareSpy.mock.calls.map(([sql]) => String(sql))

    expect(result.total).toBe(2)
    expect(result.items.map((item) => item.sessionId)).toEqual(["session-2", "session-1"])
    expect(result.items.find((item) => item.sessionId === "session-1")).toEqual(expect.objectContaining({
      tokens: 40,
      estimatedCost: 0.03,
      lastUsedAt: "2026-05-27T01:02:00.000Z",
    }))
    expect(result.items.find((item) => item.sessionId === "session-2")).toEqual(expect.objectContaining({
      tokens: 10,
      estimatedCost: 0.03,
      lastUsedAt: "2026-05-27T02:05:00.000Z",
    }))
    expect(preparedSql.filter((sql) =>
      sql.includes("FROM cc_usage_events")
      && sql.includes("WHERE session_id IN")
      && sql.includes("GROUP BY session_id")
    )).toHaveLength(1)
    expect(preparedSql.some((sql) =>
      sql.includes("FROM cc_usage_events")
      && sql.includes("WHERE session_id = ?")
      && sql.includes("GROUP BY session_id")
    )).toBe(false)
  })

  it("allows record batches beyond the initial 200 rows", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })

    db.exec("BEGIN IMMEDIATE")
    try {
      for (let index = 2; index <= 250; index += 1) {
        const sessionId = `session-${index}`
        insertSession(db, { sessionId, filePath: `/tmp/${sessionId}.jsonl`, workspaceLabel: `/repo/${index}` })
        insertUsage(db, {
          id: `usage-${index}`,
          sessionId,
          timestampMs: Date.parse("2026-05-27T01:00:00.000Z") + index,
          input: 1,
          output: 1,
        })
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    const result = service.listRecords({ preset: "all", limit: 250 })

    expect(result.total).toBe(250)
    expect(result.items).toHaveLength(250)
  })

  it("lists request details for one session only", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })
    insertSession(db, { sessionId: "session-2", filePath: "/tmp/session-2.jsonl", workspaceLabel: "/repo" })
    insertUsage(db, {
      id: "usage-2",
      sessionId: "session-2",
      timestampMs: Date.parse("2026-05-27T01:02:00.000Z"),
      input: 20,
      output: 5,
    })

    expect(service.listRecordDetails({ sessionId: "session-1" })).toEqual({
      sessionId: "session-1",
      total: 1,
      rows: [expect.objectContaining({
        id: "usage-1",
        sessionId: "session-1",
        tokens: 15,
        pricedTokens: 15,
        timestampMs: Date.parse("2026-05-27T01:00:01.000Z"),
      })],
    })
  })

  it("searches raw record text with request counts", async () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })

    const result = await service.searchRecordsText({ preset: "all", query: "登录", rawText: true })

    expect(result.items[0]).toEqual(expect.objectContaining({
      sessionId: "session-1",
      requestCount: 1,
      pricedTokens: 15,
      unpricedTokens: 0,
    }))
  })

  it("opens a conversation by reading raw JSONL on demand", async () => {
    const { db, filePath } = setupFixture()
    const service = new CcConversationService({ db, logger })

    const detail = await service.getConversation("session-1")

    expect(detail.session.sessionId).toBe("session-1")
    expect(detail.events.map((event) => event.type)).toEqual(["ai-title", "user", "assistant"])
    expect(detail.parseErrors).toEqual([])
    expect(logger.info).toHaveBeenCalledWith("CC conversation loaded.", {
      sessionId: "session-1",
      filePath: filePath,
      fileSizeBytes: fs.statSync(filePath).size,
      eventCount: 3,
      parseErrorCount: 0,
    })
  })

  it("opens large conversations as chunks", async () => {
    const { db, filePath } = setupFixture()
    const largeText = "x".repeat(11_000)
    const lines = Array.from({ length: 205 }, (_, index) => JSON.stringify({
      type: "user",
      sessionId: "session-1",
      uuid: `u${index + 1}`,
      timestamp: "2026-05-27T01:00:00.000Z",
      message: { role: "user", content: `${index + 1}:${largeText}` },
    }))
    fs.writeFileSync(filePath, lines.join("\n"), "utf8")
    const service = new CcConversationService({ db, logger })

    const detail = await service.getConversation("session-1")

    expect(detail.events).toHaveLength(200)
    expect(detail.hasMore).toBe(true)
    expect(detail.nextCursor).toBeTruthy()
    expect(logger.info).toHaveBeenCalledWith("CC conversation loaded.", {
      sessionId: "session-1",
      filePath,
      fileSizeBytes: fs.statSync(filePath).size,
      eventCount: 200,
      parseErrorCount: 0,
      chunked: true,
      hasMore: true,
    })

    if (!detail.nextCursor) throw new Error("Expected a next cursor")
    const next = await service.getConversationChunk("session-1", detail.nextCursor)
    expect(next.events.map((event) => event.uuid)).toEqual(["u201", "u202", "u203", "u204", "u205"])
    expect(next.hasMore).toBe(false)
  })

  it("reads conversation chunks from byte cursors", async () => {
    const { filePath } = setupFixture()

    const first = await parseCcConversationFileChunk(filePath, { limit: 1 })
    if (!first.nextCursor) throw new Error("Expected a next cursor")
    const second = await parseCcConversationFileChunk(filePath, { cursor: first.nextCursor, limit: 2 })

    expect(first.events.map((event) => event.type)).toEqual(["ai-title"])
    expect(first.hasMore).toBe(true)
    expect(second.events.map((event) => event.type)).toEqual(["user", "assistant"])
    expect(second.hasMore).toBe(false)
  })

  it("searches raw text only when requested", async () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db, logger })

    expect(service.listConversations({ preset: "all", query: "登录", rawText: false }).items).toEqual([])
    const result = await service.searchConversationText({ preset: "all", query: "登录", rawText: true })

    expect(result.items[0].matchSnippets?.[0]).toEqual(expect.objectContaining({
      eventId: "u1",
      eventType: "user",
      text: expect.stringContaining("登录"),
    }))
    expect(logger.info).toHaveBeenCalledWith("CC conversation raw text search completed.", {
      candidateCount: 1,
      candidateTotal: 1,
      cursorOffset: 0,
      matchedCount: 1,
      missingFileCount: 0,
      parseErrorCount: 0,
      partial: false,
      queryLength: 2,
    })
  })

  it("searches beyond the first raw text candidate batch when the requested limit grows", async () => {
    const { db, dir } = setupFixture()
    db.exec("BEGIN IMMEDIATE")
    try {
      for (let index = 2; index <= 151; index += 1) {
        const sessionId = `session-${index}`
        const filePath = path.join(dir, `${sessionId}.jsonl`)
        fs.writeFileSync(filePath, JSON.stringify({
          type: "user",
          sessionId,
          uuid: `u${index}`,
          timestamp: "2026-05-27T01:00:00.000Z",
          message: {
            role: "user",
            content: index === 40 ? "needle after first hundred" : `ordinary session ${index}`,
          },
        }), "utf8")
        insertSession(db, { sessionId, filePath, workspaceLabel: `/repo/${index}` })
        db.prepare("UPDATE cc_sessions SET ended_at = ? WHERE session_id = ?").run(
          new Date(Date.parse("2026-05-27T02:00:00.000Z") + index * 1000).toISOString(),
          sessionId,
        )
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
    const service = new CcConversationService({ db, logger })

    const firstBatch = await service.searchConversationText({
      preset: "all",
      query: "needle after first hundred",
      rawText: true,
      limit: 100,
    })
    const expandedBatch = await service.searchConversationText({
      preset: "all",
      query: "needle after first hundred",
      rawText: true,
      limit: 150,
    })

    expect(firstBatch.items).toEqual([])
    expect(firstBatch.partial).toBe(true)
    expect(expandedBatch.items.map((item) => item.sessionId)).toContain("session-40")
    expect(expandedBatch.partial).toBe(true)
  })

  it("continues raw text search from the next candidate cursor", async () => {
    const { db, dir } = setupFixture()
    db.exec("BEGIN IMMEDIATE")
    try {
      for (let index = 2; index <= 151; index += 1) {
        const sessionId = `session-${index}`
        const filePath = path.join(dir, `${sessionId}.jsonl`)
        fs.writeFileSync(filePath, JSON.stringify({
          type: "user",
          sessionId,
          uuid: `u${index}`,
          timestamp: "2026-05-27T01:00:00.000Z",
          message: {
            role: "user",
            content: index === 40 ? "needle after cursor" : `ordinary session ${index}`,
          },
        }), "utf8")
        insertSession(db, { sessionId, filePath, workspaceLabel: `/repo/${index}` })
        db.prepare("UPDATE cc_sessions SET ended_at = ? WHERE session_id = ?").run(
          new Date(Date.parse("2026-05-27T02:00:00.000Z") + index * 1000).toISOString(),
          sessionId,
        )
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
    const service = new CcConversationService({ db, logger })

    const firstBatch = await service.searchConversationText({
      preset: "all",
      query: "needle after cursor",
      rawText: true,
      limit: 100,
    })
    const secondBatch = await service.searchConversationText({
      preset: "all",
      query: "needle after cursor",
      rawText: true,
      limit: 50,
      cursor: firstBatch.nextCursor,
    })

    expect(firstBatch.items).toEqual([])
    expect(firstBatch.nextCursor).toBe("100")
    expect(secondBatch.items.map((item) => item.sessionId)).toContain("session-40")
    expect(secondBatch.nextCursor).toBe("150")
  })

  it("redacts raw conversation secrets in details and search snippets", async () => {
    const { db, filePath } = setupFixture()
    fs.appendFileSync(filePath, `\n${JSON.stringify({
      type: "user",
      sessionId: "session-1",
      uuid: "secret-1",
      timestamp: "2026-05-27T01:00:02.000Z",
      message: {
        role: "user",
        content: [
          "ANTHROPIC_AUTH_TOKEN=sk-usage-secret",
          "Authorization: Bearer sk-bearer",
          "{\"token\":\"data-server-token\"}",
          "/Users/liyang/project/file.ts",
        ].join(" "),
      },
    })}`)
    const service = new CcConversationService({ db, logger })

    const detail = await service.getConversation("session-1")
    const serializedDetail = JSON.stringify(detail.events)
    expect(serializedDetail).toContain("[redacted]")
    expect(serializedDetail).toContain("/Users/liyang/project/file.ts")
    expect(serializedDetail).not.toContain("sk-usage-secret")
    expect(serializedDetail).not.toContain("sk-bearer")
    expect(serializedDetail).not.toContain("data-server-token")

    const result = await service.searchConversationText({
      preset: "all",
      query: "file.ts",
      rawText: true,
    })
    const serializedSnippets = JSON.stringify(result.items[0].matchSnippets)
    expect(serializedSnippets).toContain("[redacted]")
    expect(serializedSnippets).toContain("/Users/liyang/project/file.ts")
    expect(serializedSnippets).not.toContain("sk-usage-secret")
    expect(serializedSnippets).not.toContain("sk-bearer")
    expect(serializedSnippets).not.toContain("data-server-token")

    const secretSearch = await service.searchConversationText({
      preset: "all",
      query: "sk-usage-secret",
      rawText: true,
    })
    expect(secretSearch.items).toEqual([])
  })

  it("returns an explicit error for a missing source file", async () => {
    const { db, filePath } = setupFixture()
    fs.rmSync(filePath)
    const service = new CcConversationService({ db, logger })

    await expect(service.getConversation("session-1")).rejects.toThrow("Claude Code transcript file is missing")
    expect(logger.error).toHaveBeenCalledWith("CC conversation source file missing.", {
      sessionId: "session-1",
      filePath,
    })
  })
})
