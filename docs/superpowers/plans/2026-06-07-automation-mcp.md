# Automation MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Synapse Automation through `synapse-mcp` and add a built-in Skill that teaches Agents how to manage Automations safely.

**Architecture:** Add a first-class `automation` capability domain beside Scheduler and Workflow. Route MCP calls through a new Electron automation dispatcher that reuses `AutomationService`, `AutomationTriggerRegistry`, and `MainActionRegistry`, returning redacted public summaries instead of raw stored configs.

**Tech Stack:** Electron main process, TypeScript, Vitest, existing Synapse MCP capability registry, existing Automation service and built-in content templates.

---

## File Structure

- Create `desktop/synapse-capabilities/shared/automation-domain.ts`  
  Defines Automation capability ids, MCP tool mappings, public input types, and MCP tool schemas.

- Create `desktop/synapse-capabilities/shared/__tests__/automation-domain.test.ts`  
  Verifies tool names, domain registration, and `tools/list` integration.

- Modify `desktop/synapse-capabilities/shared/registry.ts`  
  Adds Automation to `CAPABILITY_DOMAINS`, `MCP_TOOL_ACTIONS`, and `buildAllMcpTools()`.

- Modify `desktop/electron/capabilities/action-router.ts`  
  Adds `automationDispatch` to router deps and routes `automation.*` actions.

- Modify `desktop/electron/capabilities/__tests__/action-router.test.ts`  
  Adds an Automation routing test and updates the default mock deps.

- Create `desktop/electron/capabilities/automation-dispatcher.ts`  
  Parses public MCP params, validates trigger/executor refs through registries, calls `AutomationService`, checks permissions, audits mutations, and returns public summaries.

- Create `desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts`  
  Covers read summaries, redaction, create/update validation, enable/disable/delete, manual run, stop run, runtime inspect, permissions, and audit behavior.

- Modify `desktop/electron/bootstrap/descriptors.ts`  
  Creates the Automation dispatcher inside `coreDatabaseDescriptor`, adds `core.automation` dependency, and wires it into `createSynapseActionRouter`.

- Modify `desktop/electron/bootstrap/__tests__/registry.test.ts` and `desktop/electron/bootstrap/__tests__/descriptors.test.ts`  
  Updates dependency expectations for `core.database`.

- Modify `desktop/electron/database/__tests__/mcp-server.test.ts` or add a focused MCP RPC test if more direct  
  Confirms `tools/list` exposes Automation tools and `tools/call` normalizes Automation results as JSON text.

- Create `desktop/resources/templates/skills/synapse-automation-mcp/meta.json`  
  Built-in Skill metadata.

- Create `desktop/resources/templates/skills/synapse-automation-mcp/content.md`  
  Installable Agent guidance for Automation MCP.

- Create `desktop/resources/templates/skills/synapse-automation-mcp/files/api-reference.md`  
  Tool reference attachment for the built-in Skill.

- Modify `docs/reference/capability-naming-matrix.md`  
  Adds Automation capability/tool/action rows.

- Modify `RELEASE_NOTES_PENDING.md`  
  Records the user-visible Automation MCP and built-in Skill addition.

---

### Task 1: Add Automation Capability Domain

**Files:**
- Create: `desktop/synapse-capabilities/shared/__tests__/automation-domain.test.ts`
- Create: `desktop/synapse-capabilities/shared/automation-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`

- [ ] **Step 1: Write the failing domain registry test**

Create `desktop/synapse-capabilities/shared/__tests__/automation-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  AUTOMATION_DOMAIN,
  AUTOMATION_MCP_TOOL_ACTIONS,
  buildAutomationTools,
} from "../automation-domain"
import {
  CAPABILITY_DOMAINS,
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
  getMcpToolDomainId,
} from "../registry"

describe("Automation capability domain", () => {
  it("defines the Automation capability ids", () => {
    expect(AUTOMATION_DOMAIN.id).toBe("automation")
    expect(AUTOMATION_DOMAIN.capabilities.map((capability) => capability.id)).toEqual([
      "automation.item.list",
      "automation.item.get",
      "automation.item.create",
      "automation.item.update",
      "automation.item.delete",
      "automation.item.enable",
      "automation.item.disable",
      "automation.run.execute",
      "automation.run.disable",
      "automation.run.list",
      "automation.runtime.inspect",
      "automation.trigger_type.list",
      "automation.executor_type.list",
    ])
  })

  it("maps Automation MCP tool names to canonical actions", () => {
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_item_list).toBe("automation.item.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_item_create).toBe("automation.item.create")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_run_execute).toBe("automation.run.execute")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_trigger_type_list).toBe("automation.trigger_type.list")
    expect(AUTOMATION_MCP_TOOL_ACTIONS.automation_executor_type_list).toBe("automation.executor_type.list")
  })

  it("registers Automation tools with the global MCP registry", () => {
    expect(CAPABILITY_DOMAINS.map((domain) => domain.id)).toContain("automation")
    expect(MCP_TOOL_ACTIONS.automation_item_delete).toBe("automation.item.delete")
    expect(MCP_TOOL_ACTIONS.automation_run_disable).toBe("automation.run.disable")
    expect(getActionDomainId("automation.item.list")).toBe("automation")
    expect(getMcpToolDomainId("automation_runtime_inspect")).toBe("automation")

    const tools = buildAllMcpTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "automation_item_list",
      "automation_item_create",
      "automation_item_update",
      "automation_item_delete",
      "automation_run_execute",
      "automation_runtime_inspect",
      "automation_trigger_type_list",
      "automation_executor_type_list",
    ]))
  })

  it("declares required input schema fields for mutating tools", () => {
    const tools = buildAutomationTools()
    expect(tools.find((tool) => tool.name === "automation_item_get")?.inputSchema.required).toEqual(["automationId"])
    expect(tools.find((tool) => tool.name === "automation_item_create")?.inputSchema.required).toEqual([
      "name",
      "scope",
      "trigger",
      "executor",
    ])
    expect(tools.find((tool) => tool.name === "automation_item_update")?.inputSchema.required).toEqual([
      "automationId",
      "patch",
    ])
    expect(tools.find((tool) => tool.name === "automation_run_disable")?.inputSchema.required).toEqual(["runId"])
  })
})
```

- [ ] **Step 2: Run the domain test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run synapse-capabilities/shared/__tests__/automation-domain.test.ts
```

Expected: FAIL because `automation-domain.ts` does not exist and the global registry does not register Automation.

- [ ] **Step 3: Create `automation-domain.ts`**

Create `desktop/synapse-capabilities/shared/automation-domain.ts`:

```ts
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"

const automationCapabilities: readonly CapabilityDefinition[] = [
  { id: "automation.item.list" as CapabilityId, title: "List automations", description: "List Synapse Automation item summaries.", mutates: false },
  { id: "automation.item.get" as CapabilityId, title: "Get automation", description: "Get one Synapse Automation item summary by id.", mutates: false },
  { id: "automation.item.create" as CapabilityId, title: "Create automation", description: "Create one Synapse Automation item.", mutates: true },
  { id: "automation.item.update" as CapabilityId, title: "Update automation", description: "Update one Synapse Automation item.", mutates: true },
  { id: "automation.item.delete" as CapabilityId, title: "Delete automation", description: "Delete one Synapse Automation item.", mutates: true, risk: "high" },
  { id: "automation.item.enable" as CapabilityId, title: "Enable automation", description: "Enable one Synapse Automation item.", mutates: true },
  { id: "automation.item.disable" as CapabilityId, title: "Disable automation", description: "Disable one Synapse Automation item.", mutates: true },
  { id: "automation.run.execute" as CapabilityId, title: "Run automation", description: "Manually run one Synapse Automation item.", mutates: true },
  { id: "automation.run.disable" as CapabilityId, title: "Stop automation run", description: "Stop one active Synapse Automation run.", mutates: true },
  { id: "automation.run.list" as CapabilityId, title: "List automation runs", description: "List recent runs for one Synapse Automation item.", mutates: false },
  { id: "automation.runtime.inspect" as CapabilityId, title: "Inspect automation runtime", description: "Inspect Automation timers, running item ids, and compact runtime state.", mutates: false },
  { id: "automation.trigger_type.list" as CapabilityId, title: "List automation trigger types", description: "List registered Automation trigger type descriptors.", mutates: false },
  { id: "automation.executor_type.list" as CapabilityId, title: "List automation executor types", description: "List registered Automation executor type descriptors.", mutates: false },
]

