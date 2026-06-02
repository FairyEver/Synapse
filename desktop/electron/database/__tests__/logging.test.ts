import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { sanitizeDatabaseLogPath } from "../logging"

const ipcHandlersSourcePath = fileURLToPath(new URL("../ipc-handlers.ts", import.meta.url))
const importExportSourcePath = fileURLToPath(new URL("../import-export.ts", import.meta.url))

describe("database logging", () => {
  it("redacts absolute paths while keeping the selected file name", () => {
    expect(sanitizeDatabaseLogPath("/Users/liyang/客户目录/synapse-database.db"))
      .toBe("[path redacted]/synapse-database.db")
    expect(sanitizeDatabaseLogPath("C:\\Users\\liyang\\Desktop\\orders.sql"))
      .toBe("[path redacted]/orders.sql")
    expect(sanitizeDatabaseLogPath(""))
      .toBe("[path redacted]")
  })

  it("sanitizes database import and export success log paths", () => {
    const ipcHandlersSource = readFileSync(ipcHandlersSourcePath, "utf8")
    const importExportSource = readFileSync(importExportSourcePath, "utf8")

    expect(ipcHandlersSource).toContain("logger.info(\"Database exported.\", { path: sanitizeDatabaseLogPath(result.filePath) })")
    expect(importExportSource).toContain("logger.info(\"Database imported.\", { source: sanitizeDatabaseLogPath(sourcePath) })")
    expect(importExportSource).toContain("logger.info(\"Table exported.\", { table, targetPath: sanitizeDatabaseLogPath(targetPath) })")
    expect(importExportSource).toContain("logger.info(\"Table imported.\", { table: payload.table.name, sourcePath: sanitizeDatabaseLogPath(sourcePath) })")
  })
})
