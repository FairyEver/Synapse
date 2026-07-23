# Database Agent Capabilities Implementation Plan

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Synapse Database as a self-use Agent database by adding parity tests, global database inspection, operation history, dry-run previews, a lightweight capability registry, and a safer read-first SQL path without removing current raw SQL power.

**Architecture:** Keep `desktop/electron/database/service.ts` and `desktop/electron/database/dispatcher.ts` as the canonical execution path. Keep MCP schemas stateless; add tools that help Agents discover current runtime state by calling tools rather than by dynamic MCP schema mutation. Add a small shared capability registry for parity checks and command/tool mapping, not a large framework rewrite.

**Tech Stack:** Electron main process, Node.js, TypeScript, `node:sqlite`, Vitest, bundled Node CLI/MCP via esbuild.

---

## Current Context

The current Database chain is:

```text
DatabaseService
  -> dispatchDatabaseAction
    -> HTTP API
    -> HTTP MCP
    -> stdio MCP bridge
    -> CLI via HTTP API
```

Current counts verified before this plan:

```text
Dispatcher actions: 21
MCP tools: 21
CLI commands: 21 total, 20 data commands plus status
Known gap count between dispatcher and MCP: 0
```

Security hardening is not the main priority for the current self-use product stage. Keep full-power `database_sql_execute`, but add better guidance and safer first-choice tools for Agents.

---

## File Structure

Create:

- `desktop/database/shared/capability-registry.ts`  
  Lightweight registry of action names, MCP tool names, and CLI commands.

- `desktop/tests/unit/database-capability-parity.test.ts`  
  Automated parity test for Dispatcher, MCP map, CLI command coverage, and registry coverage.

- `desktop/tests/unit/database-overview.test.ts`  
  Service-level test for database overview shape.

- `desktop/tests/unit/database-sql-read.test.ts`  
  Service-level test for read-only SQL behavior.

- `desktop/tests/unit/database-dry-run.test.ts`  
  Service-level test for update/delete dry-run behavior.

- `desktop/tests/unit/database-log-list.test.ts`  
  Dispatcher/service test for mutation logging.

Modify:

- `desktop/database/shared/mcp-tools.ts`  
  Add `database_overview_get`, `database_sql_read`, `database_log_list`; use registry for `MCP_TOOL_ACTIONS`.

- `desktop/database/shared/mcp-rpc.ts`  
  Normalize result shapes for new MCP tools.

- `desktop/database/shared/resolve-user-data.ts`  
  Add optional client source header support for CLI and stdio MCP.

- `desktop/database/mcp/index.ts`  
  Pass source `"mcp-stdio"` to API calls.

- `desktop/database/cli/index.ts`  
  Add `database overview get`, `database sql read`, `database log list`, `--dry-run`; use registry for known data commands where practical.

- `desktop/electron/database/types.ts`  
  Add overview, operation log, and dry-run result types.

- `desktop/electron/database/service.ts`  
  Add overview, read SQL, dry-run support, operation log storage.

- `desktop/electron/database/dispatcher.ts`  
  Add actions, source context, operation logging.

- `desktop/electron/database/http-server.ts`  
  Pass source context from `X-Synapse-Client`.

- `desktop/electron/database/mcp-server.ts`  
  Pass source context `"mcp-http"`.

Optional renderer/API type follow-up:

- `desktop/src/types/database.ts`
- `desktop/src/types/bridge.ts`
- `desktop/electron/database/ipc-handlers.ts`
- `desktop/electron/preload.ts`

Add renderer IPC only if the UI needs these new features immediately. The requested scope is Agent/CLI/MCP first.

---

### Task 1: Add Capability Registry And Parity Test

**Files:**

- Create: `desktop/database/shared/capability-registry.ts`
- Create: `desktop/tests/unit/database-capability-parity.test.ts`
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/cli/index.ts`

- [ ] **Step 1: Create the shared registry**

Create `desktop/database/shared/capability-registry.ts`:

```ts
type DatabaseCapability = {
  action: string
  mcpTool?: string
  cliCommand?: string
  mutates: boolean
}

