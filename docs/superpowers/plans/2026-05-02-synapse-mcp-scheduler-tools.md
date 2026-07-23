# Synapse MCP Scheduler Tools Implementation Plan

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Task Scheduler list/get/create/enable/disable capabilities to the existing Synapse MCP server, HTTP API, and CLI without mixing Scheduler into the Database domain.

**Architecture:** Add a neutral capability registry that can aggregate isolated domains. Keep Database as its own domain and add Scheduler as a second domain. Route HTTP, MCP HTTP, stdio MCP, and CLI calls through canonical actions, with Scheduler execution delegated to `TaskSchedulerService`.

**Tech Stack:** Electron main process, TypeScript, Zod-style runtime checks where existing code already uses them, local HTTP `/api`, stdio MCP bridge, Vitest.

---

## Source Spec

Read this first:

- `docs/superpowers/specs/2026-05-02-synapse-mcp-scheduler-tools-design.md`

Hard constraints from the spec:

- Database and Scheduler are separate capability domains.
- Existing Database MCP tool names, schemas, and result normalization stay unchanged.
- First phase Scheduler actions are exactly `schedulerTaskList`, `schedulerTaskGet`, `schedulerTaskCreate`, `schedulerTaskEnable`, and `schedulerTaskDisable`.
- Task detail lookup uses `taskId`, not name.
- External Scheduler calls go through `TaskSchedulerService`, never task repositories.
- Do not expose delete, update, manual run, stop run, or run history through the new external Scheduler capability set.

## File Structure

Create neutral shared capability files:

- Create `desktop/synapse-capabilities/shared/types.ts` for domain/action/tool shared types and helper result types.
- Create `desktop/synapse-capabilities/shared/scheduler-domain.ts` for Scheduler action metadata, public input shapes, and MCP tool schemas.
- Create `desktop/synapse-capabilities/shared/registry.ts` for combined domain registration, tool/action lookup, and CLI command lookup.

Keep Database files domain-owned:

- Modify `desktop/database/shared/capability-registry.ts` to export a Database domain definition while keeping existing exports working.
- Modify `desktop/database/shared/mcp-tools.ts` to expose Database-only tool builders and keep compatibility exports.
- Modify `desktop/database/shared/mcp-rpc.ts` to consume the combined MCP tool registry and domain-aware result normalization.

Add Scheduler domain execution:

- Create `desktop/electron/services/task-scheduler/external-api.ts` for Scheduler canonical action dispatch and public `schedule -> trigger` mapping.
- Test with `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`.

Add a neutral Electron action router:

- Create `desktop/electron/capabilities/action-router.ts` to route actions to Database or Scheduler dispatchers.
- Test with `desktop/electron/capabilities/__tests__/action-router.test.ts`.

Wire transports:

- Modify `desktop/electron/database/http-server.ts` to use the neutral action router.
- Modify `desktop/electron/database/mcp-server.ts` to use the combined MCP tool/action registry and neutral action router.
- Modify `desktop/electron/database/index.ts` to accept an action router when starting HTTP and MCP servers.
- Modify `desktop/electron/bootstrap/descriptors.ts` so `core.database` depends on `core.task-scheduler`, builds the action router, and passes it to `initDatabase`.
- Modify `desktop/electron/bootstrap/__tests__/registry.test.ts` and `desktop/electron/bootstrap/__tests__/descriptors.test.ts` for the new dependency.

Wire stdio MCP and CLI:

- Modify `desktop/database/mcp/index.ts` to use the combined MCP tool/action registry.
- Create `desktop/database/cli/scheduler.ts` for Scheduler CLI parsing and printing.
- Modify `desktop/database/cli/index.ts` to delegate `synapse scheduler ...` to the Scheduler CLI namespace.

Typecheck support:

- Modify `desktop/tsconfig.electron.json` to include `synapse-capabilities/shared/**/*.ts`.

Tests:

- Create `desktop/tests/unit/synapse-capabilities.test.ts` for registry drift checks.
- Create `desktop/tests/unit/mcp-scheduler-tools.test.ts` for MCP tool list and result normalization checks.
- Create `desktop/tests/unit/cli-scheduler.test.ts` for Scheduler CLI parsing.

---

### Task 1: Add Neutral Capability Types And Database Domain Adapter

**Files:**
- Create: `desktop/synapse-capabilities/shared/types.ts`
- Modify: `desktop/database/shared/capability-registry.ts`
- Modify: `desktop/tsconfig.electron.json`
- Test: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `desktop/tests/unit/synapse-capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { DATABASE_DOMAIN } from "../../database/shared/capability-registry"

describe("Synapse capability domains", () => {
  it("keeps Database capabilities in the Database domain", () => {
    expect(DATABASE_DOMAIN.id).toBe("database")
    expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.action)).toContain("databaseTableList")
    expect(DATABASE_DOMAIN.capabilities.map((capability) => capability.mcpTool)).toContain("database_table_list")
    expect(DATABASE_DOMAIN.capabilities.some((capability) => capability.action.startsWith("scheduler"))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: FAIL because `DATABASE_DOMAIN` does not exist.

- [ ] **Step 3: Add neutral capability types**

Create `desktop/synapse-capabilities/shared/types.ts`:

```ts
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
  readonly action: string
  readonly mcpTool?: string
  readonly cliCommand?: string
  readonly mutates: boolean
}

