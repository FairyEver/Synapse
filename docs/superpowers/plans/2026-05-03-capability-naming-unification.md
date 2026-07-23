# Capability Naming Unification Implementation Plan

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Synapse external capabilities around canonical ids such as `database.table.list`, then derive matching API actions, MCP tool names, CLI commands, and public service method names from one manifest.

**Architecture:** Add shared naming helpers and enrich the capability manifest so each external capability has one canonical id. Migrate Database and Scheduler capability manifests, route HTTP/MCP/CLI by canonical ids, rename public service/dispatcher methods that sit on the external capability path, and keep renderer preload/IPC identifiers stable unless they are user-visible copy.

**Tech Stack:** Electron main process, TypeScript, Vitest, local HTTP API, MCP JSON-RPC, pnpm monorepo, shadcn/Radix renderer UI copy only.

---

## File Map

- Create `desktop/synapse-capabilities/shared/naming.ts`: canonical id validation and derivation helpers.
- Modify `desktop/synapse-capabilities/shared/types.ts`: manifest types based on `id` instead of hand-written action/tool/CLI names.
- Modify `desktop/database/shared/capability-registry.ts`: Database canonical ids and metadata.
- Modify `desktop/synapse-capabilities/shared/scheduler-domain.ts`: Scheduler canonical ids and generated tool names.
- Modify `desktop/synapse-capabilities/shared/registry.ts`: combine manifests and derive MCP/action/domain maps.
- Modify `desktop/database/shared/mcp-tools.ts`: rename Database MCP tools and parameter names.
- Modify `desktop/database/shared/mcp-rpc.ts`: normalize results by canonical action ids.
- Modify `desktop/electron/database/dispatcher.ts`: canonical action handlers, canonical params, public handler names.
- Modify `desktop/electron/database/service.ts`: rename public Database service methods used by external capability handlers.
- Modify `desktop/electron/database/ipc-handlers.ts`: call renamed service methods and use canonical IPC channel keys.
- Modify `desktop/electron/services/task-scheduler/external-capabilities.ts`: canonical Scheduler action switch and public adapter method names.
- Modify `desktop/electron/capabilities/action-router.ts`: route by canonical domain ids.
- Modify `desktop/database/cli/index.ts`: route `synapse database <resource> <action>` and keep `synapse status`.
- Modify `desktop/database/cli/scheduler.ts`: route `synapse scheduler task|run|runtime|action-type <action>`.
- Create `desktop/database/cli/database.ts`: focused parser for `synapse database <resource> <action>` commands.
- Create `docs/reference/capability-naming-matrix.md`: checked-in human-readable matrix.
- Do not add a user-local migration report script; the final product has no legacy alias surface.
- Update tests under `desktop/tests/unit/`, `desktop/electron/**/__tests__/`, and `desktop/electron/services/task-scheduler/__tests__/`.
- Update user-visible English copy in renderer/settings/diagnostics from `Database` to `Database`.

## Task 1: Canonical Naming Helpers

**Files:**
- Create: `desktop/synapse-capabilities/shared/naming.ts`
- Modify: `desktop/synapse-capabilities/shared/types.ts`
- Test: `desktop/tests/unit/capability-naming.test.ts`

- [ ] **Step 1: Write failing tests for canonical id validation and derivation**

Create `desktop/tests/unit/capability-naming.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  capabilityIdToCliCommand,
  capabilityIdToMcpTool,
  capabilityIdToServiceMethod,
  getCapabilityAction,
  getCapabilityDomain,
  isCanonicalCapabilityId,
} from "../../synapse-capabilities/shared/naming"

describe("capability naming", () => {
  it("validates canonical ids", () => {
    expect(isCanonicalCapabilityId("database.table.list")).toBe(true)
    expect(isCanonicalCapabilityId("scheduler.action_type.list")).toBe(true)
    expect(isCanonicalCapabilityId("database.table.fetch")).toBe(false)
    expect(isCanonicalCapabilityId("database.table.list")).toBe(false)
    expect(isCanonicalCapabilityId("database.Table.list")).toBe(false)
  })

  it("derives public names from canonical ids", () => {
    expect(capabilityIdToMcpTool("database.table.list")).toBe("database_table_list")
    expect(capabilityIdToCliCommand("database.choice_usage.get")).toBe("database choice-usage get")
    expect(capabilityIdToServiceMethod("scheduler.runtime.inspect")).toBe("schedulerRuntimeInspect")
  })

  it("extracts domain and action tokens", () => {
    expect(getCapabilityDomain("database.sql.execute")).toBe("database")
    expect(getCapabilityAction("database.sql.execute")).toBe("execute")
  })
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/capability-naming.test.ts
```

Expected: FAIL because `desktop/synapse-capabilities/shared/naming.ts` does not exist.

- [ ] **Step 3: Implement naming helpers**

Create `desktop/synapse-capabilities/shared/naming.ts`:

