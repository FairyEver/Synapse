import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"
import { initUsageAnalysisSchema } from "../db-schema"
import { CcUsageAnalysisService, runWithUsageDatabaseLockRetry } from "../cc-service"
import { CodexUsageAnalysisService } from "../codex-service"
import { ModelPriceService } from "../../model-price"

const tempDirs: string[] = []
const WINDOWS_CI_TEST_TIMEOUT = 15_000

function createRecordingLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => logger),
  }
  return logger
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("usage analysis reports", { timeout: WINDOWS_CI_TEST_TIMEOUT }, () => {
  it("includes stable focus fields in CC details rows", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [] })
    db.prepare(`
      INSERT INTO cc_usage_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
        input_tokens, output_tokens
      ) VALUES ('usage-1', 'session-1', 1779843600000, '2026-05-27', '2026-05-27 09', '-repo', '/repo', 'claude-opus-4.6', 'anthropic', 10, 5)
    `).run()

    expect(service.getDetails({ preset: "all", limit: 10 })[0]).toEqual(expect.objectContaining({
      id: "usage-1",
      usageEventId: "usage-1",
      sessionId: "session-1",
      timestampMs: 1779843600000,
    }))
  })

  it("counts detail row tools inside each usage event interval", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [] })
    db.exec(`
      INSERT INTO cc_usage_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
        input_tokens, output_tokens
      ) VALUES
        ('usage-1', 'session-1', 1779843600000, '2026-05-27', '2026-05-27 09', '-repo', '/repo', 'claude-opus-4.6', 'anthropic', 10, 5),
        ('usage-2', 'session-1', 1779847200000, '2026-05-27', '2026-05-27 10', '-repo', '/repo', 'claude-opus-4.6', 'anthropic', 20, 5)
    `)
    db.exec(`
      INSERT INTO cc_tool_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, tool_name, category
      ) VALUES
        ('tool-1', 'session-1', 1779845400000, '2026-05-27', '2026-05-27 09', '-repo', 'Read', 'tool_use'),
        ('tool-2', 'session-1', 1779849000000, '2026-05-27', '2026-05-27 10', '-repo', 'Bash', 'tool_use')
    `)

    expect(service.getDetails({ preset: "all", limit: 10 }).map((row) => [row.id, row.toolCalls])).toEqual([
      ["usage-2", 1],
      ["usage-1", 1],
    ])
  })

  it("returns rounded report costs without floating point tails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [] })
    db.exec(`
      INSERT INTO cc_usage_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
        input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known
      ) VALUES
        ('usage-1', 'session-1', 1779843600000, '2026-05-27', '2026-05-27 09', '-repo', '/repo', 'decimal-model', 'anthropic', 1, 1, 0.1, 0, 0.1, 1),
        ('usage-2', 'session-1', 1779847200000, '2026-05-27', '2026-05-27 10', '-repo', '/repo', 'decimal-model', 'anthropic', 1, 1, 0.2, 0, 0.2, 1)
    `)

    const overview = service.getOverview({ preset: "all" })
    const detailCosts = service.getDetails({ preset: "all", limit: 10 }).map((row) => row.estimatedCost)

    expect(overview.totals.estimatedCost).toBe(0.3)
    expect(overview.costBreakdown.input).toBe(0.3)
    expect(detailCosts.every((value) => Number(value.toFixed(6)) === value)).toBe(true)
  })

  it("retries transient database write locks during refresh writes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const dbPath = path.join(dir, "usage.db")
    const writer = new DatabaseSync(dbPath)
    const blocked = new DatabaseSync(dbPath)
    try {
      writer.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
      blocked.exec("PRAGMA busy_timeout = 1")
      writer.exec("BEGIN IMMEDIATE")
      setTimeout(() => {
        writer.exec("COMMIT")
      }, 20)

      await runWithUsageDatabaseLockRetry(() => {
        blocked.prepare("INSERT INTO records (value) VALUES (?)").run("ok")
      })

      expect(blocked.prepare("SELECT value FROM records").get()).toEqual({ value: "ok" })
    } finally {
      writer.close()
      blocked.close()
    }
  })

  it("keeps refreshing when an enumerated JSONL file disappears before fingerprinting", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "deleted.jsonl")
    fs.writeFileSync(file, "{}\n")
    const originalStatSync: typeof fs.statSync = fs.statSync
    vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, options?: fs.StatSyncOptions) => {
      if (target === file) {
        const error = new Error(`ENOENT: no such file or directory, stat '${file}'`) as NodeJS.ErrnoException
        error.code = "ENOENT"
        throw error
      }
      return originalStatSync(target, options as never)
    }) as typeof fs.statSync)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })

    const refresh = await service.refresh()

    expect(refresh).toMatchObject({
      failedFiles: 1,
      parsedFiles: 0,
      scannedFiles: 1,
    })
    expect(db.prepare("SELECT parse_status, size, mtime_ms FROM cc_scan_files WHERE file_path = ?").get(file)).toEqual({
      parse_status: "failed",
      size: 0,
      mtime_ms: 0,
    })
  })

  it("stores parsed CC events and returns overview totals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
        content: [{ type: "tool_use", name: "Bash", id: "tool-1" }],
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    const refresh = await service.refresh()
    expect(refresh.parsedFiles).toBe(1)

    const overview = service.getOverview({ preset: "all" })
    expect(overview.totals.tokens).toBe(190)
    expect(overview.totals.requests).toBe(1)
    expect(overview.totals.toolCalls).toBe(1)
    expect(overview.topModels[0].model).toBe("claude-opus-4.6")
    expect(overview.trend[0].modelBreakdown).toEqual([{
      model: "claude-opus-4.6",
      tokens: 190,
      input: 100,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      reasoning: 0,
    }])

    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_daily_usage").get()).toEqual({ toolCalls: 1 })
    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_hourly_usage").get()).toEqual({ toolCalls: 1 })
  })

  it("removes CC usage rows for source files deleted before refresh", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    fs.rmSync(file)
    const refresh = await service.refresh()

    expect(refresh.scannedFiles).toBe(0)
    expect(service.getOverview({ preset: "all" }).totals.tokens).toBe(0)
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_scan_files WHERE file_path = ?").get(file)).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_sessions WHERE file_path = ?").get(file)).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_usage_events").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_daily_usage").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_hourly_usage").get()).toEqual({ count: 0 })
  })

  it("keeps historical CC rows when a today-scoped refresh scans only today's files", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-12T12:00:00"))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const oldFile = path.join(projectDir, "old-session.jsonl")
    const todayFile = path.join(projectDir, "today-session.jsonl")
    fs.writeFileSync(oldFile, JSON.stringify({
      type: "assistant",
      sessionId: "old-session",
      timestamp: "2026-06-11T01:00:01.000Z",
      message: {
        id: "old-msg",
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    }))
    fs.writeFileSync(todayFile, JSON.stringify({
      type: "assistant",
      sessionId: "today-session",
      timestamp: "2026-06-12T01:00:01.000Z",
      message: {
        id: "today-msg",
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }))
    const todayStartMs = new Date("2026-06-12T00:00:00").getTime()
    fs.utimesSync(oldFile, new Date(todayStartMs - 60_000), new Date(todayStartMs - 60_000))
    fs.utimesSync(todayFile, new Date(todayStartMs + 60_000), new Date(todayStartMs + 60_000))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    const refresh = await service.refresh({ preset: "today" })

    expect(refresh.scannedFiles).toBe(1)
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_scan_files WHERE file_path = ?").get(oldFile)).toEqual({ count: 1 })
    expect(service.getOverview({ preset: "all" }).totals.tokens).toBe(135)
  })

  it("removes Codex usage rows for source files deleted before refresh", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".codex", "sessions")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "rollout-test.jsonl")
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session_meta", timestamp: "2026-05-19T01:00:00.000Z", payload: { type: "session_meta", id: "s1", cwd: "/tmp/project", model_provider: "openai", source: "cli", cli_version: "1.0.0" } }),
      JSON.stringify({ type: "turn_context", timestamp: "2026-05-19T01:00:01.000Z", payload: { type: "turn_context", model: "gpt-5.5" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:03.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10 } } } }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CodexUsageAnalysisService({ db, roots: [path.join(dir, ".codex", "sessions")] })
    await service.refresh()

    fs.rmSync(file)
    const refresh = await service.refresh()

    expect(refresh.scannedFiles).toBe(0)
    expect(service.getOverview({ preset: "all" }).totals.tokens).toBe(0)
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_scan_files WHERE file_path = ?").get(file)).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_sessions WHERE file_path = ?").get(file)).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_usage_events").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_task_events").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_daily_usage").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_hourly_usage").get()).toEqual({ count: 0 })
  })

  it("reparses unchanged Codex usage files when pricing rules change", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".codex", "sessions")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "rollout-test.jsonl")
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session_meta", timestamp: "2026-05-19T01:00:00.000Z", payload: { type: "session_meta", id: "s1", cwd: "/tmp/project", model_provider: "openai", source: "cli", cli_version: "1.0.0" } }),
      JSON.stringify({ type: "turn_context", timestamp: "2026-05-19T01:00:01.000Z", payload: { type: "turn_context", model: "local-codex-model" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:03.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 } } } }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CodexUsageAnalysisService({ db, roots: [path.join(dir, ".codex", "sessions")] })
    await service.refresh()
    expect(db.prepare("SELECT total_cost, price_known FROM cx_usage_events").get()).toEqual({ total_cost: 0, price_known: 0 })

    new ModelPriceService(db).saveRules([{ modelPattern: "local-codex-model", inputPer1M: 14.4, outputPer1M: 0 }])
    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 1, skippedFiles: 0, usageEvents: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_usage_events").get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT total_cost, price_known FROM cx_usage_events").get()).toEqual({ total_cost: 14.4, price_known: 1 })
    expect(service.getOverview({ preset: "all" }).totals.estimatedCost).toBe(14.4)
  })

  it("parses only appended Codex usage lines when a session file grows", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".codex", "sessions")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "append-test.jsonl")
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session_meta", timestamp: "2026-05-19T01:00:00.000Z", payload: { type: "session_meta", id: "s1", cwd: "/tmp/project", model_provider: "openai", source: "cli", cli_version: "1.0.0" } }),
      JSON.stringify({ type: "turn_context", timestamp: "2026-05-19T01:00:01.000Z", payload: { type: "turn_context", model: "gpt-5.5" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:03.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10 } } } }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CodexUsageAnalysisService({ db, roots: [path.join(dir, ".codex", "sessions")] })
    await service.refresh()

    fs.appendFileSync(file, "\n" + [
      JSON.stringify({ type: "turn_context", timestamp: "2026-05-19T01:00:04.000Z", payload: { type: "turn_context", model: "gpt-5.5" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-05-19T01:00:05.000Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0 } } } }),
    ].join("\n"))
    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 1, skippedFiles: 0, usageEvents: 1 })
    expect(db.prepare("SELECT line_count FROM cx_scan_files WHERE file_path = ?").get(file)).toEqual({ line_count: 5 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cx_usage_events").get()).toEqual({ count: 2 })
    expect(service.getOverview({ preset: "all" }).totals.tokens).toBe(210)
  })

  it("keeps historical event costs stable after saving model-only price rules", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    const before = service.getOverview({ preset: "all" })
    expect(before.totals.estimatedCost).toBe(0)
    expect(before.totals.unpricedTokens).toBe(1_500_000)
    expect(before.topModels[0]).toMatchObject({
      model: "local-model",
      unpricedTokens: 1_500_000,
    })

    new ModelPriceService(db).saveRules([{
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 57.6,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
      reasoningPer1M: 57.6,
    }])

    const after = service.getOverview({ preset: "all" })
    expect(after.totals.estimatedCost).toBe(0)
    expect(after.totals.unpricedTokens).toBe(1_500_000)
  })

  it("reprices unchanged CC files on refresh when pricing rules change", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      },
    })}\n`)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    new ModelPriceService(db).saveRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 57.6 }])

    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 1, usageEvents: 1 })
    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events").get()).toEqual({
      total_cost: 43.2,
      price_known: 1,
    })
    expect(service.getOverview({ preset: "all" }).totals).toMatchObject({
      estimatedCost: 43.2,
      pricedTokens: 1_500_000,
      unpricedTokens: 0,
    })
  })

  it("prices newly appended events with current CNY rules without repricing old events", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    new ModelPriceService(db).saveRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])
    fs.appendFileSync(file, `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    await service.refresh()

    const rows = db.prepare("SELECT total_cost, price_known, cost_currency FROM cc_usage_events ORDER BY timestamp_ms ASC").all() as { total_cost: number; price_known: number; cost_currency: string }[]
    expect(rows).toEqual([
      { total_cost: 0, price_known: 0, cost_currency: "CNY" },
      { total_cost: 14.4, price_known: 1, cost_currency: "CNY" },
    ])
    expect(service.getOverview({ preset: "all" }).totals).toMatchObject({
      estimatedCost: 14.4,
      pricedTokens: 1_000_000,
      unpricedTokens: 1_000_000,
    })
  })

  it("parses only appended CC usage and preserves historical event costs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    new ModelPriceService(db).saveRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])
    fs.appendFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        id: "msg-2",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 1, usageEvents: 1 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_usage_events").get()).toEqual({ count: 2 })
    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events ORDER BY timestamp_ms ASC").all()).toEqual([
      { total_cost: 0, price_known: 0 },
      { total_cost: 14.4, price_known: 1 },
    ])
    const scan = db.prepare("SELECT parsed_offset, size, parser_version FROM cc_scan_files WHERE file_path = ?").get(file) as { parsed_offset: number; size: number; parser_version: number }
    expect(scan.parsed_offset).toBe(scan.size)
    expect(scan.parser_version).toBeGreaterThan(0)
  })

  it("upgrades legacy parsed CC scan rows without reparsing historical events", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "local-model",
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
    })}\n`)

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("UPDATE cc_scan_files SET parsed_offset = 0, parser_version = 0, pricing_rules_hash = ''")
    new ModelPriceService(db).saveRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])

    const refresh = await service.refresh()

    expect(refresh).toMatchObject({ parsedFiles: 0, skippedFiles: 1, usageEvents: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM cc_usage_events").get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events").get()).toEqual({ total_cost: 0, price_known: 0 })
    const scan = db.prepare("SELECT parsed_offset, size, parser_version FROM cc_scan_files WHERE file_path = ?").get(file) as { parsed_offset: number; size: number; parser_version: number }
    expect(scan.parsed_offset).toBe(scan.size)
    expect(scan.parser_version).toBeGreaterThan(0)
  })

  it("rebuilds only affected CC aggregate buckets after append refresh", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const file = path.join(projectDir, "session.jsonl")
    fs.writeFileSync(file, [
      JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-18T01:00:01.000Z",
        message: {
          id: "msg-1",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "session",
        timestamp: "2026-05-19T01:00:01.000Z",
        message: {
          id: "msg-2",
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      }),
    ].join("\n") + "\n")

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("UPDATE cc_daily_usage SET input_tokens = 999 WHERE date = '2026-05-18'")
    fs.appendFileSync(file, `${JSON.stringify({
      type: "assistant",
      sessionId: "session",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        id: "msg-3",
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 30, output_tokens: 5 },
      },
    })}\n`)

    await service.refresh()

    expect(db.prepare("SELECT input_tokens FROM cc_daily_usage WHERE date = '2026-05-18' AND model != '__synapse_tool_calls__'").get()).toEqual({ input_tokens: 999 })
    expect(db.prepare("SELECT input_tokens FROM cc_daily_usage WHERE date = '2026-05-19' AND model != '__synapse_tool_calls__'").get()).toEqual({ input_tokens: 50 })
  })

  it("rebuilds missing aggregates before reading reports", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 50, output_tokens: 10 },
        content: [{ type: "tool_use", name: "Read", id: "tool-1" }],
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("DELETE FROM cc_hourly_usage")

    const overview = service.getOverview({ preset: "all" })

    expect(overview.totals.tokens).toBe(60)
    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_daily_usage").get()).toEqual({ toolCalls: 1 })
    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_hourly_usage").get()).toEqual({ toolCalls: 1 })
  })

  it("rebuilds stale aggregates with missing tool totals before reading reports", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T02:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 50, output_tokens: 10 },
        content: [{ type: "tool_use", name: "Read", id: "tool-1" }],
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("UPDATE cc_daily_usage SET tool_calls = 0")
    db.exec("UPDATE cc_hourly_usage SET tool_calls = 0")

    const overview = service.getOverview({ preset: "all" })

    expect(overview.totals.toolCalls).toBe(1)
    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_daily_usage").get()).toEqual({ toolCalls: 1 })
    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_hourly_usage").get()).toEqual({ toolCalls: 1 })
  }, 15000)

  it("does not rebuild zero-component cost aggregates when source events also have zero components", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [] })
    db.exec(`
      INSERT INTO cc_usage_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
        input_tokens, output_tokens, unpriced_tokens, total_cost, price_known
      ) VALUES (
        'usage-1', 'session-1', 1779843600000, '2026-05-27', '2026-05-27 09', '-repo', '/repo',
        'unpriced-model', 'custom', 10, 5, 15, 1.23, 0
      );
      INSERT INTO cc_daily_usage (
        date, model, provider, workspace_key, input_tokens, output_tokens, unpriced_tokens,
        total_cost, price_known, requests, conversations
      ) VALUES (
        '2026-05-27', 'unpriced-model', 'custom', '-repo', 10, 5, 15, 1.23, 0, 99, 99
      );
      INSERT INTO cc_hourly_usage (
        hour, model, provider, workspace_key, input_tokens, output_tokens,
        total_cost, price_known, requests, conversations
      ) VALUES (
        '2026-05-27 09', 'unpriced-model', 'custom', '-repo', 10, 5, 1.23, 0, 99, 99
      );
    `)

    service.getOverview({ preset: "all" })

    expect(db.prepare("SELECT requests, conversations FROM cc_daily_usage WHERE model = 'unpriced-model'").get()).toEqual({
      conversations: 99,
      requests: 99,
    })
  })

  it("serves overview core metrics from aggregate tables", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-18T02:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 80, output_tokens: 20 },
          content: [{ type: "tool_use", name: "Read", id: "tool-1" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-05-19T02:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-haiku-4.5",
          usage: { input_tokens: 30, output_tokens: 10 },
          content: [{ type: "tool_use", name: "Bash", id: "tool-2" }],
        },
      }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("DELETE FROM cc_usage_events")
    db.exec("DELETE FROM cc_tool_events")

    const overview = service.getOverview({ preset: "all" })

    expect(overview.totals.tokens).toBe(140)
    expect(overview.totals.requests).toBe(2)
    expect(overview.totals.toolCalls).toBe(2)
    expect(overview.topModels.map((row) => row.model)).toEqual(["claude-opus-4.6", "claude-haiku-4.5"])
    expect(overview.trend.map((row) => [row.bucket, row.tokens, row.toolCalls])).toEqual([
      ["2026-05-18", 100, 1],
      ["2026-05-19", 40, 1],
    ])
  })

  it("keeps overview conversations distinct across model aggregates when raw events are available", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        sessionId: "session-1",
        timestamp: "2026-05-19T02:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 80, output_tokens: 20 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "session-1",
        timestamp: "2026-05-19T03:00:01.000Z",
        message: {
          role: "assistant",
          model: "claude-haiku-4.5",
          usage: { input_tokens: 30, output_tokens: 10 },
        },
      }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    const overview = service.getOverview({ preset: "all" })

    expect(overview.totals.requests).toBe(2)
    expect(overview.totals.conversations).toBe(1)
  })

  it("uses daily buckets by default and hourly buckets when requested", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 12))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const start = new Date(2026, 4, 19, 0)
    const entries = Array.from({ length: 31 }, (_, index) => {
      const timestamp = new Date(start.getTime() + index * 60 * 60 * 1000).toISOString()
      return JSON.stringify({
        type: "assistant",
        timestamp,
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      })
    })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), entries.join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    const dailyOverview = service.getOverview({ preset: "7d" })
    const hourlyOverview = service.getOverview({ preset: "7d", bucket: "hour" })

    expect(dailyOverview.trend.map((row) => row.bucket)).toEqual(["2026-05-19", "2026-05-20"])
    expect(hourlyOverview.trend).toHaveLength(31)
    expect(hourlyOverview.trend[0].bucket).toBe("2026-05-19 00")
    expect(hourlyOverview.trend.at(-1)?.bucket).toBe("2026-05-20 06")
  })

  it("serves today time report from hourly buckets", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 12))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    const firstHour = new Date(2026, 4, 20, 9, 10).toISOString()
    const secondHour = new Date(2026, 4, 20, 10, 20).toISOString()
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: firstHour,
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: secondHour,
        message: {
          role: "assistant",
          model: "claude-haiku-4.5",
          usage: { input_tokens: 20, output_tokens: 10 },
        },
      }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    const rows = service.getTime({ preset: "today" })

    expect(rows.map((row) => row.bucket)).toEqual(["2026-05-20 09", "2026-05-20 10"])
    expect(rows.map((row) => row.tokens)).toEqual([15, 30])
  })

  it("rebuilds stale hourly tool aggregates for today time report", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 12))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(2026, 4, 20, 9, 10).toISOString(),
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "tool_use", name: "Read", id: "tool-1" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(2026, 4, 20, 10, 20).toISOString(),
        message: {
          role: "assistant",
          model: "claude-haiku-4.5",
          usage: { input_tokens: 20, output_tokens: 10 },
          content: [{ type: "tool_use", name: "Bash", id: "tool-2" }],
        },
      }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()
    db.exec("UPDATE cc_hourly_usage SET tool_calls = 0 WHERE model = '__synapse_tool_calls__'")

    const rows = service.getTime({ preset: "today" })

    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_daily_usage WHERE model = '__synapse_tool_calls__'").get()).toEqual({ toolCalls: 2 })
    expect(rows.map((row) => [row.bucket, row.toolCalls])).toEqual([
      ["2026-05-20 09", 1],
      ["2026-05-20 10", 1],
    ])
    expect(db.prepare("SELECT SUM(tool_calls) AS toolCalls FROM cc_hourly_usage WHERE model = '__synapse_tool_calls__'").get()).toEqual({ toolCalls: 2 })
  })

  it("limits today reports to local midnight through now", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 20, 12))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), [
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(2026, 4, 20, 11, 30).toISOString(),
        message: {
          role: "assistant",
          model: "claude-opus-4.6",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(2026, 4, 20, 12, 30).toISOString(),
        message: {
          role: "assistant",
          model: "claude-haiku-4.5",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ].join("\n"))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    await service.refresh()

    const overview = service.getOverview({ preset: "today" })
    const time = service.getTime({ preset: "today" })
    const models = service.getModels({ preset: "today" })

    expect(overview.totals.tokens).toBe(15)
    expect(time.map((row) => [row.bucket, row.tokens])).toEqual([["2026-05-20 11", 15]])
    expect(models.map((row) => row.model)).toEqual(["claude-opus-4.6"])
  })

  it("migrates legacy USD stored costs exactly once", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)
    db.exec(`
      DELETE FROM model_price_meta WHERE key = 'cost_currency_migrated_to_cny_v1';
      INSERT INTO cc_usage_events (id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known)
      VALUES ('event-1', 'session-1', 1770000000000, '2026-05-01', '2026-05-01 10', 'legacy-model', 100, 50, 1, 2, 3, 1);
      INSERT INTO cc_daily_usage (date, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known, requests, conversations)
      VALUES ('2026-05-01', 'legacy-model', '', 100, 50, 1, 2, 3, 1, 1, 1);
      INSERT INTO cc_hourly_usage (hour, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known, requests, conversations)
      VALUES ('2026-05-01 10', 'legacy-model', '', 100, 50, 1, 2, 3, 1, 1, 1);
    `)

    initUsageAnalysisSchema(db)
    initUsageAnalysisSchema(db)

    expect(db.prepare("SELECT cost_input, cost_output, total_cost, cost_currency, pricing_rate FROM cc_usage_events WHERE id = 'event-1'").get()).toEqual({
      cost_input: 7.2,
      cost_output: 14.4,
      total_cost: 21.6,
      cost_currency: "CNY",
      pricing_rate: 7.2,
    })
    expect(db.prepare("SELECT total_cost, cost_currency FROM cc_daily_usage WHERE model = 'legacy-model'").get()).toEqual({
      total_cost: 21.6,
      cost_currency: "CNY",
    })
    expect(db.prepare("SELECT total_cost, cost_currency FROM cc_hourly_usage WHERE model = 'legacy-model'").get()).toEqual({
      total_cost: 21.6,
      cost_currency: "CNY",
    })
    db.close()
  })

  it("rebuilds stale legacy aggregate costs from migrated events", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)
    db.exec(`
      DELETE FROM model_price_meta WHERE key = 'cost_currency_migrated_to_cny_v1';
      INSERT INTO cc_usage_events (id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known)
      VALUES ('event-1', 'session-1', 1770000000000, '2026-05-01', '2026-05-01 10', 'legacy-model', 100, 50, 1, 2, 3, 1);
      INSERT INTO cc_daily_usage (date, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known, requests, conversations)
      VALUES ('2026-05-01', 'legacy-model', '', 999, 999, 9, 9, 18, 1, 99, 99);
      INSERT INTO cc_hourly_usage (hour, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known, requests, conversations)
      VALUES ('2026-05-01 10', 'legacy-model', '', 999, 999, 9, 9, 18, 1, 99, 99);
    `)

    initUsageAnalysisSchema(db)

    expect(db.prepare("SELECT input_tokens, output_tokens, total_cost, cost_currency, requests, conversations FROM cc_daily_usage WHERE model = 'legacy-model'").get()).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      total_cost: 21.6,
      cost_currency: "CNY",
      requests: 1,
      conversations: 1,
    })
    expect(db.prepare("SELECT input_tokens, output_tokens, total_cost, cost_currency, requests, conversations FROM cc_hourly_usage WHERE model = 'legacy-model'").get()).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      total_cost: 21.6,
      cost_currency: "CNY",
      requests: 1,
      conversations: 1,
    })
    db.close()
  })
})
