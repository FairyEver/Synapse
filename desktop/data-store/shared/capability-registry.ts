import type { CapabilityDomainDefinition } from "../../synapse-capabilities/shared/types"

type DataStoreCapability = {
  action: string
  mcpTool?: string
  cliCommand?: string
  mutates: boolean
}

const DATA_STORE_CAPABILITIES = [
  { action: "listTables", mcpTool: "list_tables", cliCommand: "tables", mutates: false },
  { action: "createTable", mcpTool: "create_table", cliCommand: "create", mutates: true },
  { action: "dropTable", mcpTool: "drop_table", cliCommand: "drop", mutates: true },
  { action: "describeTable", mcpTool: "describe_table", cliCommand: "describe", mutates: false },
  { action: "databaseOverview", mcpTool: "database_overview", cliCommand: "overview", mutates: false },
  { action: "updateTableDescription", mcpTool: "update_table_description", cliCommand: "update-table-description", mutates: true },
  { action: "addColumn", mcpTool: "add_column", cliCommand: "add-column", mutates: true },
  { action: "updateColumnDescription", mcpTool: "update_column_description", cliCommand: "update-column-description", mutates: true },
  { action: "updateColumnChoices", mcpTool: "update_column_choices", cliCommand: "update-column-choices", mutates: true },
  { action: "getColumnChoicesUsage", mcpTool: "get_column_choices_usage", cliCommand: "choice-usage", mutates: false },
  { action: "insert", mcpTool: "insert", cliCommand: "insert", mutates: true },
  { action: "batchInsert", mcpTool: "batch_insert", cliCommand: "insert", mutates: true },
  { action: "query", mcpTool: "query", cliCommand: "query", mutates: false },
  { action: "update", mcpTool: "update", cliCommand: "update", mutates: true },
  { action: "delete", mcpTool: "delete", cliCommand: "delete", mutates: true },
  { action: "updateWhere", mcpTool: "update_where", cliCommand: "update-where", mutates: true },
  { action: "deleteWhere", mcpTool: "delete_where", cliCommand: "delete-where", mutates: true },
  { action: "count", mcpTool: "count", cliCommand: "count", mutates: false },
  { action: "operationLog", mcpTool: "operation_log", cliCommand: "operation-log", mutates: false },
  { action: "renameTable", mcpTool: "rename_table", cliCommand: "rename-table", mutates: true },
  { action: "renameColumn", mcpTool: "rename_column", cliCommand: "rename-column", mutates: true },
  { action: "dropColumn", mcpTool: "drop_column", cliCommand: "drop-column", mutates: true },
  { action: "readSQL", mcpTool: "read_sql", cliCommand: "read-sql", mutates: false },
  { action: "rawSQL", mcpTool: "raw_sql", cliCommand: "sql", mutates: true },
] as const satisfies readonly DataStoreCapability[]

const DATA_STORE_DOMAIN: CapabilityDomainDefinition = {
  id: "data-store",
  capabilities: DATA_STORE_CAPABILITIES,
}

function buildMcpToolActions(): Record<string, string> {
  return Object.fromEntries(
    DATA_STORE_CAPABILITIES
      .filter((capability) => capability.mcpTool)
      .map((capability) => [capability.mcpTool, capability.action]),
  )
}

function getCliDataCommands(): string[] {
  return Array.from(new Set(
    DATA_STORE_CAPABILITIES
      .filter((capability) => capability.cliCommand)
      .map((capability) => capability.cliCommand as string),
  ))
}

function getMutatingActions(): string[] {
  return DATA_STORE_CAPABILITIES
    .filter((capability) => capability.mutates)
    .map((capability) => capability.action)
}

export {
  DATA_STORE_CAPABILITIES,
  DATA_STORE_DOMAIN,
  buildMcpToolActions,
  getCliDataCommands,
  getMutatingActions,
}
export type { DataStoreCapability }