export type CapabilityDomainDefinition = {
  readonly id: string
  readonly capabilities: readonly CapabilityDefinition[]
}
```

- [ ] **Step 4: Export a Database domain definition without changing existing helpers**

Modify `desktop/database/shared/capability-registry.ts`:

```ts
import type { CapabilityDomainDefinition } from "../../synapse-capabilities/shared/types"

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
  { action: "databaseOverviewGet", mcpTool: "database_overview_get", cliCommand: "database overview get", mutates: false },
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
  { action: "databaseLogList", mcpTool: "database_log_list", cliCommand: "database log list", mutates: false },
  { action: "databaseTableRename", mcpTool: "database_table_rename", cliCommand: "database table rename", mutates: true },
  { action: "databaseColumnRename", mcpTool: "database_column_rename", cliCommand: "database column rename", mutates: true },
  { action: "databaseColumnDelete", mcpTool: "database_column_delete", cliCommand: "database column delete", mutates: true },
  { action: "databaseSqlRead", mcpTool: "database_sql_read", cliCommand: "database sql read", mutates: false },
  { action: "databaseSqlExecute", mcpTool: "database_sql_execute", cliCommand: "database sql execute", mutates: true },
] as const satisfies readonly DatabaseCapability[]

const DATABASE_DOMAIN: CapabilityDomainDefinition = {
  id: "database",
  capabilities: DATABASE_CAPABILITIES,
}

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
  DATABASE_DOMAIN,
  buildMcpToolActions,
  getCliDataCommands,
  getMutatingActions,
}
export type { DatabaseCapability }
```

- [ ] **Step 5: Include neutral shared files in Electron typecheck**

Modify `desktop/tsconfig.electron.json`:

```json
{
  "include": [
    "electron/**/*.ts",
    "action-packages/**/*.ts",
    "database/shared/**/*.ts",
    "synapse-capabilities/shared/**/*.ts"
  ]
}
```

Keep the existing `compilerOptions`, `exclude`, and other fields unchanged.

- [ ] **Step 6: Run the test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/synapse-capabilities/shared/types.ts desktop/database/shared/capability-registry.ts desktop/tsconfig.electron.json desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat: add capability domain metadata"
```

---

### Task 2: Add Scheduler Domain Metadata And MCP Tool Schemas

**Files:**
- Create: `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- Create: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`

- [ ] **Step 1: Extend registry tests for Scheduler and combined tools**

Append to `desktop/tests/unit/synapse-capabilities.test.ts`:

```ts
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "../../synapse-capabilities/shared/scheduler-domain"
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
} from "../../synapse-capabilities/shared/registry"

describe("Scheduler capability domain", () => {
  it("registers Scheduler actions separately from Database", () => {
    expect(SCHEDULER_DOMAIN.id).toBe("scheduler")
    expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.action)).toEqual([
      "schedulerTaskList",
      "schedulerTaskGet",
      "schedulerTaskCreate",
      "schedulerTaskEnable",
      "schedulerTaskDisable",
    ])
    expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.mcpTool)).toEqual([
      "scheduler_task_list",
      "scheduler_task_get",
      "scheduler_task_create",
      "scheduler_task_enable",
      "scheduler_task_disable",
    ])
  })

  it("combines Database and Scheduler MCP tools without renaming Database tools", () => {
    const toolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(toolNames).toContain("database_table_list")
    expect(toolNames).toContain("query")
    expect(toolNames).toContain("database_log_list")
    expect(toolNames).toContain("scheduler_task_list")
    expect(toolNames).toContain("scheduler_task_create")
    expect(MCP_TOOL_ACTIONS.scheduler_task_create).toBe("schedulerTaskCreate")
    expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_disable).toBe("schedulerTaskDisable")
    expect(getActionDomainId("databaseTableList")).toBe("database")
    expect(getActionDomainId("schedulerTaskList")).toBe("scheduler")
  })

  it("defines Scheduler MCP schemas with taskId-only detail lookup", () => {
    const tools = buildSchedulerTools()
    const getTool = tools.find((tool) => tool.name === "scheduler_task_get")
    expect(getTool?.inputSchema.required).toEqual(["taskId"])
    expect(Object.keys(getTool?.inputSchema.properties ?? {})).toEqual(["taskId"])
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: FAIL because Scheduler domain files do not exist.

- [ ] **Step 3: Add Scheduler domain and MCP tool schemas**

Create `desktop/synapse-capabilities/shared/scheduler-domain.ts`:

```ts
import type {
  CapabilityDomainDefinition,
  McpToolDefinition,
} from "./types"

export type SchedulerSchedule =
  | {
      readonly type: "cron"
      readonly expr: string
      readonly timezone?: string
    }
  | {
      readonly type: "interval"
      readonly everyMinutes: number
      readonly anchor?: "created_at" | "last_completed_at"
    }

export type SchedulerTaskCreateParams = {
  readonly name: string
  readonly description?: string
  readonly scope: { readonly type: "global" } | { readonly type: "project"; readonly projectId: string }
  readonly cwd?: string
  readonly schedule: SchedulerSchedule
  readonly action: {
    readonly type: string
    readonly config: Record<string, unknown>
  }
  readonly enabled?: boolean
  readonly missedRunPolicy?: "skip" | "run_once"
}

export type SchedulerTaskListParams = {
  readonly enabled?: boolean
  readonly limit?: number
}

export type SchedulerTaskIdParams = {
  readonly taskId: string
}

const taskIdProperty = {
  type: "string",
  description: "Scheduled task id. If only a task name is known, call scheduler_task_list first and use the returned id.",
}

const schedulerCapabilities = [
  { action: "schedulerTaskList", mcpTool: "scheduler_task_list", cliCommand: "scheduler list", mutates: false },
  { action: "schedulerTaskGet", mcpTool: "scheduler_task_get", cliCommand: "scheduler get", mutates: false },
  { action: "schedulerTaskCreate", mcpTool: "scheduler_task_create", cliCommand: "scheduler create", mutates: true },
  { action: "schedulerTaskEnable", mcpTool: "scheduler_task_enable", cliCommand: "scheduler enable", mutates: true },
  { action: "schedulerTaskDisable", mcpTool: "scheduler_task_disable", cliCommand: "scheduler disable", mutates: true },
] as const

export const SCHEDULER_DOMAIN: CapabilityDomainDefinition = {
  id: "scheduler",
  capabilities: schedulerCapabilities,
}

export const SCHEDULER_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  schedulerCapabilities.map((capability) => [capability.mcpTool, capability.action]),
)