const DATABASE_CAPABILITIES = [
  { action: "databaseTableList", mcpTool: "database_table_list", cliCommand: "database table list", mutates: false },
  { action: "databaseTableCreate", mcpTool: "database_table_create", cliCommand: "database table create", mutates: true },
  { action: "databaseTableDelete", mcpTool: "database_table_delete", cliCommand: "database table delete", mutates: true },
  { action: "databaseTableDescribe", mcpTool: "database_table_describe", cliCommand: "database table describe", mutates: false },
  { action: "databaseTableUpdate", mcpTool: "database_table_update", cliCommand: "database table update", mutates: true },
  { action: "databaseColumnCreate", mcpTool: "database_column_create", cliCommand: "database column create", mutates: true },
  { action: "databaseColumnUpdate", mcpTool: "database_column_update", cliCommand: "database column update", mutates: true },
  { action: "databaseChoiceUpdate", mcpTool: "database_choice_update", cliCommand: "database choice update", mutates: true },
  { action: "databaseChoiceUsageGet", mcpTool: "database_choice_usage_get", cliCommand: "database choice-usage get", mutates: false },
  { action: "databaseRowCreate", mcpTool: "database_row_create", cliCommand: "database row create", mutates: true },
  { action: "databaseRowsCreate", mcpTool: "database_rows_create", cliCommand: "database rows create", mutates: true },
  { action: "databaseRowList", mcpTool: "database_row_list", cliCommand: "database row list", mutates: false },
  { action: "databaseRowUpdate", mcpTool: "database_row_update", cliCommand: "database row update", mutates: true },
  { action: "databaseRowDelete", mcpTool: "database_row_delete", cliCommand: "database row delete", mutates: true },
  { action: "databaseRowsUpdate", mcpTool: "database_rows_update", cliCommand: "database rows update", mutates: true },
  { action: "databaseRowsDelete", mcpTool: "database_rows_delete", cliCommand: "database rows delete", mutates: true },
  { action: "databaseRowCount", mcpTool: "database_row_count", cliCommand: "database row count", mutates: false },
  { action: "databaseTableRename", mcpTool: "database_table_rename", cliCommand: "database table rename", mutates: true },
  { action: "databaseColumnRename", mcpTool: "database_column_rename", cliCommand: "database column rename", mutates: true },
  { action: "databaseColumnDelete", mcpTool: "database_column_delete", cliCommand: "database column delete", mutates: true },
  { action: "databaseSqlExecute", mcpTool: "database_sql_execute", cliCommand: "database sql execute", mutates: true },
] as const satisfies readonly DatabaseCapability[]

function buildMcpToolActions(): Record<string, string> {
  return Object.fromEntries(
    DATABASE_CAPABILITIES
      .filter((capability) => capability.mcpTool)
      .map((capability) => [capability.mcpTool, capability.action]),
  )
}

function getCliDataCommands(): string[] {
  return Array.from(new Set(
    DATABASE_CAPABILITIES
      .filter((capability) => capability.cliCommand)
      .map((capability) => capability.cliCommand as string),
  ))
}

function getMutatingActions(): string[] {
  return DATABASE_CAPABILITIES
    .filter((capability) => capability.mutates)
    .map((capability) => capability.action)
}

export {
  DATABASE_CAPABILITIES,
  buildMcpToolActions,
  getCliDataCommands,
  getMutatingActions,
}
export type { DatabaseCapability }
```

- [ ] **Step 2: Use registry for MCP action map**

In `desktop/database/shared/mcp-tools.ts`, add:

```ts
import { buildMcpToolActions } from "./capability-registry"
```

Replace the manual `MCP_TOOL_ACTIONS` object with:

```ts
const MCP_TOOL_ACTIONS: Record<string, string> = buildMcpToolActions()
```

- [ ] **Step 3: Use registry for CLI known data commands**

In `desktop/database/cli/index.ts`, add:

```ts
import { getCliDataCommands } from "../shared/capability-registry"
```

Replace the manual `KNOWN_COMMANDS` set with:

```ts
const KNOWN_COMMANDS = new Set([...getCliDataCommands(), "status"])
```

- [ ] **Step 4: Write the parity test**

Create `desktop/tests/unit/database-capability-parity.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DATABASE_CAPABILITIES, getCliDataCommands } from "../../database/shared/capability-registry"
import { MCP_TOOL_ACTIONS, buildTools } from "../../database/shared/mcp-tools"

function extractDispatcherActions(): string[] {
  const source = readFileSync(new URL("../../electron/database/dispatcher.ts", import.meta.url), "utf-8")
  const body = source.match(/const ACTION_HANDLERS:[\s\S]*?= \{([\s\S]*?)\n\}/)?.[1]
  if (!body) throw new Error("ACTION_HANDLERS not found")
  return [...body.matchAll(/\n\s{2}([A-Za-z0-9_]+):/g)].map((match) => match[1]).sort()
}

