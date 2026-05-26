import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"
import { initUsageAnalysisSchema } from "../db-schema"
import { CcUsageAnalysisService } from "../cc-service"

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("usage analysis reports", () => {
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

    service.savePricingRules([{
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
    service.savePricingRules([{ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0 }])
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

  it("migrates legacy USD prices and stored costs exactly once", () => {
    const db = new DatabaseSync(":memory:")
    db.exec(`
      CREATE TABLE usage_model_prices (
        id TEXT PRIMARY KEY,
        model_pattern TEXT NOT NULL,
        input_per_1m REAL NOT NULL DEFAULT 0,
        output_per_1m REAL NOT NULL DEFAULT 0,
        cache_read_per_1m REAL NOT NULL DEFAULT 0,
        cache_write_per_1m REAL NOT NULL DEFAULT 0,
        reasoning_per_1m REAL NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        sort_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE usage_pricing_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE cc_scan_files (file_path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, line_count INTEGER NOT NULL DEFAULT 0, parse_status TEXT NOT NULL, error_kind TEXT, last_scanned_at TEXT NOT NULL);
      CREATE TABLE cc_sessions (session_id TEXT PRIMARY KEY, file_path TEXT NOT NULL, workspace_key TEXT NOT NULL DEFAULT '', workspace_label TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', cli_version TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL DEFAULT '', model_summary TEXT NOT NULL DEFAULT '', request_count INTEGER NOT NULL DEFAULT 0, conversation_count INTEGER NOT NULL DEFAULT 0, tool_call_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE cc_usage_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, date TEXT NOT NULL, hour TEXT NOT NULL, workspace_key TEXT NOT NULL DEFAULT '', workspace_label TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT 'unknown', provider TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cost_input REAL NOT NULL DEFAULT 0, cost_output REAL NOT NULL DEFAULT 0, cost_cache_read REAL NOT NULL DEFAULT 0, cost_cache_write REAL NOT NULL DEFAULT 0, cost_reasoning REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0, price_known INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE cc_tool_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, date TEXT NOT NULL, hour TEXT NOT NULL DEFAULT '', workspace_key TEXT NOT NULL DEFAULT '', tool_name TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', exit_code INTEGER, duration_ms INTEGER);
      CREATE TABLE cc_daily_usage (date TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', workspace_key TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cost_input REAL NOT NULL DEFAULT 0, cost_output REAL NOT NULL DEFAULT 0, cost_cache_read REAL NOT NULL DEFAULT 0, cost_cache_write REAL NOT NULL DEFAULT 0, cost_reasoning REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0, price_known INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, conversations INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (date, model, provider, workspace_key));
      CREATE TABLE cc_hourly_usage (hour TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', workspace_key TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cost_input REAL NOT NULL DEFAULT 0, cost_output REAL NOT NULL DEFAULT 0, cost_cache_read REAL NOT NULL DEFAULT 0, cost_cache_write REAL NOT NULL DEFAULT 0, cost_reasoning REAL NOT NULL DEFAULT 0, total_cost REAL NOT NULL DEFAULT 0, price_known INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0, conversations INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, model, provider, workspace_key));
      INSERT INTO usage_model_prices (id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m, cache_write_per_1m, reasoning_per_1m, enabled, source, sort_index, updated_at)
      VALUES ('legacy', 'legacy-model', 1, 2, 0.5, 3, 2, 1, 'user', 0, '2026-05-01T00:00:00.000Z');
      INSERT INTO cc_usage_events (id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known)
      VALUES ('event-1', 'session-1', 1770000000000, '2026-05-01', '2026-05-01 10', 'legacy-model', 100, 50, 1, 2, 3, 1);
      INSERT INTO cc_daily_usage (date, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known, requests, conversations)
      VALUES ('2026-05-01', 'legacy-model', '', 100, 50, 1, 2, 3, 1, 1, 1);
      INSERT INTO cc_hourly_usage (hour, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output, total_cost, price_known, requests, conversations)
      VALUES ('2026-05-01 10', 'legacy-model', '', 100, 50, 1, 2, 3, 1, 1, 1);
    `)

    initUsageAnalysisSchema(db)
    initUsageAnalysisSchema(db)

    expect(db.prepare("SELECT input_per_1m, output_per_1m, currency FROM usage_model_prices WHERE id = 'legacy'").get()).toEqual({
      input_per_1m: 7.2,
      output_per_1m: 14.4,
      currency: "CNY",
    })
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
})
