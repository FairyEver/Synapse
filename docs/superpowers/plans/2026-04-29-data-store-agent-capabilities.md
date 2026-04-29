# Data Store Agent Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Synapse Data Store as a self-use Agent database by adding parity tests, global database inspection, operation history, dry-run previews, a lightweight capability registry, and a safer read-first SQL path without removing current raw SQL power.

**Architecture:** Keep `desktop/electron/data-store/service.ts` and `desktop/electron/data-store/dispatcher.ts` as the canonical execution path. Keep MCP schemas stateless; add tools that help Agents discover current runtime state by calling tools rather than by dynamic MCP schema mutation. Add a small shared capability registry for parity checks and command/tool mapping, not a large framework rewrite.

**Tech Stack:** Electron main process, Node.js, TypeScript, `node:sqlite`, Vitest, bundled Node CLI/MCP via esbuild.

---

## Current Context

The current Data Store chain is:

```text
DataStoreService
  -> dispatchDataStoreAction
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

Security hardening is not the main priority for the current self-use product stage. Keep full-power `raw_sql`, but add better guidance and safer first-choice tools for Agents.

---

## File Structure

Create:

- `desktop/data-store/shared/capability-registry.ts`  
  Lightweight registry of action names, MCP tool names, and CLI commands.

- `desktop/tests/unit/data-store-capability-parity.test.ts`  
  Automated parity test for Dispatcher, MCP map, CLI command coverage, and registry coverage.

- `desktop/tests/unit/data-store-overview.test.ts`  
  Service-level test for database overview shape.

- `desktop/tests/unit/data-store-read-sql.test.ts`  
  Service-level test for read-only SQL behavior.

- `desktop/tests/unit/data-store-dry-run.test.ts`  
  Service-level test for update/delete dry-run behavior.

- `desktop/tests/unit/data-store-operation-log.test.ts`  
  Dispatcher/service test for mutation logging.

Modify:

- `desktop/data-store/shared/mcp-tools.ts`  
  Add `database_overview`, `read_sql`, `operation_log`; use registry for `MCP_TOOL_ACTIONS`.

- `desktop/data-store/shared/mcp-rpc.ts`  
  Normalize result shapes for new MCP tools.

- `desktop/data-store/shared/resolve-user-data.ts`  
  Add optional client source header support for CLI and stdio MCP.

- `desktop/data-store/mcp/index.ts`  
  Pass source `"mcp-stdio"` to API calls.

- `desktop/data-store/cli/index.ts`  
  Add `overview`, `read-sql`, `operation-log`, `--dry-run`; use registry for known data commands where practical.

- `desktop/electron/data-store/types.ts`  
  Add overview, operation log, and dry-run result types.

- `desktop/electron/data-store/service.ts`  
  Add overview, read SQL, dry-run support, operation log storage.

- `desktop/electron/data-store/dispatcher.ts`  
  Add actions, source context, operation logging.

- `desktop/electron/data-store/http-server.ts`  
  Pass source context from `X-Synapse-Client`.

- `desktop/electron/data-store/mcp-server.ts`  
  Pass source context `"mcp-http"`.

Optional renderer/API type follow-up:

- `desktop/src/types/data-store.ts`
- `desktop/src/types/bridge.ts`
- `desktop/electron/data-store/ipc-handlers.ts`
- `desktop/electron/preload.ts`

Add renderer IPC only if the UI needs these new features immediately. The requested scope is Agent/CLI/MCP first.

---

### Task 1: Add Capability Registry And Parity Test

**Files:**

- Create: `desktop/data-store/shared/capability-registry.ts`
- Create: `desktop/tests/unit/data-store-capability-parity.test.ts`
- Modify: `desktop/data-store/shared/mcp-tools.ts`
- Modify: `desktop/data-store/cli/index.ts`

- [ ] **Step 1: Create the shared registry**

Create `desktop/data-store/shared/capability-registry.ts`:

```ts
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
  { action: "renameTable", mcpTool: "rename_table", cliCommand: "rename-table", mutates: true },
  { action: "renameColumn", mcpTool: "rename_column", cliCommand: "rename-column", mutates: true },
  { action: "dropColumn", mcpTool: "drop_column", cliCommand: "drop-column", mutates: true },
  { action: "rawSQL", mcpTool: "raw_sql", cliCommand: "sql", mutates: true },
] as const satisfies readonly DataStoreCapability[]

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
  buildMcpToolActions,
  getCliDataCommands,
  getMutatingActions,
}
export type { DataStoreCapability }
```

- [ ] **Step 2: Use registry for MCP action map**

In `desktop/data-store/shared/mcp-tools.ts`, add:

```ts
import { buildMcpToolActions } from "./capability-registry"
```

Replace the manual `MCP_TOOL_ACTIONS` object with:

```ts
const MCP_TOOL_ACTIONS: Record<string, string> = buildMcpToolActions()
```

- [ ] **Step 3: Use registry for CLI known data commands**

In `desktop/data-store/cli/index.ts`, add:

```ts
import { getCliDataCommands } from "../shared/capability-registry"
```

Replace the manual `KNOWN_COMMANDS` set with:

```ts
const KNOWN_COMMANDS = new Set([...getCliDataCommands(), "status"])
```

- [ ] **Step 4: Write the parity test**

Create `desktop/tests/unit/data-store-capability-parity.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DATA_STORE_CAPABILITIES, getCliDataCommands } from "../../data-store/shared/capability-registry"
import { MCP_TOOL_ACTIONS, buildTools } from "../../data-store/shared/mcp-tools"