export const AUTOMATION_DOMAIN: CapabilityDomainDefinition = {
  id: "automation",
  capabilities: automationCapabilities,
}

export const AUTOMATION_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  automationCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

const automationIdProperty = {
  type: "string",
  description: "Automation item id. If only a name is known, call automation_item_list first because names are not unique.",
}

const automationScopeSchema = {
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
}

const automationRefSchema = {
  type: "object",
  properties: {
    type: { type: "string", description: "Registered trigger or executor type id." },
    config: { type: "object", description: "Config validated by the matching registry. Use discovery tools first." },
  },
  required: ["type", "config"],
}

const automationPolicySchema = {
  type: "object",
  properties: {
    missedRunPolicy: { type: "string", enum: ["skip", "run_once"] },
    overlapPolicy: { type: "string", enum: ["skip"], description: "Automation currently supports skip only." },
  },
}

export function buildAutomationTools(): McpToolDefinition[] {
  return [
    {
      name: "automation_item_list",
      description: "List Synapse Automation item summaries. Results intentionally omit raw trigger.config and executor.config.",
      inputSchema: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Optional filter for enabled or disabled Automations." },
          limit: { type: "number", description: "Optional maximum number of Automations to return." },
          scope: {
            type: "object",
            description: "Optional scope filter. Pass { type: 'global' } or { type: 'project', projectId: '...' }. Omit projectId to match all project-scoped Automations.",
            properties: {
              type: { type: "string", enum: ["global", "project"] },
              projectId: { type: "string" },
            },
          },
        },
      },
    },
    {
      name: "automation_item_get",
      description: "Get one Synapse Automation item summary by automationId. The response does not include raw trigger or executor config.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_item_create",
      description: "Create one Synapse Automation. Call automation_trigger_type_list and automation_executor_type_list before building trigger/executor configs.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          enabled: { type: "boolean" },
          scope: automationScopeSchema,
          cwd: { type: "string" },
          trigger: automationRefSchema,
          executor: automationRefSchema,
          policy: automationPolicySchema,
        },
        required: ["name", "scope", "trigger", "executor"],
      },
    },
    {
      name: "automation_item_update",
      description: "Update one Synapse Automation. The patch may replace trigger or executor refs; use discovery tools before changing configs.",
      inputSchema: {
        type: "object",
        properties: {
          automationId: automationIdProperty,
          patch: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              enabled: { type: "boolean" },
              scope: automationScopeSchema,
              cwd: { type: "string" },
              trigger: automationRefSchema,
              executor: automationRefSchema,
              policy: automationPolicySchema,
            },
          },
        },
        required: ["automationId", "patch"],
      },
    },
    {
      name: "automation_item_delete",
      description: "Delete one Synapse Automation by automationId. This also removes its run history through AutomationService.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_item_enable",
      description: "Enable one Synapse Automation by automationId.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_item_disable",
      description: "Disable one Synapse Automation by automationId. This prevents future trigger runs but does not stop an active run.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_run_execute",
      description: "Manually run one Synapse Automation by automationId. Use automation_run_list or automation_runtime_inspect for follow-up.",
      inputSchema: { type: "object", properties: { automationId: automationIdProperty }, required: ["automationId"] },
    },
    {
      name: "automation_run_disable",
      description: "Stop one active Automation run by runId.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string", description: "Automation run id." } },
        required: ["runId"],
      },
    },
    {
      name: "automation_run_list",
      description: "List recent runs for one Automation. Run summaries omit logs and raw outputs.",
      inputSchema: {
        type: "object",
        properties: {
          automationId: automationIdProperty,
          limit: { type: "number", description: "Optional maximum number of runs. Defaults to 20 and caps at 100." },
        },
        required: ["automationId"],
      },
    },
    {
      name: "automation_runtime_inspect",
      description: "Inspect Automation runtime state. Pass automationId for one item or omit it for all items.",
      inputSchema: { type: "object", properties: { automationId: { type: "string" } } },
    },
    {
      name: "automation_trigger_type_list",
      description: "List registered Automation trigger types, default configs, JSON Schemas, and trigger variables.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "automation_executor_type_list",
      description: "List registered Automation executor types from Action Runtime, including public config fields and defaults.",
      inputSchema: { type: "object", properties: {} },
    },
  ]
}
```

- [ ] **Step 4: Register Automation in the shared registry**

Modify `desktop/synapse-capabilities/shared/registry.ts`:

```ts
import {
  AUTOMATION_DOMAIN,
  AUTOMATION_MCP_TOOL_ACTIONS,
  buildAutomationTools,
} from "./automation-domain"
```

Add `AUTOMATION_DOMAIN` to `CAPABILITY_DOMAINS` after `SCHEDULER_DOMAIN`:

```ts
export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  MODEL_PRICE_DOMAIN,
  REPOSITORY_DOMAIN,
  SCHEDULER_DOMAIN,
  AUTOMATION_DOMAIN,
  VARIABLE_DOMAIN,
  WORKFLOW_DOMAIN,
  CONTENT_DOMAIN,
]
```

Add `...AUTOMATION_MCP_TOOL_ACTIONS` to `MCP_TOOL_ACTIONS` after Scheduler, and add `...buildAutomationTools()` to `buildAllMcpTools()` after Scheduler.

- [ ] **Step 5: Run the domain test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run synapse-capabilities/shared/__tests__/automation-domain.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the shared domain**

Run:

```bash
git add desktop/synapse-capabilities/shared/automation-domain.ts desktop/synapse-capabilities/shared/registry.ts desktop/synapse-capabilities/shared/__tests__/automation-domain.test.ts
git commit -m "feat(automation): add mcp capability domain"
```

---

### Task 2: Route Automation Actions

**Files:**
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`
- Modify: `desktop/electron/capabilities/action-router.ts`

- [ ] **Step 1: Write the failing router test**

In `desktop/electron/capabilities/__tests__/action-router.test.ts`, update `createRouterDeps` to include `automationDispatch`:

```ts
function createRouterDeps(overrides: Partial<Parameters<typeof createSynapseActionRouter>[0]> = {}) {
  return {
    automationDispatch: vi.fn(),
    contentDispatch: vi.fn(),
    databaseDispatch: vi.fn(),
    modelPriceDispatch: vi.fn(),
    repositoryDispatch: vi.fn(),
    schedulerDispatch: vi.fn(),
    variableDispatch: vi.fn(),
    workflowDispatch: vi.fn(),
    ...overrides,
  }
}
```

Add this test near the Scheduler routing tests:

```ts
it("routes Automation actions to the Automation dispatcher", async () => {
  const automationDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
  const deps = createRouterDeps({ automationDispatch })
  const router = createSynapseActionRouter(deps)

  await expect(router.dispatch("automation.item.list", {}, { source: "api" })).resolves.toEqual({
    ok: true,
    data: [],
  })
  expect(automationDispatch).toHaveBeenCalledWith("automation.item.list", {}, { source: "api" })
  expect(deps.contentDispatch).not.toHaveBeenCalled()
  expect(deps.databaseDispatch).not.toHaveBeenCalled()
  expect(deps.repositoryDispatch).not.toHaveBeenCalled()
  expect(deps.schedulerDispatch).not.toHaveBeenCalled()
  expect(deps.variableDispatch).not.toHaveBeenCalled()
  expect(deps.workflowDispatch).not.toHaveBeenCalled()
})
```

In every existing router test that asserts other dispatchers were not called, add `expect(deps.automationDispatch).not.toHaveBeenCalled()` unless the test is the new Automation routing test.

- [ ] **Step 2: Run the router test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts
```

Expected: FAIL because `SynapseActionRouterDeps` does not define `automationDispatch` and `createSynapseActionRouter` does not route `automation`.

- [ ] **Step 3: Implement Automation routing**

Modify `desktop/electron/capabilities/action-router.ts`:

```ts
export type SynapseActionRouterDeps = {
  readonly automationDispatch: DomainDispatch
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly repositoryDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly variableDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}
```

Add the route before content/database branches:

```ts
if (domainId === "automation") return deps.automationDispatch(action, params, context)
```

- [ ] **Step 4: Run the router test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit router wiring**

Run:

```bash
git add desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts
git commit -m "feat(automation): route mcp actions"
```

---

### Task 3: Add Automation Dispatcher Read And Discovery Behavior

**Files:**
- Create: `desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts`
- Create: `desktop/electron/capabilities/automation-dispatcher.ts`

- [ ] **Step 1: Write failing tests for discovery and public summaries**

Create `desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts` with this initial content:

```ts
import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../action-runtime/action-registry"
import { AutomationTriggerRegistry, type AutomationTriggerDefinition } from "../../services/automation/trigger-registry"
import type { AutomationItem, AutomationRun } from "../../services/automation/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createAutomationCapabilityDispatcher, toPublicAutomationItemSummary } from "../automation-dispatcher"