```ts
const CAPABILITY_ACTIONS = [
  "list",
  "get",
  "create",
  "update",
  "delete",
  "count",
  "rename",
  "describe",
  "inspect",
  "enable",
  "disable",
  "read",
  "execute",
] as const

export type CapabilityAction = typeof CAPABILITY_ACTIONS[number]
export type CapabilityId = `${string}.${string}.${CapabilityAction}`

const TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/

function splitCapabilityId(id: string): string[] {
  return id.split(".")
}

function isKnownAction(action: string): action is CapabilityAction {
  return CAPABILITY_ACTIONS.includes(action as CapabilityAction)
}

function toPascalToken(token: string): string {
  return token
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

function toKebabToken(token: string): string {
  return token.replaceAll("_", "-")
}

export function isCanonicalCapabilityId(id: string): id is CapabilityId {
  const parts = splitCapabilityId(id)
  if (parts.length < 3) return false
  if (!parts.every((part) => TOKEN_PATTERN.test(part))) return false
  return isKnownAction(parts[parts.length - 1])
}

export function assertCanonicalCapabilityId(id: string): asserts id is CapabilityId {
  if (!isCanonicalCapabilityId(id)) {
    throw new Error(`Invalid capability id: ${id}`)
  }
}

export function getCapabilityDomain(id: CapabilityId): string {
  return splitCapabilityId(id)[0]
}

export function getCapabilityAction(id: CapabilityId): CapabilityAction {
  const parts = splitCapabilityId(id)
  return parts[parts.length - 1] as CapabilityAction
}

export function capabilityIdToMcpTool(id: CapabilityId): string {
  return id.replaceAll(".", "_")
}

export function capabilityIdToCliCommand(id: CapabilityId): string {
  return splitCapabilityId(id).map(toKebabToken).join(" ")
}

export function capabilityIdToServiceMethod(id: CapabilityId): string {
  const pascal = splitCapabilityId(id).map(toPascalToken).join("")
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export { CAPABILITY_ACTIONS }
```

- [ ] **Step 4: Update shared types to use canonical ids**

Modify `desktop/synapse-capabilities/shared/types.ts`:

```ts
import type { CapabilityId } from "./naming"

export type SynapseActionSource = "api" | "cli" | "mcp-stdio" | "mcp-http"

export type DispatchContext = {
  readonly source?: SynapseActionSource
}

export type DispatchResult = {
  readonly ok: true
  readonly data?: unknown
  readonly affected?: number
  readonly total?: number
}

export type McpToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
  }
}

export type CapabilityDefinition = {
  readonly id: CapabilityId
  readonly title: string
  readonly description: string
  readonly mutates: boolean
  readonly risk?: "normal" | "high"
}

export type CapabilityDomainDefinition = {
  readonly id: string
  readonly capabilities: readonly CapabilityDefinition[]
}
```

- [ ] **Step 5: Run the naming test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/capability-naming.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add desktop/synapse-capabilities/shared/naming.ts desktop/synapse-capabilities/shared/types.ts desktop/tests/unit/capability-naming.test.ts
git commit -m "feat: add canonical capability naming helpers"
```

## Task 2: Canonical Capability Manifests

**Files:**
- Modify: `desktop/database/shared/capability-registry.ts`
- Modify: `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Test: `desktop/tests/unit/synapse-capabilities.test.ts`
- Test: `desktop/tests/unit/database-capability-parity.test.ts`

- [ ] **Step 1: Write failing manifest parity expectations**

Update `desktop/tests/unit/synapse-capabilities.test.ts` so it expects:

```ts
expect(DATABASE_DOMAIN.id).toBe("database")
expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.id)).toContain("database.table.list")
expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.id)).not.toContain("databaseTableList")

expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
  "scheduler.task.list",
  "scheduler.task.get",
  "scheduler.task.create",
  "scheduler.task.enable",
  "scheduler.task.disable",
  "scheduler.run.list",
  "scheduler.runtime.inspect",
  "scheduler.action_type.list",
  "scheduler.task.update",
])
expect(MCP_TOOL_ACTIONS.database_table_list).toBe("database.table.list")
expect(MCP_TOOL_ACTIONS.scheduler_run_list).toBe("scheduler.run.list")
expect(getActionDomainId("database.table.list")).toBe("database")
expect(getActionDomainId("scheduler.task.list")).toBe("scheduler")
```

Update `desktop/tests/unit/database-capability-parity.test.ts` so it compares dispatcher actions to manifest ids instead of legacy action names.

- [ ] **Step 2: Run manifest tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/synapse-capabilities.test.ts desktop/tests/unit/database-capability-parity.test.ts
```

Expected: FAIL because registries still expose legacy names.

- [ ] **Step 3: Replace Database capability registry entries**

In `desktop/database/shared/capability-registry.ts`, replace `DATABASE_CAPABILITIES` with `DATABASE_CAPABILITIES`:

```ts
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
] as const
```

Update imports in tests and registries to use `DATABASE_CAPABILITIES`. Do not keep `DATABASE_CAPABILITIES` as a compatibility alias.

- [ ] **Step 4: Generate MCP maps from canonical ids**

Use `capabilityIdToMcpTool` in `buildMcpToolActions()`:

```ts
function buildMcpToolActions(): Record<string, string> {
  return Object.fromEntries(
    DATABASE_CAPABILITIES.map((capability) => [
      capabilityIdToMcpTool(capability.id),
      capability.id,
    ]),
  )
}
```

Use `capabilityIdToCliCommand` in `getCliDataCommands()`:

```ts
function getCliDataCommands(): string[] {
  return DATABASE_CAPABILITIES.map((capability) => capabilityIdToCliCommand(capability.id))
}
```

- [ ] **Step 5: Replace Scheduler capability registry entries**

In `desktop/synapse-capabilities/shared/scheduler-domain.ts`, replace `schedulerCapabilities` with canonical ids in this order:

```ts
const schedulerCapabilities = [
  { id: "scheduler.task.list", title: "List tasks", description: "List scheduled tasks.", mutates: false },
  { id: "scheduler.task.get", title: "Get task", description: "Get one scheduled task.", mutates: false },
  { id: "scheduler.task.create", title: "Create task", description: "Create one scheduled task.", mutates: true },
  { id: "scheduler.task.enable", title: "Enable task", description: "Enable one scheduled task.", mutates: true },
  { id: "scheduler.task.disable", title: "Disable task", description: "Disable one scheduled task.", mutates: true },
  { id: "scheduler.run.list", title: "List runs", description: "List recent runs for one scheduled task.", mutates: false },
  { id: "scheduler.runtime.inspect", title: "Inspect runtime", description: "Inspect Scheduler runtime state.", mutates: false },
  { id: "scheduler.action_type.list", title: "List action types", description: "List task action types.", mutates: false },
  { id: "scheduler.task.update", title: "Update task", description: "Update safe scheduled task fields.", mutates: true },
] as const
```

Build `SCHEDULER_MCP_TOOL_ACTIONS` using `capabilityIdToMcpTool(capability.id)`.

- [ ] **Step 6: Update combined registry lookups**

In `desktop/synapse-capabilities/shared/registry.ts`, update lookups to read `capability.id`:

```ts
export function getActionDomainId(action: string): string | null {
  for (const domain of CAPABILITY_DOMAINS) {
    if (domain.capabilities.some((capability) => capability.id === action)) {
      return domain.id
    }
  }
  return null
}
```

- [ ] **Step 7: Run manifest tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/synapse-capabilities.test.ts desktop/tests/unit/database-capability-parity.test.ts
```

