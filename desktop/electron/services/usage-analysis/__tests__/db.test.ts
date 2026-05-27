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
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("usage analysis db", () => {
  it("creates cc and cx table namespaces", () => {
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
})
