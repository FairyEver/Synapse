import {
  capabilityIdToCliCommand,
  capabilityIdToMcpTool,
} from "../../synapse-capabilities/shared/naming"
import type { CapabilityDefinition, CapabilityDomainDefinition } from "../../synapse-capabilities/shared/types"

const DATABASE_CAPABILITIES = [
  { id: "database.table.list", title: "List tables", description: "List database tables.", mutates: false },
  { id: "database.table.describe", title: "Describe table", description: "Describe one database table.", mutates: false },
  { id: "database.table.create", title: "Create table", description: "Create one database table.", mutates: true },
  { id: "database.table.delete", title: "Delete table", description: "Delete one database table.", mutates: true },
  { id: "database.table.rename", title: "Rename table", description: "Rename one database table.", mutates: true },
  { id: "database.table.update", title: "Update table", description: "Update database table metadata.", mutates: true },
  { id: "database.overview.get", title: "Get overview", description: "Get a database overview.", mutates: false },
  { id: "database.column.create", title: "Create column", description: "Create one database column.", mutates: true },
  { id: "database.column.delete", title: "Delete column", description: "Delete one database column.", mutates: true },
  { id: "database.column.rename", title: "Rename column", description: "Rename one database column.", mutates: true },
  { id: "database.column.update", title: "Update column", description: "Update database column metadata.", mutates: true },
  { id: "database.choice.update", title: "Update choices", description: "Update allowed values for a choice column.", mutates: true },
  { id: "database.choice_usage.get", title: "Get choice usage", description: "Get usage counts for choice values.", mutates: false },
  { id: "database.row.create", title: "Create row", description: "Create one database row.", mutates: true },
  { id: "database.rows.create", title: "Create rows", description: "Create multiple database rows.", mutates: true },
  { id: "database.row.list", title: "List rows", description: "List database rows.", mutates: false },
  { id: "database.row.count", title: "Count rows", description: "Count database rows.", mutates: false },
  { id: "database.row.update", title: "Update row", description: "Update one database row.", mutates: true },
  { id: "database.row.delete", title: "Delete row", description: "Delete one database row.", mutates: true },
  { id: "database.rows.update", title: "Update rows", description: "Update database rows matching a filter.", mutates: true },
  { id: "database.rows.delete", title: "Delete rows", description: "Delete database rows matching a filter.", mutates: true },
  { id: "database.log.list", title: "List log", description: "List recent database mutation log entries.", mutates: false },
  { id: "database.sql.read", title: "Read SQL", description: "Execute read-only SQL.", mutates: false },
  { id: "database.sql.execute", title: "Execute SQL", description: "Execute raw SQL.", mutates: true, risk: "high" },
] as const satisfies readonly CapabilityDefinition[]

const DATABASE_DOMAIN: CapabilityDomainDefinition = {
  id: "database",
  capabilities: DATABASE_CAPABILITIES,
}

function buildMcpToolActions(): Record<string, string> {
  return Object.fromEntries(
    DATABASE_CAPABILITIES.map((capability) => [
      capabilityIdToMcpTool(capability.id),
      capability.id,
    ]),
  )
}

function getCliDataCommands(): string[] {
  return DATABASE_CAPABILITIES.map((capability) => capabilityIdToCliCommand(capability.id))
}

function getMutatingActions(): string[] {
  return DATABASE_CAPABILITIES
    .filter((capability) => capability.mutates)
    .map((capability) => capability.id)
}

export {
  DATABASE_CAPABILITIES,
  DATABASE_DOMAIN,
  buildMcpToolActions,
  getCliDataCommands,
  getMutatingActions,
}