Expected: PASS after all imports and assertions use canonical ids.

- [ ] **Step 8: Commit Task 2**

```bash
git add desktop/database/shared/capability-registry.ts desktop/synapse-capabilities/shared/scheduler-domain.ts desktop/synapse-capabilities/shared/registry.ts desktop/tests/unit/synapse-capabilities.test.ts desktop/tests/unit/database-capability-parity.test.ts
git commit -m "feat: define canonical capability manifests"
```

## Task 3: Database MCP Tools And Dispatcher

**Files:**
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Modify: `desktop/electron/database/dispatcher.ts`
- Test: `desktop/tests/unit/database-mcp-tools.test.ts`
- Test: `desktop/tests/unit/database-mcp-rpc.test.ts`

- [ ] **Step 1: Write failing MCP tool tests for Database canonical names**

Update `desktop/tests/unit/database-mcp-tools.test.ts`:

```ts
expect(getTool("database_table_list").description).toContain("Use description to choose")
expect(getTool("database_table_describe").description).toContain("Call this before")
expect(getPropertyDescription("database_row_list", "tableName")).toContain("database_table_list")
expect(getTool("database_table_update").description).toContain("table description")
expect(getTool("database_choice_usage_get").description).toContain("choice")
expect(MCP_TOOL_ACTIONS.database_table_update).toBe("database.table.update")
expect(MCP_TOOL_ACTIONS.database_choice_usage_get).toBe("database.choice_usage.get")
expect(getTool("database_overview_get").description).toContain("Use this first")
expect(getTool("database_sql_read").description).toContain("Prefer this over database_sql_execute")
expect(getTool("database_sql_execute").description).toContain("Use only")
expect(getTool("database_log_list").description).toContain("recently changed")
```

Add negative expectations:

```ts
expect(buildTools().map((tool) => tool.name)).not.toContain("database_table_list")
expect(buildTools().map((tool) => tool.name)).not.toContain("database_log_list")
```

- [ ] **Step 2: Write failing MCP RPC result-shape tests**

Update `desktop/tests/unit/database-mcp-rpc.test.ts` to call:

```ts
await callTool("database_table_list", { ok: true, data: [{ name: "projects" }] })
await callTool("database_row_list", { ok: true, data: [{ id: 1 }], total: 1 })
await callTool("database_rows_update", { ok: true, data: { ids: [1, 3] }, affected: 2 })
```

Expected shapes remain:

```ts
[{ name: "projects" }]
{ rows: [{ id: 1 }], total: 1 }
{ affected: 2, ids: [1, 3] }
```

- [ ] **Step 3: Run MCP tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/database-mcp-tools.test.ts desktop/tests/unit/database-mcp-rpc.test.ts
```

Expected: FAIL because old tool names and result switch cases are still used.

- [ ] **Step 4: Rename Database MCP tool schemas**

In `desktop/database/shared/mcp-tools.ts`, rename each tool and public parameter:

```text
database_table_list -> database_table_list
database_table_create name -> database_table_create tableName
database_table_delete name -> database_table_delete tableName
database_table_describe name -> database_table_describe tableName
database_overview_get -> database_overview_get
database_table_update table -> database_table_update tableName
add_column table -> database_column_create tableName
update_column_description table/column -> database_column_update tableName/columnName
update_column_choices table/column -> database_choice_update tableName/columnName
get_column_choices_usage table/column -> database_choice_usage_get tableName/columnName
insert table -> database_row_create tableName
database_rows_create table -> database_rows_create tableName
query table -> database_row_list tableName
count table -> database_row_count tableName
update table/id -> database_row_update tableName/rowId
delete table/id -> database_row_delete tableName/rowId
database_rows_update table -> database_rows_update tableName
database_rows_delete table -> database_rows_delete tableName
database_log_list -> database_log_list
rename_table from/to -> database_table_rename fromTableName/toTableName
database_column_rename table/from/to -> database_column_rename tableName/fromColumnName/toColumnName
database_column_delete table/column -> database_column_delete tableName/columnName
database_sql_read -> database_sql_read
database_sql_execute -> database_sql_execute
```

Keep descriptions concise and agent-facing. Do not add UI-style explanation paragraphs.

- [ ] **Step 5: Update MCP result normalization**

In `desktop/database/shared/mcp-rpc.ts`, normalize by canonical tool/action names:

```ts
case "database.table.list":
case "database.table.describe":
case "database.overview.get":
case "database.row.create":
case "database.rows.create":
case "database.row.count":
case "database.log.list":
case "database.sql.read":
case "database.sql.execute":
case "database.choice_usage.get":
  return result.data

case "database.row.list":
  return {
    rows: Array.isArray(result.data) ? result.data : [],
    total: numberOrZero(result.total),
  }

