# Scheduler MCP External Capabilities Implementation Plan

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Scheduler run-history, runtime-status, action-type listing, and conservative task-update capabilities across the underlying service boundary, local API, CLI, and MCP.

**Architecture:** Promote `MainActionRegistry` to `core.action-runtime`, make Scheduler execution and action-type listing share the same registry, then route all new external Scheduler capabilities through a focused adapter. The Scheduler capability matrix remains the single source for API action names, CLI command metadata, and MCP tool names.

**Tech Stack:** Electron main process, TypeScript, Vitest, Zod, local HTTP `/api`, shared MCP JSON-RPC, existing `TaskSchedulerService`, existing `MainActionRegistry`.

---

## Source Spec

Read first:

- `docs/superpowers/specs/2026-05-02-scheduler-mcp-external-capabilities-design.md`

Hard constraints:

- Every exposed capability must align across underlying capability, API action, CLI command, and MCP tool.
- Do not expose delete, manual run, or stop-run through API, CLI, or MCP.
- Do not expose fake tools that only tell agents to use the UI.
- Do not change existing Database MCP behavior.
- Do not change renderer UI behavior in this plan.

## File Structure

Create:

- `desktop/electron/services/task-scheduler/external-capabilities.ts`  
  Owns Scheduler external dispatch, public input parsing, public schedule conversion, run summary shaping, runtime status shaping, action-type summary shaping, and restricted update validation.

Modify:

- `desktop/action-packages/types.ts`  
  Adds stable public action config field descriptor types to `ActionManifest`.

- `desktop/action-packages/builtin/command/manifest.ts`  
  Adds public config field descriptors for `builtin.command`.

- `desktop/action-packages/builtin/script/manifest.ts`  
  Adds public config field descriptors for `builtin.script`.

- `desktop/action-packages/builtin/http-request/manifest.ts`  
  Adds public config field descriptors for `builtin.http-request`.

- `desktop/electron/bootstrap/descriptors.ts`  
  Adds `core.action-runtime`; rewires `core.task-scheduler` and `core.database` to use it.

- `desktop/electron/bootstrap/index.ts`  
  Exports `coreActionRuntimeDescriptor`.

- `desktop/electron/bootstrap/registry.ts`  
  Registers `coreActionRuntimeDescriptor`.

- `desktop/electron/bootstrap/__tests__/descriptors.test.ts`  
  Verifies descriptor ids and dependencies.

- `desktop/synapse-capabilities/shared/scheduler-domain.ts`  
  Extends Scheduler capability metadata and MCP schemas for the four new external capabilities. Keeps delete, run-now, and stop-run absent.

- `desktop/tests/unit/synapse-capabilities.test.ts`  
  Adds matrix and negative exposure tests.

- `desktop/tests/unit/mcp-scheduler-tools.test.ts`  
  Adds MCP tool list and routing tests for the new tools.

- `desktop/electron/services/task-scheduler/external-api.ts`  
  Becomes a compatibility re-export for the new adapter.

- `desktop/electron/services/task-scheduler/index.ts`  
  Re-exports the new external adapter types/functions.

- `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`  
  Updates existing tests for the new dependency shape and adds tests for runs, status, action types, and restricted update.

- `desktop/electron/capabilities/__tests__/action-router.test.ts`  
  Adds routing tests for a new Scheduler action and unknown delete action.

- `desktop/database/cli/scheduler.ts`  
  Adds `runs`, `status`, `actions`, and `update` CLI commands. Keeps `delete`, `run`, and `stop` unsupported.

- `desktop/database/cli/index.ts`  
  Updates help text for new Scheduler commands and keeps hidden commands absent.

- `desktop/tests/unit/cli-scheduler.test.ts`  
  Adds CLI command mapping and negative command tests.

No renderer files should change.

---

### Task 1: Add Public Action Manifest Fields And `core.action-runtime`

**Files:**
- Modify: `desktop/action-packages/types.ts`
- Modify: `desktop/action-packages/builtin/command/manifest.ts`
- Modify: `desktop/action-packages/builtin/script/manifest.ts`
- Modify: `desktop/action-packages/builtin/http-request/manifest.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/index.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Test: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Test: `desktop/electron/action-runtime/__tests__/action-registry.test.ts`

- [ ] **Step 1: Write failing descriptor tests**

Update the existing `coreDatabaseDescriptor` dependency test in
`desktop/electron/bootstrap/__tests__/descriptors.test.ts` so the expected
dependency list includes the shared action runtime:

```ts
it("coreDatabaseDescriptor is degraded, depends on config, event bus, scheduler, and action runtime, has stop", async () => {
  const { coreDatabaseDescriptor } = await importBootstrap()
  expect(coreDatabaseDescriptor.id).toBe("core.database")
  expect(coreDatabaseDescriptor.criticality).toBe("degraded")
  expect(coreDatabaseDescriptor.dependsOn).toEqual([
    "core.config",
    "core.event-bus",
    "core.task-scheduler",
    "core.action-runtime",
  ])
  expect(coreDatabaseDescriptor.stop).toBeTypeOf("function")
})
```

Add these tests near the existing descriptor dependency tests:

```ts
it("coreActionRuntimeDescriptor creates the shared action registry", async () => {
  const { coreActionRuntimeDescriptor } = await importBootstrap()
  expect(coreActionRuntimeDescriptor.id).toBe("core.action-runtime")
  expect(coreActionRuntimeDescriptor.criticality).toBe("fatal")
  expect(coreActionRuntimeDescriptor.dependsOn).toEqual([
    "core.permission-guard",
    "core.audit-sink",
  ])
  expect(coreActionRuntimeDescriptor.create).toBeTypeOf("function")
})