const baseItem: AutomationItem = {
  id: "automation:1",
  schemaVersion: 1,
  name: "Daily automation",
  description: "Send summary",
  enabled: true,
  scope: { type: "global" },
  cwd: "/Users/liyang/project",
  trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1, 2, 3] } },
  executor: { type: "builtin.agent", config: { projectId: "project:1", agentType: "claude-code", providerId: "p1", modelTier: "sonnet", prompt: "private prompt" } },
  policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:10:00.000Z",
  nextRunAt: "2026-06-07T00:30:00.000Z",
  lastRunAt: "2026-06-07T00:05:00.000Z",
  lastStatus: "success",
  activeRun: { status: "running", id: "automation-run:1" },
  runCount: 2,
  configVersion: 1,
}

const baseRun: AutomationRun = {
  id: "automation-run:1",
  schemaVersion: 1,
  automationId: "automation:1",
  startedAt: "2026-06-07T00:05:00.000Z",
  finishedAt: "2026-06-07T00:05:02.000Z",
  status: "success",
  triggeredBy: "manual",
  triggerType: "builtin.interval",
  executorType: "builtin.agent",
  result: {
    status: "success",
    summary: "ok",
    logs: [{ label: "prompt", value: "private prompt" }],
    outputs: { text: "private output" },
    metrics: { durationMs: 2000 },
  },
}

const intervalTriggerSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]),
  activeDays: z.array(z.number().int().min(0).max(6)).min(1),
})

function intervalTrigger(): AutomationTriggerDefinition {
  return {
    manifest: {
      id: "builtin.interval",
      title: "Fixed interval",
      kind: "schedule",
      defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      configSchema: intervalTriggerSchema,
      variables: [{ key: "trigger.everyMinutes", label: "Interval minutes", group: "config" }],
    },
    summarize: (config) => `Every ${(config as { everyMinutes: number }).everyMinutes} minutes`,
    runtime: {
      computeNextRunAt: () => new Date("2026-06-07T00:30:00.000Z"),
    },
  }
}

const commandActionSchema = z.object({ command: z.string().min(1) })
type CommandActionConfig = z.infer<typeof commandActionSchema>

function commandAction(): MainActionDefinition<CommandActionConfig> {
  return {
    manifest: {
      id: "builtin.command",
      title: "Command",
      permissions: ["shell.exec"],
      defaultConfig: { command: "date" },
      configFields: [{ name: "command", kind: "string", required: true, defaultValue: "" }],
      configSchema: commandActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.command,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async (_input: ActionExecutionInput<CommandActionConfig>) => ({ status: "success" }),
  }
}

const agentActionSchema = z.object({
  projectId: z.string().min(1),
  agentType: z.string().min(1),
  providerId: z.string().min(1),
  modelTier: z.string().min(1),
  prompt: z.string().min(1),
})

function agentAction(): MainActionDefinition<z.infer<typeof agentActionSchema>> {
  return {
    manifest: {
      id: "builtin.agent",
      title: "Agent",
      permissions: ["agent.spawn"],
      defaultConfig: { projectId: "", agentType: "claude-code", providerId: "", modelTier: "sonnet", prompt: "" },
      configFields: [{ name: "prompt", kind: "string", required: true }],
      configSchema: agentActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "agent.spawn",
      actor: context.actor,
      resource: config.projectId,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async () => ({ status: "success" }),
  }
}

function registries() {
  const triggers = new AutomationTriggerRegistry()
  triggers.register(intervalTrigger())
  const actions = new MainActionRegistry()
  actions.register(commandAction())
  actions.register(agentAction())
  return { triggers, actions }
}

function serviceMock() {
  return {
    automationList: vi.fn(async () => [baseItem, { ...baseItem, id: "automation:2", enabled: false }]),
    automationGet: vi.fn(async (id: string) => (id === "automation:1" ? baseItem : null)),
    automationCreate: vi.fn(),
    automationUpdate: vi.fn(),
    automationDelete: vi.fn(),
    automationEnable: vi.fn(),
    automationDisable: vi.fn(),
    runAutomationNow: vi.fn(),
    stopRun: vi.fn(),
    automationRunList: vi.fn(async () => [baseRun]),
    automationRuntimeInspect: vi.fn(() => ({ timers: ["automation:1"], runningItemIds: ["automation:1"] })),
  }
}

function permissionGuardMock(result: Awaited<ReturnType<PermissionGuard["check"]>> = { allowed: true }) {
  return {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => result),
  } satisfies PermissionGuard
}

function auditSinkMock() {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  } satisfies AuditSink
}

function createHarness() {
  const { triggers, actions } = registries()
  const service = serviceMock()
  const permissionGuard = permissionGuardMock()
  const auditSink = auditSinkMock()
  const dispatcher = createAutomationCapabilityDispatcher({
    service,
    triggers,
    actions,
    permissionGuard,
    auditSink,
  })
  return { actions, auditSink, dispatcher, permissionGuard, service, triggers }
}