export function buildSchedulerTools(): McpToolDefinition[] {
  return [
    {
      name: "scheduler_task_list",
      description: "List scheduled tasks. If only a task name is known, use this first to find the task id.",
      inputSchema: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Optional filter for enabled or disabled tasks." },
          limit: { type: "number", description: "Optional maximum number of tasks to return." },
        },
      },
    },
    {
      name: "scheduler_task_get",
      description: "Get one scheduled task by taskId. Task names are not unique; use scheduler_task_list first if needed.",
      inputSchema: {
        type: "object",
        properties: { taskId: taskIdProperty },
        required: ["taskId"],
      },
    },
    {
      name: "scheduler_task_create",
      description: "Create a scheduled task. Supports cron and interval schedules and existing Action Runtime action types.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Task name." },
          description: { type: "string", description: "Optional task description." },
          scope: {
            anyOf: [
              { type: "object", properties: { type: { type: "string", enum: ["global"] } }, required: ["type"] },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["project"] },
                  projectId: { type: "string" },
                },
                required: ["type", "projectId"],
              },
            ],
          },
          cwd: { type: "string", description: "Optional working directory." },
          schedule: {
            anyOf: [
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["cron"] },
                  expr: { type: "string", description: "Five-field cron expression." },
                  timezone: { type: "string" },
                },
                required: ["type", "expr"],
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["interval"] },
                  everyMinutes: { type: "number", description: "Positive integer interval in minutes." },
                  anchor: { type: "string", enum: ["created_at", "last_completed_at"] },
                },
                required: ["type", "everyMinutes"],
              },
            ],
          },
          action: {
            type: "object",
            properties: {
              type: { type: "string", description: "Action type, such as builtin.command, builtin.script, or builtin.http-request." },
              config: { type: "object", description: "Action config validated by the existing action runtime." },
            },
            required: ["type", "config"],
          },
          enabled: { type: "boolean" },
          missedRunPolicy: { type: "string", enum: ["skip", "run_once"] },
        },
        required: ["name", "scope", "schedule", "action"],
      },
    },
    {
      name: "scheduler_task_enable",
      description: "Enable one scheduled task by taskId.",
      inputSchema: { type: "object", properties: { taskId: taskIdProperty }, required: ["taskId"] },
    },
    {
      name: "scheduler_task_disable",
      description: "Disable one scheduled task by taskId. This prevents future scheduled runs and does not stop a currently running run.",
      inputSchema: { type: "object", properties: { taskId: taskIdProperty }, required: ["taskId"] },
    },
  ]
}
```

- [ ] **Step 4: Add combined registry helpers**

Create `desktop/synapse-capabilities/shared/registry.ts`:

```ts
import { DATABASE_DOMAIN, buildMcpToolActions as buildDatabaseMcpToolActions } from "../../database/shared/capability-registry"
import { buildTools as buildDatabaseTools } from "../../database/shared/mcp-tools"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "./scheduler-domain"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  SCHEDULER_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDatabaseMcpToolActions(),
  ...SCHEDULER_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDatabaseTools(),
    ...buildSchedulerTools(),
  ]
}

export function getActionDomainId(action: string): string | null {
  for (const domain of CAPABILITY_DOMAINS) {
    if (domain.capabilities.some((capability) => capability.action === action)) {
      return domain.id
    }
  }
  return null
}

export function getMcpToolDomainId(toolName: string): string | null {
  const action = MCP_TOOL_ACTIONS[toolName]
  return action ? getActionDomainId(action) : null
}
```

- [ ] **Step 5: Run registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/synapse-capabilities/shared/scheduler-domain.ts desktop/synapse-capabilities/shared/registry.ts desktop/tests/unit/synapse-capabilities.test.ts
git commit -m "feat: register scheduler capability metadata"
```

---

### Task 3: Add Scheduler External Dispatcher

**Files:**
- Create: `desktop/electron/services/task-scheduler/external-api.ts`
- Modify: `desktop/electron/services/task-scheduler/index.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`

- [ ] **Step 1: Write failing dispatcher tests**

Create `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { dispatchSchedulerAction, toPublicTaskSummary } from "../external-api"
import type { TaskSchedulerService } from "../task-scheduler-service"
import type { ScheduledTaskEntry } from "../types"

const baseTask: ScheduledTaskEntry = {
  id: "task:1",
  schemaVersion: 2,
  name: "Daily summary",
  description: "Send summary",
  scope: { type: "global" },
  trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at" } },
  action: { type: "builtin.command", config: { command: "echo ok" } },
  enabled: true,
  missedRunPolicy: "skip",
  overlapPolicy: "skip",
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  nextRunAt: "2026-05-02T00:30:00.000Z",
  runCount: 0,
}

function serviceMock(): TaskSchedulerService {
  return {
    listTasks: vi.fn(async () => [baseTask, { ...baseTask, id: "task:2", enabled: false }]),
    getTask: vi.fn(async (id: string) => (id === "task:1" ? baseTask : null)),
    createTask: vi.fn(async (input) => ({ ...baseTask, ...input, id: "task:new" })),
    setTaskEnabled: vi.fn(async (_id: string, enabled: boolean) => ({ ...baseTask, enabled })),
  } as unknown as TaskSchedulerService
}

describe("task scheduler external api", () => {
  it("maps list results to public summaries and applies enabled filter", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, "schedulerTaskList", { enabled: true })
    expect(result).toEqual({
      ok: true,
      data: [toPublicTaskSummary(baseTask)],
      total: 1,
    })
  })

  it("gets task detail by taskId only", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, "schedulerTaskGet", { taskId: "task:1" })
    expect(result).toEqual({ ok: true, data: baseTask })
    expect(service.getTask).toHaveBeenCalledWith("task:1")
  })

  it("maps cron schedule to builtin cron trigger on create", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, "schedulerTaskCreate", {
      name: "Daily",
      scope: { type: "global" },
      schedule: { type: "cron", expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      action: { type: "builtin.command", config: { command: "date" } },
    })
    expect(service.createTask).toHaveBeenCalledWith({
      name: "Daily",
      description: undefined,
      scope: { type: "global" },
      cwd: undefined,
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      action: { type: "builtin.command", config: { command: "date" } },
      enabled: undefined,
      missedRunPolicy: undefined,
    })
  })

  it("maps interval schedule to builtin interval trigger on create", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, "schedulerTaskCreate", {
      name: "Every 30",
      scope: { type: "global" },
      schedule: { type: "interval", everyMinutes: 30 },
      action: { type: "builtin.command", config: { command: "date" } },
      enabled: false,
      missedRunPolicy: "run_once",
    })
    expect(service.createTask).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: undefined } },
      enabled: false,
      missedRunPolicy: "run_once",
    }))
  })

  it("enables and disables tasks by id", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, "schedulerTaskEnable", { taskId: "task:1" })
    await dispatchSchedulerAction(service, "schedulerTaskDisable", { taskId: "task:1" })
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(1, "task:1", true)
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(2, "task:1", false)
  })

  it("rejects unknown scheduler actions and invalid task ids", async () => {
    const service = serviceMock()
    await expect(dispatchSchedulerAction(service, "schedulerTaskGet", {})).rejects.toThrow(/taskId/)
    await expect(dispatchSchedulerAction(service, "missingSchedulerAction", { taskId: "task:1" })).rejects.toThrow(/Unknown scheduler action/)
  })
})
```

