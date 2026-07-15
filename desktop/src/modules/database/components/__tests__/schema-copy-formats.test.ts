import { describe, expect, it } from "vitest"

import { SCHEMA_COPY_FORMATS } from "../schema-copy-formats"

type Schema = Parameters<(typeof SCHEMA_COPY_FORMATS)[number]["generate"]>[0]

const schema: Schema = {
  name: "tasks",
  description: "Task records",
  rowCount: 0,
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
  columns: [
    { name: "id", kind: "integer", primaryKey: true, system: true },
    { name: "created_at", kind: "timestamp", system: true },
    { name: "updated_at", kind: "timestamp", system: true },
    { name: "title", kind: "text", description: "Title" },
  ],
}

describe("schema copy formats", () => {
  it("uses primary app database MCP tool names in generated agent context", () => {
    const output = SCHEMA_COPY_FORMATS
      .filter((format) => format.key === "mcp" || format.key === "skill-context")
      .map((format) => format.generate(schema))
      .join("\n")

    expect(output).toContain("app_database_row_create")
    expect(output).toContain("app_database_row_list")
    expect(output).not.toMatch(/(?<!app_)database_row_(create|list|update|delete)/)
  })

  it.each(["mcp", "skill-context"])("includes bulk mutation dry-run safety in %s output", (formatKey) => {
    const output = SCHEMA_COPY_FORMATS.find((format) => format.key === formatKey)?.generate(schema)

    expect(output).toContain("app_database_rows_update")
    expect(output).toContain("app_database_rows_delete")
    expect(output).toContain('"dryRun": true')
    expect(output).toContain("检查返回的 `ids` 和 `affected`")
    expect(output).toContain("完全相同的参数")
  })
})