describe("Database capability parity", () => {
  it("keeps dispatcher actions registered in the shared capability registry", () => {
    const registryActions = DATABASE_CAPABILITIES.map((capability) => capability.action).sort()
    expect(registryActions).toEqual(extractDispatcherActions())
  })

  it("keeps MCP tools mapped to registered actions", () => {
    const toolNames = buildTools().map((tool) => tool.name).sort()
    const mappedToolNames = Object.keys(MCP_TOOL_ACTIONS).sort()
    const mappedActions = Object.values(MCP_TOOL_ACTIONS).sort()
    const registryActions = DATABASE_CAPABILITIES.map((capability) => capability.action).sort()

    expect(mappedToolNames).toEqual(toolNames)
    expect(mappedActions).toEqual(registryActions)
  })

  it("keeps CLI data commands registered", () => {
    expect(getCliDataCommands().sort()).toEqual([
      "add-column",
      "choice-usage",
      "count",
      "create",
      "delete",
      "delete-where",
      "describe",
      "drop",
      "drop-column",
      "insert",
      "query",
      "rename-column",
      "rename-table",
      "sql",
      "tables",
      "update",
      "update-column-choices",
      "update-column-description",
      "update-table-description",
      "update-where",
    ])
  })
})
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-capability-parity.test.ts tests/unit/database-mcp-tools.test.ts
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 6: Commit**

```bash
git add desktop/database/shared/capability-registry.ts desktop/database/shared/mcp-tools.ts desktop/database/cli/index.ts desktop/tests/unit/database-capability-parity.test.ts
git commit -m "test: add database capability parity checks"
```

---

### Task 2: Add Database Overview For Agents

**Files:**

- Modify: `desktop/electron/database/types.ts`
- Modify: `desktop/electron/database/service.ts`
- Modify: `desktop/electron/database/dispatcher.ts`
- Modify: `desktop/database/shared/capability-registry.ts`
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Modify: `desktop/database/cli/index.ts`
- Create: `desktop/tests/unit/database-overview.test.ts`

- [ ] **Step 1: Add overview types**

In `desktop/electron/database/types.ts`, add:

```ts
type DatabaseOverviewColumn = {
  name: string
  kind: ColumnKind
  description: string
  choices?: string[]
  system?: true
}

type DatabaseOverviewTable = {
  name: string
  description: string
  rowCount: number
  columns: DatabaseOverviewColumn[]
}

type DatabaseOverview = {
  tableCount: number
  tables: DatabaseOverviewTable[]
}
```

Export those types from the existing `export type { ... }` block.

- [ ] **Step 2: Write the failing service test**

Create `desktop/tests/unit/database-overview.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({ app: { getPath: vi.fn() } }))
vi.mock("electron", () => electronMock)
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

let tempDir = ""
let service: typeof import("../../electron/database/service").databaseService

describe("DatabaseService overview", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/database/service")
    service = module.databaseService
    service.open()
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("summarizes tables, descriptions, row counts, and columns", () => {
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text", description: "Task title" },
      { name: "priority", kind: "single_choice", choices: ["high", "low"], description: "Priority" },
    ], "Task tracker")
    service.insert("tasks", { title: "Ship", priority: "high" })

    expect(service.getDatabaseOverview()).toEqual({
      tableCount: 1,
      tables: [
        expect.objectContaining({
          name: "tasks",
          description: "Task tracker",
          rowCount: 1,
          columns: expect.arrayContaining([
            expect.objectContaining({ name: "title", kind: "text", description: "Task title" }),
            expect.objectContaining({ name: "priority", kind: "single_choice", choices: ["high", "low"] }),
          ]),
        }),
      ],
    })
  })
})
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-overview.test.ts
```

Expected:

```text
FAIL ... service.getDatabaseOverview is not a function
```

- [ ] **Step 4: Implement service overview**

In `desktop/electron/database/service.ts`, import the new type:

```ts
import type { DatabaseOverview } from "./types"
```

Add this method inside `DatabaseService`:

```ts
getDatabaseOverview(): DatabaseOverview {
  const tables = this.databaseTableList().map((table) => {
    const schema = this.databaseTableDescribe(table.name)
    return {
      name: schema.name,
      description: schema.description,
      rowCount: schema.rowCount,
      columns: schema.columns.map((column) => {
        const item = {
          name: column.name,
          kind: column.kind,
          description: column.description ?? "",
          ...(column.choices ? { choices: column.choices } : {}),
          ...(column.system ? { system: true as const } : {}),
        }
        return item
      }),
    }
  })

  return { tableCount: tables.length, tables }
}
```

