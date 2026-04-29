import { describe, expect, it } from "vitest"
import { buildTools, MCP_TOOL_ACTIONS } from "../../data-store/shared/mcp-tools"

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

describe("Data Store MCP tool descriptions", () => {
  it("guides agents to use table descriptions when choosing a table", () => {
    expect(getTool("list_tables").description).toContain("Use description to choose")
    expect(getTool("describe_table").description).toContain("Call this before")

    const tableDescription = getPropertyDescription("query", "table")
    expect(tableDescription).toContain("call list_tables")
    expect(tableDescription).toContain("table.description")
  })

  it("exposes the same metadata actions as the canonical service dispatcher", () => {
    expect(getTool("update_table_description").description).toContain("table description")
    expect(getTool("get_column_choices_usage").description).toContain("choice")

    expect(MCP_TOOL_ACTIONS.update_table_description).toBe("updateTableDescription")
    expect(MCP_TOOL_ACTIONS.get_column_choices_usage).toBe("getColumnChoicesUsage")
  })

  it("guides agents toward overview, read_sql, and operation_log before riskier tools", () => {
    expect(getTool("database_overview").description).toContain("Use this first")
    expect(getTool("read_sql").description).toContain("Prefer this over raw_sql")
    expect(getTool("raw_sql").description).toContain("Use raw_sql only")
    expect(getTool("operation_log").description).toContain("recently changed")
  })
})