describe("automation capability dispatcher", () => {
  it("lists trigger and executor descriptors from registries", async () => {
    const { dispatcher } = createHarness()

    await expect(dispatcher.dispatch("automation.trigger_type.list", {}, { source: "api" }))
      .resolves.toMatchObject({
        ok: true,
        total: 1,
        data: [{
          type: "builtin.interval",
          title: "Fixed interval",
          kind: "schedule",
          defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
          variables: [{ key: "trigger.everyMinutes", label: "Interval minutes", group: "config" }],
        }],
      })

    const result = await dispatcher.dispatch("automation.executor_type.list", {}, { source: "api" })
    expect(result).toMatchObject({
      ok: true,
      total: 2,
      data: [
        expect.objectContaining({ type: "builtin.command", title: "Command", permissions: ["shell.exec"] }),
        expect.objectContaining({ type: "builtin.agent", title: "Agent", permissions: ["agent.spawn"] }),
      ],
    })
    expect(JSON.stringify(result)).not.toContain("private prompt")
  })

  it("lists and gets public item summaries without raw configs", async () => {
    const { dispatcher, permissionGuard } = createHarness()

    const list = await dispatcher.dispatch("automation.item.list", { enabled: true }, { source: "mcp-http" })
    const get = await dispatcher.dispatch("automation.item.get", { automationId: "automation:1" }, { source: "mcp-http" })

    expect(list).toEqual({
      ok: true,
      data: [toPublicAutomationItemSummary(baseItem, registries().triggers, registries().actions)],
      total: 1,
    })
    expect(get).toEqual({
      ok: true,
      data: toPublicAutomationItemSummary(baseItem, registries().triggers, registries().actions),
    })
    expect(JSON.stringify([list, get])).not.toContain("private prompt")
    expect(JSON.stringify([list, get])).not.toContain("everyMinutes")
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the dispatcher test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/automation-dispatcher.test.ts
```

Expected: FAIL because `automation-dispatcher.ts` does not exist.

- [ ] **Step 3: Implement the dispatcher read/discovery surface**

Create `desktop/electron/capabilities/automation-dispatcher.ts` with these exported types and functions. Keep the file focused on capability adaptation; do not import renderer modules.

```ts
import { zodToJsonSchema } from "zod-to-json-schema"
import type { MainActionRegistry } from "../action-runtime/action-registry"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { AutomationService } from "../services/automation"
import type { AutomationTriggerRegistry } from "../services/automation/trigger-registry"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationRun,
  AutomationUpdateInput,
} from "../services/automation/types"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type AutomationServicePort = Pick<
  AutomationService,
  | "automationList"
  | "automationGet"
  | "automationCreate"
  | "automationUpdate"
  | "automationDelete"
  | "automationEnable"
  | "automationDisable"
  | "runAutomationNow"
  | "stopRun"
  | "automationRunList"
  | "automationRuntimeInspect"
>

export type AutomationCapabilityDispatcherDeps = {
  readonly service: AutomationServicePort
  readonly triggers: AutomationTriggerRegistry
  readonly actions: MainActionRegistry
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}

type AutomationItemListParams = {
  readonly enabled?: boolean
  readonly limit?: number
  readonly scope?: { readonly type: "global" } | { readonly type: "project"; readonly projectId?: string }
}

type AutomationMutationSecurity = {
  readonly actor: { kind: "user"; id: string }
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const MUTATING_AUTOMATION_ACTIONS = new Set([
  "automation.item.create",
  "automation.item.update",
  "automation.item.delete",
  "automation.item.enable",
  "automation.item.disable",
  "automation.run.execute",
  "automation.run.disable",
])

export function createAutomationCapabilityDispatcher(deps: AutomationCapabilityDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const security = automationMutationSecurity(action, params, context)
      if (security) await authorizeAutomationMutation(deps, security)

      try {
        let result: DispatchResult
        switch (action) {
          case "automation.trigger_type.list": {
            const descriptors = deps.triggers.list().map((definition) => ({
              type: definition.manifest.id,
              title: definition.manifest.title,
              kind: definition.manifest.kind,
              defaultConfig: definition.manifest.defaultConfig,
              configSchema: zodToJsonSchema(definition.manifest.configSchema as Parameters<typeof zodToJsonSchema>[0]),
              ...(definition.manifest.variables ? { variables: definition.manifest.variables } : {}),
            }))
            result = { ok: true, data: descriptors, total: descriptors.length }
            break
          }

          case "automation.executor_type.list": {
            const descriptors = deps.actions.list().map((definition) => ({
              type: definition.manifest.id,
              title: definition.manifest.title,
              permissions: [...definition.manifest.permissions],
              defaultConfig: definition.manifest.defaultConfig,
              configFields: definition.manifest.configFields,
            }))
            result = { ok: true, data: descriptors, total: descriptors.length }
            break
          }

          case "automation.item.list": {
            const input = parseListParams(params)
            const items = await deps.service.automationList()
            const filtered = items
              .filter((item) => input.enabled === undefined || item.enabled === input.enabled)
              .filter((item) => matchesScope(item, input.scope))
              .slice(0, input.limit ?? items.length)
              .map((item) => toPublicAutomationItemSummary(item, deps.triggers, deps.actions))
            result = { ok: true, data: filtered, total: filtered.length }
            break
          }

          case "automation.item.get": {
            const { automationId } = parseAutomationIdParams(params)
            const item = await deps.service.automationGet(automationId)
            result = { ok: true, data: item ? toPublicAutomationItemSummary(item, deps.triggers, deps.actions) : null }
            break
          }

          default:
            throw new Error(`Unknown automation action: ${action}`)
        }

        if (security) {
          deps.auditSink?.record({
            action: "automation.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "allowed",
            metadata: security.metadata,
          })
        }
        return result
      } catch (error) {
        if (security) {
          deps.auditSink?.record({
            action: "automation.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "failed",
            metadata: {
              ...security.metadata,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
        }
        throw error
      }
    },
  }
}

export function toPublicAutomationItemSummary(
  item: AutomationItem,
  triggers: AutomationTriggerRegistry,
  actions: MainActionRegistry,
) {
  const validation = toPublicValidation(item.validation)
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    enabled: item.enabled,
    scope: item.scope,
    cwd: item.cwd,
    trigger: triggerSummary(item, triggers),
    executor: executorSummary(item, actions),
    policy: item.policy,
    nextRunAt: item.nextRunAt,
    lastRunAt: item.lastRunAt,
    lastStatus: item.lastStatus,
    activeRun: item.activeRun,
    ...(validation ? { validation } : {}),
    runCount: item.runCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function triggerSummary(item: AutomationItem, triggers: AutomationTriggerRegistry) {
  try {
    const definition = triggers.get(item.trigger.type)
    return {
      type: item.trigger.type,
      kind: definition.manifest.kind,
      summary: definition.summarize(definition.manifest.configSchema.parse(item.trigger.config)),
    }
  } catch {
    return { type: item.trigger.type }
  }
}

function executorSummary(item: AutomationItem, actions: MainActionRegistry) {
  try {
    const definition = actions.get(item.executor.type)
    return { type: item.executor.type, title: definition.manifest.title }
  } catch {
    return { type: item.executor.type }
  }
}

function toPublicValidation(validation: AutomationItem["validation"]) {
  if (validation?.status !== "needs_update") return undefined
  return {
    status: "needs_update" as const,
    issues: validation.issues.map((issue) => ({
      field: issue.field,
      message: issue.message,
    })),
  }
}

function parseListParams(params: Record<string, unknown>): AutomationItemListParams {
  const enabled = params.enabled
  const limit = params.limit
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error("Missing or invalid 'enabled': expected boolean")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  return {
    enabled: enabled as boolean | undefined,
    limit: limit as number | undefined,
    scope: parseOptionalScope(params.scope),
  }
}

function parseOptionalScope(value: unknown): AutomationItemListParams["scope"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("Missing or invalid 'scope': expected object")
  if (value.type === "global") return { type: "global" }
  if (value.type === "project") {
    const projectId = value.projectId
    if (projectId !== undefined && (typeof projectId !== "string" || !projectId.trim())) {
      throw new Error("Missing or invalid 'scope.projectId': expected non-empty string")
    }
    return { type: "project", projectId: projectId as string | undefined }
  }
  throw new Error("Missing or invalid 'scope.type': expected global or project")
}

function matchesScope(item: AutomationItem, scope: AutomationItemListParams["scope"]): boolean {
  if (!scope) return true
  if (scope.type !== item.scope.type) return false
  if (scope.type === "project" && scope.projectId) {
    return item.scope.type === "project" && item.scope.projectId === scope.projectId
  }
  return true
}

function parseAutomationIdParams(params: Record<string, unknown>): { automationId: string } {
  const automationId = params.automationId
  if (typeof automationId !== "string" || !automationId.trim()) {
    throw new Error("Missing or invalid 'automationId': expected non-empty string")
  }
  return { automationId }
}

function automationMutationSecurity(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): AutomationMutationSecurity | null {
  if (!MUTATING_AUTOMATION_ACTIONS.has(action)) return null
  const source = context.source ?? "api"
  const automationId = typeof params.automationId === "string" && params.automationId.trim()
    ? params.automationId.trim()
    : action
  const runId = typeof params.runId === "string" && params.runId.trim()
    ? params.runId.trim()
    : undefined
  return {
    actor: { kind: "user", id: `automation-dispatch:${source}` },
    resource: `automation:${runId ?? automationId}`,
    metadata: {
      source,
      automationAction: action,
      ...(automationId !== action ? { automationId } : {}),
      ...(runId ? { runId } : {}),
      ...(isRecord(params.patch) ? { patchKeys: Object.keys(params.patch) } : {}),
      ...(isRecord(params.trigger) && typeof params.trigger.type === "string" ? { triggerType: params.trigger.type } : {}),
      ...(isRecord(params.executor) && typeof params.executor.type === "string" ? { executorType: params.executor.type } : {}),
    },
  }
}

async function authorizeAutomationMutation(
  deps: Pick<AutomationCapabilityDispatcherDeps, "permissionGuard" | "auditSink">,
  security: AutomationMutationSecurity,
): Promise<void> {
  const permission = await deps.permissionGuard?.check({
    action: "automation.mutate",
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "automation.mutate",
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
```

This initial implementation intentionally leaves mutating and run actions unknown; Task 4 adds them with tests.

- [ ] **Step 4: Run the dispatcher test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/automation-dispatcher.test.ts
```

Expected: PASS for discovery/list/get tests.

- [ ] **Step 5: Commit read/discovery dispatcher**

Run:

```bash
git add desktop/electron/capabilities/automation-dispatcher.ts desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts
git commit -m "feat(automation): add mcp discovery and summaries"
```

---

### Task 4: Add Automation Dispatcher Mutations, Runs, Security, And Redaction

**Files:**
- Modify: `desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts`
- Modify: `desktop/electron/capabilities/automation-dispatcher.ts`

- [ ] **Step 1: Add failing mutation and run tests**

Append these tests to `desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts`:

```ts
it("creates updates enables disables and deletes automations through the service", async () => {
  const { dispatcher, service } = createHarness()
  vi.mocked(service.automationCreate).mockResolvedValueOnce({ ...baseItem, id: "automation:new" })
  vi.mocked(service.automationUpdate).mockResolvedValueOnce({ ...baseItem, name: "Updated automation" })
  vi.mocked(service.automationEnable).mockResolvedValueOnce({ ...baseItem, enabled: true })
  vi.mocked(service.automationDisable).mockResolvedValueOnce({ ...baseItem, enabled: false })
  vi.mocked(service.automationDelete).mockResolvedValueOnce({ deleted: true })

  const createInput = {
    name: "New automation",
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
    executor: { type: "builtin.command", config: { command: "echo ok" } },
  }

  const created = await dispatcher.dispatch("automation.item.create", createInput, { source: "mcp-http" })
  const updated = await dispatcher.dispatch("automation.item.update", {
    automationId: "automation:1",
    patch: { name: "Updated automation" },
  }, { source: "mcp-http" })
  const enabled = await dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" })
  const disabled = await dispatcher.dispatch("automation.item.disable", { automationId: "automation:1" }, { source: "mcp-http" })
  const deleted = await dispatcher.dispatch("automation.item.delete", { automationId: "automation:1" }, { source: "mcp-http" })

  expect(service.automationCreate).toHaveBeenCalledWith(expect.objectContaining({
    name: "New automation",
    trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
    executor: { type: "builtin.command", config: { command: "echo ok" } },
  }))
  expect(service.automationUpdate).toHaveBeenCalledWith("automation:1", { name: "Updated automation" })
  expect(service.automationEnable).toHaveBeenCalledWith("automation:1")
  expect(service.automationDisable).toHaveBeenCalledWith("automation:1")
  expect(service.automationDelete).toHaveBeenCalledWith("automation:1")
  expect(JSON.stringify([created, updated, enabled, disabled, deleted])).not.toContain("echo ok")
})

it("rejects unknown trigger and executor types before persistence", async () => {
  const { dispatcher, service } = createHarness()

  await expect(dispatcher.dispatch("automation.item.create", {
    name: "Broken trigger",
    scope: { type: "global" },
    trigger: { type: "builtin.missing-trigger", config: {} },
    executor: { type: "builtin.command", config: { command: "echo ok" } },
  }, { source: "mcp-http" })).rejects.toThrow('Automation trigger "builtin.missing-trigger" is not registered')

  await expect(dispatcher.dispatch("automation.item.create", {
    name: "Broken executor",
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "created_at", activeDays: [1] } },
    executor: { type: "builtin.missing-executor", config: {} },
  }, { source: "mcp-http" })).rejects.toThrow('Task action "builtin.missing-executor" is not registered')

  expect(service.automationCreate).not.toHaveBeenCalled()
})

it("runs stops lists runs and inspects runtime without exposing raw logs", async () => {
  const { dispatcher, service } = createHarness()
  vi.mocked(service.runAutomationNow).mockResolvedValueOnce(baseRun)
  vi.mocked(service.stopRun).mockResolvedValueOnce({ stopped: false, alreadyFinished: true })

  const run = await dispatcher.dispatch("automation.run.execute", { automationId: "automation:1" }, { source: "mcp-http" })
  const stopped = await dispatcher.dispatch("automation.run.disable", { runId: "automation-run:1" }, { source: "mcp-http" })
  const runs = await dispatcher.dispatch("automation.run.list", { automationId: "automation:1" }, { source: "mcp-http" })
  const runtime = await dispatcher.dispatch("automation.runtime.inspect", {}, { source: "mcp-http" })

  expect(service.runAutomationNow).toHaveBeenCalledWith("automation:1")
  expect(service.stopRun).toHaveBeenCalledWith("automation-run:1")
  expect(stopped).toEqual({ ok: true, data: { stopped: false, alreadyFinished: true } })
  expect(runs).toMatchObject({ ok: true, total: 1 })
  expect(runtime).toMatchObject({
    ok: true,
    data: {
      runningItemIds: ["automation:1"],
      scheduledItemIds: ["automation:1"],
      items: [expect.objectContaining({ id: "automation:1", running: true, scheduled: true })],
    },
  })
  expect(JSON.stringify([run, runs, runtime])).not.toContain("private prompt")
  expect(JSON.stringify([run, runs, runtime])).not.toContain("private output")
})

it("checks permission and audits allowed automation mutations", async () => {
  const { auditSink, dispatcher, permissionGuard, service } = createHarness()
  vi.mocked(service.automationDisable).mockResolvedValueOnce({ ...baseItem, enabled: false })

  await dispatcher.dispatch("automation.item.disable", { automationId: "automation:1" }, { source: "mcp-http" })

  expect(permissionGuard.check).toHaveBeenCalledWith({
    action: "automation.mutate",
    actor: { kind: "user", id: "automation-dispatch:mcp-http" },
    resource: "automation:automation:1",
    context: expect.objectContaining({
      source: "mcp-http",
      automationAction: "automation.item.disable",
      automationId: "automation:1",
    }),
  })
  expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
    action: "automation.mutate",
    actor: { kind: "user", id: "automation-dispatch:mcp-http" },
    resource: "automation:automation:1",
    outcome: "allowed",
  }))
})

it("denies automation mutations before service calls", async () => {
  const { actions, triggers } = registries()
  const service = serviceMock()
  const permissionGuard = permissionGuardMock({ allowed: false, reason: "blocked", policyId: "test-policy" })
  const auditSink = auditSinkMock()
  const dispatcher = createAutomationCapabilityDispatcher({ service, triggers, actions, permissionGuard, auditSink })

  await expect(dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" }))
    .rejects.toThrow("blocked")

  expect(service.automationEnable).not.toHaveBeenCalled()
  expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
    action: "automation.mutate",
    outcome: "denied",
    metadata: expect.objectContaining({ reason: "blocked", policyId: "test-policy" }),
  }))
})

it("audits failed mutations without raw error text", async () => {
  const { auditSink, dispatcher, service } = createHarness()
  vi.mocked(service.automationEnable).mockRejectedValueOnce(new Error("failed with private prompt"))

  await expect(dispatcher.dispatch("automation.item.enable", { automationId: "automation:1" }, { source: "mcp-http" }))
    .rejects.toThrow("failed with private prompt")

  expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
    action: "automation.mutate",
    outcome: "failed",
    metadata: expect.objectContaining({
      errorName: "Error",
      errorLength: "Error: failed with private prompt".length,
    }),
  }))
  expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("private prompt")
})
```

- [ ] **Step 2: Run the dispatcher test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/automation-dispatcher.test.ts
```

Expected: FAIL because mutating and run actions are still unknown.

- [ ] **Step 3: Implement parse helpers, mutation actions, run summaries, and runtime inspect**

Modify `desktop/electron/capabilities/automation-dispatcher.ts`:

Add cases inside the dispatcher switch:

```ts
case "automation.item.create": {
  const input = parseCreateParams(params, deps.triggers, deps.actions)
  result = { ok: true, data: toPublicAutomationItemSummary(await deps.service.automationCreate(input), deps.triggers, deps.actions) }
  break
}

case "automation.item.update": {
  const input = parseUpdateParams(params, deps.triggers, deps.actions)
  result = { ok: true, data: toPublicAutomationItemSummary(await deps.service.automationUpdate(input.automationId, input.patch), deps.triggers, deps.actions) }
  break
}

case "automation.item.delete": {
  const { automationId } = parseAutomationIdParams(params)
  result = { ok: true, data: await deps.service.automationDelete(automationId) }
  break
}

case "automation.item.enable": {
  const { automationId } = parseAutomationIdParams(params)
  result = { ok: true, data: toPublicAutomationItemSummary(await deps.service.automationEnable(automationId), deps.triggers, deps.actions) }
  break
}

case "automation.item.disable": {
  const { automationId } = parseAutomationIdParams(params)
  result = { ok: true, data: toPublicAutomationItemSummary(await deps.service.automationDisable(automationId), deps.triggers, deps.actions) }
  break
}

case "automation.run.execute": {
  const { automationId } = parseAutomationIdParams(params)
  const run = await deps.service.runAutomationNow(automationId)
  result = { ok: true, data: run ? toPublicAutomationRunSummary(run) : null }
  break
}

case "automation.run.disable": {
  const { runId } = parseRunIdParams(params)
  result = { ok: true, data: await deps.service.stopRun(runId) }
  break
}

case "automation.run.list": {
  const input = parseRunListParams(params)
  const item = await deps.service.automationGet(input.automationId)
  if (!item) throw new Error(`Automation "${input.automationId}" was not found`)
  const runs = await deps.service.automationRunList(input.automationId, { limit: input.limit })
  result = { ok: true, data: runs.map(toPublicAutomationRunSummary), total: runs.length }
  break
}

case "automation.runtime.inspect": {
  const input = parseRuntimeInspectParams(params)
  result = { ok: true, data: await buildRuntimeInspect(deps, input.automationId) }
  break
}
```

Add helper implementations:

```ts
export function toPublicAutomationRunSummary(run: AutomationRun) {
  return {
    id: run.id,
    automationId: run.automationId,
    status: run.status,
    triggeredBy: run.triggeredBy,
    triggerType: run.triggerType,
    executorType: run.executorType,
    startedAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.result?.summary === undefined ? {} : { summary: run.result.summary }),
    ...(run.result?.metrics === undefined ? {} : { metrics: run.result.metrics }),
  }
}

function parseCreateParams(
  params: Record<string, unknown>,
  triggers: AutomationTriggerRegistry,
  actions: MainActionRegistry,
): AutomationCreateInput {
  const name = params.name
  const scope = params.scope
  const trigger = params.trigger
  const executor = params.executor
  if (typeof name !== "string" || !name.trim()) throw new Error("Missing or invalid 'name': expected non-empty string")
  if (!isRecord(scope)) throw new Error("Missing or invalid 'scope': expected object")
  if (!isRecord(trigger)) throw new Error("Missing or invalid 'trigger': expected object")
  if (!isRecord(executor)) throw new Error("Missing or invalid 'executor': expected object")
  return {
    name,
    description: optionalString(params.description, "description"),
    enabled: optionalBoolean(params.enabled, "enabled"),
    scope: parseScope(scope),
    cwd: optionalString(params.cwd, "cwd"),
    trigger: parseTriggerRef(trigger, triggers),
    executor: parseExecutorRef(executor, actions),
    policy: parseOptionalPolicy(params.policy),
  }
}

function parseUpdateParams(
  params: Record<string, unknown>,
  triggers: AutomationTriggerRegistry,
  actions: MainActionRegistry,
): { automationId: string; patch: AutomationUpdateInput } {
  const { automationId } = parseAutomationIdParams(params)
  const patchRecord = requireRecord(params.patch, "patch")
  const allowed = new Set(["name", "description", "enabled", "scope", "cwd", "trigger", "executor", "policy"])
  for (const key of Object.keys(patchRecord)) {
    if (!allowed.has(key)) throw new Error(`Forbidden automation update field: ${key}`)
  }
  const patch: AutomationUpdateInput = {
    name: optionalString(patchRecord.name, "patch.name"),
    description: optionalString(patchRecord.description, "patch.description"),
    enabled: optionalBoolean(patchRecord.enabled, "patch.enabled"),
    scope: patchRecord.scope === undefined ? undefined : parseScope(requireRecord(patchRecord.scope, "patch.scope")),
    cwd: optionalString(patchRecord.cwd, "patch.cwd"),
    trigger: patchRecord.trigger === undefined ? undefined : parseTriggerRef(requireRecord(patchRecord.trigger, "patch.trigger"), triggers),
    executor: patchRecord.executor === undefined ? undefined : parseExecutorRef(requireRecord(patchRecord.executor, "patch.executor"), actions),
    policy: parseOptionalPolicy(patchRecord.policy),
  }
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new Error("automation.item.update requires at least one field to update")
  }
  return { automationId, patch }
}

function parseTriggerRef(value: Record<string, unknown>, triggers: AutomationTriggerRegistry) {
  const type = requireString(value, "trigger.type")
  const config = requireRecord(value.config, "trigger.config")
  return {
    type,
    config: triggers.parseConfig(type, config),
  }
}

function parseExecutorRef(value: Record<string, unknown>, actions: MainActionRegistry) {
  const type = requireString(value, "executor.type")
  const config = requireRecord(value.config, "executor.config")
  return {
    type,
    config: actions.parseConfig(type, config),
  }
}

function parseScope(value: Record<string, unknown>) {
  if (value.type === "global") return { type: "global" as const }
  if (value.type === "project") {
    const projectId = value.projectId
    if (typeof projectId !== "string" || !projectId.trim()) {
      throw new Error("Missing or invalid 'scope.projectId': expected non-empty string")
    }
    return { type: "project" as const, projectId }
  }
  throw new Error("Missing or invalid 'scope.type': expected global or project")
}

function parseOptionalPolicy(value: unknown): AutomationCreateInput["policy"] {
  if (value === undefined) return undefined
  const record = requireRecord(value, "policy")
  const missedRunPolicy = record.missedRunPolicy
  const overlapPolicy = record.overlapPolicy
  if (missedRunPolicy !== undefined && missedRunPolicy !== "skip" && missedRunPolicy !== "run_once") {
    throw new Error("Missing or invalid 'policy.missedRunPolicy': expected skip or run_once")
  }
  if (overlapPolicy !== undefined && overlapPolicy !== "skip") {
    throw new Error("Missing or invalid 'policy.overlapPolicy': expected skip")
  }
  return {
    missedRunPolicy: missedRunPolicy as "skip" | "run_once" | undefined,
    overlapPolicy: overlapPolicy as "skip" | undefined,
  }
}

function parseRunIdParams(params: Record<string, unknown>): { runId: string } {
  return { runId: requireString(params, "runId") }
}

function parseRunListParams(params: Record<string, unknown>): { automationId: string; limit: number } {
  const { automationId } = parseAutomationIdParams(params)
  const rawLimit = params.limit
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || Number(rawLimit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  return { automationId, limit: rawLimit === undefined ? 20 : Math.min(rawLimit as number, 100) }
}

function parseRuntimeInspectParams(params: Record<string, unknown>): { automationId?: string } {
  if (params.automationId === undefined) return {}
  return parseAutomationIdParams(params)
}

async function buildRuntimeInspect(deps: AutomationCapabilityDispatcherDeps, automationId?: string) {
  const inspect = deps.service.automationRuntimeInspect()
  const runningItemIds = [...inspect.runningItemIds]
  const scheduledItemIds = [...inspect.timers]
  const items = automationId
    ? [await deps.service.automationGet(automationId)]
    : await deps.service.automationList()
  if (automationId && !items[0]) throw new Error(`Automation "${automationId}" was not found`)
  return {
    runningItemIds,
    scheduledItemIds,
    items: items
      .filter((item): item is AutomationItem => item !== null)
      .map((item) => ({
        id: item.id,
        name: item.name,
        enabled: item.enabled,
        running: runningItemIds.includes(item.id),
        scheduled: scheduledItemIds.includes(item.id),
        activeRunId: item.activeRun?.id,
        nextRunAt: item.nextRunAt,
        lastRunAt: item.lastRunAt,
        lastStatus: item.lastStatus,
      })),
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return value
}

function requireRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Missing or invalid '${key}': expected object`)
  return value
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`Missing or invalid '${key}': expected string`)
  return value
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`Missing or invalid '${key}': expected boolean`)
  return value
}
```

- [ ] **Step 4: Run the dispatcher tests and fix exact type errors**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/automation-dispatcher.test.ts
```

Expected: PASS. Use this return type for `parseOptionalPolicy` from the start so create and update inputs both receive a narrowed policy object:

```ts
function parseOptionalPolicy(value: unknown): { missedRunPolicy?: "skip" | "run_once"; overlapPolicy?: "skip" } | undefined
```

- [ ] **Step 5: Commit dispatcher mutation support**

Run:

```bash
git add desktop/electron/capabilities/automation-dispatcher.ts desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts
git commit -m "feat(automation): add mcp mutations and runs"
```

---

### Task 5: Wire Automation Dispatcher Into Bootstrap And MCP Runtime

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/__tests__/registry.test.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- Modify: `desktop/electron/database/__tests__/mcp-server.test.ts`

- [ ] **Step 1: Write/update failing bootstrap tests**

In `desktop/electron/bootstrap/__tests__/registry.test.ts`, update the `core.database` dependency expectation so it includes `core.automation` after `core.task-scheduler`:

```ts
expect(byId.get("core.database")?.dependsOn).toEqual([
  "core.config",
  "core.event-bus",
  "core.task-scheduler",
  "core.automation",
  "core.action-runtime",
  "core.workflow",
  "core.workflow.snapshots",
  "core.workflow.run-aborts",
  "core.workflow.run-statuses",
  "core.workflow.engine",
  "core.permission-guard",
  "core.audit-sink",
  PROVIDER_SERVICE_ID,
])
```

Also add:

```ts
expect(idx("core.automation")).toBeLessThan(idx("core.database"))
```

In `desktop/electron/bootstrap/__tests__/descriptors.test.ts`, update any `coreDatabaseDescriptor.dependsOn` expectation with the same added `core.automation` entry.

- [ ] **Step 2: Add a failing MCP tools/list test**

Append to `desktop/electron/database/__tests__/mcp-server.test.ts`:

```ts
it("lists Automation MCP tools", async () => {
  const { startMcpServer } = await import("../mcp-server")
  const port = await startMcpServer({
    dispatch: vi.fn(),
  })

  const response = await postJson(port, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  })

  expect(response.status).toBe(200)
  const payload = JSON.parse(response.body)
  expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
    "automation_item_list",
    "automation_item_create",
    "automation_run_execute",
    "automation_trigger_type_list",
    "automation_executor_type_list",
  ]))
})

it("calls Automation tools through the action router", async () => {
  const dispatch = vi.fn(async () => ({ ok: true, data: [{ id: "automation:1" }] }))
  const { startMcpServer } = await import("../mcp-server")
  const port = await startMcpServer({ dispatch })

  const response = await postJson(port, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "automation_item_list",
      arguments: { enabled: true },
    },
  })

  expect(response.status).toBe(200)
  expect(dispatch).toHaveBeenCalledWith("automation.item.list", { enabled: true }, { source: "mcp-http" })
  expect(JSON.parse(response.body).result.content[0].text).toBe(JSON.stringify([{ id: "automation:1" }], null, 2))
})
```

- [ ] **Step 3: Run focused tests and verify they fail before wiring**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/bootstrap/__tests__/registry.test.ts \
  electron/bootstrap/__tests__/descriptors.test.ts \
  electron/database/__tests__/mcp-server.test.ts
```

Expected: FAIL on bootstrap dependency and router wiring assertions before this task is implemented. MCP `tools/list` assertions are regression coverage and may already pass after Task 1 registered the Automation domain.

- [ ] **Step 4: Wire the dispatcher in `coreDatabaseDescriptor`**

Modify imports in `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { createAutomationCapabilityDispatcher } from "../capabilities/automation-dispatcher"
```

Add `"core.automation"` to `coreDatabaseDescriptor.dependsOn` immediately after `"core.task-scheduler"`.

Inside `create(ctx)`, after `taskScheduler`:

```ts
const automation = ctx.registry.get<AutomationService>("core.automation")
```

After `variableDispatcher` creation:

```ts
const automationDispatcher = createAutomationCapabilityDispatcher({
  service: automation,
  triggers: createBuiltinAutomationTriggerRegistry(),
  actions: actionRuntime,
  permissionGuard,
  auditSink,
})
```

Use a fresh `createBuiltinAutomationTriggerRegistry()` for dispatcher validation and summaries. Do not change `AutomationService` public shape only to expose its internal registry; the built-in trigger definitions are deterministic and shared through the same factory.

Add to `createSynapseActionRouter`:

```ts
automationDispatch: (action, params, context) => automationDispatcher.dispatch(action, params, context),
```

- [ ] **Step 5: Run focused wiring tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/bootstrap/__tests__/registry.test.ts \
  electron/bootstrap/__tests__/descriptors.test.ts \
  electron/database/__tests__/mcp-server.test.ts \
  electron/capabilities/__tests__/action-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit bootstrap wiring**

Run:

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts desktop/electron/database/__tests__/mcp-server.test.ts
git commit -m "feat(automation): wire mcp dispatcher"
```

---

### Task 6: Add Built-In Automation MCP Skill

**Files:**
- Create: `desktop/resources/templates/skills/synapse-automation-mcp/meta.json`
- Create: `desktop/resources/templates/skills/synapse-automation-mcp/content.md`
- Create: `desktop/resources/templates/skills/synapse-automation-mcp/files/api-reference.md`

- [ ] **Step 1: Create `meta.json`**

Create `desktop/resources/templates/skills/synapse-automation-mcp/meta.json`:

```json
{
  "id": "synapse-automation-mcp",
  "name": "synapse-automation-mcp",
  "title": "Synapse 自动化 MCP",
  "usage": "让 AI 管理 Synapse 自动化：创建、修改、启用、禁用、删除、手动运行、停止运行并查看运行记录。\n\n- **适合**：配置 cron/interval/webhook 触发器和命令、脚本、HTTP、Agent 执行器。\n- **会做**：创建或修改前先读取触发器和执行器类型；按 id 操作；用运行记录和 runtime inspect 排查状态。\n- **限制**：读取结果会刻意隐藏 executor config，不能用来查看命令正文、Agent prompt、HTTP body 或 secret。",
  "description": "Use when managing Synapse Automation items, trigger/executor configs, enablement, manual runs, active runs, run history, or Automation runtime state through MCP tools.",
  "category": "automation",
  "icon": "terminal",
  "iconBg": "teal"
}
```

- [ ] **Step 2: Create `content.md`**

Create `desktop/resources/templates/skills/synapse-automation-mcp/content.md`:

```md
# Synapse Automation MCP

You have access to Synapse Automation MCP tools for managing Automation items and runs. Automation is separate from Scheduler and Workflow.

## Scope Boundary

Use this skill only for Synapse Automation items, trigger/executor configuration, enablement, manual runs, active run stopping, run history, and Automation runtime state.

Do not use this skill for old Scheduler tasks, Workflow definitions, database rows, content publishing, provider settings, or editor installation. Switch to the matching dedicated Synapse MCP skill when available.

## Capabilities

Automation MCP exposes these operations:

- list, get, create, update, delete Automation items
- enable or disable Automation items
- manually run one Automation
- stop one active Automation run
- list recent Automation runs
- inspect Automation runtime state
- list registered trigger types
- list registered executor types

Read responses intentionally omit raw `trigger.config` and `executor.config`. Do not ask MCP to reveal hidden command text, scripts, Agent prompts, HTTP bodies, tokens, cookies, Authorization values, or environment secrets.

## Default Flow

1. If the user gives an Automation name instead of an id, call `automation_item_list` first. Names are not unique.
2. Before creating or replacing configs, call `automation_trigger_type_list` and `automation_executor_type_list`.
3. Build a full `trigger` ref: `{ "type": "...", "config": { ... } }`.
4. Build a full `executor` ref: `{ "type": "...", "config": { ... } }`.
5. Call `automation_item_create` or `automation_item_update`.
6. Use `automation_item_enable` or `automation_item_disable` for enabled state changes.
7. Use `automation_run_execute` for a manual run.
8. Use `automation_runtime_inspect` and `automation_run_list` to troubleshoot execution state.
9. Use `automation_run_disable` only when stopping an active run by run id.

## Trigger Rules

Always use trigger type discovery unless the exact config is already known from this conversation.

Known built-in trigger types include:

- `builtin.cron` — schedule by five-field cron expression.
- `builtin.interval` — schedule by fixed interval.
- `builtin.webhook` — run when a matching Webhook delivery arrives.

Use the returned `configSchema`, `defaultConfig`, and `variables` from `automation_trigger_type_list`. Do not guess fields that are not in the schema.

## Executor Rules

Always use executor type discovery unless the exact config is already known from this conversation.

Known built-in executor types include:

- `builtin.command` — runs one shell command.
- `builtin.script` — runs shell script content.
- `builtin.http-request` — sends one HTTP request.
- `builtin.agent` — sends work to an Agent.

Use `automation_executor_type_list` for public config fields, defaults, and permissions. Do not guess provider ids, model tiers, project ids, or Agent settings.

## Update Rules

Use `automation_item_update` with a focused patch. The patch may include `trigger` or `executor`, but those refs replace the corresponding stored config.

If you only need to enable or disable an Automation, use `automation_item_enable` or `automation_item_disable` instead of `automation_item_update`.

If a read result only shows `{ type, summary }`, that is expected. It is not enough to reconstruct private configs. Ask the user for the new desired config or use discovery defaults.

## Run Rules

- `automation_run_execute` starts a manual run and returns a safe run summary.
- `automation_run_disable` stops an active run by run id.
- `automation_run_list` returns recent run summaries without raw logs or outputs.
- `automation_runtime_inspect` shows which items are scheduled or running.

## API Reference

See the attached `api-reference.md` for complete tool signatures and public result shapes.
```

- [ ] **Step 3: Create `files/api-reference.md`**

Create `desktop/resources/templates/skills/synapse-automation-mcp/files/api-reference.md`:

```md
# Synapse Automation MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Discovery

### automation_trigger_type_list

Input:

```json
{}
```

Returns trigger descriptors with `type`, `title`, `kind`, `defaultConfig`, `configSchema`, and optional `variables`.

### automation_executor_type_list

Input:

```json
{}
```

Returns executor descriptors with `type`, `title`, `permissions`, `defaultConfig`, and `configFields`.

## Items

### automation_item_list

Input:

```json
{
  "enabled": true,
  "limit": 20,
  "scope": { "type": "project", "projectId": "project-id" }
}
```

All fields are optional. Returns public item summaries.

### automation_item_get

Input:

```json
{ "automationId": "automation:..." }
```

Returns one public item summary or `null`.

### automation_item_create

Input:

```json
{
  "name": "Daily summary",
  "description": "Optional description",
  "enabled": true,
  "scope": { "type": "global" },
  "cwd": "/Users/example/project",
  "trigger": {
    "type": "builtin.interval",
    "config": { "everyMinutes": 60, "anchor": "created_at", "activeDays": [1, 2, 3, 4, 5] }
  },
  "executor": {
    "type": "builtin.command",
    "config": { "command": "date", "shell": "posix", "timeoutMins": 30 }
  },
  "policy": { "missedRunPolicy": "skip", "overlapPolicy": "skip" }
}
```

Returns a public item summary.

### automation_item_update

Input:

```json
{
  "automationId": "automation:...",
  "patch": {
    "name": "New name",
    "trigger": {
      "type": "builtin.interval",
      "config": { "everyMinutes": 30, "anchor": "last_completed_at", "activeDays": [1, 2, 3, 4, 5] }
    }
  }
}
```

Returns a public item summary. `trigger` and `executor` patches replace the corresponding stored refs.

### automation_item_delete

Input:

```json
{ "automationId": "automation:..." }
```

Returns:

```json
{ "deleted": true }
```

### automation_item_enable

Input:

```json
{ "automationId": "automation:..." }
```

Returns a public item summary.

### automation_item_disable

Input:

```json
{ "automationId": "automation:..." }
```

Returns a public item summary.

## Runs

### automation_run_execute

Input:

```json
{ "automationId": "automation:..." }
```

Returns a safe run summary or `null`.

### automation_run_disable

Input:

```json
{ "runId": "automation-run:..." }
```

Returns:

```json
{ "stopped": true }
```

If the run already finished, the result can include:

```json
{ "stopped": false, "alreadyFinished": true }
```

### automation_run_list

Input:

```json
{ "automationId": "automation:...", "limit": 20 }
```

Returns recent safe run summaries. `limit` defaults to 20 and caps at 100.

## Runtime

### automation_runtime_inspect

Input:

```json
{ "automationId": "automation:..." }
```

`automationId` is optional. Returns running item ids, scheduled item ids, and compact runtime state.

## Public Summary Boundary

Item summaries include trigger type, trigger summary, executor type, executor title, status, timestamps, and validation issues.

Item summaries do not include `trigger.config` or `executor.config`.

Run summaries include id, status, trigger/executor type, timestamps, result summary, and non-secret metrics.

Run summaries do not include logs, raw outputs, Agent prompts, shell command text, scripts, HTTP bodies, Authorization values, Bearer tokens, Basic passwords, cookies, API keys, environment variable values, or raw event payloads.
```

- [ ] **Step 4: Parse the template metadata**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("desktop/resources/templates/skills/synapse-automation-mcp/meta.json","utf8")); console.log("ok")'
```

Expected: prints `ok`.

- [ ] **Step 5: Commit built-in skill**

Run:

```bash
git add desktop/resources/templates/skills/synapse-automation-mcp
git commit -m "feat(automation): add built-in mcp skill"
```

---

### Task 7: Update Docs And Release Notes

**Files:**
- Modify: `docs/reference/capability-naming-matrix.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update capability naming matrix**

In `docs/reference/capability-naming-matrix.md`, insert these rows after Scheduler rows:

```md
| `automation.item.list` | `automation_item_list` | `automation.item.list` | `automationItemList` |
| `automation.item.get` | `automation_item_get` | `automation.item.get` | `automationItemGet` |
| `automation.item.create` | `automation_item_create` | `automation.item.create` | `automationItemCreate` |
| `automation.item.update` | `automation_item_update` | `automation.item.update` | `automationItemUpdate` |
| `automation.item.delete` | `automation_item_delete` | `automation.item.delete` | `automationItemDelete` |
| `automation.item.enable` | `automation_item_enable` | `automation.item.enable` | `automationItemEnable` |
| `automation.item.disable` | `automation_item_disable` | `automation.item.disable` | `automationItemDisable` |
| `automation.run.execute` | `automation_run_execute` | `automation.run.execute` | `automationRunExecute` |
| `automation.run.disable` | `automation_run_disable` | `automation.run.disable` | `automationRunDisable` |
| `automation.run.list` | `automation_run_list` | `automation.run.list` | `automationRunList` |
| `automation.runtime.inspect` | `automation_runtime_inspect` | `automation.runtime.inspect` | `automationRuntimeInspect` |
| `automation.trigger_type.list` | `automation_trigger_type_list` | `automation.trigger_type.list` | `automationTriggerTypeList` |
| `automation.executor_type.list` | `automation_executor_type_list` | `automation.executor_type.list` | `automationExecutorTypeList` |
```

- [ ] **Step 2: Update release notes**

Open `RELEASE_NOTES_PENDING.md` and append this user-facing bullet to the existing pending list. If the file is grouped by section, place it under the section that already describes newly added user-facing features:

```md
- 新增 Synapse 自动化 MCP 能力和内置技能，安装后 Agent 可以通过 `synapse-mcp` 创建、修改、启用、禁用、删除、运行和排查自动化，同时读取结果会隐藏命令正文、Agent prompt、HTTP body 和敏感配置。
```

- [ ] **Step 3: Run a docs sanity check**

Run:

```bash
rg -n "automation\\.(item|run|runtime|trigger_type|executor_type)" docs/reference/capability-naming-matrix.md
node -e 'JSON.parse(require("node:fs").readFileSync("desktop/resources/templates/skills/synapse-automation-mcp/meta.json","utf8")); console.log("meta ok")'
```

Expected: matrix rows are printed and `meta ok` is printed.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add docs/reference/capability-naming-matrix.md RELEASE_NOTES_PENDING.md
git commit -m "docs: document automation mcp"
```

---

### Task 8: Final Verification

**Files:**
- Inspect all files changed by Tasks 1-7.

- [ ] **Step 1: Run focused MCP and Automation tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  synapse-capabilities/shared/__tests__/automation-domain.test.ts \
  electron/capabilities/__tests__/automation-dispatcher.test.ts \
  electron/capabilities/__tests__/action-router.test.ts \
  electron/bootstrap/__tests__/registry.test.ts \
  electron/bootstrap/__tests__/descriptors.test.ts \
  electron/database/__tests__/mcp-server.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Run hard-constraints check**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: exits 0.

- [ ] **Step 3: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Check for forbidden UI/style changes**

This feature should not change renderer UI. Confirm no UI styling files were touched:

```bash
git diff --name-only HEAD~5..HEAD | rg 'desktop/src/|desktop/components.json|desktop/src/styles/globals.css|\\.css$' || true
```

Expected: no renderer UI or CSS files are printed.

- [ ] **Step 5: Check redaction-sensitive strings in dispatcher tests**

Run:

```bash
rg -n "private prompt|private output|Authorization|Bearer|Cookie|apiKey|token" desktop/electron/capabilities/__tests__/automation-dispatcher.test.ts desktop/electron/capabilities/automation-dispatcher.ts
```

Expected: sensitive canary strings appear only in tests as negative assertions or spec-like deny lists, not in production output construction.

- [ ] **Step 6: Review changed files**

Run:

```bash
git status --short
git diff --stat
git log --oneline -8
```

Expected: worktree is clean after commits, recent commits correspond to plan tasks, and diff stat is limited to Automation MCP, router/bootstrap wiring, built-in Skill template, docs, and release notes.

---

## Self-Review

- Spec coverage: The plan covers the shared capability domain, action routing, Automation dispatcher, bootstrap MCP wiring, built-in Skill, API reference, capability matrix, release notes, and verification.
- Red-flag scan: The plan contains no deferred or unspecified implementation steps. Each implementation task includes concrete files, test snippets, commands, and expected outcomes.
- Type consistency: The plan consistently uses `automationId`, `runId`, `trigger`, `executor`, `AutomationService`, `AutomationTriggerRegistry`, `MainActionRegistry`, and canonical actions from the approved spec.