- [ ] **Step 5: Add dispatcher action**

In `desktop/electron/database/dispatcher.ts`, add to `ACTION_HANDLERS`:

```ts
databaseOverviewGet: () => ({
  ok: true,
  data: databaseService.getDatabaseOverview(),
}),
```

- [ ] **Step 6: Register MCP and CLI capability**

Append to `DATABASE_CAPABILITIES` in `desktop/database/shared/capability-registry.ts`:

```ts
{ action: "databaseOverviewGet", mcpTool: "database_overview_get", cliCommand: "overview", mutates: false },
```

In `desktop/database/shared/mcp-tools.ts`, add a tool:

```ts
{
  name: "database_overview_get",
  description: "Return an overview of all user tables, table descriptions, row counts, and column summaries. Use this first when the user asks broadly about available data.",
  inputSchema: { type: "object", properties: {} },
},
```

In `desktop/database/shared/mcp-rpc.ts`, add `database_overview_get` to the `result.data` return group:

```ts
case "database_overview_get":
  return result.data
```

- [ ] **Step 7: Add CLI overview command**

In `desktop/database/cli/index.ts`, add a usage line:

```text
  synapse database overview get                                   Show all tables and column summaries
```

Add a switch case:

```ts
case "overview": {
  const result = await apiCall(info, "databaseOverviewGet") as {
    data: { tables: Array<{ name: string; description: string; rowCount: number; columns: Array<{ name: string; kind: string; description: string }> }> }
  }
  const rows = result.data.tables.map((table) => ({
    name: table.name,
    description: table.description,
    rowCount: table.rowCount,
    columns: table.columns.map((column) => `${column.name}:${column.kind}`).join(", "),
  }))
  printTable(rows)
  break
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-overview.test.ts tests/unit/database-capability-parity.test.ts tests/unit/database-mcp-tools.test.ts
pnpm --filter @synapse/desktop run build:database
```

Expected:

```text
Test Files  3 passed
build:database exits 0
```

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/database/types.ts desktop/electron/database/service.ts desktop/electron/database/dispatcher.ts desktop/database/shared/capability-registry.ts desktop/database/shared/mcp-tools.ts desktop/database/shared/mcp-rpc.ts desktop/database/cli/index.ts desktop/tests/unit/database-overview.test.ts
git commit -m "feat: add database overview for agents"
```

---

### Task 3: Add Read-Only SQL Tool

**Files:**

- Modify: `desktop/electron/database/service.ts`
- Modify: `desktop/electron/database/dispatcher.ts`
- Modify: `desktop/database/shared/capability-registry.ts`
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Modify: `desktop/database/cli/index.ts`
- Create: `desktop/tests/unit/database-sql-read.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `desktop/tests/unit/database-sql-read.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({ app: { getPath: vi.fn() } }))
vi.mock("electron", () => electronMock)
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

let tempDir = ""
let service: typeof import("../../electron/database/service").databaseService

describe("DatabaseService databaseSqlRead", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/database/service")
    service = module.databaseService
    service.open()
    service.databaseTableCreate("tasks", [{ name: "title", kind: "text" }])
    service.insert("tasks", { title: "Ship" })
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("allows SELECT statements with bind params", () => {
    expect(service.databaseSqlRead("SELECT title FROM tasks WHERE title = ?", ["Ship"])).toEqual({
      rows: [{ title: "Ship" }],
    })
  })

  it("rejects write statements", () => {
    expect(() => service.databaseSqlRead("DELETE FROM tasks")).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-sql-read.test.ts
```

Expected:

```text
FAIL ... service.databaseSqlRead is not a function
```

- [ ] **Step 3: Implement `databaseSqlRead`**

In `desktop/electron/database/service.ts`, add:

```ts
databaseSqlRead(sql: string, params?: unknown[]): { rows: Record<string, unknown>[] } {
  const normalized = sql.trim().toLowerCase()
  if (!/^(select|pragma|explain)\b/.test(normalized)) {
    throw new Error("databaseSqlRead is read-only. Use databaseSqlExecute when you explicitly need to write.")
  }
  if (/\b(attach|detach)\b/i.test(normalized)) {
    throw new Error("ATTACH and DETACH statements are not allowed")
  }

  const db = this.getDb()
  const sqlParams = (params ?? []).map(toSqlValue)
  const rows = db.prepare(sql).all(...sqlParams) as Record<string, unknown>[]
  return { rows }
}
```