it("coreTaskSchedulerDescriptor depends on action runtime", async () => {
  const { coreTaskSchedulerDescriptor } = await importBootstrap()
  expect(coreTaskSchedulerDescriptor.dependsOn).toEqual([
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.action-runtime",
  ])
})
```

- [ ] **Step 2: Write failing action manifest field test**

Add this test to `desktop/electron/action-runtime/__tests__/action-registry.test.ts`:

```ts
import { createBuiltinMainActionRegistry } from "../builtin-actions"

it("built-in action manifests expose public config fields", () => {
  const registry = createBuiltinMainActionRegistry({
    processRunner: {
      run: async () => ({
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        durationMs: 0,
      }),
    },
  })

  const summaries = registry.list().map((action) => ({
    id: action.manifest.id,
    fields: action.manifest.configFields.map((field) => field.name),
  }))

  expect(summaries).toEqual(expect.arrayContaining([
    { id: "builtin.command", fields: ["command", "shell", "env", "timeoutMins"] },
    { id: "builtin.script", fields: ["script", "shell", "env", "timeoutMins"] },
    { id: "builtin.http-request", fields: ["method", "url", "headers", "query", "bodyType", "body", "timeoutMins"] },
  ]))
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/descriptors.test.ts electron/action-runtime/__tests__/action-registry.test.ts
```

Expected: FAIL because `coreActionRuntimeDescriptor` and `configFields` do not exist yet.

- [ ] **Step 4: Add public action config field types**

Modify `desktop/action-packages/types.ts`:

```ts
export type ActionConfigFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "record"

export type ActionConfigFieldDescriptor = {
  readonly name: string
  readonly kind: ActionConfigFieldKind
  readonly required: boolean
  readonly description?: string
  readonly choices?: readonly string[]
  readonly defaultValue?: unknown
}

export type ActionManifest<TConfig extends ActionConfig = ActionConfig> = {
  readonly id: string
  readonly title: string
  readonly permissions: readonly ActionPermissionName[]
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
  readonly configFields: readonly ActionConfigFieldDescriptor[]
}
```

Keep the existing `ActionRunStatus`, `ActionRunResult`, `ActionConfig`, and permission types unchanged.

- [ ] **Step 5: Add command action field descriptors**

Modify `desktop/action-packages/builtin/command/manifest.ts`:

```ts
export const commandActionManifest = {
  id: "builtin.command",
  title: "命令",
  permissions: ["shell.exec"],
  defaultConfig: {
    command: "",
    shell: "posix",
    timeoutMins: 30,
  },
  configFields: [
    {
      name: "command",
      kind: "string",
      required: true,
      description: "Shell command to run.",
      defaultValue: "",
    },
    {
      name: "shell",
      kind: "enum",
      required: true,
      description: "Shell runtime.",
      choices: ["posix", "cmd", "powershell"],
      defaultValue: "posix",
    },
    {
      name: "env",
      kind: "record",
      required: false,
      description: "Additional environment variables.",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes. Null disables the timeout.",
      defaultValue: 30,
    },
  ],
  configSchema: commandActionConfigSchema,
} satisfies ActionManifest<CommandActionConfig>
```

- [ ] **Step 6: Add script action field descriptors**

Modify `desktop/action-packages/builtin/script/manifest.ts`:

```ts
export const scriptActionManifest = {
  id: "builtin.script",
  title: "脚本",
  permissions: ["shell.exec"],
  defaultConfig: {
    script: "",
    shell: "posix",
    timeoutMins: 30,
  },
  configFields: [
    {
      name: "script",
      kind: "string",
      required: true,
      description: "Shell script content to run.",
      defaultValue: "",
    },
    {
      name: "shell",
      kind: "enum",
      required: true,
      description: "Shell runtime.",
      choices: ["posix", "cmd", "powershell"],
      defaultValue: "posix",
    },
    {
      name: "env",
      kind: "record",
      required: false,
      description: "Additional environment variables.",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes. Null disables the timeout.",
      defaultValue: 30,
    },
  ],
  configSchema: scriptActionConfigSchema,
} satisfies ActionManifest<ScriptActionConfig>
```

- [ ] **Step 7: Add HTTP request action field descriptors**

Modify `desktop/action-packages/builtin/http-request/manifest.ts`:

```ts
export const httpRequestActionManifest = {
  id: "builtin.http-request",
  title: "HTTP 请求",
  permissions: ["network.connect"],
  defaultConfig: {
    method: "GET",
    url: "",
    bodyType: "none",
    timeoutMins: 5,
  },
  configFields: [
    {
      name: "method",
      kind: "enum",
      required: true,
      description: "HTTP method.",
      choices: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      defaultValue: "GET",
    },
    {
      name: "url",
      kind: "string",
      required: true,
      description: "Absolute request URL.",
      defaultValue: "",
    },
    {
      name: "headers",
      kind: "record",
      required: false,
      description: "Request headers.",
    },
    {
      name: "query",
      kind: "record",
      required: false,
      description: "Query parameters.",
    },
    {
      name: "bodyType",
      kind: "enum",
      required: true,
      description: "Request body type.",
      choices: ["none", "json", "text"],
      defaultValue: "none",
    },
    {
      name: "body",
      kind: "string",
      required: false,
      description: "Request body.",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes. Null disables the timeout.",
      defaultValue: 5,
    },
  ],
  configSchema: httpRequestActionConfigSchema,
} satisfies ActionManifest<HttpRequestActionConfig>
```

- [ ] **Step 8: Add `core.action-runtime` descriptor and rewire Scheduler**

Modify imports in `desktop/electron/bootstrap/descriptors.ts` to include `MainActionRegistry`:

```ts
import type { MainActionRegistry } from "../action-runtime/action-registry"
```

Add this descriptor before `coreTaskSchedulerDescriptor`:

```ts
export const coreActionRuntimeDescriptor: ServiceDescriptor<MainActionRegistry> = {
  id: "core.action-runtime",
  criticality: "fatal",
  dependsOn: [
    "core.permission-guard",
    "core.audit-sink",
  ],
  create(ctx) {
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    return createBuiltinMainActionRegistry({
      processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
    })
  },
}
```

Change `coreTaskSchedulerDescriptor.dependsOn`:

```ts
dependsOn: [
  "core.data-repository",
  "core.permission-guard",
  "core.audit-sink",
  "core.action-runtime",
],
```

Inside `coreTaskSchedulerDescriptor.create`, replace local registry creation:

```ts
const actions = ctx.registry.get<MainActionRegistry>("core.action-runtime")
```

Remove this local block from `coreTaskSchedulerDescriptor.create`:

```ts
const actions = createBuiltinMainActionRegistry({
  processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
})
```

- [ ] **Step 9: Rewire Database descriptor to use action runtime**

Change `coreDatabaseDescriptor.dependsOn`:

```ts
dependsOn: ["core.config", "core.event-bus", "core.task-scheduler", "core.action-runtime"],
```

Inside `coreDatabaseDescriptor.create`, add:

```ts
const actionRuntime = ctx.registry.get<MainActionRegistry>("core.action-runtime")
```

Change Scheduler dispatch wiring:

```ts
schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
```

- [ ] **Step 10: Export and register the descriptor**

Modify `desktop/electron/bootstrap/index.ts` export list:

```ts
export {
  coreActionRuntimeDescriptor,
  coreAppIconDescriptor,
  coreConfigDescriptor,
  coreDatabaseDescriptor,
  coreLoggingDescriptor,
  coreTaskSchedulerDescriptor,
  coreUpdateDescriptor,
  createUiTrayDescriptor,
  repoMaintenanceDescriptor,
  repoPendingPushesDescriptor,
  repoSyncCoordinatorDescriptor,
  repoWatchDescriptor,
} from "./descriptors"
```

Modify imports in `desktop/electron/bootstrap/registry.ts`:

```ts
coreActionRuntimeDescriptor,
```

Register it before `coreTaskSchedulerDescriptor`:

```ts
registry.register(coreActionRuntimeDescriptor)
registry.register(coreTaskSchedulerDescriptor)
```

- [ ] **Step 11: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/descriptors.test.ts electron/action-runtime/__tests__/action-registry.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add desktop/action-packages/types.ts \
  desktop/action-packages/builtin/command/manifest.ts \
  desktop/action-packages/builtin/script/manifest.ts \
  desktop/action-packages/builtin/http-request/manifest.ts \
  desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/bootstrap/index.ts \
  desktop/electron/bootstrap/registry.ts \
  desktop/electron/bootstrap/__tests__/descriptors.test.ts \
  desktop/electron/action-runtime/__tests__/action-registry.test.ts
git commit -m "feat: add shared action runtime registry"
```

---

### Task 2: Extend Scheduler Capability Matrix And MCP Schemas

**Files:**
- Modify: `desktop/synapse-capabilities/shared/scheduler-domain.ts`
- Modify: `desktop/tests/unit/synapse-capabilities.test.ts`
- Modify: `desktop/tests/unit/mcp-scheduler-tools.test.ts`

- [ ] **Step 1: Write failing capability matrix tests**

Add to `desktop/tests/unit/synapse-capabilities.test.ts`:

```ts
it("registers second-phase Scheduler external capabilities", () => {
  expect(SCHEDULER_DOMAIN.capabilities.map((capability) => capability.action)).toEqual([
    "schedulerTaskList",
    "schedulerTaskGet",
    "schedulerTaskCreate",
    "schedulerTaskEnable",
    "schedulerTaskDisable",
    "schedulerTaskRunsList",
    "schedulerTaskRuntimeStatus",
    "schedulerActionTypesList",
    "schedulerTaskUpdate",
  ])
  expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_runs_list).toBe("schedulerTaskRunsList")
  expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_runtime_status).toBe("schedulerTaskRuntimeStatus")
  expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_action_types_list).toBe("schedulerActionTypesList")
  expect(SCHEDULER_MCP_TOOL_ACTIONS.scheduler_task_update).toBe("schedulerTaskUpdate")
})

it("does not expose destructive or execution-control Scheduler capabilities", () => {
  const actions = SCHEDULER_DOMAIN.capabilities.map((capability) => capability.action)
  const tools = buildSchedulerTools().map((tool) => tool.name)
  expect(actions).not.toContain("schedulerTaskDelete")
  expect(actions).not.toContain("schedulerTaskRunNow")
  expect(actions).not.toContain("schedulerTaskStopRun")
  expect(tools).not.toContain("scheduler_task_delete")
  expect(tools).not.toContain("scheduler_task_run_now")
  expect(tools).not.toContain("scheduler_task_stop_run")
})
```

Add to `desktop/tests/unit/mcp-scheduler-tools.test.ts`:

```ts
it("lists second-phase Scheduler MCP tools and omits hidden tools", () => {
  const names = buildAllMcpTools().map((tool) => tool.name)
  expect(names).toContain("scheduler_task_runs_list")
  expect(names).toContain("scheduler_task_runtime_status")
  expect(names).toContain("scheduler_action_types_list")
  expect(names).toContain("scheduler_task_update")
  expect(names).not.toContain("scheduler_task_delete")
  expect(names).not.toContain("scheduler_task_run_now")
  expect(names).not.toContain("scheduler_task_stop_run")
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/mcp-scheduler-tools.test.ts
```

Expected: FAIL because the new capabilities are not registered yet.

- [ ] **Step 3: Add public Scheduler update type**

Modify `desktop/synapse-capabilities/shared/scheduler-domain.ts` after `SchedulerTaskCreateParams`:

```ts
export type SchedulerTaskUpdateParams = {
  readonly taskId: string
  readonly name?: string
  readonly description?: string
  readonly cwd?: string
  readonly schedule?: SchedulerSchedule
  readonly missedRunPolicy?: "skip" | "run_once"
}

export type SchedulerTaskRunsListParams = {
  readonly taskId: string
  readonly limit?: number
}

export type SchedulerTaskRuntimeStatusParams = {
  readonly taskId?: string
}
```

- [ ] **Step 4: Extend Scheduler capability metadata**

Replace `schedulerCapabilities` with:

```ts
const schedulerCapabilities = [
  { action: "schedulerTaskList", mcpTool: "scheduler_task_list", cliCommand: "scheduler list", mutates: false },
  { action: "schedulerTaskGet", mcpTool: "scheduler_task_get", cliCommand: "scheduler get", mutates: false },
  { action: "schedulerTaskCreate", mcpTool: "scheduler_task_create", cliCommand: "scheduler create", mutates: true },
  { action: "schedulerTaskEnable", mcpTool: "scheduler_task_enable", cliCommand: "scheduler enable", mutates: true },
  { action: "schedulerTaskDisable", mcpTool: "scheduler_task_disable", cliCommand: "scheduler disable", mutates: true },
  { action: "schedulerTaskRunsList", mcpTool: "scheduler_task_runs_list", cliCommand: "scheduler runs", mutates: false },
  { action: "schedulerTaskRuntimeStatus", mcpTool: "scheduler_task_runtime_status", cliCommand: "scheduler status", mutates: false },
  { action: "schedulerActionTypesList", mcpTool: "scheduler_action_types_list", cliCommand: "scheduler actions", mutates: false },
  { action: "schedulerTaskUpdate", mcpTool: "scheduler_task_update", cliCommand: "scheduler update", mutates: true },
] as const
```

- [ ] **Step 5: Add MCP schemas for new tools**

Append these tool definitions to the array returned by `buildSchedulerTools()`:

```ts
{
  name: "scheduler_task_runs_list",
  description: "List recent runs for one scheduled task. This is read-only and does not stop or start runs.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: taskIdProperty,
      limit: { type: "number", description: "Optional maximum number of runs. Defaults to 20 and caps at 100." },
    },
    required: ["taskId"],
  },
},
{
  name: "scheduler_task_runtime_status",
  description: "Inspect Scheduler runtime state. Pass taskId for one task, or omit it for all tasks.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Optional scheduled task id." },
    },
  },
},
{
  name: "scheduler_action_types_list",
  description: "List task action types that can be used when creating scheduled tasks, including public config fields and defaults.",
  inputSchema: { type: "object", properties: {} },
},
{
  name: "scheduler_task_update",
  description: "Conservatively update a scheduled task. Only name, description, cwd, schedule, and missedRunPolicy are accepted. Use scheduler_task_enable or scheduler_task_disable for enabled state. Task action, scope, delete, manual run, and stop-run are not exposed through MCP.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: taskIdProperty,
      name: { type: "string", description: "Optional new task name." },
      description: { type: "string", description: "Optional new task description." },
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
      missedRunPolicy: { type: "string", enum: ["skip", "run_once"] },
    },
    required: ["taskId"],
  },
},
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/synapse-capabilities.test.ts tests/unit/mcp-scheduler-tools.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/synapse-capabilities/shared/scheduler-domain.ts \
  desktop/tests/unit/synapse-capabilities.test.ts \
  desktop/tests/unit/mcp-scheduler-tools.test.ts
git commit -m "feat: extend scheduler external capability metadata"
```

---

### Task 3: Add Scheduler External Adapter

**Files:**
- Create: `desktop/electron/services/task-scheduler/external-capabilities.ts`
- Modify: `desktop/electron/services/task-scheduler/external-api.ts`
- Modify: `desktop/electron/services/task-scheduler/index.ts`
- Modify: `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`

- [ ] **Step 1: Write failing external adapter tests**

Replace `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts` with tests that cover old and new behavior:

```ts
import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import { MainActionRegistry, type MainActionDefinition } from "../../../action-runtime/action-registry"
import type { ActionExecutionInput } from "../../../action-runtime/action-registry"
import { dispatchSchedulerAction, toPublicTaskSummary } from "../external-api"
import type { TaskSchedulerService } from "../task-scheduler-service"
import type { ScheduledTaskEntry, ScheduledTaskRunEntry } from "../types"

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

const baseRun: ScheduledTaskRunEntry = {
  id: "run:1",
  schemaVersion: 2,
  taskId: "task:1",
  startedAt: "2026-05-02T00:10:00.000Z",
  finishedAt: "2026-05-02T00:10:02.000Z",
  status: "success",
  triggeredBy: "schedule",
  result: {
    status: "success",
    summary: "ok",
    logs: [{ label: "stdout", value: "large output" }],
    metrics: { durationMs: 2000, exitCode: 0 },
  },
}

function serviceMock(): TaskSchedulerService {
  return {
    listTasks: vi.fn(async () => [baseTask, { ...baseTask, id: "task:2", enabled: false }]),
    getTask: vi.fn(async (id: string) => (id === "task:1" ? baseTask : null)),
    createTask: vi.fn(async (input) => ({ ...baseTask, ...input, id: "task:new" })),
    updateTask: vi.fn(async (_id, patch) => ({ ...baseTask, ...patch, updatedAt: "2026-05-02T00:20:00.000Z" })),
    setTaskEnabled: vi.fn(async (_id: string, enabled: boolean) => ({ ...baseTask, enabled })),
    listRuns: vi.fn(async () => [baseRun]),
    inspect: vi.fn(() => ({ timers: ["task:1"], runningTaskIds: ["task:2"] })),
  } as unknown as TaskSchedulerService
}

function actionRegistry(): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(testAction())
  return registry
}

const testActionSchema = z.object({ command: z.string().min(1) })
type TestActionConfig = z.infer<typeof testActionSchema>

function testAction(): MainActionDefinition<TestActionConfig> {
  return {
    manifest: {
      id: "builtin.command",
      title: "命令",
      permissions: ["shell.exec"],
      defaultConfig: { command: "date" },
      configFields: [
        { name: "command", kind: "string", required: true, defaultValue: "" },
      ],
      configSchema: testActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.command,
    }),
    execute: async (_input: ActionExecutionInput<TestActionConfig>) => ({ status: "success" }),
  }
}

describe("task scheduler external api", () => {
  it("keeps list/get/create/enable/disable behavior", async () => {
    const service = serviceMock()
    const actions = actionRegistry()

    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskList", { enabled: true }))
      .resolves.toEqual({ ok: true, data: [toPublicTaskSummary(baseTask)], total: 1 })
    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskGet", { taskId: "task:1" }))
      .resolves.toEqual({ ok: true, data: baseTask })
    await dispatchSchedulerAction(service, actions, "schedulerTaskEnable", { taskId: "task:1" })
    await dispatchSchedulerAction(service, actions, "schedulerTaskDisable", { taskId: "task:1" })
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(1, "task:1", true)
    expect(service.setTaskEnabled).toHaveBeenNthCalledWith(2, "task:1", false)
  })

  it("lists run summaries without log payloads", async () => {
    const service = serviceMock()
    const result = await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskRunsList", {
      taskId: "task:1",
    })

    expect(service.listRuns).toHaveBeenCalledWith("task:1", { limit: 20 })
    expect(result).toEqual({
      ok: true,
      data: [{
        id: "run:1",
        taskId: "task:1",
        status: "success",
        triggeredBy: "schedule",
        startedAt: "2026-05-02T00:10:00.000Z",
        finishedAt: "2026-05-02T00:10:02.000Z",
        summary: "ok",
        metrics: { durationMs: 2000, exitCode: 0 },
      }],
      total: 1,
    })
    expect(JSON.stringify(result)).not.toContain("large output")
  })

  it("returns runtime status for all tasks and one task", async () => {
    const service = serviceMock()
    const all = await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskRuntimeStatus", {})
    expect(all).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        runningTaskIds: ["task:2"],
        scheduledTaskIds: ["task:1"],
      }),
    }))

    const one = await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskRuntimeStatus", { taskId: "task:1" })
    expect(one).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        tasks: [expect.objectContaining({ id: "task:1", scheduled: true, running: false })],
      }),
    }))
  })

  it("lists public action type descriptors from the shared registry", async () => {
    const result = await dispatchSchedulerAction(serviceMock(), actionRegistry(), "schedulerActionTypesList", {})
    expect(result).toEqual({
      ok: true,
      data: [{
        type: "builtin.command",
        title: "命令",
        permissions: ["shell.exec"],
        defaultConfig: { command: "date" },
        configFields: [{ name: "command", kind: "string", required: true, defaultValue: "" }],
      }],
      total: 1,
    })
  })

  it("updates only conservative public fields", async () => {
    const service = serviceMock()
    await dispatchSchedulerAction(service, actionRegistry(), "schedulerTaskUpdate", {
      taskId: "task:1",
      name: "Updated",
      schedule: { type: "cron", expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      missedRunPolicy: "run_once",
    })

    expect(service.updateTask).toHaveBeenCalledWith("task:1", {
      name: "Updated",
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      missedRunPolicy: "run_once",
    })
  })

  it("rejects empty and forbidden update patches", async () => {
    const service = serviceMock()
    const actions = actionRegistry()
    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskUpdate", { taskId: "task:1" }))
      .rejects.toThrow(/at least one field/)
    await expect(dispatchSchedulerAction(service, actions, "schedulerTaskUpdate", {
      taskId: "task:1",
      action: { type: "builtin.command", config: { command: "rm -rf /tmp/x" } },
    }))
      .rejects.toThrow(/Forbidden scheduler update field: action/)
  })

  it("rejects hidden external actions", async () => {
    await expect(dispatchSchedulerAction(serviceMock(), actionRegistry(), "schedulerTaskDelete", { taskId: "task:1" }))
      .rejects.toThrow(/Unknown scheduler action/)
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/external-api.test.ts
```

Expected: FAIL because `dispatchSchedulerAction` does not accept an action registry and new actions are missing.

- [ ] **Step 3: Create external adapter**

Create `desktop/electron/services/task-scheduler/external-capabilities.ts`:

```ts
import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type {
  SchedulerSchedule,
  SchedulerTaskCreateParams,
  SchedulerTaskIdParams,
  SchedulerTaskListParams,
  SchedulerTaskRunsListParams,
  SchedulerTaskRuntimeStatusParams,
  SchedulerTaskUpdateParams,
} from "../../../synapse-capabilities/shared/scheduler-domain"
import type { DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { TaskSchedulerService } from "./task-scheduler-service"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
  ScheduledTaskUpdateInput,
  TaskTrigger,
} from "./types"

type SchedulerServicePort = Pick<
  TaskSchedulerService,
  "listTasks" | "getTask" | "createTask" | "updateTask" | "setTaskEnabled" | "listRuns" | "inspect"
>

export type SchedulerTaskSummary = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly schedule: SchedulerSchedule
  readonly action: { readonly type: string }
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: string
  readonly runCount: number
}

export async function dispatchSchedulerAction(
  service: SchedulerServicePort,
  actions: MainActionRegistry,
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
    case "schedulerTaskRunsList": {
      const input = parseRunsListParams(params)
      const task = await service.getTask(input.taskId)
      if (!task) throw new Error(`Scheduled task "${input.taskId}" was not found`)
      const runs = await service.listRuns(input.taskId, { limit: input.limit })
      return { ok: true, data: runs.map(toRunSummary), total: runs.length }
    }
    case "schedulerTaskRuntimeStatus": {
      const input = parseRuntimeStatusParams(params)
      return { ok: true, data: await buildRuntimeStatus(service, input) }
    }
    case "schedulerActionTypesList": {
      const summaries = actions.list().map((definition) => ({
        type: definition.manifest.id,
        title: definition.manifest.title,
        permissions: [...definition.manifest.permissions],
        defaultConfig: definition.manifest.defaultConfig,
        configFields: definition.manifest.configFields,
      }))
      return { ok: true, data: summaries, total: summaries.length }
    }
    case "schedulerTaskUpdate": {
      const input = parseUpdateParams(params)
      return { ok: true, data: await service.updateTask(input.taskId, toUpdatePatch(input)) }
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

function toRunSummary(run: ScheduledTaskRunEntry) {
  return {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    summary: run.result?.summary,
    metrics: run.result?.metrics,
  }
}

async function buildRuntimeStatus(
  service: SchedulerServicePort,
  input: SchedulerTaskRuntimeStatusParams,
) {
  const inspect = service.inspect()
  const runningTaskIds = [...inspect.runningTaskIds]
  const scheduledTaskIds = [...inspect.timers]
  const tasks = input.taskId
    ? [await service.getTask(input.taskId)]
    : await service.listTasks()
  if (input.taskId && !tasks[0]) {
    throw new Error(`Scheduled task "${input.taskId}" was not found`)
  }
  return {
    runningTaskIds,
    scheduledTaskIds,
    tasks: tasks
      .filter((task): task is ScheduledTaskEntry => task !== null)
      .map((task) => ({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        running: runningTaskIds.includes(task.id),
        scheduled: scheduledTaskIds.includes(task.id),
        nextRunAt: task.nextRunAt,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
      })),
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
  return { enabled: enabled as boolean | undefined, limit: limit as number | undefined }
}

function parseTaskIdParams(params: Record<string, unknown>): SchedulerTaskIdParams {
  const taskId = params.taskId
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Missing or invalid 'taskId': expected non-empty string")
  }
  return { taskId }
}

function parseRunsListParams(params: Record<string, unknown>): SchedulerTaskRunsListParams {
  const { taskId } = parseTaskIdParams(params)
  const rawLimit = params.limit
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || Number(rawLimit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  return { taskId, limit: Math.min(rawLimit === undefined ? 20 : rawLimit as number, 100) }
}

function parseRuntimeStatusParams(params: Record<string, unknown>): SchedulerTaskRuntimeStatusParams {
  if (params.taskId === undefined) return {}
  return parseTaskIdParams(params)
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

function parseUpdateParams(params: Record<string, unknown>): SchedulerTaskUpdateParams {
  const allowed = new Set(["taskId", "name", "description", "cwd", "schedule", "missedRunPolicy"])
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`Forbidden scheduler update field: ${key}`)
  }
  const { taskId } = parseTaskIdParams(params)
  const input: SchedulerTaskUpdateParams = {
    taskId,
    name: optionalString(params.name, "name"),
    description: optionalString(params.description, "description"),
    cwd: optionalString(params.cwd, "cwd"),
    schedule: params.schedule === undefined ? undefined : parseSchedule(requireRecord(params.schedule, "schedule")),
    missedRunPolicy: parseMissedRunPolicy(params.missedRunPolicy),
  }
  if (
    input.name === undefined
    && input.description === undefined
    && input.cwd === undefined
    && input.schedule === undefined
    && input.missedRunPolicy === undefined
  ) {
    throw new Error("schedulerTaskUpdate requires at least one field to update")
  }
  return input
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

function toUpdatePatch(input: SchedulerTaskUpdateParams): ScheduledTaskUpdateInput {
  return {
    name: input.name,
    description: input.description,
    cwd: input.cwd,
    trigger: input.schedule ? toTrigger(input.schedule) : undefined,
    missedRunPolicy: input.missedRunPolicy,
  }
}

function toTrigger(schedule: SchedulerSchedule): TaskTrigger {
  if (schedule.type === "cron") {
    return { type: "builtin.cron", config: { expr: schedule.expr, timezone: schedule.timezone } }
  }
  return { type: "builtin.interval", config: { everyMinutes: schedule.everyMinutes, anchor: schedule.anchor } }
}

function fromTrigger(trigger: TaskTrigger): SchedulerSchedule {
  if (trigger.type === "builtin.cron") {
    return { type: "cron", expr: trigger.config.expr, timezone: trigger.config.timezone }
  }
  return { type: "interval", everyMinutes: trigger.config.everyMinutes, anchor: trigger.config.anchor }
}

function parseScope(scope: Record<string, unknown>): SchedulerTaskCreateParams["scope"] {
  if (scope.type === "global") return { type: "global" }
  if (scope.type === "project" && typeof scope.projectId === "string" && scope.projectId.trim()) {
    return { type: "project", projectId: scope.projectId }
  }
  throw new Error("Missing or invalid 'scope': expected global or project scope")
}

function parseSchedule(schedule: Record<string, unknown>): SchedulerSchedule {
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

function requireRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Missing or invalid '${key}': expected object`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
```

- [ ] **Step 4: Re-export from existing external API file**

Replace `desktop/electron/services/task-scheduler/external-api.ts` with:

```ts
export {
  dispatchSchedulerAction,
  toPublicTaskSummary,
  type SchedulerTaskSummary,
} from "./external-capabilities"
```

Keep `desktop/electron/services/task-scheduler/index.ts` exporting `dispatchSchedulerAction` from `./external-api`.

- [ ] **Step 5: Run external API tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/external-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/task-scheduler/external-capabilities.ts \
  desktop/electron/services/task-scheduler/external-api.ts \
  desktop/electron/services/task-scheduler/index.ts \
  desktop/electron/services/task-scheduler/__tests__/external-api.test.ts
git commit -m "feat: add scheduler external capability adapter"
```

---

### Task 4: Wire Router And API To New Scheduler Adapter

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`

- [ ] **Step 1: Write router tests for new actions and hidden delete**

Add to `desktop/electron/capabilities/__tests__/action-router.test.ts`:

```ts
it("routes second-phase Scheduler actions to the Scheduler dispatcher", async () => {
  const databaseDispatch = vi.fn()
  const schedulerDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
  const router = createSynapseActionRouter({
    databaseDispatch,
    schedulerDispatch,
  })

  await expect(router.dispatch("schedulerTaskRunsList", { taskId: "task:1" }, { source: "api" }))
    .resolves.toEqual({ ok: true, data: [] })
  expect(schedulerDispatch).toHaveBeenCalledWith("schedulerTaskRunsList", { taskId: "task:1" }, { source: "api" })
  expect(databaseDispatch).not.toHaveBeenCalled()
})

it("keeps schedulerTaskDelete unknown on the external router", async () => {
  const router = createSynapseActionRouter({
    databaseDispatch: vi.fn(),
    schedulerDispatch: vi.fn(),
  })

  await expect(router.dispatch("schedulerTaskDelete", { taskId: "task:1" }, { source: "api" }))
    .rejects.toThrow(/Unknown action/)
})
```

- [ ] **Step 2: Run failing/passing router test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts
```

Expected: FAIL until Task 2 has registered `schedulerTaskRunsList`; PASS after Task 2 and Task 3 code are in place.

- [ ] **Step 3: Wire descriptor dispatch signature**

In `desktop/electron/bootstrap/descriptors.ts`, make sure `coreDatabaseDescriptor.create` uses:

```ts
const actionRuntime = ctx.registry.get<MainActionRegistry>("core.action-runtime")
const actionRouter = createSynapseActionRouter({
  databaseDispatch: dispatchDatabaseAction,
  schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
})
```

If Task 1 already made this change, leave it as-is and only keep the router tests.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/capabilities/__tests__/action-router.test.ts
git commit -m "feat: route scheduler external actions"
```

---

### Task 5: Add Scheduler CLI Commands

**Files:**
- Modify: `desktop/database/cli/scheduler.ts`
- Modify: `desktop/database/cli/index.ts`
- Modify: `desktop/tests/unit/cli-scheduler.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add to `desktop/tests/unit/cli-scheduler.test.ts`:

```ts
it("lists task runs", async () => {
  const apiCall = vi.fn(async () => ({ data: [{ id: "run:1", status: "success" }] }))
  const lines: string[] = []
  await handleSchedulerCommand(["runs", "task:1", "--limit", "5"], apiCall, (line) => lines.push(line))
  expect(apiCall).toHaveBeenCalledWith("schedulerTaskRunsList", { taskId: "task:1", limit: 5 })
  expect(lines.join("\n")).toContain("run:1")
})

it("gets runtime status", async () => {
  const apiCall = vi.fn(async () => ({ data: { runningTaskIds: [], scheduledTaskIds: ["task:1"], tasks: [] } }))
  const lines: string[] = []
  await handleSchedulerCommand(["status", "task:1"], apiCall, (line) => lines.push(line))
  expect(apiCall).toHaveBeenCalledWith("schedulerTaskRuntimeStatus", { taskId: "task:1" })
  expect(lines.join("\n")).toContain("scheduledTaskIds")
})

it("lists action types", async () => {
  const apiCall = vi.fn(async () => ({ data: [{ type: "builtin.command" }] }))
  const lines: string[] = []
  await handleSchedulerCommand(["actions"], apiCall, (line) => lines.push(line))
  expect(apiCall).toHaveBeenCalledWith("schedulerActionTypesList", {})
  expect(lines.join("\n")).toContain("builtin.command")
})

it("updates a task from canonical JSON data", async () => {
  const apiCall = vi.fn(async () => ({ data: { id: "task:1", name: "Updated" } }))
  const lines: string[] = []
  await handleSchedulerCommand([
    "update",
    "task:1",
    "--data",
    JSON.stringify({ name: "Updated", missedRunPolicy: "run_once" }),
  ], apiCall, (line) => lines.push(line))
  expect(apiCall).toHaveBeenCalledWith("schedulerTaskUpdate", {
    taskId: "task:1",
    name: "Updated",
    missedRunPolicy: "run_once",
  })
  expect(lines.join("\n")).toContain("Task updated: task:1")
})

it("rejects hidden scheduler commands", async () => {
  await expect(handleSchedulerCommand(["delete", "task:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
  await expect(handleSchedulerCommand(["run", "task:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
  await expect(handleSchedulerCommand(["stop", "run:1"], vi.fn(), () => {})).rejects.toThrow(/Unknown scheduler command/)
})
```

- [ ] **Step 2: Run failing CLI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/cli-scheduler.test.ts
```

Expected: FAIL because new CLI commands are missing.

- [ ] **Step 3: Update Scheduler CLI handler**

Modify `desktop/database/cli/scheduler.ts` by adding these cases before `default`:

```ts
case "runs": {
  const taskId = requireArg(args[1], "Usage: synapse scheduler run list <taskId> [--limit N]")
  const limit = getNumberFlag(args, "--limit")
  const params: Record<string, unknown> = { taskId }
  if (limit !== undefined) params.limit = limit
  const result = await apiCall("schedulerTaskRunsList", params) as { data?: unknown }
  printJson(result.data ?? [], print)
  break
}

case "status": {
  const params: Record<string, unknown> = {}
  if (args[1] && !args[1].startsWith("--")) params.taskId = args[1]
  const result = await apiCall("schedulerTaskRuntimeStatus", params) as { data?: unknown }
  printJson(result.data ?? null, print)
  break
}

case "actions": {
  const result = await apiCall("schedulerActionTypesList", {}) as { data?: unknown }
  printJson(result.data ?? [], print)
  break
}

case "update": {
  const taskId = requireArg(args[1], "Usage: synapse scheduler update <taskId> --data '{...}'")
  const data = parseData(args)
  if (!isRecord(data)) throw new Error("Invalid JSON for --data: expected object.")
  const result = await apiCall("schedulerTaskUpdate", { taskId, ...data }) as { data?: { id?: string } }
  print(`Task updated: ${result.data?.id ?? taskId}`)
  break
}
```

Add this helper near the bottom:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
```

- [ ] **Step 4: Update CLI help**

Modify the Scheduler section in `desktop/database/cli/index.ts` help text to include:

```text
  synapse scheduler run list <taskId> [--limit N]               List recent task runs
  synapse scheduler runtime inspect [taskId]                         Inspect scheduler runtime status
  synapse scheduler action-type list                                 List available task action types
  synapse scheduler update <taskId> --data '{...}'          Update safe task fields
```

Do not add help lines for delete, run, or stop.

- [ ] **Step 5: Run CLI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/cli-scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/database/cli/scheduler.ts \
  desktop/database/cli/index.ts \
  desktop/tests/unit/cli-scheduler.test.ts
git commit -m "feat: add scheduler observation cli commands"
```

---

### Task 6: Complete MCP Routing And Result Tests

**Files:**
- Modify: `desktop/tests/unit/mcp-scheduler-tools.test.ts`
- Modify: `desktop/tests/unit/database-mcp-rpc.test.ts`

- [ ] **Step 1: Add MCP routing tests**

Add to `desktop/tests/unit/mcp-scheduler-tools.test.ts`:

```ts
it("routes new Scheduler MCP tools through their action names", async () => {
  const executeTool = vi.fn(async () => ({
    ok: true,
    data: [{ id: "run:1", status: "success" }],
    total: 1,
  }))
  const response = await processMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "scheduler_task_runs_list",
      arguments: { taskId: "task:1" },
    },
  }, SYNAPSE_MCP_SERVER_IDENTITY, executeTool)

  expect(executeTool).toHaveBeenCalledWith("scheduler_task_runs_list", { taskId: "task:1" })
  expect(response.kind).toBe("result")
  if (response.kind !== "result") return
  expect(response.result).toEqual({
    content: [{
      type: "text",
      text: JSON.stringify([{ id: "run:1", status: "success" }], null, 2),
    }],
  })
})