function extractDispatcherActions(): string[] {
  const source = readFileSync(new URL("../../electron/data-store/dispatcher.ts", import.meta.url), "utf-8")
  const body = source.match(/const ACTION_HANDLERS:[\s\S]*?= \{([\s\S]*?)\n\}/)?.[1]
  if (!body) throw new Error("ACTION_HANDLERS not found")
  return [...body.matchAll(/\n\s{2}([A-Za-z0-9_]+):/g)].map((match) => match[1]).sort()
}

describe("Data Store capability parity", () => {
  it("keeps dispatcher actions registered in the shared capability registry", () => {
    const registryActions = DATA_STORE_CAPABILITIES.map((capability) => capability.action).sort()
    expect(registryActions).toEqual(extractDispatcherActions())
  })

  it("keeps MCP tools mapped to registered actions", () => {
    const toolNames = buildTools().map((tool) => tool.name).sort()
    const mappedToolNames = Object.keys(MCP_TOOL_ACTIONS).sort()
    const mappedActions = Object.values(MCP_TOOL_ACTIONS).sort()
    const registryActions = DATA_STORE_CAPABILITIES.map((capability) => capability.action).sort()

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
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-capability-parity.test.ts tests/unit/data-store-mcp-tools.test.ts
```

Expected:

```text
Test Files  2 passed
```

- [ ] **Step 6: Commit**

```bash
git add desktop/data-store/shared/capability-registry.ts desktop/data-store/shared/mcp-tools.ts desktop/data-store/cli/index.ts desktop/tests/unit/data-store-capability-parity.test.ts
git commit -m "test: add data store capability parity checks"
```

---

### Task 2: Add Database Overview For Agents

**Files:**

- Modify: `desktop/electron/data-store/types.ts`
- Modify: `desktop/electron/data-store/service.ts`
- Modify: `desktop/electron/data-store/dispatcher.ts`
- Modify: `desktop/data-store/shared/capability-registry.ts`
- Modify: `desktop/data-store/shared/mcp-tools.ts`
- Modify: `desktop/data-store/shared/mcp-rpc.ts`
- Modify: `desktop/data-store/cli/index.ts`
- Create: `desktop/tests/unit/data-store-overview.test.ts`

- [ ] **Step 1: Add overview types**

In `desktop/electron/data-store/types.ts`, add:

```ts
type DataStoreOverviewColumn = {
  name: string
  kind: ColumnKind
  description: string
  choices?: string[]
  system?: true
}

type DataStoreOverviewTable = {
  name: string
  description: string
  rowCount: number
  columns: DataStoreOverviewColumn[]
}

type DataStoreOverview = {
  tableCount: number
  tables: DataStoreOverviewTable[]
}
```

Export those types from the existing `export type { ... }` block.

- [ ] **Step 2: Write the failing service test**

Create `desktop/tests/unit/data-store-overview.test.ts`:

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
let service: typeof import("../../electron/data-store/service").dataStoreService

describe("DataStoreService overview", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/data-store/service")
    service = module.dataStoreService
    service.open()
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("summarizes tables, descriptions, row counts, and columns", () => {
    service.createTable("tasks", [
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
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-overview.test.ts
```

Expected:

```text
FAIL ... service.getDatabaseOverview is not a function
```

- [ ] **Step 4: Implement service overview**

In `desktop/electron/data-store/service.ts`, import the new type:

```ts
import type { DataStoreOverview } from "./types"
```

Add this method inside `DataStoreService`:

```ts
getDatabaseOverview(): DataStoreOverview {
  const tables = this.listTables().map((table) => {
    const schema = this.describeTable(table.name)
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

In `desktop/electron/data-store/dispatcher.ts`, add to `ACTION_HANDLERS`:

```ts
databaseOverview: () => ({
  ok: true,
  data: dataStoreService.getDatabaseOverview(),
}),
```

- [ ] **Step 6: Register MCP and CLI capability**

Append to `DATA_STORE_CAPABILITIES` in `desktop/data-store/shared/capability-registry.ts`:

```ts
{ action: "databaseOverview", mcpTool: "database_overview", cliCommand: "overview", mutates: false },
```

In `desktop/data-store/shared/mcp-tools.ts`, add a tool:

```ts
{
  name: "database_overview",
  description: "Return an overview of all user tables, table descriptions, row counts, and column summaries. Use this first when the user asks broadly about available data.",
  inputSchema: { type: "object", properties: {} },
},
```

In `desktop/data-store/shared/mcp-rpc.ts`, add `database_overview` to the `result.data` return group:

```ts
case "database_overview":
  return result.data
```

- [ ] **Step 7: Add CLI overview command**

In `desktop/data-store/cli/index.ts`, add a usage line:

```text
  synapse overview                                   Show all tables and column summaries
```

Add a switch case:

```ts
case "overview": {
  const result = await apiCall(info, "databaseOverview") as {
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
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-overview.test.ts tests/unit/data-store-capability-parity.test.ts tests/unit/data-store-mcp-tools.test.ts
pnpm --filter @synapse/desktop run build:data-store
```

Expected:

```text
Test Files  3 passed
build:data-store exits 0
```

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/data-store/types.ts desktop/electron/data-store/service.ts desktop/electron/data-store/dispatcher.ts desktop/data-store/shared/capability-registry.ts desktop/data-store/shared/mcp-tools.ts desktop/data-store/shared/mcp-rpc.ts desktop/data-store/cli/index.ts desktop/tests/unit/data-store-overview.test.ts
git commit -m "feat: add data store overview for agents"
```

---

### Task 3: Add Read-Only SQL Tool

**Files:**

- Modify: `desktop/electron/data-store/service.ts`
- Modify: `desktop/electron/data-store/dispatcher.ts`
- Modify: `desktop/data-store/shared/capability-registry.ts`
- Modify: `desktop/data-store/shared/mcp-tools.ts`
- Modify: `desktop/data-store/shared/mcp-rpc.ts`
- Modify: `desktop/data-store/cli/index.ts`
- Create: `desktop/tests/unit/data-store-read-sql.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `desktop/tests/unit/data-store-read-sql.test.ts`:

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
let service: typeof import("../../electron/data-store/service").dataStoreService

describe("DataStoreService readSQL", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/data-store/service")
    service = module.dataStoreService
    service.open()
    service.createTable("tasks", [{ name: "title", kind: "text" }])
    service.insert("tasks", { title: "Ship" })
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("allows SELECT statements with bind params", () => {
    expect(service.readSQL("SELECT title FROM tasks WHERE title = ?", ["Ship"])).toEqual({
      rows: [{ title: "Ship" }],
    })
  })

  it("rejects write statements", () => {
    expect(() => service.readSQL("DELETE FROM tasks")).toThrow(/read-only/i)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-read-sql.test.ts
```

Expected:

```text
FAIL ... service.readSQL is not a function
```

- [ ] **Step 3: Implement `readSQL`**

In `desktop/electron/data-store/service.ts`, add:

```ts
readSQL(sql: string, params?: unknown[]): { rows: Record<string, unknown>[] } {
  const normalized = sql.trim().toLowerCase()
  if (!/^(select|pragma|explain)\b/.test(normalized)) {
    throw new Error("readSQL is read-only. Use rawSQL when you explicitly need to write.")
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

In `desktop/electron/data-store/dispatcher.ts`, add:

```ts
readSQL: (params) => ({
  ok: true,
  data: dataStoreService.readSQL(
    requireString(params, "sql"),
    params.params as unknown[] | undefined,
  ),
}),
```

Append to `DATA_STORE_CAPABILITIES`:

```ts
{ action: "readSQL", mcpTool: "read_sql", cliCommand: "read-sql", mutates: false },
```

Add MCP tool:

```ts
{
  name: "read_sql",
  description: "Execute a read-only SQL statement with optional positional bind params. Allows SELECT, PRAGMA, and EXPLAIN. Prefer this over raw_sql for inspection and reporting.",
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

Add `read_sql` to the `result.data` group in `mcp-rpc.ts`.

Add CLI command:

```ts
case "read-sql": {
  const sql = args[1]
  if (!sql) { console.error("Usage: synapse read-sql '<SQL>' [--params '[...]']"); process.exit(1) }
  const params = parseJsonFlag(args, "--params")
  if (params !== undefined && !Array.isArray(params)) {
    console.error("Invalid --params value: expected a JSON array")
    process.exit(1)
  }
  const result = await apiCall(info, "readSQL", { sql, params }) as { data: { rows: unknown[] } }
  printTable(result.data.rows as Record<string, unknown>[])
  break
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-read-sql.test.ts tests/unit/data-store-capability-parity.test.ts tests/unit/data-store-mcp-tools.test.ts
pnpm --filter @synapse/desktop run build:data-store
```

Expected:

```text
Test Files  3 passed
build:data-store exits 0
```

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/data-store/service.ts desktop/electron/data-store/dispatcher.ts desktop/data-store/shared/capability-registry.ts desktop/data-store/shared/mcp-tools.ts desktop/data-store/shared/mcp-rpc.ts desktop/data-store/cli/index.ts desktop/tests/unit/data-store-read-sql.test.ts
git commit -m "feat: add read-only sql data store tool"
```

---

### Task 4: Add Dry-Run Preview For Bulk Updates And Deletes

**Files:**

- Modify: `desktop/electron/data-store/types.ts`
- Modify: `desktop/electron/data-store/service.ts`
- Modify: `desktop/electron/data-store/dispatcher.ts`
- Modify: `desktop/data-store/shared/mcp-tools.ts`
- Modify: `desktop/data-store/cli/index.ts`
- Create: `desktop/tests/unit/data-store-dry-run.test.ts`

- [ ] **Step 1: Add dry-run result type**

In `desktop/electron/data-store/types.ts`, add:

```ts
type DataStoreBulkMutationResult = {
  affected: number
  ids: number[]
  dryRun?: true
}
```

Export it.

- [ ] **Step 2: Write failing service tests**

Create `desktop/tests/unit/data-store-dry-run.test.ts`:

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
let service: typeof import("../../electron/data-store/service").dataStoreService

describe("DataStoreService bulk dry run", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const module = await import("../../electron/data-store/service")
    service = module.dataStoreService
    service.open()
    service.createTable("tasks", [
      { name: "title", kind: "text" },
      { name: "done", kind: "boolean" },
    ])
    service.batchInsert("tasks", [
      { title: "A", done: false },
      { title: "B", done: false },
    ])
  })

  afterEach(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("previews updateWhere without changing rows", () => {
    const preview = service.updateWhere("tasks", { done: false }, { done: true }, { dryRun: true })
    expect(preview).toEqual({ affected: 2, ids: [1, 2], dryRun: true })
    expect(service.count("tasks", { done: true })).toEqual({ count: 0 })
  })

  it("previews deleteWhere without deleting rows", () => {
    const preview = service.deleteWhere("tasks", { done: false }, { dryRun: true })
    expect(preview).toEqual({ affected: 2, ids: [1, 2], dryRun: true })
    expect(service.count("tasks")).toEqual({ count: 2 })
  })
})
```

- [ ] **Step 3: Run and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-dry-run.test.ts
```

Expected:

```text
FAIL ... Expected 3 arguments, but got 4
```

- [ ] **Step 4: Implement dry-run options**

In `desktop/electron/data-store/service.ts`, add a local type:

```ts
type BulkMutationOptions = { dryRun?: boolean }
```

Change signatures:

```ts
updateWhere(table: string, where: DataStoreWhereClause, data: Record<string, unknown>, options: BulkMutationOptions = {}): { affected: number; ids: number[]; dryRun?: true }
deleteWhere(table: string, where: DataStoreWhereClause, options: BulkMutationOptions = {}): { affected: number; ids: number[]; dryRun?: true }
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
dataStoreService.updateWhere(..., { dryRun })
dataStoreService.deleteWhere(..., { dryRun })
```

In `mcp-tools.ts`, add this property to `update_where` and `delete_where` schemas:

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
await apiCall(info, "updateWhere", { table, where, data, dryRun })
```

For `delete-where`, call:

```ts
await apiCall(info, "deleteWhere", { table, where, dryRun })
```

Print dry-run wording:

```ts
console.log(`${result.affected} rows ${dryRun ? "matched" : "updated"}.`)
console.log(`${result.affected} rows ${dryRun ? "matched" : "deleted"}.`)
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-dry-run.test.ts
pnpm --filter @synapse/desktop run build:data-store
```

Expected:

```text
Test Files  1 passed
build:data-store exits 0
```

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/data-store/types.ts desktop/electron/data-store/service.ts desktop/electron/data-store/dispatcher.ts desktop/data-store/shared/mcp-tools.ts desktop/data-store/cli/index.ts desktop/tests/unit/data-store-dry-run.test.ts
git commit -m "feat: add dry-run preview for data store bulk mutations"
```

---

### Task 5: Add Operation Log For Agent Actions

**Files:**

- Modify: `desktop/electron/data-store/types.ts`
- Modify: `desktop/electron/data-store/service.ts`
- Modify: `desktop/electron/data-store/dispatcher.ts`
- Modify: `desktop/electron/data-store/http-server.ts`
- Modify: `desktop/electron/data-store/mcp-server.ts`
- Modify: `desktop/data-store/shared/resolve-user-data.ts`
- Modify: `desktop/data-store/mcp/index.ts`
- Modify: `desktop/data-store/shared/capability-registry.ts`
- Modify: `desktop/data-store/shared/mcp-tools.ts`
- Modify: `desktop/data-store/shared/mcp-rpc.ts`
- Modify: `desktop/data-store/cli/index.ts`
- Create: `desktop/tests/unit/data-store-operation-log.test.ts`

- [ ] **Step 1: Add operation log types**

In `desktop/electron/data-store/types.ts`, add:

```ts
type DataStoreOperationSource = "api" | "cli" | "mcp-stdio" | "mcp-http"

type DataStoreOperationLogEntry = {
  id: number
  source: DataStoreOperationSource
  action: string
  table: string | null
  affected: number | null
  dryRun: boolean
  createdAt: string
}
```

Export them.

- [ ] **Step 2: Add system table creation**

In `DataStoreService.ensureMetaTables()`, add:

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

In `desktop/electron/data-store/service.ts`, add:

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

listOperationLog(limit = 50): DataStoreOperationLogEntry[] {
  const db = this.getDb()
  const rows = db.prepare(`
    SELECT "id", "source", "action", "table_name", "affected", "dry_run", "created_at"
    FROM "_operation_log"
    ORDER BY "id" DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: number | bigint
    source: DataStoreOperationSource
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
type DataStoreDispatchSource = "api" | "cli" | "mcp-stdio" | "mcp-http"
type DispatchContext = { source?: DataStoreDispatchSource }
```

Change signature:

```ts
function dispatchDataStoreAction(action: string, params: Record<string, unknown>, context: DispatchContext = {}): DispatchResult
```

After `const result = handler(params)`, add:

```ts
if (MUTATING_ACTIONS.has(action)) {
  dataStoreService.recordOperation({
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
operationLog: (params) => ({
  ok: true,
  data: dataStoreService.listOperationLog(
    typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : 50,
  ),
}),
```

- [ ] **Step 5: Pass source from transports**

In `http-server.ts`, read source header:

```ts
const sourceHeader = req.headers["x-synapse-client"]
const source = sourceHeader === "cli" || sourceHeader === "mcp-stdio" ? sourceHeader : "api"
const result = dispatchDataStoreAction(action, params, { source })
```

In `mcp-server.ts`, pass:

```ts
return dispatchDataStoreAction(action, args, { source: "mcp-http" })
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

In `data-store/mcp/index.ts`, call:

```ts
return await apiCall(getServerInfo(), action, args, "mcp-stdio")
```

- [ ] **Step 6: Register operation log MCP/CLI**

Append to registry:

```ts
{ action: "operationLog", mcpTool: "operation_log", cliCommand: "operation-log", mutates: false },
```

Add MCP tool:

```ts
{
  name: "operation_log",
  description: "Return recent Data Store mutation operations. Use this when the user asks what an Agent or CLI recently changed.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Maximum log entries to return. Defaults to 50." },
    },
  },
},
```

Add `operation_log` to `mcp-rpc.ts` result-data group.

Add CLI case:

```ts
case "operation-log": {
  const limit = parseNonNegativeIntegerFlag(args, "--limit")
  const result = await apiCall(info, "operationLog", { limit }) as { data: Record<string, unknown>[] }
  printTable(result.data)
  break
}
```

- [ ] **Step 7: Write operation log test**

Create `desktop/tests/unit/data-store-operation-log.test.ts`:

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

describe("Data Store operation log", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-data-store-"))
    electronMock.app.getPath.mockReturnValue(tempDir)
    vi.resetModules()
    const { dataStoreService } = await import("../../electron/data-store/service")
    dataStoreService.open()
    dataStoreService.createTable("tasks", [{ name: "title", kind: "text" }])
  })

  afterEach(async () => {
    const { dataStoreService } = await import("../../electron/data-store/service")
    dataStoreService.close()
    await rm(tempDir, { recursive: true, force: true })
    electronMock.app.getPath.mockReset()
  })

  it("records mutating dispatcher actions with source and affected count", async () => {
    const { dispatchDataStoreAction } = await import("../../electron/data-store/dispatcher")

    dispatchDataStoreAction("insert", { table: "tasks", data: { title: "Ship" } }, { source: "mcp-stdio" })

    const result = dispatchDataStoreAction("operationLog", { limit: 5 })
    expect(result.data).toEqual([
      expect.objectContaining({
        source: "mcp-stdio",
        action: "insert",
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
pnpm --filter @synapse/desktop exec vitest run tests/unit/data-store-operation-log.test.ts tests/unit/data-store-capability-parity.test.ts
pnpm --filter @synapse/desktop run build:data-store
```

Expected:

```text
Test Files  2 passed
build:data-store exits 0
```

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/data-store/types.ts desktop/electron/data-store/service.ts desktop/electron/data-store/dispatcher.ts desktop/electron/data-store/http-server.ts desktop/electron/data-store/mcp-server.ts desktop/data-store/shared/resolve-user-data.ts desktop/data-store/mcp/index.ts desktop/data-store/shared/capability-registry.ts desktop/data-store/shared/mcp-tools.ts desktop/data-store/shared/mcp-rpc.ts desktop/data-store/cli/index.ts desktop/tests/unit/data-store-operation-log.test.ts
git commit -m "feat: add data store operation log"
```

---

### Task 6: Final Verification And Agent Guidance Polish

**Files:**

- Modify: `desktop/data-store/shared/mcp-tools.ts`
- Modify: `desktop/data-store/cli/index.ts`
- Modify: `desktop/tests/unit/data-store-mcp-tools.test.ts`

- [ ] **Step 1: Update MCP descriptions to guide Agent behavior**

In `mcp-tools.ts`:

Change `raw_sql` description to:

```ts
description: "Execute raw SQL with optional positional bind params. Prefer read_sql for inspection and structured tools for normal writes. Use raw_sql only when the user explicitly needs SQL-level DDL/DML or advanced repair. System tables prefixed with _ and ATTACH or DETACH are blocked.",
```

Ensure `database_overview` description contains:

```text
Use this first when the user asks broadly about available data.
```

Ensure `operation_log` description contains:

```text
Use this when the user asks what an Agent or CLI recently changed.
```

- [ ] **Step 2: Extend MCP description tests**

In `desktop/tests/unit/data-store-mcp-tools.test.ts`, add:

```ts
it("guides agents toward overview, read_sql, and operation_log before riskier tools", () => {
  expect(getTool("database_overview").description).toContain("Use this first")
  expect(getTool("read_sql").description).toContain("Prefer this over raw_sql")
  expect(getTool("raw_sql").description).toContain("Use raw_sql only")
  expect(getTool("operation_log").description).toContain("recently changed")
})
```

- [ ] **Step 3: Update CLI help**

In `desktop/data-store/cli/index.ts`, ensure help includes:

```text
  synapse overview                                   Show all tables and column summaries
  synapse read-sql '<SQL>' [--params '[...]']        Execute read-only SQL
  synapse operation-log [--limit N]                  Show recent Data Store mutations
  synapse update-where <table> --where-json '{...}' --data '{"k":"v"}' [--dry-run]
  synapse delete-where <table> --where-json '{...}' [--dry-run]
```

- [ ] **Step 4: Run full focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  tests/unit/data-store-capability-parity.test.ts \
  tests/unit/data-store-mcp-tools.test.ts \
  tests/unit/data-store-mcp-rpc.test.ts \
  tests/unit/data-store-overview.test.ts \
  tests/unit/data-store-read-sql.test.ts \
  tests/unit/data-store-dry-run.test.ts \
  tests/unit/data-store-operation-log.test.ts \
  electron/data-store/__tests__/service.test.ts
pnpm --filter @synapse/desktop run build:data-store
pnpm --filter @synapse/desktop exec tsc -p tsconfig.test.json --noEmit --pretty false
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected:

```text
All listed Vitest files pass.
build:data-store exits 0.
tsconfig.test typecheck exits 0.
check:hard-constraints exits 0.
```

- [ ] **Step 5: Commit**

```bash
git add desktop/data-store/shared/mcp-tools.ts desktop/data-store/cli/index.ts desktop/tests/unit/data-store-mcp-tools.test.ts
git commit -m "docs: polish data store agent tool guidance"
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

- Action names use camelCase: `databaseOverview`, `readSQL`, `operationLog`.
- MCP names use snake_case: `database_overview`, `read_sql`, `operation_log`.
- CLI commands use kebab-case: `overview`, `read-sql`, `operation-log`.

Verification:

- Every feature has at least one focused unit test.
- Final verification includes MCP tests, service tests, data-store bundle build, TypeScript test config, and hard constraints.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-data-store-agent-capabilities.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, with checkpoints after each task.

If you implement it yourself, do the tasks in order and commit after each task. Task 1 is the safety rail; it makes later changes much harder to accidentally drift across API/MCP/CLI.