- [ ] **Step 4: Add dispatcher, MCP, and CLI**

In `desktop/electron/database/dispatcher.ts`, add:

```ts
databaseSqlRead: (params) => ({
  ok: true,
  data: databaseService.databaseSqlRead(
    requireString(params, "sql"),
    params.params as unknown[] | undefined,
  ),
}),
```

Append to `DATABASE_CAPABILITIES`:

```ts
{ action: "databaseSqlRead", mcpTool: "database_sql_read", cliCommand: "database sql read", mutates: false },
```

Add MCP tool:

```ts
{
  name: "database_sql_read",
  description: "Execute a read-only SQL statement with optional positional bind params. Allows SELECT, PRAGMA, and EXPLAIN. Prefer this over database_sql_execute for inspection and reporting.",
  inputSchema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "Read-only SQL statement" },
      params: {
        type: "array",
        items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] },
        description: "Optional positional bind parameters",
      },
    },
    required: ["sql"],
  },
},
```

Add `database_sql_read` to the `result.data` group in `mcp-rpc.ts`.

Add CLI command:

```ts
case "sql.read": {
  const sql = args[1]
  if (!sql) { console.error("Usage: synapse database sql read '<SQL>' [--params '[...]']"); process.exit(1) }
  const params = parseJsonFlag(args, "--params")
  if (params !== undefined && !Array.isArray(params)) {
    console.error("Invalid --params value: expected a JSON array")
    process.exit(1)
  }
  const result = await apiCall(info, "databaseSqlRead", { sql, params }) as { data: { rows: unknown[] } }
  printTable(result.data.rows as Record<string, unknown>[])
  break
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-sql-read.test.ts tests/unit/database-capability-parity.test.ts tests/unit/database-mcp-tools.test.ts
pnpm --filter @synapse/desktop run build:database
```

Expected:

```text
Test Files  3 passed
build:database exits 0
```

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/database/service.ts desktop/electron/database/dispatcher.ts desktop/database/shared/capability-registry.ts desktop/database/shared/mcp-tools.ts desktop/database/shared/mcp-rpc.ts desktop/database/cli/index.ts desktop/tests/unit/database-sql-read.test.ts
git commit -m "feat: add read-only sql database tool"
```

---

### Task 4: Add Dry-Run Preview For Bulk Updates And Deletes

**Files:**

- Modify: `desktop/electron/database/types.ts`
- Modify: `desktop/electron/database/service.ts`
- Modify: `desktop/electron/database/dispatcher.ts`
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/cli/index.ts`
- Create: `desktop/tests/unit/database-dry-run.test.ts`

- [ ] **Step 1: Add dry-run result type**

In `desktop/electron/database/types.ts`, add:

```ts
type DatabaseBulkMutationResult = {
  affected: number
  ids: number[]
  dryRun?: true
}
```

Export it.

- [ ] **Step 2: Write failing service tests**

Create `desktop/tests/unit/database-dry-run.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({ app: { getPath: vi.fn() } }))
vi.mock("electron", () => electronMock)
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

let tempDir = ""
let service: typeof import("../../electron/database/service").databaseService

describe("DatabaseService bulk dry run", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/database/service")
    service = module.databaseService
    service.open()
    service.databaseTableCreate("tasks", [
      { name: "title", kind: "text" },
      { name: "done", kind: "boolean" },
    ])
    service.databaseRowsCreate("tasks", [
      { title: "A", done: false },
      { title: "B", done: false },
    ])
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("previews databaseRowsUpdate without changing rows", () => {
    const preview = service.databaseRowsUpdate("tasks", { done: false }, { done: true }, { dryRun: true })
    expect(preview).toEqual({ affected: 2, ids: [1, 2], dryRun: true })
    expect(service.count("tasks", { done: true })).toEqual({ count: 0 })
  })

  it("previews databaseRowsDelete without deleting rows", () => {
    const preview = service.databaseRowsDelete("tasks", { done: false }, { dryRun: true })
    expect(preview).toEqual({ affected: 2, ids: [1, 2], dryRun: true })
    expect(service.count("tasks")).toEqual({ count: 2 })
  })
})
```

