# Automation Trigger Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trigger-declared variables to Automation, expose them from the trigger panel as copyable templates, and render them at runtime for Agent, Command, Script, and HTTP executors.

**Architecture:** Trigger packages declare available variables. Automation execution builds a per-run `templateVariables` map and passes it through `ActionRuntimeContext`. Each executor renders only its approved fields with a shared action-template helper; the trigger panel only copies variables and does not modify executor forms.

**Tech Stack:** Electron main process, React, TypeScript, Vitest, shadcn/Radix UI primitives, existing action-runtime and automation-trigger registries.

---

## File Structure

- Modify: `desktop/automation-trigger-packages/types.shared.ts`
  - Add trigger variable descriptor types to shared trigger manifests.
- Modify: `desktop/automation-trigger-packages/builtin/cron/manifest.ts`
  - Declare Cron variables.
- Modify: `desktop/automation-trigger-packages/builtin/interval/manifest.ts`
  - Declare Interval variables.
- Create: `desktop/electron/action-runtime/template-variables.ts`
  - Flatten trigger context and render `{{...}}` templates.
- Modify: `desktop/electron/action-runtime/action-registry.ts`
  - Add optional `templateVariables` to `ActionRuntimeContext`.
- Modify: `desktop/electron/services/automation/types.ts`
  - Add `AutomationTriggerRuntimeContext`.
- Modify: `desktop/electron/services/automation/automation-service.ts`
  - Build and pass trigger runtime context into execution.
- Modify: `desktop/electron/services/automation/execution-service.ts`
  - Accept runtime context and attach `templateVariables` to action context.
- Modify: `desktop/action-packages/builtin/agent/executor.main.ts`
  - Render `prompt`.
- Modify: `desktop/action-packages/builtin/shell-process.main.ts`
  - Render shell content and env values.
- Modify: `desktop/action-packages/builtin/http-request/executor.main.ts`
  - Render HTTP config before permission request and execution.
- Modify: `desktop/action-packages/builtin/http-request/request-builders.main.ts`
  - Keep request building pure; no template logic here unless tests show duplicated code is unavoidable.
- Modify: `desktop/src/modules/automation/editor/trigger-executor-builder.tsx`
  - Add the trigger-side `变量` button and copy popover.
