import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"
import { CcUsageAnalysisService } from "../cc-service"

const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("usage analysis reports", () => {
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
})
