import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { CcConversationService } from "../cc-conversation-service"
import { initUsageAnalysisSchema } from "../db-schema"

type Fixture = {
  readonly db: DatabaseSync
  readonly dir: string
  readonly filePath: string
}

const fixtures: Fixture[] = []

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
      priced_tokens, unpriced_tokens, total_cost
    ) VALUES (?, ?, ?, '2026-05-27', '2026-05-27 09', ?, ?, ?, 'anthropic', 10, 5, 0, 0, 0, 15, 0, 0.01)
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
  input: { id: string; sessionId: string; timestampMs: number; input: number; output: number },
): void {
  const total = input.input + input.output
  db.prepare(`
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
      priced_tokens, unpriced_tokens, total_cost, price_known
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 1)
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
  )
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close()
    fs.rmSync(fixture.dir, { recursive: true, force: true })
  }
})

describe("CcConversationService", () => {
  it("lists conversations from the usage index", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

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
  })

  it("returns record rows with request counts", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })
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

  it("allows record batches beyond the initial 200 rows", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

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

    const result = service.listRecords({ preset: "all", limit: 250 })

    expect(result.total).toBe(250)
    expect(result.items).toHaveLength(250)
  })

  it("lists request details for one session only", () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })
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
    const service = new CcConversationService({ db })

    const result = await service.searchRecordsText({ preset: "all", query: "登录", rawText: true })

    expect(result.items[0]).toEqual(expect.objectContaining({
      sessionId: "session-1",
      requestCount: 1,
    }))
  })

  it("opens a conversation by reading raw JSONL on demand", async () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

    const detail = await service.getConversation("session-1")

    expect(detail.session.sessionId).toBe("session-1")
    expect(detail.events.map((event) => event.type)).toEqual(["ai-title", "user", "assistant"])
    expect(detail.parseErrors).toEqual([])
  })

  it("searches raw text only when requested", async () => {
    const { db } = setupFixture()
    const service = new CcConversationService({ db })

    expect(service.listConversations({ preset: "all", query: "登录", rawText: false }).items).toEqual([])
    const result = await service.searchConversationText({ preset: "all", query: "登录", rawText: true })

    expect(result.items[0].matchSnippets?.[0]).toEqual(expect.objectContaining({
      eventId: "u1",
      eventType: "user",
      text: expect.stringContaining("登录"),
    }))
  })

  it("returns an explicit error for a missing source file", async () => {
    const { db, filePath } = setupFixture()
    fs.rmSync(filePath)
    const service = new CcConversationService({ db })

    await expect(service.getConversation("session-1")).rejects.toThrow("Claude Code transcript file is missing")
  })
})