- [ ] **Step 2: Run failing dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/external-api.test.ts
```

Expected: FAIL because `external-api.ts` does not exist.

- [ ] **Step 3: Implement Scheduler external dispatcher**

Create `desktop/electron/services/task-scheduler/external-api.ts`:

```ts
import type {
  SchedulerTaskCreateParams,
  SchedulerTaskIdParams,
  SchedulerTaskListParams,
} from "../../../synapse-capabilities/shared/scheduler-domain"
import type { DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { TaskSchedulerService } from "./task-scheduler-service"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskEntry,
  TaskTrigger,
} from "./types"

type SchedulerServicePort = Pick<
  TaskSchedulerService,
  "listTasks" | "getTask" | "createTask" | "setTaskEnabled"
>

export type SchedulerTaskSummary = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly schedule: SchedulerTaskCreateParams["schedule"]
  readonly action: { readonly type: string }
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: string
  readonly runCount: number
}

export async function dispatchSchedulerAction(
  service: SchedulerServicePort,
  action: string,
  params: Record<string, unknown>,
): Promise<DispatchResult> {
  switch (action) {
    case "schedulerTaskList": {
      const input = parseListParams(params)
      const tasks = await service.listTasks()
      const filtered = tasks
        .filter((task) => input.enabled === undefined || task.enabled === input.enabled)
        .slice(0, input.limit ?? tasks.length)
        .map(toPublicTaskSummary)
      return { ok: true, data: filtered, total: filtered.length }
    }

    case "schedulerTaskGet": {
      const { taskId } = parseTaskIdParams(params)
      return { ok: true, data: await service.getTask(taskId) }
    }

    case "schedulerTaskCreate": {
      const input = toCreateInput(parseCreateParams(params))
      return { ok: true, data: await service.createTask(input) }
    }

    case "schedulerTaskEnable": {
      const { taskId } = parseTaskIdParams(params)
      return { ok: true, data: await service.setTaskEnabled(taskId, true) }
    }

    case "schedulerTaskDisable": {
      const { taskId } = parseTaskIdParams(params)
      return { ok: true, data: await service.setTaskEnabled(taskId, false) }
    }

    default:
      throw new Error(`Unknown scheduler action: ${action}`)
  }
}

export function toPublicTaskSummary(task: ScheduledTaskEntry): SchedulerTaskSummary {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    enabled: task.enabled,
    schedule: fromTrigger(task.trigger),
    action: { type: task.action.type },
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastStatus: task.lastStatus,
    runCount: task.runCount,
  }
}

function parseListParams(params: Record<string, unknown>): SchedulerTaskListParams {
  const enabled = params.enabled
  const limit = params.limit
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error("Missing or invalid 'enabled': expected boolean")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  return {
    enabled,
    limit: limit as number | undefined,
  }
}

function parseTaskIdParams(params: Record<string, unknown>): SchedulerTaskIdParams {
  const taskId = params.taskId
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Missing or invalid 'taskId': expected non-empty string")
  }
  return { taskId }
}

function parseCreateParams(params: Record<string, unknown>): SchedulerTaskCreateParams {
  const name = params.name
  const scope = params.scope
  const schedule = params.schedule
  const action = params.action
  if (typeof name !== "string" || !name.trim()) throw new Error("Missing or invalid 'name': expected non-empty string")
  if (!isRecord(scope)) throw new Error("Missing or invalid 'scope': expected object")
  if (!isRecord(schedule)) throw new Error("Missing or invalid 'schedule': expected object")
  if (!isRecord(action)) throw new Error("Missing or invalid 'action': expected object")
  return {
    name,
    description: optionalString(params.description, "description"),
    scope: parseScope(scope),
    cwd: optionalString(params.cwd, "cwd"),
    schedule: parseSchedule(schedule),
    action: parseAction(action),
    enabled: optionalBoolean(params.enabled, "enabled"),
    missedRunPolicy: parseMissedRunPolicy(params.missedRunPolicy),
  }
}

function toCreateInput(input: SchedulerTaskCreateParams): ScheduledTaskCreateInput {
  return {
    name: input.name,
    description: input.description,
    scope: input.scope,
    cwd: input.cwd,
    trigger: toTrigger(input.schedule),
    action: input.action,
    enabled: input.enabled,
    missedRunPolicy: input.missedRunPolicy,
  }
}