case "database.row.update":
case "database.row.delete":
  return { affected: numberOrZero(result.affected) }

case "database.rows.update":
case "database.rows.delete":
  return {
    affected: numberOrZero(result.affected),
    ids: idsFromData(result.data),
    ...(isDryRun(result.data) ? { dryRun: true } : {}),
  }
```

Before the switch, convert the incoming MCP tool to canonical action:

```ts
const action = MCP_TOOL_ACTIONS[toolName] ?? toolName
```

Then call `normalizeToolResult(action, result)`.

- [ ] **Step 6: Rename Database dispatcher handlers and params**

In `desktop/electron/database/dispatcher.ts`, rename `ACTION_HANDLERS` keys to canonical ids and read canonical param names:

```ts
"database.table.list": () => ({ ok: true, data: databaseService.databaseTableList() }),
"database.table.create": (params) => {
  databaseService.databaseTableCreate(
    requireString(params, "tableName"),
    requireArray(params, "columns") as Column[],
    params.description as string | undefined,
  )
  return { ok: true }
},
"database.table.describe": (params) => ({
  ok: true,
  data: databaseService.databaseTableDescribe(requireString(params, "tableName")),
}),
"database.row.update": (params) => {
  const result = databaseService.databaseRowUpdate(
    requireString(params, "tableName"),
    requireNumber(params, "rowId"),
    requireObject(params, "data"),
  )
  return { ok: true, data: { id: params.rowId }, affected: result.affected }
},
```

Apply the same mapping from the spec for all Database capabilities.

Remove the legacy `params.table ?? params.name` fallback in `database.column.create`. This migration has no legacy API compatibility.

- [ ] **Step 7: Update mutation tracking helpers**

Update `MUTATING_ACTIONS` to canonical ids and update `extractTableName`:

```ts
function extractTableName(action: string, params: Record<string, unknown>): string | undefined {
  if (action === "database.table.rename") {
    return typeof params.toTableName === "string" ? params.toTableName : undefined
  }
  return typeof params.tableName === "string" ? params.tableName : undefined
}
```

- [ ] **Step 8: Run MCP and dispatcher-adjacent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/database-mcp-tools.test.ts desktop/tests/unit/database-mcp-rpc.test.ts desktop/tests/unit/database-capability-parity.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add desktop/database/shared/mcp-tools.ts desktop/database/shared/mcp-rpc.ts desktop/electron/database/dispatcher.ts desktop/tests/unit/database-mcp-tools.test.ts desktop/tests/unit/database-mcp-rpc.test.ts desktop/tests/unit/database-capability-parity.test.ts
git commit -m "feat: rename database mcp capabilities"
```

## Task 4: Public Database Service Method Names

**Files:**
- Modify: `desktop/electron/database/service.ts`
- Modify: `desktop/electron/database/ipc-handlers.ts`
- Modify: `desktop/electron/services/diagnostics-service.ts`
- Test: `desktop/electron/database/__tests__/service.test.ts`
- Test: `desktop/electron/services/__tests__/diagnostics-service.test.ts`

- [ ] **Step 1: Update service tests to canonical public method names**

In `desktop/electron/database/__tests__/service.test.ts`, replace public method calls:

```text
databaseTableList() -> databaseTableList()
getDatabaseOverview() -> databaseOverviewGet()
databaseTableCreate(...) -> databaseTableCreate(...)
databaseTableDelete(...) -> databaseTableDelete(...)
databaseTableDescribe(...) -> databaseTableDescribe(...)
databaseTableUpdate(...) -> databaseTableUpdate(...)
getColumnChoicesUsage(...) -> databaseChoiceUsageGet(...)
updateColumnChoices(...) -> databaseChoiceUpdate(...)
databaseSqlExecute(...) -> databaseSqlExecute(...)
databaseSqlRead(...) -> databaseSqlRead(...)
listOperationLog(...) -> databaseLogList(...)
```

Do not rename test descriptions unless the old wording is user-visible.

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/database/__tests__/service.test.ts
```

Expected: FAIL because methods are still legacy named.

- [ ] **Step 3: Rename public methods in `service.ts`**

Rename public methods in `desktop/electron/database/service.ts`:

```text
databaseTableList -> databaseTableList
getDatabaseOverview -> databaseOverviewGet
databaseTableCreate -> databaseTableCreate
databaseTableDelete -> databaseTableDelete
databaseTableDescribe -> databaseTableDescribe
databaseTableUpdate -> databaseTableUpdate
addColumn -> databaseColumnCreate
databaseColumnDelete -> databaseColumnDelete
renameTable -> databaseTableRename
databaseColumnRename -> databaseColumnRename
updateColumnDescription -> databaseColumnUpdate
updateColumnChoices -> databaseChoiceUpdate
getColumnChoicesUsage -> databaseChoiceUsageGet
insert -> databaseRowCreate
databaseRowsCreate -> databaseRowsCreate
query -> databaseRowList
count -> databaseRowCount
update -> databaseRowUpdate
delete -> databaseRowDelete
databaseRowsUpdate -> databaseRowsUpdate
databaseRowsDelete -> databaseRowsDelete
listOperationLog -> databaseLogList
databaseSqlRead -> databaseSqlRead
databaseSqlExecute -> databaseSqlExecute
```

Update internal calls inside `service.ts` too:

```ts
const tables = this.databaseTableList().map((table) => {
  const schema = this.databaseTableDescribe(table.name)
  return {
    ...table,
    columnCount: schema.columns.length,
  }
})
```

Keep private helper names unchanged unless TypeScript forces a local update.

- [ ] **Step 4: Update callers that use the service**

Update callsites in:

```text
desktop/electron/database/dispatcher.ts
desktop/electron/database/ipc-handlers.ts
desktop/electron/services/diagnostics-service.ts
desktop/electron/database/__tests__/service.test.ts
```

Example in `ipc-handlers.ts`:

```ts
handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableList, async () => {
  return databaseService.databaseTableList()
})
```

Rename `DATABASE_IPC_CHANNELS` keys and preload bridge methods to the same lower-camel names as the service methods.

- [ ] **Step 5: Run service and type checks for touched surface**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/database/__tests__/service.test.ts desktop/electron/services/__tests__/diagnostics-service.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: tests PASS and typecheck PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add desktop/electron/database/service.ts desktop/electron/database/dispatcher.ts desktop/electron/database/ipc-handlers.ts desktop/electron/services/diagnostics-service.ts desktop/electron/database/__tests__/service.test.ts desktop/electron/services/__tests__/diagnostics-service.test.ts
git commit -m "refactor: align database service method names"
```