- [ ] **Step 3: Run and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-dry-run.test.ts
```

Expected:

```text
FAIL ... Expected 3 arguments, but got 4
```

- [ ] **Step 4: Implement dry-run options**

In `desktop/electron/database/service.ts`, add a local type:

```ts
type BulkMutationOptions = { dryRun?: boolean }
```

Change signatures:

```ts
databaseRowsUpdate(table: string, where: DatabaseWhereClause, data: Record<string, unknown>, options: BulkMutationOptions = {}): { affected: number; ids: number[]; dryRun?: true }
databaseRowsDelete(table: string, where: DatabaseWhereClause, options: BulkMutationOptions = {}): { affected: number; ids: number[]; dryRun?: true }
```

Inside both methods, after computing `ids` and before `UPDATE` or `DELETE`, add:

```ts
if (options.dryRun) {
  db.exec("COMMIT")
  return { affected: ids.length, ids, dryRun: true }
}
```

- [ ] **Step 5: Thread dryRun through dispatcher, MCP, and CLI**

In `dispatcher.ts`, pass options:

```ts
const dryRun = params.dryRun === true
```

Use:

```ts
databaseService.databaseRowsUpdate(..., { dryRun })
databaseService.databaseRowsDelete(..., { dryRun })
```

In `mcp-tools.ts`, add this property to `database_rows_update` and `database_rows_delete` schemas:

```ts
dryRun: {
  type: "boolean",
  description: "When true, return affected ids without modifying rows.",
},
```

In `cli/index.ts`, pass `dryRun`:

```ts
const dryRun = args.includes("--dry-run")
```

For `update-where`, call:

```ts
await apiCall(info, "databaseRowsUpdate", { table, where, data, dryRun })
```

For `delete-where`, call:

```ts
await apiCall(info, "databaseRowsDelete", { table, where, dryRun })
```

Print dry-run wording:

```ts
console.log(`${result.affected} rows ${dryRun ? "matched" : "updated"}.`)
console.log(`${result.affected} rows ${dryRun ? "matched" : "deleted"}.`)
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-dry-run.test.ts
pnpm --filter @synapse/desktop run build:database
```

Expected:

```text
Test Files  1 passed
build:database exits 0
```

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/database/types.ts desktop/electron/database/service.ts desktop/electron/database/dispatcher.ts desktop/database/shared/mcp-tools.ts desktop/database/cli/index.ts desktop/tests/unit/database-dry-run.test.ts
git commit -m "feat: add dry-run preview for database bulk mutations"
```

---

### Task 5: Add Operation Log For Agent Actions

**Files:**

- Modify: `desktop/electron/database/types.ts`
- Modify: `desktop/electron/database/service.ts`
- Modify: `desktop/electron/database/dispatcher.ts`
- Modify: `desktop/electron/database/http-server.ts`
- Modify: `desktop/electron/database/mcp-server.ts`
- Modify: `desktop/database/shared/resolve-user-data.ts`
- Modify: `desktop/database/mcp/index.ts`
- Modify: `desktop/database/shared/capability-registry.ts`
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Modify: `desktop/database/cli/index.ts`
- Create: `desktop/tests/unit/database-log-list.test.ts`

- [ ] **Step 1: Add operation log types**

In `desktop/electron/database/types.ts`, add:

```ts
type DatabaseOperationSource = "api" | "cli" | "mcp-stdio" | "mcp-http"

type DatabaseOperationLogEntry = {
  id: number
  source: DatabaseOperationSource
  action: string
  table: string | null
  affected: number | null
  dryRun: boolean
  createdAt: string
}
```

Export them.

- [ ] **Step 2: Add system table creation**

In `DatabaseService.ensureMetaTables()`, add:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS "_operation_log" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "table_name" TEXT,
    "affected" INTEGER,
    "dry_run" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL
  )
`)
```

- [ ] **Step 3: Add service methods**

In `desktop/electron/database/service.ts`, add:

```ts
recordOperation(entry: {
  source: "api" | "cli" | "mcp-stdio" | "mcp-http"
  action: string
  table?: string
  affected?: number
  dryRun?: boolean
}): void {
  const db = this.getDb()
  db.prepare(`
    INSERT INTO "_operation_log" ("source", "action", "table_name", "affected", "dry_run", "created_at")
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.source,
    entry.action,
    entry.table ?? null,
    entry.affected ?? null,
    entry.dryRun ? 1 : 0,
    new Date().toISOString(),
  )
}