function toTrigger(schedule: SchedulerTaskCreateParams["schedule"]): TaskTrigger {
  if (schedule.type === "cron") {
    return { type: "builtin.cron", config: { expr: schedule.expr, timezone: schedule.timezone } }
  }
  return { type: "builtin.interval", config: { everyMinutes: schedule.everyMinutes, anchor: schedule.anchor } }
}

function fromTrigger(trigger: TaskTrigger): SchedulerTaskCreateParams["schedule"] {
  if (trigger.type === "builtin.cron") {
    return { type: "cron", expr: trigger.config.expr, timezone: trigger.config.timezone }
  }
  return {
    type: "interval",
    everyMinutes: trigger.config.everyMinutes,
    anchor: trigger.config.anchor,
  }
}

function parseScope(scope: Record<string, unknown>): SchedulerTaskCreateParams["scope"] {
  if (scope.type === "global") return { type: "global" }
  if (scope.type === "project" && typeof scope.projectId === "string" && scope.projectId.trim()) {
    return { type: "project", projectId: scope.projectId }
  }
  throw new Error("Missing or invalid 'scope': expected global or project scope")
}

function parseSchedule(schedule: Record<string, unknown>): SchedulerTaskCreateParams["schedule"] {
  if (schedule.type === "cron") {
    if (typeof schedule.expr !== "string" || !schedule.expr.trim()) {
      throw new Error("Missing or invalid 'schedule.expr': expected non-empty string")
    }
    return {
      type: "cron",
      expr: schedule.expr,
      timezone: optionalString(schedule.timezone, "schedule.timezone"),
    }
  }
  if (schedule.type === "interval") {
    if (!Number.isInteger(schedule.everyMinutes) || Number(schedule.everyMinutes) < 1) {
      throw new Error("Missing or invalid 'schedule.everyMinutes': expected positive integer")
    }
    if (
      schedule.anchor !== undefined
      && schedule.anchor !== "created_at"
      && schedule.anchor !== "last_completed_at"
    ) {
      throw new Error("Missing or invalid 'schedule.anchor': expected created_at or last_completed_at")
    }
    return {
      type: "interval",
      everyMinutes: schedule.everyMinutes as number,
      anchor: schedule.anchor as "created_at" | "last_completed_at" | undefined,
    }
  }
  throw new Error("Missing or invalid 'schedule.type': expected cron or interval")
}

function parseAction(action: Record<string, unknown>): SchedulerTaskCreateParams["action"] {
  if (typeof action.type !== "string" || !action.type.trim()) {
    throw new Error("Missing or invalid 'action.type': expected non-empty string")
  }
  if (!isRecord(action.config)) throw new Error("Missing or invalid 'action.config': expected object")
  return { type: action.type, config: action.config }
}

function parseMissedRunPolicy(value: unknown): "skip" | "run_once" | undefined {
  if (value === undefined) return undefined
  if (value === "skip" || value === "run_once") return value
  throw new Error("Missing or invalid 'missedRunPolicy': expected skip or run_once")
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  throw new Error(`Missing or invalid '${key}': expected string`)
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  throw new Error(`Missing or invalid '${key}': expected boolean`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
```

- [ ] **Step 4: Export the external API**

Modify `desktop/electron/services/task-scheduler/index.ts`:

```ts
export {
  dispatchSchedulerAction,
  toPublicTaskSummary,
  type SchedulerTaskSummary,
} from "./external-api"
```

Keep the existing exports in the file.

- [ ] **Step 5: Run dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/external-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/task-scheduler/external-api.ts desktop/electron/services/task-scheduler/index.ts desktop/electron/services/task-scheduler/__tests__/external-api.test.ts
git commit -m "feat: add scheduler external action dispatcher"
```

---

### Task 4: Add Neutral Electron Action Router And Wire HTTP API

**Files:**
- Create: `desktop/electron/capabilities/action-router.ts`
- Test: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/electron/database/http-server.ts`
- Modify: `desktop/electron/database/index.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/__tests__/registry.test.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`

- [ ] **Step 1: Write failing action router tests**

Create `desktop/electron/capabilities/__tests__/action-router.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../action-router"

describe("createSynapseActionRouter", () => {
  it("routes Database actions to the Database dispatcher", async () => {
    const databaseDispatch = vi.fn(() => ({ ok: true, data: ["tables"] }))
    const schedulerDispatch = vi.fn()
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
    })

    await expect(router.dispatch("databaseTableList", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: ["tables"],
    })
    expect(databaseDispatch).toHaveBeenCalledWith("databaseTableList", {}, { source: "api" })
    expect(schedulerDispatch).not.toHaveBeenCalled()
  })

  it("routes Scheduler actions to the Scheduler dispatcher", async () => {
    const databaseDispatch = vi.fn()
    const schedulerDispatch = vi.fn(async () => ({ ok: true, data: [] }))
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
    })

    await expect(router.dispatch("schedulerTaskList", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(schedulerDispatch).toHaveBeenCalledWith("schedulerTaskList", {}, { source: "api" })
    expect(databaseDispatch).not.toHaveBeenCalled()
  })

  it("rejects unknown actions", async () => {
    const router = createSynapseActionRouter({
      databaseDispatch: vi.fn(),
      schedulerDispatch: vi.fn(),
    })

    await expect(router.dispatch("missingAction", {}, { source: "api" })).rejects.toThrow(/Unknown action/)
  })
})
```

- [ ] **Step 2: Run failing action router tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts
```

Expected: FAIL because `action-router.ts` does not exist.

- [ ] **Step 3: Implement neutral action router**

Create `desktop/electron/capabilities/action-router.ts`:

```ts
import { getActionDomainId } from "../../synapse-capabilities/shared/registry"
import type {
  DispatchContext,
  DispatchResult,
} from "../../synapse-capabilities/shared/types"

type DomainDispatch = (
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
) => DispatchResult | Promise<DispatchResult>

export type SynapseActionRouter = {
  readonly dispatch: DomainDispatch
}

export type SynapseActionRouterDeps = {
  readonly databaseDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
}

export function createSynapseActionRouter(deps: SynapseActionRouterDeps): SynapseActionRouter {
  return {
    async dispatch(action, params, context) {
      const domainId = getActionDomainId(action)
      if (domainId === "database") return deps.databaseDispatch(action, params, context)
      if (domainId === "scheduler") return deps.schedulerDispatch(action, params, context)
      throw new Error(`Unknown action: ${action}`)
    },
  }
}
```

- [ ] **Step 4: Run action router tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire HTTP server to action router**

Modify `desktop/electron/database/http-server.ts`:

```ts
import type { SynapseActionRouter } from "../capabilities/action-router"
```

Add a module-level router:

```ts
let actionRouter: SynapseActionRouter | null = null
```

Change the dispatch section inside `handleRequest`:

```ts
    const sourceHeader = req.headers["x-synapse-client"]
    const source = sourceHeader === "cli" || sourceHeader === "mcp-stdio" ? sourceHeader : "api"
    const result = await actionRouterForRequest().dispatch(action, params, { source })
    sendJson(res, 200, result)
```

Add this helper in the same file:

```ts
function actionRouterForRequest(): SynapseActionRouter {
  if (!actionRouter) {
    throw new Error("Synapse action router is not initialized")
  }
  return actionRouter
}
```

Change `startHttpServer` signature:

```ts
function startHttpServer(router: SynapseActionRouter): Promise<number> {
  actionRouter = router
  cleanupStaleServerInfo()
  return new Promise((resolve, reject) => {
    // existing body stays the same
  })
}
```

In `stopHttpServer`, clear the router:

```ts
    actionRouter = null
```

Remove the direct `dispatchDatabaseAction` import from this file.

- [ ] **Step 6: Wire database initialization to accept the router**

Modify `desktop/electron/database/index.ts`:

```ts
import type { SynapseActionRouter } from "../capabilities/action-router"
```

Change the init signature:

```ts
async function initDatabase(eventBus: EventBus | undefined, actionRouter: SynapseActionRouter): Promise<void> {
```

Change the HTTP start call:

```ts
  const port = await startHttpServer(actionRouter)
```

- [ ] **Step 7: Build the router in bootstrap and add Scheduler dependency**

Modify `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { createSynapseActionRouter } from "../capabilities/action-router"
import { dispatchDatabaseAction } from "../database/dispatcher"
import { dispatchSchedulerAction, type TaskSchedulerService } from "../services/task-scheduler"
```

Change `coreDatabaseDescriptor.dependsOn`:

```ts
dependsOn: ["core.config", "core.event-bus", "core.task-scheduler"],
```

Change `create`:

```ts
  async create(ctx) {
    const eventBus = ctx.registry.get<EventBus>("core.event-bus")
    const taskScheduler = ctx.registry.get<TaskSchedulerService>("core.task-scheduler")
    const actionRouter = createSynapseActionRouter({
      databaseDispatch: dispatchDatabaseAction,
      schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, action, params),
    })
    await initDatabase(eventBus, actionRouter)
    return { initialized: true }
  },
```

- [ ] **Step 8: Update bootstrap tests for dependency graph**

Modify `desktop/electron/bootstrap/__tests__/registry.test.ts`:

```ts
expect(byId.get("core.database")?.dependsOn).toEqual([
  "core.config",
  "core.event-bus",
  "core.task-scheduler",
])
expect(idx("core.task-scheduler")).toBeLessThan(idx("core.database"))
```

Modify `desktop/electron/bootstrap/__tests__/descriptors.test.ts` wherever it expects `core.database` dependencies:

```ts
expect(coreDatabaseDescriptor.dependsOn).toEqual([
  "core.config",
  "core.event-bus",
  "core.task-scheduler",
])
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts desktop/electron/database/http-server.ts desktop/electron/database/index.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat: route local api through capability domains"
```

---

### Task 5: Wire MCP HTTP And Stdio MCP To Combined Registry

**Files:**
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Modify: `desktop/electron/database/mcp-server.ts`
- Modify: `desktop/database/mcp/index.ts`
- Test: `desktop/tests/unit/mcp-scheduler-tools.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Create `desktop/tests/unit/mcp-scheduler-tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { processMcpRequest } from "../../database/shared/mcp-rpc"
import { SYNAPSE_MCP_SERVER_IDENTITY } from "../../database/shared/server-identity"
import { buildAllMcpTools, MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"

describe("MCP Scheduler tools", () => {
  it("lists existing Database tools and new Scheduler tools", () => {
    const names = buildAllMcpTools().map((tool) => tool.name)
    expect(names).toContain("database_table_list")
    expect(names).toContain("query")
    expect(names).toContain("scheduler_task_list")
    expect(names).toContain("scheduler_task_get")
    expect(names).toContain("scheduler_task_create")
    expect(names).toContain("scheduler_task_enable")
    expect(names).toContain("scheduler_task_disable")
  })

  it("maps Scheduler MCP tools to Scheduler actions", () => {
    expect(MCP_TOOL_ACTIONS.scheduler_task_list).toBe("schedulerTaskList")
    expect(MCP_TOOL_ACTIONS.scheduler_task_get).toBe("schedulerTaskGet")
    expect(MCP_TOOL_ACTIONS.scheduler_task_create).toBe("schedulerTaskCreate")
    expect(MCP_TOOL_ACTIONS.scheduler_task_enable).toBe("schedulerTaskEnable")
    expect(MCP_TOOL_ACTIONS.scheduler_task_disable).toBe("schedulerTaskDisable")
  })

  it("normalizes Scheduler MCP tool results to data payload", async () => {
    const executeTool = vi.fn(async () => ({
      ok: true,
      data: [{ id: "task:1", name: "Daily" }],
      total: 1,
    }))
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "scheduler_task_list",
        arguments: {},
      },
    }, SYNAPSE_MCP_SERVER_IDENTITY, executeTool)

    expect(response.kind).toBe("result")
    if (response.kind !== "result") return
    expect(response.result).toEqual({
      content: [{
        type: "text",
        text: JSON.stringify([{ id: "task:1", name: "Daily" }], null, 2),
      }],
    })
  })
})
```

- [ ] **Step 2: Run failing MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/mcp-scheduler-tools.test.ts
```

