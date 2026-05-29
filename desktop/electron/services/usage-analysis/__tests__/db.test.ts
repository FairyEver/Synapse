import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"
import { initUsageAnalysisSchema } from "../db-schema"

const tempDirs: string[] = []

afterEach(() => {
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
})

describe("usage analysis db", () => {
  it("creates cc and cx table namespaces", { timeout: 15_000 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-db-"))
    tempDirs.push(dir)
    const db = getUsageAnalysisDb(dir)
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    const names = rows.map((row) => row.name)

    expect(names).toContain("cc_scan_files")
    expect(names).toContain("cc_usage_events")
    expect(names).toContain("cc_tool_events")
    expect(names).toContain("cc_daily_usage")
    expect(names).toContain("cc_hourly_usage")
    expect(names).toContain("cx_scan_files")
    expect(names).toContain("cx_usage_events")
    expect(names).toContain("cx_tool_events")
    expect(names).toContain("cx_task_events")
    expect(names).toContain("cx_daily_usage")
    expect(names).toContain("cx_hourly_usage")
  })

  it("adds CC scan offset state columns", () => {
    const db = new DatabaseSync(":memory:")
    try {
      initUsageAnalysisSchema(db)

      const columns = db.prepare("PRAGMA table_info(cc_scan_files)").all() as { name: string }[]
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "parsed_offset",
        "parser_version",
        "pricing_rules_hash",
        "first_seen_at",
        "last_changed_at",
      ]))
    } finally {
      db.close()
    }
  })

  it("creates CC scan file parser state table", () => {
    const db = new DatabaseSync(":memory:")
    try {
      initUsageAnalysisSchema(db)

      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cc_scan_file_state'").get()
      expect(row).toEqual({ name: "cc_scan_file_state" })
    } finally {
      db.close()
    }
  })

  it("creates indexes for CC record session queries", () => {
    const db = new DatabaseSync(":memory:")
    try {
      initUsageAnalysisSchema(db)

      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('cc_usage_events', 'cc_tool_events', 'cc_sessions')").all() as { name: string }[]
      expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
        "idx_cc_usage_session_date",
        "idx_cc_usage_session_timestamp",
        "idx_cc_tool_session_timestamp",
        "idx_cc_sessions_activity",
      ]))

      const usageDatePlan = db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM cc_usage_events WHERE session_id = ? AND date >= ? AND date <= ?").all("s1", "2026-05-01", "2026-05-31") as { detail: string }[]
      const usageTimestampPlan = db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM cc_usage_events WHERE session_id = ? ORDER BY timestamp_ms DESC LIMIT 1").all("s1") as { detail: string }[]
      const toolTimestampPlan = db.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM cc_tool_events WHERE session_id = ? GROUP BY session_id, timestamp_ms").all("s1") as { detail: string }[]

      expect(usageDatePlan.map((row) => row.detail).join("\n")).toContain("idx_cc_usage_session_date")
      expect(usageTimestampPlan.map((row) => row.detail).join("\n")).toContain("idx_cc_usage_session_timestamp")
      expect(toolTimestampPlan.map((row) => row.detail).join("\n")).toContain("idx_cc_tool_session_timestamp")
    } finally {
      db.close()
    }
  })
})