## Task 5: Scheduler Canonical Actions And Tools

**Files:**
- Modify: `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- Modify: `desktop/electron/services/task-scheduler/external-capabilities.ts`
- Modify: `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`
- Test: `desktop/tests/unit/mcp-scheduler-tools.test.ts`
- Test: `desktop/tests/unit/cli-scheduler.test.ts`

- [ ] **Step 1: Update Scheduler tests to canonical actions and MCP tools**

In `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`, replace actions:

```text
schedulerTaskList -> scheduler.task.list
schedulerTaskGet -> scheduler.task.get
schedulerTaskCreate -> scheduler.task.create
schedulerTaskEnable -> scheduler.task.enable
schedulerTaskDisable -> scheduler.task.disable
schedulerTaskRunsList -> scheduler.run.list
schedulerTaskRuntimeStatus -> scheduler.runtime.inspect
schedulerActionTypesList -> scheduler.action_type.list
schedulerTaskUpdate -> scheduler.task.update
schedulerTaskDelete -> scheduler.task.delete
```

Expected hidden action test:

```ts
await expect(dispatchSchedulerAction(serviceMock(), actionRegistry(), "scheduler.task.delete", { taskId: "task:1" }))
  .rejects.toThrow(/Unknown scheduler action/)
```

In `desktop/tests/unit/mcp-scheduler-tools.test.ts`, replace tool expectations:

```text
scheduler_task_runs_list -> scheduler_run_list
scheduler_task_runtime_status -> scheduler_runtime_inspect
scheduler_action_types_list -> scheduler_action_type_list
```

- [ ] **Step 2: Run Scheduler tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/external-api.test.ts desktop/tests/unit/mcp-scheduler-tools.test.ts
```

Expected: FAIL because implementation still switches on legacy Scheduler actions.

- [ ] **Step 3: Update Scheduler external dispatcher switch**

In `desktop/electron/services/task-scheduler/external-capabilities.ts`, replace only the string labels for the existing switch cases and keep each case body unchanged:

```text
schedulerTaskList -> scheduler.task.list
schedulerTaskGet -> scheduler.task.get
schedulerTaskCreate -> scheduler.task.create
schedulerTaskEnable -> scheduler.task.enable
schedulerTaskDisable -> scheduler.task.disable
schedulerTaskRunsList -> scheduler.run.list
schedulerTaskRuntimeStatus -> scheduler.runtime.inspect
schedulerActionTypesList -> scheduler.action_type.list
schedulerTaskUpdate -> scheduler.task.update
```

Update the empty patch error text:

```ts
throw new Error("scheduler.task.update requires at least one field to update")
```

- [ ] **Step 4: Keep public adapter method names aligned where practical**

If an exported helper directly represents the external capability, rename it. For current code, `dispatchSchedulerAction` can remain as the generic dispatcher because it is not one capability method. Keep `toPublicTaskSummary` unchanged because it is a DTO conversion helper.

- [ ] **Step 5: Run Scheduler tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/external-api.test.ts desktop/tests/unit/mcp-scheduler-tools.test.ts desktop/tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add desktop/synapse-capabilities/shared/scheduler-domain.ts desktop/electron/services/task-scheduler/external-capabilities.ts desktop/electron/services/task-scheduler/__tests__/external-api.test.ts desktop/tests/unit/mcp-scheduler-tools.test.ts desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat: rename scheduler external capabilities"
```

## Task 6: HTTP Action Router And MCP Routing

**Files:**
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/database/mcp/index.ts`
- Modify: `desktop/electron/database/mcp-server.ts`
- Test: `desktop/tests/unit/mcp-scheduler-tools.test.ts`

- [ ] **Step 1: Update action router tests**

In `desktop/electron/capabilities/__tests__/action-router.test.ts`, assert canonical routes:

```ts
await expect(router.dispatch("database.table.list", {}, { source: "api" })).resolves.toEqual({
  ok: true,
  data: ["tables"],
})
expect(databaseDispatch).toHaveBeenCalledWith("database.table.list", {}, { source: "api" })

await expect(router.dispatch("scheduler.task.list", {}, { source: "api" })).resolves.toEqual({
  ok: true,
  data: [],
})
expect(schedulerDispatch).toHaveBeenCalledWith("scheduler.task.list", {}, { source: "api" })

await expect(router.dispatch("scheduler.run.list", { taskId: "task:1" }, { source: "api" }))
  .resolves.toEqual({ ok: true, data: [] })
expect(schedulerDispatch).toHaveBeenCalledWith("scheduler.run.list", { taskId: "task:1" }, { source: "api" })
```

Old action rejection:

```ts
await expect(router.dispatch("databaseTableList", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
await expect(router.dispatch("schedulerTaskList", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
```