- Modify tests:
  - `desktop/electron/services/automation/__tests__/execution-service.test.ts`
  - `desktop/electron/services/automation/__tests__/automation-service.test.ts`
  - `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`
  - `desktop/action-packages/builtin/command/__tests__/executor.test.ts`
  - `desktop/action-packages/builtin/script/__tests__/executor.test.ts`
  - `desktop/action-packages/builtin/http-request/__tests__/executor.test.ts`
  - `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
- Modify: `RELEASE_NOTES_PENDING.md`
  - Add one user-facing note.

---

### Task 1: Trigger Variable Descriptors

**Files:**
- Modify: `desktop/automation-trigger-packages/types.shared.ts`
- Modify: `desktop/automation-trigger-packages/builtin/cron/manifest.ts`
- Modify: `desktop/automation-trigger-packages/builtin/interval/manifest.ts`
- Test: `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`

- [ ] **Step 1: Write failing trigger variable metadata test**

Add to `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`:

```ts
it("exposes builtin trigger variables", () => {
  const registry = createBuiltinAutomationTriggerRegistry()

  const cron = registry.get("builtin.cron")
  const interval = registry.get("builtin.interval")

  expect(cron.manifest.variables?.map((variable) => variable.key)).toEqual([
    "trigger.type",
    "trigger.triggeredBy",
    "trigger.triggeredAt",
    "trigger.scheduledAt",
    "trigger.automationId",
    "trigger.automationName",
    "trigger.cron",
    "trigger.timezone",
  ])
  expect(interval.manifest.variables?.map((variable) => variable.key)).toEqual([
    "trigger.type",
    "trigger.triggeredBy",
    "trigger.triggeredAt",
    "trigger.scheduledAt",
    "trigger.automationId",
    "trigger.automationName",
    "trigger.everyMinutes",
    "trigger.anchor",
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/trigger-registry.test.ts
```

Expected: FAIL because `manifest.variables` is undefined.

- [ ] **Step 3: Add shared descriptor type**

In `desktop/automation-trigger-packages/types.shared.ts`, add before `AutomationTriggerManifest`:

```ts
export type AutomationTriggerVariableDescriptor = {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly example?: string
  readonly group?: "trigger" | "config" | "event"
  readonly dynamic?: boolean
}
```

Then add this property to `AutomationTriggerManifest`:

```ts
readonly variables?: readonly AutomationTriggerVariableDescriptor[]
```

- [ ] **Step 4: Declare Cron variables**

In `desktop/automation-trigger-packages/builtin/cron/manifest.ts`, add:

```ts
const cronTriggerVariables = [
  { key: "trigger.type", label: "触发器类型", group: "trigger" },
  { key: "trigger.triggeredBy", label: "运行来源", group: "trigger" },
  { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
  { key: "trigger.scheduledAt", label: "计划时间", group: "trigger" },
  { key: "trigger.automationId", label: "自动化 ID", group: "trigger" },
  { key: "trigger.automationName", label: "自动化名称", group: "trigger" },
  { key: "trigger.cron", label: "Cron 表达式", group: "config" },
  { key: "trigger.timezone", label: "时区", group: "config" },
] as const
```

Add `variables: cronTriggerVariables,` to `cronTriggerManifest`.

- [ ] **Step 5: Declare Interval variables**

In `desktop/automation-trigger-packages/builtin/interval/manifest.ts`, add:

```ts
const intervalTriggerVariables = [
  { key: "trigger.type", label: "触发器类型", group: "trigger" },
  { key: "trigger.triggeredBy", label: "运行来源", group: "trigger" },
  { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
  { key: "trigger.scheduledAt", label: "计划时间", group: "trigger" },
  { key: "trigger.automationId", label: "自动化 ID", group: "trigger" },
  { key: "trigger.automationName", label: "自动化名称", group: "trigger" },
  { key: "trigger.everyMinutes", label: "间隔分钟", group: "config" },
  { key: "trigger.anchor", label: "间隔锚点", group: "config" },
] as const
```

Add `variables: intervalTriggerVariables,` to `intervalTriggerManifest`.

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/trigger-registry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/automation-trigger-packages/types.shared.ts \
  desktop/automation-trigger-packages/builtin/cron/manifest.ts \
  desktop/automation-trigger-packages/builtin/interval/manifest.ts \
  desktop/electron/services/automation/__tests__/trigger-registry.test.ts
git commit -m "feat: declare automation trigger variables"
```

---

### Task 2: Template Helper And Automation Runtime Context

**Files:**
- Create: `desktop/electron/action-runtime/template-variables.ts`
- Modify: `desktop/electron/action-runtime/action-registry.ts`
- Modify: `desktop/electron/services/automation/types.ts`
- Modify: `desktop/electron/services/automation/automation-service.ts`
- Modify: `desktop/electron/services/automation/execution-service.ts`
- Test: `desktop/electron/services/automation/__tests__/execution-service.test.ts`
- Test: `desktop/electron/services/automation/__tests__/automation-service.test.ts`

- [ ] **Step 1: Write failing template helper tests**

Create `desktop/electron/action-runtime/__tests__/template-variables.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  buildAutomationTemplateVariables,
  renderActionTemplate,
  renderStringRecordTemplates,
} from "../template-variables"

describe("action template variables", () => {
  it("renders braced variables and supports optional dollar prefix", () => {
    expect(renderActionTemplate(
      "run {{trigger.automationName}} at {{$trigger.triggeredAt}}",
      {
        "trigger.automationName": "Daily",
        "trigger.triggeredAt": "2026-06-06T00:00:00.000Z",
      },
    )).toBe("run Daily at 2026-06-06T00:00:00.000Z")
  })

  it("fails on unknown variables", () => {
    expect(() => renderActionTemplate("{{trigger.missing}}", {}))
      .toThrow("未知变量：trigger.missing")
  })

  it("renders record keys and values", () => {
    expect(renderStringRecordTemplates(
      { "X-{{trigger.type}}": "run-{{trigger.triggeredBy}}" },
      {
        "trigger.type": "builtin.cron",
        "trigger.triggeredBy": "trigger",
      },
    )).toEqual({ "X-builtin.cron": "run-trigger" })
  })

  it("builds schedule trigger variables from automation context", () => {
    expect(buildAutomationTemplateVariables({
      triggerType: "builtin.cron",
      triggerConfig: { expr: "0 9 * * *", timezone: "Asia/Shanghai" },
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Morning",
    })).toEqual(expect.objectContaining({
      "trigger.type": "builtin.cron",
      "trigger.triggeredBy": "trigger",
      "trigger.triggeredAt": "2026-06-06T01:00:00.000Z",
      "trigger.scheduledAt": "2026-06-06T01:00:00.000Z",
      "trigger.automationId": "automation:1",
      "trigger.automationName": "Morning",
      "trigger.cron": "0 9 * * *",
      "trigger.timezone": "Asia/Shanghai",
    }))
  })

  it("flattens event payload variables without logging raw payload", () => {
    expect(buildAutomationTemplateVariables({
      triggerType: "builtin.webhook",
      triggerConfig: {},
      triggeredBy: "trigger",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
      automationId: "automation:1",
      automationName: "Webhook",
      event: {
        source: "github",
        type: "issue",
        receivedAt: "2026-06-06T01:00:01.000Z",
        payload: { issue: { title: "Bug", number: 12 }, labels: ["bug"] },
      },
    })).toEqual(expect.objectContaining({
      "trigger.source": "github",
      "trigger.eventType": "issue",
      "trigger.receivedAt": "2026-06-06T01:00:01.000Z",
      "trigger.payload.issue.title": "Bug",
      "trigger.payload.issue.number": "12",
      "trigger.payload.labels.0": "bug",
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/action-runtime/__tests__/template-variables.test.ts
```

Expected: FAIL because `template-variables.ts` does not exist.

- [ ] **Step 3: Implement template helper**

Create `desktop/electron/action-runtime/template-variables.ts`:

```ts
import type { AutomationTriggerEvent } from "../services/automation/types"

const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu
const MAX_FLATTEN_DEPTH = 8
const MAX_FLATTEN_KEYS = 200

export type AutomationTemplateVariableInput = {
  readonly triggerType: string
  readonly triggerConfig: Record<string, unknown>
  readonly triggeredBy: "trigger" | "manual" | "missed_run"
  readonly triggeredAt: string
  readonly scheduledAt: string
  readonly automationId: string
  readonly automationName: string
  readonly event?: AutomationTriggerEvent
}

export function renderActionTemplate(
  template: string,
  variables: Record<string, string> | undefined,
): string {
  const source = variables ?? {}
  return template.replace(TEMPLATE_VARIABLE_RE, (_match, name: string) => {
    if (!(name in source)) {
      throw new Error(`未知变量：${name}`)
    }
    return source[name]
  })
}

export function renderStringRecordTemplates(
  record: Record<string, string> | undefined,
  variables: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined
  const rendered: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    rendered[renderActionTemplate(key, variables)] = renderActionTemplate(value, variables)
  }
  return rendered
}

export function buildAutomationTemplateVariables(
  input: AutomationTemplateVariableInput,
): Record<string, string> {
  const variables: Record<string, string> = {
    "trigger.type": input.triggerType,
    "trigger.triggeredBy": input.triggeredBy,
    "trigger.triggeredAt": input.triggeredAt,
    "trigger.scheduledAt": input.scheduledAt,
    "trigger.automationId": input.automationId,
    "trigger.automationName": input.automationName,
  }

  if (typeof input.triggerConfig.expr === "string") {
    variables["trigger.cron"] = input.triggerConfig.expr
  }
  if (typeof input.triggerConfig.timezone === "string") {
    variables["trigger.timezone"] = input.triggerConfig.timezone
  } else if ("expr" in input.triggerConfig) {
    variables["trigger.timezone"] = ""
  }
  if (typeof input.triggerConfig.everyMinutes === "number") {
    variables["trigger.everyMinutes"] = String(input.triggerConfig.everyMinutes)
  }
  if (typeof input.triggerConfig.anchor === "string") {
    variables["trigger.anchor"] = input.triggerConfig.anchor
  }

  if (input.event) {
    variables["trigger.source"] = input.event.source
    variables["trigger.eventType"] = input.event.type
    variables["trigger.receivedAt"] = input.event.receivedAt
    flattenValue("trigger.payload", input.event.payload, variables)
  }

  return variables
}

function flattenValue(
  prefix: string,
  value: unknown,
  output: Record<string, string>,
  depth = 0,
): void {
  if (Object.keys(output).length >= MAX_FLATTEN_KEYS || depth > MAX_FLATTEN_DEPTH) return
  if (value === null || value === undefined) {
    output[prefix] = ""
    return
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output[prefix] = String(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenValue(`${prefix}.${String(index)}`, item, output, depth + 1))
    return
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenValue(`${prefix}.${key}`, child, output, depth + 1)
    }
  }
}
```

- [ ] **Step 4: Add runtime context types**

In `desktop/electron/action-runtime/action-registry.ts`, add to `ActionRuntimeContext`:

```ts
readonly templateVariables?: Record<string, string>
```

In `desktop/electron/services/automation/types.ts`, add:

```ts
export interface AutomationTriggerRuntimeContext {
  readonly triggeredBy: AutomationRunTrigger
  readonly triggeredAt: string
  readonly scheduledAt: string
  readonly event?: AutomationTriggerEvent
}
```

- [ ] **Step 5: Pass template variables through execution service**

Modify `AutomationExecutionService.runItem` signature in `desktop/electron/services/automation/execution-service.ts`:

```ts
async runItem(
  item: AutomationItem,
  triggeredBy: AutomationRunTrigger,
  options: AutomationRunItemOptions = {},
  triggerContext?: AutomationTriggerRuntimeContext,
): Promise<AutomationRun> {
```

Import `buildAutomationTemplateVariables`. Before building `context`, compute:

```ts
const nowIso = new Date().toISOString()
const effectiveTriggerContext = triggerContext ?? {
  triggeredBy,
  triggeredAt: nowIso,
  scheduledAt: nowIso,
}
const templateVariables = buildAutomationTemplateVariables({
  triggerType: item.trigger.type,
  triggerConfig: item.trigger.config,
  triggeredBy: effectiveTriggerContext.triggeredBy,
  triggeredAt: effectiveTriggerContext.triggeredAt,
  scheduledAt: effectiveTriggerContext.scheduledAt,
  automationId: item.id,
  automationName: item.name,
  event: effectiveTriggerContext.event,
})
```

Add to action `context`:

```ts
templateVariables,
```

- [ ] **Step 6: Pass event context from AutomationService**

In `AutomationService.acceptEvent`, replace:

```ts
acceptedRuns.push(await this.executeOrSkip(item, "trigger"))
```

with:

```ts
acceptedRuns.push(await this.executeOrSkip(item, "trigger", {
  triggeredBy: "trigger",
  triggeredAt: event.receivedAt,
  scheduledAt: event.receivedAt,
  event,
}))
```

Update `executeOrSkip` signature:

```ts
private async executeOrSkip(
  item: AutomationItem,
  triggeredBy: AutomationRunTrigger,
  triggerContext?: AutomationTriggerRuntimeContext,
): Promise<AutomationRun> {
```

Pass `triggerContext` to `runItem`.

In scheduled/manual paths, construct context with `new Date().toISOString()` or `this.now().toISOString()` at the point of execution.

- [ ] **Step 7: Add execution-service context test**

In `desktop/electron/services/automation/__tests__/execution-service.test.ts`, add:

```ts
it("passes trigger template variables to executors", async () => {
  let observedVariables: Record<string, string> | undefined
  const harness = await createExecutionHarness({
    action: {
      ...testAction,
      execute: async ({ context }) => {
        observedVariables = context.templateVariables
        return { status: "success", summary: "ok" }
      },
    },
  })

  await harness.service.runItem(harness.item, "trigger", {}, {
    triggeredBy: "trigger",
    triggeredAt: "2026-06-06T01:00:00.000Z",
    scheduledAt: "2026-06-06T01:00:00.000Z",
  })

  expect(observedVariables).toEqual(expect.objectContaining({
    "trigger.type": "builtin.cron",
    "trigger.triggeredBy": "trigger",
    "trigger.triggeredAt": "2026-06-06T01:00:00.000Z",
    "trigger.scheduledAt": "2026-06-06T01:00:00.000Z",
    "trigger.automationId": "automation:1",
    "trigger.automationName": "Daily report",
    "trigger.cron": "0 9 * * *",
  }))
})
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/action-runtime/__tests__/template-variables.test.ts \
  electron/services/automation/__tests__/execution-service.test.ts \
  electron/services/automation/__tests__/automation-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/action-runtime/action-registry.ts \
  desktop/electron/action-runtime/template-variables.ts \
  desktop/electron/action-runtime/__tests__/template-variables.test.ts \
  desktop/electron/services/automation/types.ts \
  desktop/electron/services/automation/automation-service.ts \
  desktop/electron/services/automation/execution-service.ts \
  desktop/electron/services/automation/__tests__/execution-service.test.ts \
  desktop/electron/services/automation/__tests__/automation-service.test.ts
git commit -m "feat: pass automation trigger variables to actions"
```

---

### Task 3: Executor Template Rendering

**Files:**
- Modify: `desktop/action-packages/builtin/agent/executor.main.ts`
- Modify: `desktop/action-packages/builtin/shell-process.main.ts`
- Modify: `desktop/action-packages/builtin/http-request/executor.main.ts`
- Test: `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`
- Test: `desktop/action-packages/builtin/command/__tests__/executor.test.ts`
- Test: `desktop/action-packages/builtin/script/__tests__/executor.test.ts`
- Test: `desktop/action-packages/builtin/http-request/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing Agent executor test**

Add to `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`:

```ts
it("renders prompt templates from action context variables", async () => {
  const runtime = {
    sendScheduled: vi.fn(async () => ({
      conversationId: "conversation-1",
      status: "success" as const,
      summary: "done",
      durationMs: 12,
    })),
  } as unknown as AgentRuntimeService
  const action = createAgentAction({ getAgentRuntime: async () => runtime })

  await action.execute({
    config: {
      projectId: "project-1",
      agentType: "claude-code",
      providerId: "anthropic",
      modelTier: "sonnet",
      mode: "default",
      prompt: "Summarize {{trigger.automationName}}",
      sessionPolicy: "fresh",
    },
    context: {
      taskId: "task-1",
      runId: "run-1",
      triggeredBy: "schedule",
      cwd: "/repo",
      actor: { kind: "user", id: "automation" },
      abortSignal: new AbortController().signal,
      templateVariables: { "trigger.automationName": "Daily" },
    },
  })

  expect(runtime.sendScheduled).toHaveBeenCalledWith(expect.objectContaining({
    prompt: "Summarize Daily",
  }))
})
```

- [ ] **Step 2: Write failing Command and Script tests**

Add to command executor tests:

```ts
it("renders command and env templates from action context variables", async () => {
  const run = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    durationMs: 1,
  }))
  const action = createCommandAction({ processRunner: { run }, platform: "darwin" })

  await action.execute({
    config: {
      command: "echo {{trigger.automationName}}",
      shell: "posix",
      env: { RUN_NAME: "{{trigger.automationName}}" },
    },
    context: {
      taskId: "task:1",
      runId: "run:1",
      triggeredBy: "schedule",
      cwd: "/tmp",
      actor: { kind: "user", id: "automation" },
      abortSignal: new AbortController().signal,
      templateVariables: { "trigger.automationName": "Daily" },
    },
  })

  expect(run).toHaveBeenCalledWith(expect.objectContaining({
    args: ["-lc", "echo Daily"],
    env: { RUN_NAME: "Daily" },
  }))
})
```

Add to script executor tests:

```ts
it("renders script and env templates from action context variables", async () => {
  const run = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1,
  }))
  const action = createScriptAction({ processRunner: { run }, platform: "darwin" })

  await action.execute({
    config: {
      script: "echo {{trigger.automationName}}",
      shell: "posix",
      env: { RUN_NAME: "{{trigger.automationName}}" },
    },
    context: {
      taskId: "task:1",
      runId: "run:1",
      triggeredBy: "schedule",
      cwd: "/tmp",
      actor: { kind: "user", id: "automation" },
      abortSignal: new AbortController().signal,
      templateVariables: { "trigger.automationName": "Daily" },
    },
  })

  expect(run).toHaveBeenCalledWith(expect.objectContaining({
    args: ["-lc", "echo Daily"],
    env: { RUN_NAME: "Daily" },
  }))
})
```

- [ ] **Step 3: Write failing HTTP test**

Add to HTTP executor tests:

```ts
it("renders HTTP templates for url, query, headers, body, and auth", async () => {
  const sendRequest = vi.fn(async () => ({
    status: 200,
    statusText: "OK",
    headers: {},
    body: "",
  }))
  const action = createHttpRequestAction({ sendRequest })

  await action.execute({
    config: {
      method: "POST",
      url: "https://example.com/{{trigger.payload.team}}",
      query: { "{{trigger.payload.queryKey}}": "{{trigger.payload.queryValue}}" },
      headers: { "X-{{trigger.payload.headerKey}}": "{{trigger.payload.headerValue}}" },
      bodyType: "text",
      body: "issue={{trigger.payload.issue}}",
      auth: { type: "bearer", bearerToken: "{{trigger.payload.token}}" },
    },
    context: {
      taskId: "task:1",
      runId: "run:1",
      triggeredBy: "schedule",
      cwd: "/tmp",
      actor: { kind: "user", id: "automation" },
      abortSignal: new AbortController().signal,
      templateVariables: {
        "trigger.payload.team": "ops",
        "trigger.payload.queryKey": "id",
        "trigger.payload.queryValue": "42",
        "trigger.payload.headerKey": "Trace",
        "trigger.payload.headerValue": "abc",
        "trigger.payload.issue": "Bug",
        "trigger.payload.token": "secret-token",
      },
    },
  })

  expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({
    url: "https://example.com/ops?id=42",
    headers: {
      "X-Trace": "abc",
      Authorization: "Bearer secret-token",
    },
    body: "issue=Bug",
  }))
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  action-packages/builtin/agent/__tests__/executor.main.test.ts \
  action-packages/builtin/command/__tests__/executor.test.ts \
  action-packages/builtin/script/__tests__/executor.test.ts \
  action-packages/builtin/http-request/__tests__/executor.test.ts
```

Expected: FAIL because executor fields are still unrendered.

- [ ] **Step 5: Render Agent prompt**

In `desktop/action-packages/builtin/agent/executor.main.ts`, import:

```ts
import { renderActionTemplate } from "../../../electron/action-runtime/template-variables"
```

Before `runtime.sendScheduled`, compute:

```ts
const prompt = renderActionTemplate(input.config.prompt, input.context.templateVariables)
```

Use `prompt` in `sendScheduled` instead of `input.config.prompt`.

- [ ] **Step 6: Render shell content and env**

In `desktop/action-packages/builtin/shell-process.main.ts`, import:

```ts
import {
  renderActionTemplate,
  renderStringRecordTemplates,
} from "../../electron/action-runtime/template-variables"
```

At the start of `runShellAction`, compute:

```ts
const content = renderActionTemplate(input.content, input.context.templateVariables)
const env = renderStringRecordTemplates(input.config.env, input.context.templateVariables)
```

Use `content` in `resolveShellCommand(...)` and use `env` for `processRunner.run({ env, envAllowlist })`.

Set `envAllowlist` from rendered env:

```ts
envAllowlist: env ? Object.keys(env) : undefined,
```

- [ ] **Step 7: Render HTTP config**

In `desktop/action-packages/builtin/http-request/executor.main.ts`, import:

```ts
import {
  renderActionTemplate,
  renderStringRecordTemplates,
} from "../../../electron/action-runtime/template-variables"
```

Add helper:

```ts
function renderHttpConfig(
  config: HttpRequestActionConfig,
  variables: Record<string, string> | undefined,
): HttpRequestActionConfig {
  return {
    ...config,
    url: renderActionTemplate(config.url, variables),
    query: renderStringRecordTemplates(config.query, variables),
    headers: renderStringRecordTemplates(config.headers, variables),
    body: config.body === undefined ? undefined : renderActionTemplate(config.body, variables),
    auth: config.auth ? {
      ...config.auth,
      bearerToken: config.auth.bearerToken === undefined
        ? undefined
        : renderActionTemplate(config.auth.bearerToken, variables),
      basicUsername: config.auth.basicUsername === undefined
        ? undefined
        : renderActionTemplate(config.auth.basicUsername, variables),
      basicPassword: config.auth.basicPassword === undefined
        ? undefined
        : renderActionTemplate(config.auth.basicPassword, variables),
    } : undefined,
  }
}
```

Use the rendered config in both `buildPermissionRequest` and `execute`:

```ts
const renderedConfig = renderHttpConfig(config, context.templateVariables)
```

Then use `renderedConfig` for URL, headers, auth, and request building.

- [ ] **Step 8: Keep HTTP credentials redacted**

Add to HTTP tests:

```ts
it("does not expose rendered HTTP auth values in permission request", () => {
  const action = createHttpRequestAction({ sendRequest: vi.fn() })
  const request = action.buildPermissionRequest({
    config: {
      method: "GET",
      url: "https://example.com/api",
      bodyType: "none",
      auth: { type: "bearer", bearerToken: "{{trigger.payload.token}}" },
    },
    context: {
      taskId: "task:1",
      runId: "run:1",
      triggeredBy: "schedule",
      cwd: "/tmp",
      actor: { kind: "user", id: "automation" },
      abortSignal: new AbortController().signal,
      templateVariables: { "trigger.payload.token": "secret-token" },
    },
  })

  expect(JSON.stringify(request)).not.toContain("secret-token")
  expect(request.context).toEqual(expect.objectContaining({ authType: "bearer" }))
})
```

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  action-packages/builtin/agent/__tests__/executor.main.test.ts \
  action-packages/builtin/command/__tests__/executor.test.ts \
  action-packages/builtin/script/__tests__/executor.test.ts \
  action-packages/builtin/http-request/__tests__/executor.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add desktop/action-packages/builtin/agent/executor.main.ts \
  desktop/action-packages/builtin/shell-process.main.ts \
  desktop/action-packages/builtin/http-request/executor.main.ts \
  desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts \
  desktop/action-packages/builtin/command/__tests__/executor.test.ts \
  desktop/action-packages/builtin/script/__tests__/executor.test.ts \
  desktop/action-packages/builtin/http-request/__tests__/executor.test.ts
git commit -m "feat: render automation variables in executors"
```

---

### Task 4: Trigger Panel Variable Copy UI

**Files:**
- Modify: `desktop/src/modules/automation/editor/trigger-executor-builder.tsx`
- Test: `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`

- [ ] **Step 1: Write failing UI test**

Add to `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`:

```ts
it("shows trigger variables and copies a template from the trigger panel", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
  const rootElement = document.createElement("div")
  document.body.appendChild(rootElement)
  const root = createRoot(rootElement)

  await act(async () => {
    root.render(<AutomationEditorApp />)
  })
  await act(async () => {
    findButtonContaining("Cron")?.click()
  })
  await act(async () => {
    findButtonContaining("变量")?.click()
  })

  expect(document.body.textContent).toContain("触发时间")
  expect(document.body.textContent).toContain("{{trigger.triggeredAt}}")

  await act(async () => {
    findButtonContaining("{{trigger.triggeredAt}}")?.click()
  })

  expect(writeText).toHaveBeenCalledWith("{{trigger.triggeredAt}}")
  expect(document.body.textContent).toContain("已复制")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation/editor/__tests__/editor-app.test.tsx
```

Expected: FAIL because the variable button is missing.

- [ ] **Step 3: Add popover imports**

In `trigger-executor-builder.tsx`, import:

```ts
import { Copy } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
```

If `desktop/src/components/ui/popover.tsx` does not exist, add the official shadcn/Radix popover primitive matching existing component style before this task, with no custom colors.

- [ ] **Step 4: Add copy helper component**

Add these helpers in `trigger-executor-builder.tsx` above `TriggerExecutorBuilder`:

```tsx
function TriggerVariablesButton({
  variables,
}: {
  readonly variables: readonly {
    readonly key: string
    readonly label: string
    readonly group?: string
  }[]
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  if (variables.length === 0) return null

  const copyVariable = async (key: string) => {
    const template = `{{${key}}}`
    await navigator.clipboard.writeText(template)
    setCopiedKey(key)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          变量
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="grid gap-1">
          {variables.map((variable) => (
            <button
              key={variable.key}
              type="button"
              className="grid gap-1 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              onClick={() => void copyVariable(variable.key)}
            >
              <span className="text-sm font-medium">{variable.label}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Copy className="size-3" />
                {`{{${variable.key}}}`}
              </span>
              {copiedKey === variable.key ? (
                <span className="text-xs text-muted-foreground">已复制</span>
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

Add `useState` to React imports if the file does not already import it.

- [ ] **Step 5: Place button in selected trigger summary area**

Update `SelectedSummary` props to accept `extraAction?: ReactNode`, render it before `重新选择`, and pass:

```tsx
extraAction={(
  <TriggerVariablesButton variables={selectedTrigger.manifest.variables ?? []} />
)}
```

only for the trigger summary. Do not pass it for the executor summary.

- [ ] **Step 6: Run UI test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation/editor/__tests__/editor-app.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/automation/editor/trigger-executor-builder.tsx \
  desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx
git commit -m "feat: show automation trigger variables"
```

---

### Task 5: Validation, Typecheck, Release Notes

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/action-runtime/__tests__/template-variables.test.ts \
  electron/services/automation/__tests__/trigger-registry.test.ts \
  electron/services/automation/__tests__/execution-service.test.ts \
  electron/services/automation/__tests__/automation-service.test.ts \
  action-packages/builtin/agent/__tests__/executor.main.test.ts \
  action-packages/builtin/command/__tests__/executor.test.ts \
  action-packages/builtin/script/__tests__/executor.test.ts \
  action-packages/builtin/http-request/__tests__/executor.test.ts \
  src/modules/automation/editor/__tests__/editor-app.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Update release notes**

Add one bullet to `RELEASE_NOTES_PENDING.md`:

```md
- 自动化触发器现在会展示可复制的变量，Agent、命令、脚本和 HTTP 请求执行器可以在运行时使用这些变量填入触发信息。
```

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note automation trigger variables"
```

---

## Self-Review

- Spec coverage:
  - Trigger-side variable discovery: Task 1 and Task 4.
  - No executor panel UI changes: Task 4 only modifies trigger summary action area.
  - Runtime context and four executors: Task 2 and Task 3.
  - HTTP auth support and redaction: Task 3 HTTP tests.
  - No deep config replacement: Task 3 uses per-executor white-listed fields.
  - Tests and release notes: Task 5.
- Empty-marker scan:
  - The plan contains no red-flag empty markers or unspecified implementation steps.
- Type consistency:
  - `templateVariables` is the single context property used by helper and executors.
  - `AutomationTriggerRuntimeContext.triggeredBy` keeps automation values; `ActionRuntimeContext.triggeredBy` keeps existing action runtime values.