it("keeps hidden Scheduler MCP tools unknown", async () => {
  const response = await processMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "scheduler_task_delete",
      arguments: { taskId: "task:1" },
    },
  }, SYNAPSE_MCP_SERVER_IDENTITY, async () => ({ ok: true }))

  expect(response.kind).toBe("result")
  if (response.kind !== "result") return
  expect(response.result).toEqual({
    content: [{ type: "text", text: "Unknown tool: scheduler_task_delete" }],
    isError: true,
  })
})
```

- [ ] **Step 2: Run MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/mcp-scheduler-tools.test.ts tests/unit/database-mcp-rpc.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/tests/unit/mcp-scheduler-tools.test.ts \
  desktop/tests/unit/database-mcp-rpc.test.ts
git commit -m "test: cover scheduler mcp external tools"
```

---

### Task 7: Full Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: working tree is clean after the task commits; recent commits show each implementation slice.

- [ ] **Step 5: Final integration commit if needed**

If Task 7 produced only verification output and no source changes, do not create a commit. If any small verification-driven fix was needed, commit it:

```bash
git add <changed-files>
git commit -m "fix: stabilize scheduler external capabilities"
```

## Self-Review Notes

Spec coverage:

- Read-only runs: Task 2 adds metadata/schema, Task 3 adds adapter behavior, Task 5 adds CLI, Task 6 adds MCP tests.
- Runtime status: Task 2 adds metadata/schema, Task 3 adds adapter behavior, Task 5 adds CLI.
- Action type listing: Task 1 adds public manifest fields and shared registry, Task 3 adds adapter behavior, Task 5 adds CLI.
- Conservative update: Task 2 adds metadata/schema, Task 3 adds restricted validation and service call, Task 5 adds CLI.
- Delete/manual-run/stop hidden: Task 2 negative matrix tests, Task 5 CLI negative tests, Task 6 MCP unknown-tool test.
- Database unchanged: Task 6 runs Database MCP RPC tests; Task 7 runs full verification.

Type consistency:

- The public Scheduler action names match `scheduler-domain.ts`.
- The adapter signature is `dispatchSchedulerAction(service, actions, action, params)`.
- `core.action-runtime` returns `MainActionRegistry`.
- `ActionManifest.configFields` is required for every registered action.