- [ ] **Step 2: Run router tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/capabilities/__tests__/action-router.test.ts
```

Expected: FAIL until registries and dispatcher use canonical ids everywhere.

- [ ] **Step 3: Ensure MCP transport forwards canonical actions**

In `desktop/database/mcp/index.ts`, no behavior change is needed if `MCP_TOOL_ACTIONS` maps generated MCP tool names to canonical ids:

```ts
const action = MCP_TOOL_ACTIONS[toolName]
if (!action) throw new Error(`Unknown tool: ${toolName}`)
return await apiCall(getServerInfo(), action, args, "mcp-stdio")
```

Verify `desktop/electron/database/mcp-server.ts` uses the same mapping:

```ts
const action = MCP_TOOL_ACTIONS[toolName]
if (!action) throw new Error(`Unknown tool: ${toolName}`)
return actionRouter.dispatch(action, args, { source: "mcp-http" })
```

- [ ] **Step 4: Run routing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/capabilities/__tests__/action-router.test.ts desktop/tests/unit/mcp-scheduler-tools.test.ts desktop/tests/unit/database-mcp-rpc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts desktop/database/mcp/index.ts desktop/electron/database/mcp-server.ts desktop/tests/unit/mcp-scheduler-tools.test.ts desktop/tests/unit/database-mcp-rpc.test.ts
git commit -m "feat: route external api by canonical actions"
```

## Task 7: CLI Domain Resource Action Parser

**Files:**
- Create: `desktop/database/cli/database.ts`
- Modify: `desktop/database/cli/index.ts`
- Modify: `desktop/database/cli/scheduler.ts`
- Test: `desktop/tests/unit/cli-scheduler.test.ts`
- Test: create `desktop/tests/unit/cli-database.test.ts`

- [ ] **Step 1: Write failing Database CLI parser tests**

Create `desktop/tests/unit/cli-database.test.ts` with focused handler tests:

```ts
import { describe, expect, it, vi } from "vitest"
import { handleDatabaseCommand } from "../../database/cli/database"

describe("database cli commands", () => {
  it("routes table list and describe", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ name: "contacts" }] }))
    const print = vi.fn()

    await handleDatabaseCommand(["table", "list"], apiCall, print)
    await handleDatabaseCommand(["table", "describe", "contacts"], apiCall, print)

    expect(apiCall).toHaveBeenNthCalledWith(1, "database.table.list", {})
    expect(apiCall).toHaveBeenNthCalledWith(2, "database.table.describe", { tableName: "contacts" })
  })

  it("routes row update with canonical params", async () => {
    const apiCall = vi.fn(async () => ({ affected: 1 }))
    await handleDatabaseCommand([
      "row",
      "update",
      "contacts",
      "42",
      "--data",
      "{\"name\":\"Ada\"}",
    ], apiCall, () => {})

    expect(apiCall).toHaveBeenCalledWith("database.row.update", {
      tableName: "contacts",
      rowId: 42,
      data: { name: "Ada" },
    })
  })

  it("rejects old flat commands", async () => {
    await expect(handleDatabaseCommand(["tables"], vi.fn(), () => {})).rejects.toThrow(/Unknown database command/)
  })
})
```

- [ ] **Step 2: Update Scheduler CLI tests**

In `desktop/tests/unit/cli-scheduler.test.ts`, change command arrays:

```text
["task", "list"] -> scheduler.task.list
["task", "get", "task:1"] -> scheduler.task.get
["task", "create", "--data", "{\"name\":\"Daily\",\"scope\":{\"type\":\"global\"},\"schedule\":{\"type\":\"interval\",\"everyMinutes\":30},\"action\":{\"type\":\"builtin.command\",\"config\":{\"command\":\"date\"}}}"] -> scheduler.task.create
["task", "enable", "task:1"] -> scheduler.task.enable
["task", "disable", "task:1"] -> scheduler.task.disable
["run", "list", "task:1", "--limit", "5"] -> scheduler.run.list
["runtime", "inspect", "task:1"] -> scheduler.runtime.inspect
["action-type", "list"] -> scheduler.action_type.list
["task", "update", "task:1", "--data", "{\"name\":\"Updated\"}"] -> scheduler.task.update
```

Old commands `["list"]`, `["runs"]`, `["status"]`, and `["actions"]` should reject.

- [ ] **Step 3: Run CLI tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/cli-database.test.ts desktop/tests/unit/cli-scheduler.test.ts
```

Expected: FAIL because the new Database handler does not exist and Scheduler still uses old subcommands.

- [ ] **Step 4: Implement `handleDatabaseCommand`**

Create `desktop/database/cli/database.ts`. Implement commands using canonical actions and canonical params:

```ts
type CliApiCall = (action: string, params?: Record<string, unknown>) => Promise<unknown>
type PrintLine = (line: string) => void

