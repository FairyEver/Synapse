import { buildPrimaryMcpToolActions } from "../../synapse-capabilities/shared/mcp-tool-names"
import type { CapabilityDefinition, CapabilityDomainDefinition } from "../../synapse-capabilities/shared/types"

const DATABASE_CAPABILITIES = [
  { id: "app.database.table.list", title: "List tables", description: "List database tables.", mutates: false },
  { id: "app.database.table.describe", title: "Describe table", description: "Describe one database table.", mutates: false },
  { id: "app.database.table.create", title: "Create table", description: "Create one database table.", mutates: true },
  { id: "app.database.table.delete", title: "Delete table", description: "Delete one database table.", mutates: true },
  { id: "app.database.table.rename", title: "Rename table", description: "Rename one database table.", mutates: true },
  { id: "app.database.table.update", title: "Update table", description: "Update database table metadata.", mutates: true },
  { id: "app.database.overview.get", title: "Get overview", description: "Get a database overview.", mutates: false },
  { id: "app.database.column.create", title: "Create column", description: "Create one database column.", mutates: true },
  { id: "app.database.column.delete", title: "Delete column", description: "Delete one database column.", mutates: true },
  { id: "app.database.column.rename", title: "Rename column", description: "Rename one database column.", mutates: true },
  { id: "app.database.column.update", title: "Update column", description: "Update database column metadata.", mutates: true },
  { id: "app.database.choice.update", title: "Update choices", description: "Update allowed values for a choice column.", mutates: true },
  { id: "app.database.choice_usage.get", title: "Get choice usage", description: "Get usage counts for choice values.", mutates: false },
  { id: "app.database.row.create", title: "Create row", description: "Create one database row.", mutates: true },
  { id: "app.database.rows.create", title: "Create rows", description: "Create multiple database rows.", mutates: true },
  { id: "app.database.row.list", title: "List rows", description: "List database rows.", mutates: false },
  { id: "app.database.row.count", title: "Count rows", description: "Count database rows.", mutates: false },
  { id: "app.database.row.update", title: "Update row", description: "Update one database row.", mutates: true },
  { id: "app.database.row.delete", title: "Delete row", description: "Delete one database row.", mutates: true },
  { id: "app.database.rows.update", title: "Update rows", description: "Update database rows matching a filter.", mutates: true },
  { id: "app.database.rows.delete", title: "Delete rows", description: "Delete database rows matching a filter.", mutates: true },
  { id: "app.database.log.list", title: "List log", description: "List recent database mutation log entries.", mutates: false },
  { id: "app.database.sql.read", title: "Read SQL", description: "Execute read-only SQL.", mutates: false },
  { id: "app.database.sql.execute", title: "Execute SQL", description: "Execute raw SQL.", mutates: true, risk: "high" },
  { id: "app.database.folder.list", title: "List folders", description: "List table folders and their members.", mutates: false },
  { id: "app.database.folder.create", title: "Create folder", description: "Create a table folder.", mutates: true },
  { id: "app.database.folder.rename", title: "Rename folder", description: "Rename a table folder.", mutates: true },
  { id: "app.database.folder.delete", title: "Delete folder", description: "Delete a table folder. Tables inside are moved to root.", mutates: true },
  { id: "app.database.folder.reorder", title: "Reorder folders", description: "Reorder table folders.", mutates: true },
  { id: "app.database.table.move", title: "Move table", description: "Move a table to a folder or to root.", mutates: true },
] as const satisfies readonly CapabilityDefinition[]

const DATABASE_DOMAIN: CapabilityDomainDefinition = {
  id: "database",
  capabilities: DATABASE_CAPABILITIES,
}

function buildMcpToolActions(): Record<string, string> {
  return buildPrimaryMcpToolActions(DATABASE_CAPABILITIES)
}

function getMutatingActions(): string[] {
  return DATABASE_CAPABILITIES
    .filter((capability) => capability.mutates)
    .flatMap((capability) => [
      capability.id,
      capability.id.replace("app.database.", "database."),
    ])
}

export {
  DATABASE_CAPABILITIES,
  DATABASE_DOMAIN,
  buildMcpToolActions,
  getMutatingActions,
}