Expected: FAIL because `mcp-rpc.ts` still uses Database-only registry and normalization.

- [ ] **Step 3: Make Database MCP tool exports domain-specific and compatibility-safe**

Modify `desktop/database/shared/mcp-tools.ts` near the bottom:

```ts
const DATABASE_MCP_TOOL_ACTIONS: Record<string, string> = buildMcpToolActions()
const MCP_TOOL_ACTIONS: Record<string, string> = DATABASE_MCP_TOOL_ACTIONS

export {
  buildTools,
  buildTools as buildDatabaseTools,
  DATABASE_MCP_TOOL_ACTIONS,
  MCP_TOOL_ACTIONS,
}
```

Keep every existing Database tool schema unchanged.

- [ ] **Step 4: Update MCP RPC to use combined tools and domain-aware normalization**

Modify imports in `desktop/database/shared/mcp-rpc.ts`:

```ts
import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getMcpToolDomainId,
} from "../../synapse-capabilities/shared/registry"
```

Change `tools/list`:

```ts
  if (method === "tools/list") {
    return { kind: "result", id, result: { tools: buildAllMcpTools() } }
  }
```

Change `normalizeToolResult` default behavior:

```ts
function normalizeToolResult(toolName: string, result: unknown): unknown {
  if (!isRecord(result) || result.ok !== true) return result

  if (getMcpToolDomainId(toolName) === "scheduler") {
    return result.data
  }

  switch (toolName) {
    // keep existing Database cases unchanged
  }
}
```

- [ ] **Step 5: Wire MCP HTTP server to combined action registry and router**

Modify `desktop/electron/database/mcp-server.ts`:

```ts
import type { SynapseActionRouter } from "../capabilities/action-router"
import { MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"
```

Add module-level router:

```ts
let actionRouter: SynapseActionRouter | null = null
```

Change `executeTool`:

```ts
async function executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const action = MCP_TOOL_ACTIONS[toolName]
  if (!action) throw new Error(`Unknown tool: ${toolName}`)
  if (!actionRouter) throw new Error("Synapse action router is not initialized")
  return actionRouter.dispatch(action, args, { source: "mcp-http" })
}
```

Change `startMcpServer` signature:

```ts
async function startMcpServer(router: SynapseActionRouter): Promise<number> {
  actionRouter = router
  // existing loop stays the same
}
```

In `stopMcpServer`, clear the router:

```ts
      actionRouter = null
```

Modify `desktop/electron/database/index.ts`:

```ts
    mcpPort = await startMcpServer(actionRouter)
```

- [ ] **Step 6: Wire stdio MCP bridge to combined registry**

Modify imports in `desktop/database/mcp/index.ts`:

```ts
import { MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"
```

Keep `apiCall(getServerInfo(), action, args, "mcp-stdio")` unchanged.

- [ ] **Step 7: Run MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/mcp-scheduler-tools.test.ts tests/unit/synapse-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/database/shared/mcp-tools.ts desktop/database/shared/mcp-rpc.ts desktop/electron/database/mcp-server.ts desktop/electron/database/index.ts desktop/database/mcp/index.ts desktop/tests/unit/mcp-scheduler-tools.test.ts
git commit -m "feat: expose scheduler tools through mcp"
```

---

### Task 6: Add Scheduler CLI Namespace

**Files:**
- Create: `desktop/database/cli/scheduler.ts`
- Modify: `desktop/database/cli/index.ts`
- Test: `desktop/tests/unit/cli-scheduler.test.ts`

- [ ] **Step 1: Write failing CLI parser tests**

Create `desktop/tests/unit/cli-scheduler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { handleSchedulerCommand } from "../../database/cli/scheduler"