export async function handleDatabaseCommand(
  args: string[],
  apiCall: CliApiCall,
  print: PrintLine = console.log,
): Promise<void> {
  const [resource, action, ...rest] = args
  const key = `${resource ?? ""}.${action ?? ""}`

  switch (key) {
    case "table.list": {
      const result = await apiCall("database.table.list", {}) as { data?: unknown }
      printJson(result.data ?? [], print)
      return
    }
    case "table.describe": {
      const tableName = requireArg(rest[0], "Usage: synapse database table describe <tableName>")
      const result = await apiCall("database.table.describe", { tableName }) as { data?: unknown }
      printJson(result.data ?? null, print)
      return
    }
    case "row.update": {
      const tableName = requireArg(rest[0], "Usage: synapse database row update <tableName> <rowId> --data '{\"name\":\"Ada\"}'")
      const rowId = parsePositiveInteger(rest[1], "rowId")
      const data = parseData(rest.slice(2), "Usage: synapse database row update <tableName> <rowId> --data '{\"name\":\"Ada\"}'")
      await apiCall("database.row.update", { tableName, rowId, data })
      print(`Row updated: ${rowId}`)
      return
    }
    default:
      throw new Error(`Unknown database command: ${args.join(" ")}\nRun "synapse help" for usage.`)
  }
}
```

Add all remaining mappings from the design table before running the full CLI test suite:

```text
table.create/delete/rename/update
column.create/delete/rename/update
choice.update
choice-usage.get
row.create/list/count/delete
rows.create/update/delete
overview.get
log.list
sql.read/execute
```

Use existing parse helpers from `index.ts` by moving shared helpers into this file or duplicating only small parsing helpers. Do not introduce a dependency.

- [ ] **Step 5: Update root CLI routing**

In `desktop/database/cli/index.ts`, route top-level `database` and `scheduler`:

```ts
if (command === "database") {
  await handleDatabaseCommand(args.slice(1), (action, params) => apiCall(info, action, params))
  return
}

if (command === "scheduler") {
  await handleSchedulerCommand(args.slice(1), (action, params) => apiCall(info, action, params))
  return
}
```

Keep `synapse status` as service health check.

Update help text so it only documents canonical paths:

```text
synapse database table list
synapse database row list <tableName> [--where k=v] [--where-json '{"field":"value"}'] [--limit N]
synapse scheduler task list [--enabled|--disabled] [--limit N]
synapse scheduler run list <taskId> [--limit N]
```

- [ ] **Step 6: Update Scheduler CLI parser**

In `desktop/database/cli/scheduler.ts`, parse `resource.action`:

```ts
const [resource, action, ...rest] = args
const key = `${resource ?? ""}.${action ?? ""}`
```

Map to canonical actions:

```ts
case "task.list": apiCall("scheduler.task.list", params)
case "task.get": apiCall("scheduler.task.get", { taskId })
case "task.create": apiCall("scheduler.task.create", data)
case "task.enable": apiCall("scheduler.task.enable", { taskId })
case "task.disable": apiCall("scheduler.task.disable", { taskId })
case "run.list": apiCall("scheduler.run.list", params)
case "runtime.inspect": apiCall("scheduler.runtime.inspect", params)
case "action-type.list": apiCall("scheduler.action_type.list", {})
case "task.update": apiCall("scheduler.task.update", { taskId, ...data })
```

- [ ] **Step 7: Run CLI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/cli-database.test.ts desktop/tests/unit/cli-scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add desktop/database/cli/index.ts desktop/database/cli/database.ts desktop/database/cli/scheduler.ts desktop/tests/unit/cli-database.test.ts desktop/tests/unit/cli-scheduler.test.ts
git commit -m "feat: add canonical database and scheduler cli commands"
```

## Task 8: UI Copy From Database To Database

**Files:**
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/components/database-settings-panel.tsx`
- Modify: `desktop/src/modules/settings/components/mcp-settings-panel.tsx`
- Modify: `desktop/electron/services/diagnostics-service.ts`
- Modify: `desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx`
- Modify: `desktop/electron/services/__tests__/diagnostics-service.test.ts`

- [ ] **Step 1: Write failing UI copy tests**

Update tests that assert English group labels:

```ts
expect(groups.get("Database")?.map((check) => check.id)).toEqual(["database.status"])
```

Update diagnostics fixture groups:

```ts
group: "Database"
```

- [ ] **Step 2: Run copy-related tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: FAIL because UI still emits `Database`.

- [ ] **Step 3: Replace user-visible English copy only**

Replace visible strings:

```text
旧资源名 -> Database
Synapse Database CLI -> Synapse Database CLI
Database mutations -> database mutations
```

Rename project-level identifiers as well:

```text
desktop/src/modules/database
DatabaseTableInfo
DATABASE_IPC_CHANNELS
synapse:database:*
data-track="database-*"
logger name "database.*"
```

Chinese copy such as `数据库` stays unchanged.

- [ ] **Step 4: Run UI copy tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx desktop/electron/services/__tests__/diagnostics-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add desktop/src/modules/settings/data.ts desktop/src/modules/settings/components/database-settings-panel.tsx desktop/src/modules/settings/components/mcp-settings-panel.tsx desktop/electron/services/diagnostics-service.ts desktop/src/modules/settings/components/__tests__/diagnostics-panel.test.tsx desktop/electron/services/__tests__/diagnostics-service.test.ts
git commit -m "refactor: rename visible database copy to database"
```

## Task 9: Naming Matrix And User-Local Migration Report

**Files:**
- Create: `docs/reference/capability-naming-matrix.md`
- Test: `desktop/tests/unit/capability-naming-matrix.test.ts`

- [ ] **Step 1: Write failing matrix parity test**

Create `desktop/tests/unit/capability-naming-matrix.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CAPABILITY_DOMAINS } from "../../synapse-capabilities/shared/registry"
import {
  capabilityIdToCliCommand,
  capabilityIdToMcpTool,
  capabilityIdToServiceMethod,
} from "../../synapse-capabilities/shared/naming"

describe("capability naming matrix", () => {
  it("documents every manifest capability", () => {
    const matrix = readFileSync(new URL("../../../docs/reference/capability-naming-matrix.md", import.meta.url), "utf-8")
    for (const domain of CAPABILITY_DOMAINS) {
      for (const capability of domain.capabilities) {
        expect(matrix).toContain(`| \`${capability.id}\` |`)
        expect(matrix).toContain(`\`${capabilityIdToMcpTool(capability.id)}\``)
        expect(matrix).toContain(`\`synapse ${capabilityIdToCliCommand(capability.id)}\``)
        expect(matrix).toContain(`\`${capabilityIdToServiceMethod(capability.id)}\``)
      }
    }
  })
})
```

- [ ] **Step 2: Run matrix test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/capability-naming-matrix.test.ts
```

