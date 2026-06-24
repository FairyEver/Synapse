import { describe, expect, it } from "vitest"
import { DATABASE_ROW_LIST_MAX_LIMIT } from "../../database/shared/limits"
import { buildTools, MCP_TOOL_ACTIONS } from "../../database/shared/mcp-tools"

function getTool(name: string) {
  const tool = buildTools().find((item) => item.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

function getPropertyDescription(toolName: string, propertyName: string): string {
  const property = getTool(toolName).inputSchema.properties[propertyName]
  if (!property || typeof property !== "object" || !("description" in property)) {
    throw new Error(`Property ${toolName}.${propertyName} has no description`)
  }
  const description = (property as { description?: unknown }).description
  if (typeof description !== "string") {
    throw new Error(`Property ${toolName}.${propertyName} description is not a string`)
  }
  return description
}

describe("Database MCP tool descriptions", () => {
  it("guides agents to use table descriptions when choosing a table", () => {
    expect(getTool("database_table_list").description).toContain("Use description to choose")
    expect(getTool("database_table_describe").description).toContain("Call this before")

    const tableDescription = getPropertyDescription("database_row_list", "tableName")
    expect(tableDescription).toContain("call app_database_table_list")
    expect(tableDescription).toContain("table.description")
  })

  it("exposes the same metadata actions as the canonical service dispatcher", () => {
    expect(getTool("database_table_update").description).toContain("table description")
    expect(getTool("database_choice_usage_get").description).toContain("choice")

    expect(MCP_TOOL_ACTIONS.database_table_update).toBe("app.database.table.update")
    expect(MCP_TOOL_ACTIONS.database_choice_usage_get).toBe("app.database.choice_usage.get")
  })

  it("guides agents toward overview, read SQL, and logs before riskier tools", () => {
    expect(getTool("database_overview_get").description).toContain("Use this first")
    expect(getTool("database_sql_read").description).toContain("Prefer this over app_database_sql_execute")
    expect(getTool("database_sql_read").description).toContain("read-only PRAGMA")
    expect(getTool("database_sql_read").description).toContain("_table_folders")
    expect(getTool("database_sql_execute").description).toContain("Use only")
    expect(getTool("database_sql_execute").description).toContain("_table_folder_members")
    expect(getTool("database_sql_execute").description).toContain("mutating PRAGMA")
    expect(getTool("database_log_list").description).toContain("recently changed")
  })

  it("exposes primary app Database tools and legacy Database aliases", () => {
    const names = buildTools().map((tool) => tool.name)
    expect(names.some((name) => name.startsWith("app_database_"))).toBe(true)
    expect(names.some((name) => name.startsWith("database_"))).toBe(true)
    expect(MCP_TOOL_ACTIONS.app_database_table_list).toBe("app.database.table.list")
    expect(MCP_TOOL_ACTIONS.database_table_list).toBe("app.database.table.list")
  })

  it("bounds row list pagination in the MCP schema", () => {
    const properties = getTool("database_row_list").inputSchema.properties
    const limit = properties.limit as {
      type?: string
      minimum?: number
      maximum?: number
      description?: string
    }
    const offset = properties.offset as {
      type?: string
      minimum?: number
    }

    expect(limit.type).toBe("integer")
    expect(limit.minimum).toBe(0)
    expect(limit.maximum).toBe(DATABASE_ROW_LIST_MAX_LIMIT)
    expect(limit.description).toContain("Defaults to 100")
    expect(offset.type).toBe("integer")
    expect(offset.minimum).toBe(0)
  })

  it("requires grouped where conditions for bulk mutations", () => {
    for (const toolName of ["database_rows_update", "database_rows_delete"]) {
      const where = getTool(toolName).inputSchema.properties.where as {
        anyOf: Array<{
          not?: { required?: string[] }
          properties?: {
            conditions?: { minItems?: number }
          }
        }>
      }
      expect(where.anyOf[0]?.not?.required).toEqual(["combinator", "conditions"])
      expect(where.anyOf[2]?.properties?.conditions?.minItems).toBe(1)
    }
  })

  it("requires at least one update field in update tool schemas", () => {
    for (const toolName of ["database_row_update", "database_rows_update"]) {
      const data = getTool(toolName).inputSchema.properties.data as { minProperties?: number; description?: string }
      expect(data.minProperties).toBe(1)
      expect(data.description).toContain("at least one")
    }
  })
})