describe("handleSchedulerCommand", () => {
  it("lists scheduler tasks", async () => {
    const apiCall = vi.fn(async () => ({ data: [{ id: "task:1", name: "Daily", enabled: true }] }))
    const lines: string[] = []
    await handleSchedulerCommand(["list"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("schedulerTaskList", {})
    expect(lines.join("\n")).toContain("task:1")
  })

  it("gets a task by taskId", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:1", name: "Daily" } }))
    const lines: string[] = []
    await handleSchedulerCommand(["get", "task:1"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("schedulerTaskGet", { taskId: "task:1" })
    expect(lines.join("\n")).toContain("Daily")
  })

  it("creates a task from canonical JSON data", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:new", name: "Daily" } }))
    const lines: string[] = []
    await handleSchedulerCommand([
      "create",
      "--data",
      JSON.stringify({
        name: "Daily",
        scope: { type: "global" },
        schedule: { type: "interval", everyMinutes: 30 },
        action: { type: "builtin.command", config: { command: "date" } },
      }),
    ], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenCalledWith("schedulerTaskCreate", {
      name: "Daily",
      scope: { type: "global" },
      schedule: { type: "interval", everyMinutes: 30 },
      action: { type: "builtin.command", config: { command: "date" } },
    })
    expect(lines.join("\n")).toContain("task:new")
  })

  it("enables and disables tasks", async () => {
    const apiCall = vi.fn(async () => ({ data: { id: "task:1", enabled: true } }))
    const lines: string[] = []
    await handleSchedulerCommand(["enable", "task:1"], apiCall, (line) => lines.push(line))
    await handleSchedulerCommand(["disable", "task:1"], apiCall, (line) => lines.push(line))
    expect(apiCall).toHaveBeenNthCalledWith(1, "schedulerTaskEnable", { taskId: "task:1" })
    expect(apiCall).toHaveBeenNthCalledWith(2, "schedulerTaskDisable", { taskId: "task:1" })
  })

  it("rejects unknown scheduler commands", async () => {
    await expect(handleSchedulerCommand(["delete", "task:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
  })
})
```

- [ ] **Step 2: Run failing CLI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/cli-scheduler.test.ts
```

Expected: FAIL because `scheduler.ts` does not exist.

- [ ] **Step 3: Implement Scheduler CLI handler**

Create `desktop/database/cli/scheduler.ts`:

```ts
type CliApiCall = (action: string, params?: Record<string, unknown>) => Promise<unknown>
type PrintLine = (line: string) => void

export async function handleSchedulerCommand(
  args: string[],
  apiCall: CliApiCall,
  print: PrintLine = console.log,
): Promise<void> {
  const command = args[0]
  switch (command) {
    case "list": {
      const params: Record<string, unknown> = {}
      if (args.includes("--enabled")) params.enabled = true
      if (args.includes("--disabled")) params.enabled = false
      const limit = getNumberFlag(args, "--limit")
      if (limit !== undefined) params.limit = limit
      const result = await apiCall("schedulerTaskList", params) as { data?: unknown }
      printJson(result.data ?? [])
      break
    }

    case "get": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler get <taskId>")
      const result = await apiCall("schedulerTaskGet", { taskId }) as { data?: unknown }
      printJson(result.data ?? null)
      break
    }

    case "create": {
      const data = parseData(args)
      const result = await apiCall("schedulerTaskCreate", data as Record<string, unknown>) as { data?: { id?: string } }
      print(`Task created: ${result.data?.id ?? "-"}`)
      break
    }

    case "enable": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler enable <taskId>")
      await apiCall("schedulerTaskEnable", { taskId })
      print(`Task enabled: ${taskId}`)
      break
    }

    case "disable": {
      const taskId = requireArg(args[1], "Usage: synapse scheduler disable <taskId>")
      await apiCall("schedulerTaskDisable", { taskId })
      print(`Task disabled: ${taskId}`)
      break
    }

    default:
      throw new Error(`Unknown scheduler command: ${command ?? ""}\nRun "synapse help" for usage.`)
  }
}

function parseData(args: string[]): unknown {
  const value = getFlagValue(args, "--data")
  if (value === undefined) throw new Error("Usage: synapse scheduler create --data '{...}'")
  try {
    return JSON.parse(value)
  } catch {
    throw new Error("Invalid JSON for --data.")
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
  return value
}

function getNumberFlag(args: string[], flag: string): number | undefined {
  const value = getFlagValue(args, flag)
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid ${flag} value: expected positive integer`)
  return parsed
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) throw new Error(usage)
  return value
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}
```

- [ ] **Step 4: Fix injected print helper**

The `printJson` helper above writes to `console.log`, which bypasses the injected `print` in tests. Replace it with:

```ts
function printJson(value: unknown, print: PrintLine): void {
  print(JSON.stringify(value, null, 2))
}
```

And update call sites:

```ts
printJson(result.data ?? [], print)
printJson(result.data ?? null, print)
```

- [ ] **Step 5: Delegate top-level CLI to Scheduler namespace**

Modify `desktop/database/cli/index.ts` imports:

```ts
import { handleSchedulerCommand } from "./scheduler"
```

Update help text by adding:

```text
  synapse scheduler list [--enabled|--disabled] [--limit N]  List scheduled tasks
  synapse scheduler get <taskId>                             Get scheduled task detail
  synapse scheduler create --data '{...}'                    Create scheduled task
  synapse scheduler enable <taskId>                          Enable scheduled task
  synapse scheduler disable <taskId>                         Disable scheduled task
```

Update known commands:

```ts
  const KNOWN_COMMANDS = new Set([...getCliDataCommands(), "scheduler", "status"])
```

After the app-running check and before the existing switch:

```ts
    if (command === "scheduler") {
      await handleSchedulerCommand(args.slice(1), (action, params = {}) => apiCall(info, action, params))
      return
    }
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/cli-scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/database/cli/scheduler.ts desktop/database/cli/index.ts desktop/tests/unit/cli-scheduler.test.ts
git commit -m "feat: add scheduler cli namespace"
```

---

### Task 7: Full Verification And Drift Checks

**Files:**
- Review only unless previous tasks surface type or test failures.

- [ ] **Step 1: Run all focused tests from the feature**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/mcp-scheduler-tools.test.ts tests/unit/cli-scheduler.test.ts electron/services/task-scheduler/__tests__/external-api.test.ts electron/capabilities/__tests__/action-router.test.ts electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 5: Inspect for forbidden first-phase Scheduler tools**

Run:

```bash
rg -n "scheduler_task_(delete|update|run|stop|runs)|schedulerTask(Delete|Update|Run|Stop|Runs)" desktop/synapse-capabilities desktop/database desktop/electron
```

Expected: no matches.

- [ ] **Step 6: Inspect domain isolation**

Run:

```bash
rg -n "scheduler|TaskScheduler" desktop/electron/database/dispatcher.ts desktop/database/shared/capability-registry.ts desktop/database/shared/mcp-tools.ts
```

Expected: no matches.

- [ ] **Step 7: Commit final verification fixes if any were needed**

If Step 1-6 required changes:

```bash
git add <changed-files>
git commit -m "fix: align scheduler capability verification"
```

If no changes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: Tasks cover shared domains, Scheduler action metadata, Scheduler dispatcher, HTTP API, MCP HTTP, stdio MCP, CLI, dependency ordering, and verification.
- Domain isolation: Scheduler is not added to Database dispatcher, Database capability registry, or Database MCP schemas.
- First-phase scope: The plan exposes only list/get/create/enable/disable.
- ID lookup: `schedulerTaskGet` and `scheduler_task_get` use only `taskId`.
- Transport alignment: API, CLI, and MCP map to the same canonical action names.
- Verification: Hard constraints, typecheck, feature tests, and full tests are included.