databaseLogList(limit = 50): DatabaseOperationLogEntry[] {
  const db = this.getDb()
  const rows = db.prepare(`
    SELECT "id", "source", "action", "table_name", "affected", "dry_run", "created_at"
    FROM "_operation_log"
    ORDER BY "id" DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number | bigint
    source: DatabaseOperationSource
    action: string
    table_name: string | null
    affected: number | bigint | null
    dry_run: number
    created_at: string
  }>

  return rows.map((row) => ({
    id: toNumber(row.id),
    source: row.source,
    action: row.action,
    table: row.table_name,
    affected: row.affected === null ? null : toNumber(row.affected),
    dryRun: row.dry_run === 1,
    createdAt: row.created_at,
  }))
}
```

- [ ] **Step 4: Update dispatcher context**

In `dispatcher.ts`, add:

```ts
type DatabaseDispatchSource = "api" | "cli" | "mcp-stdio" | "mcp-http"
type DispatchContext = { source?: DatabaseDispatchSource }
```

Change signature:

```ts
function dispatchDatabaseAction(action: string, params: Record<string, unknown>, context: DispatchContext = {}): DispatchResult
```

After `const result = handler(params)`, add:

```ts
if (MUTATING_ACTIONS.has(action)) {
  databaseService.recordOperation({
    source: context.source ?? "api",
    action,
    table: extractTableName(action, params),
    affected: result.affected,
    dryRun: params.dryRun === true,
  })
}
```

Add handler:

```ts
databaseLogList: (params) => ({
  ok: true,
  data: databaseService.databaseLogList(
    typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : 50,
  ),
}),
```

- [ ] **Step 5: Pass source from transports**

In `http-server.ts`, read source header:

```ts
const sourceHeader = req.headers["x-synapse-client"]
const source = sourceHeader === "cli" || sourceHeader === "mcp-stdio" ? sourceHeader : "api"
const result = dispatchDatabaseAction(action, params, { source })
```

In `mcp-server.ts`, pass:

```ts
return dispatchDatabaseAction(action, args, { source: "mcp-http" })
```

In `resolve-user-data.ts`, change:

```ts
async function apiCall(
  info: ServerInfo,
  action: string,
  params: Record<string, unknown> = {},
  source: "cli" | "mcp-stdio" = "cli",
): Promise<unknown>
```

Add header:

```ts
"X-Synapse-Client": source,
```

In `database/mcp/index.ts`, call:

```ts
return await apiCall(getServerInfo(), action, args, "mcp-stdio")
```

- [ ] **Step 6: Register operation log MCP/CLI**

Append to registry:

```ts
{ action: "databaseLogList", mcpTool: "database_log_list", cliCommand: "database log list", mutates: false },
```

Add MCP tool:

```ts
{
  name: "database_log_list",
  description: "Return recent Database mutation operations. Use this when the user asks what an Agent or CLI recently changed.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Maximum log entries to return. Defaults to 50." },
    },
  },
},
```

Add `database_log_list` to `mcp-rpc.ts` result-data group.

Add CLI case:

```ts
case "log.list": {
  const limit = parseNonNegativeIntegerFlag(args, "--limit")
  const result = await apiCall(info, "databaseLogList", { limit }) as { data: Record<string, unknown>[] }
  printTable(result.data)
  break
}
```

- [ ] **Step 7: Write operation log test**

Create `desktop/tests/unit/database-log-list.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({ app: { getPath: vi.fn() } }))
vi.mock("electron", () => electronMock)
vi.mock("../../electron/services/log-store", () => ({
  createMainLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

let tempDir = ""

describe("Database operation log", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-database-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const { databaseService } = await import("../../electron/database/service")
    databaseService.open()
    databaseService.databaseTableCreate("tasks", [{ name: "title", kind: "text" }])
  })

  afterEach(async () => {
    const { databaseService } = await import("../../electron/database/service")
    databaseService.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("records mutating dispatcher actions with source and affected count", async () => {
    const { dispatchDatabaseAction } = await import("../../electron/database/dispatcher")

    dispatchDatabaseAction("database.row.create", { tableName: "tasks", data: { title: "Ship" } }, { source: "mcp-stdio" })

    const result = dispatchDatabaseAction("database.log.list", { limit: 5 })
    expect(result.data).toEqual([
      expect.objectContaining({
        source: "mcp-stdio",
        action: "database.row.create",
        table: "tasks",
        affected: 1,
        dryRun: false,
      }),
    ])
  })
})
```

- [ ] **Step 8: Run tests and build**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/database-log-list.test.ts tests/unit/database-capability-parity.test.ts
pnpm --filter @synapse/desktop run build:database
```

Expected:

```text
Test Files  2 passed
build:database exits 0
```

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/database/types.ts desktop/electron/database/service.ts desktop/electron/database/dispatcher.ts desktop/electron/database/http-server.ts desktop/electron/database/mcp-server.ts desktop/database/shared/resolve-user-data.ts desktop/database/mcp/index.ts desktop/database/shared/capability-registry.ts desktop/database/shared/mcp-tools.ts desktop/database/shared/mcp-rpc.ts desktop/database/cli/index.ts desktop/tests/unit/database-log-list.test.ts
git commit -m "feat: add database operation log"
```

---

### Task 6: Final Verification And Agent Guidance Polish

**Files:**

- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/cli/index.ts`
- Modify: `desktop/tests/unit/database-mcp-tools.test.ts`

- [ ] **Step 1: Update MCP descriptions to guide Agent behavior**

In `mcp-tools.ts`:

Change `database_sql_execute` description to:

```ts
description: "Execute raw SQL with optional positional bind params. Prefer database_sql_read for inspection and structured tools for normal writes. Use database_sql_execute only when the user explicitly needs SQL-level DDL/DML or advanced repair. System tables prefixed with _ and ATTACH or DETACH are blocked.",
```

Ensure `database_overview_get` description contains:

```text
Use this first when the user asks broadly about available data.
```

Ensure `database_log_list` description contains:

```text
Use this when the user asks what an Agent or CLI recently changed.
```

- [ ] **Step 2: Extend MCP description tests**

In `desktop/tests/unit/database-mcp-tools.test.ts`, add:

```ts
it("guides agents toward overview, database_sql_read, and database_log_list before riskier tools", () => {
  expect(getTool("database_overview_get").description).toContain("Use this first")
  expect(getTool("database_sql_read").description).toContain("Prefer this over database_sql_execute")
  expect(getTool("database_sql_execute").description).toContain("Use database_sql_execute only")
  expect(getTool("database_log_list").description).toContain("recently changed")
})
```

- [ ] **Step 3: Update CLI help**

In `desktop/database/cli/index.ts`, ensure help includes:

```text
  synapse database overview get                                   Show all tables and column summaries
  synapse database sql read '<SQL>' [--params '[...]']        Execute read-only SQL
  synapse database log list [--limit N]                  Show recent Database mutations
  synapse database rows update <tableName> --where-json '{...}' --data '{"k":"v"}' [--dry-run]
  synapse database rows delete <tableName> --where-json '{...}' [--dry-run]
```

- [ ] **Step 4: Run full focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  tests/unit/database-capability-parity.test.ts \
  tests/unit/database-mcp-tools.test.ts \
  tests/unit/database-mcp-rpc.test.ts \
  tests/unit/database-overview.test.ts \
  tests/unit/database-sql-read.test.ts \
  tests/unit/database-dry-run.test.ts \
  tests/unit/database-log-list.test.ts \
  electron/database/__tests__/service.test.ts
pnpm --filter @synapse/desktop run build:database
pnpm --filter @synapse/desktop exec tsc -p tsconfig.test.json --noEmit --pretty false
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected:

```text
All listed Vitest files pass.
build:database exits 0.
tsconfig.test typecheck exits 0.
check:hard-constraints exits 0.
```

- [ ] **Step 5: Commit**

```bash
git add desktop/database/shared/mcp-tools.ts desktop/database/cli/index.ts desktop/tests/unit/database-mcp-tools.test.ts
git commit -m "docs: polish database agent tool guidance"
```

---

## Self-Review

Spec coverage:

- Capability parity automated test: Task 1.
- Database overview MCP/CLI/API action: Task 2.
- Operation log: Task 5.
- Dry-run preview for bulk operations: Task 4.
- Unified metadata registry: Task 1, then extended by Tasks 2, 3, and 5.
- Read-only SQL preferred path: Task 3 and Task 6.

Type consistency:

- Action names use camelCase: `databaseOverviewGet`, `databaseSqlRead`, `databaseLogList`.
- MCP names use snake_case: `database_overview_get`, `database_sql_read`, `database_log_list`.
- CLI commands use kebab-case: `database overview get`, `database sql read`, `database log list`.

Verification:

- Every feature has at least one focused unit test.
- Final verification includes MCP tests, service tests, database bundle build, TypeScript test config, and hard constraints.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-database-agent-capabilities.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, with checkpoints after each task.

If you implement it yourself, do the tasks in order and commit after each task. Task 1 is the safety rail; it makes later changes much harder to accidentally drift across API/MCP/CLI.