Expected: FAIL because the matrix file does not exist.

- [ ] **Step 3: Create the naming matrix**

Create `docs/reference/capability-naming-matrix.md` with a table:

```markdown
# Capability Naming Matrix

| Canonical id | MCP tool | CLI command | API action | Service method | Mutates | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `database.table.list` | `database_table_list` | `synapse database table list` | `database.table.list` | `databaseTableList` | no | normal |
```

Populate all Database and Scheduler rows from `docs/superpowers/specs/2026-05-03-capability-naming-unification-design.md`.

- [ ] **Step 4: Create user-local migration report script**

Do not create a user-local migration report script:

```js
#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const replacements = new Map([
  ["database_table_list", "database_table_list"],
  ["database_log_list", "database_log_list"],
  ["scheduler_task_runs_list", "scheduler_run_list"],
  ["scheduler_task_runtime_status", "scheduler_runtime_inspect"],
  ["scheduler_action_types_list", "scheduler_action_type_list"],
  ["databaseTableList", "database.table.list"],
  ["databaseLogList", "database.log.list"],
  ["schedulerTaskRunsList", "scheduler.run.list"],
  ["synapse database table list", "synapse database table list"],
  ["synapse database log list", "synapse database log list"],
  ["synapse scheduler run list", "synapse scheduler run list"],
])

const roots = [
  path.join(homedir(), ".codex"),
  path.join(homedir(), ".agents"),
  path.join(homedir(), ".cursor"),
  path.join(homedir(), ".claude"),
  path.join(homedir(), "Library", "Application Support", "Synapse"),
].filter(existsSync)

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    let stats
    try {
      stats = statSync(fullPath)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue
      walk(fullPath, files)
    } else if (stats.isFile() && stats.size <= 1024 * 1024) {
      files.push(fullPath)
    }
  }
  return files
}

const matches = []
for (const root of roots) {
  for (const filePath of walk(root)) {
    let text
    try {
      text = readFileSync(filePath, "utf-8")
    } catch {
      continue
    }
    for (const [from, to] of replacements) {
      if (text.includes(from)) {
        matches.push({ filePath, from, to })
      }
    }
  }
}

if (matches.length === 0) {
  console.log("No local capability name references found.")
} else {
  for (const match of matches) {
    console.log(`${match.filePath}: ${match.from} -> ${match.to}`)
  }
}
```

This script only reports. It must not edit local user files.

- [ ] **Step 5: Run matrix test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/tests/unit/capability-naming-matrix.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 9**

```bash
git add docs/reference/capability-naming-matrix.md desktop/tests/unit/capability-naming-matrix.test.ts
git commit -m "docs: add capability naming matrix"
```

## Task 10: Old Name Cleanup And Full Verification

**Files:**
- Modify tests/docs touched by failing references.
- Do not edit already committed historical spec files unless they are active user-facing docs for the current feature.

- [ ] **Step 1: Scan for old external names in active code and tests**

Run:

```bash
rg -n "database_table_list|database_log_list|scheduler_task_runs_list|schedulerTaskRunsList|schedulerTaskRuntimeStatus|schedulerActionTypesList|schedulerTaskUpdate|databaseTableList|databaseLogList|synapse database table list|synapse database log list|synapse scheduler run list|Database" desktop/database desktop/electron desktop/src desktop/tests docs/reference AGENTS.md README.md
```

Expected after cleanup:

- No old MCP/API/CLI names in active code except negative tests or migration report replacements.
- No user-visible `Database` copy in renderer/electron diagnostics except negative documentation or migration-report strings.
- Internal identifiers such as `database` paths, `Database` types, IPC channels, and tracking ids may remain.

- [ ] **Step 2: Update active docs and generated copy formats**

Update references in active docs and copy helpers:

```text
AGENTS.md shortcut wording: "Database, table, column, row, SQL, or data CRUD requests use Database tools."
desktop/src/modules/database/components/schema-copy-formats.ts MCP snippets
desktop/database/cli/index.ts help text
README.md only if it documents current Database/CLI/MCP names
```

Do not rewrite historical superpowers specs from prior dates. They document past decisions.

- [ ] **Step 3: Run targeted test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/tests/unit/capability-naming.test.ts \
  desktop/tests/unit/capability-naming-matrix.test.ts \
  desktop/tests/unit/synapse-capabilities.test.ts \
  desktop/tests/unit/database-capability-parity.test.ts \
  desktop/tests/unit/database-mcp-tools.test.ts \
  desktop/tests/unit/database-mcp-rpc.test.ts \
  desktop/tests/unit/mcp-scheduler-tools.test.ts \
  desktop/tests/unit/cli-database.test.ts \
  desktop/tests/unit/cli-scheduler.test.ts \
  desktop/electron/capabilities/__tests__/action-router.test.ts \
  desktop/electron/database/__tests__/service.test.ts \
  desktop/electron/services/task-scheduler/__tests__/external-api.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Expected: all commands PASS.

- [ ] **Step 5: Run user-local migration report**

Run:

```bash
node
```

Expected: prints either no local references or a report of local files with suggested replacements. Do not edit those local files automatically.

- [ ] **Step 6: Commit final cleanup**

```bash
git add .
git commit -m "test: enforce canonical capability names"
```

## Handoff Notes

- Do not start a dev server or browser preview for this task.
- This migration is project-wide: renderer, preload, Electron, CLI/MCP bundles, scripts, tests, docs, and tracking ids should all use `database`.
- Old API/MCP/CLI names should fail, not warn.
- When a test fails because it encodes old names, update the test only if the new behavior is covered by the spec.
