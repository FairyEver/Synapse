# Task Action Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor scheduled task execution around reusable built-in Action Packages and add command, script, and HTTP request actions.

**Architecture:** Add a standalone `desktop/action-packages/` layer with shared action contracts plus main and renderer runtime registries. The scheduler persists `action: { type, config }`, resolves action executors through the main registry, and stores generic `ActionRunResult` records. Renderer UI resolves action forms, summaries, and result views through the renderer registry.

**Tech Stack:** Electron main process, React, TypeScript, zod, Vitest, shadcn/ui, existing `PermissionGuard`, `AuditSink`, `ControlledProcessRunner`, and task scheduler repositories.

---

## Scope Notes

This plan implements the approved spec at `docs/superpowers/specs/2026-05-01-task-action-packages-design.md`.

The workspace currently has unrelated unstaged changes in:

- `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`
- `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`

Do not revert those changes. Before editing either file, inspect it and merge with the current contents.

## File Map

Create shared Action Package contracts:

- `desktop/action-packages/types.ts`: shared action ids, manifests, execution input, permissions, and generic results.
- `desktop/action-packages/records.ts`: parse and stringify `KEY=value` record text for env, headers, and query fields.

Create built-in action packages:

- `desktop/action-packages/builtin/command/schema.ts`: command config schema.
- `desktop/action-packages/builtin/command/manifest.ts`: command manifest and defaults.
- `desktop/action-packages/builtin/command/index.shared.ts`: pure shared exports.
- `desktop/action-packages/builtin/command/executor.main.ts`: main-process command executor.
- `desktop/action-packages/builtin/command/config.renderer.tsx`: renderer command config form.
- `desktop/action-packages/builtin/command/result.renderer.tsx`: optional renderer command result view.
- `desktop/action-packages/builtin/script/schema.ts`: script config schema.
- `desktop/action-packages/builtin/script/manifest.ts`: script manifest and defaults.
- `desktop/action-packages/builtin/script/index.shared.ts`: pure shared exports.
- `desktop/action-packages/builtin/script/executor.main.ts`: main-process script executor.
- `desktop/action-packages/builtin/script/config.renderer.tsx`: renderer script config form.
- `desktop/action-packages/builtin/script/result.renderer.tsx`: optional renderer script result view.
- `desktop/action-packages/builtin/http-request/schema.ts`: HTTP config schema.
- `desktop/action-packages/builtin/http-request/manifest.ts`: HTTP manifest and defaults.
- `desktop/action-packages/builtin/http-request/index.shared.ts`: pure shared exports.
- `desktop/action-packages/builtin/http-request/executor.main.ts`: main-process HTTP executor.
- `desktop/action-packages/builtin/http-request/config.renderer.tsx`: renderer HTTP config form.
- `desktop/action-packages/builtin/http-request/result.renderer.tsx`: optional renderer HTTP result view.
- `desktop/action-packages/builtin/shell-process.main.ts`: shared command/script process execution helper.

Create main runtime:

- `desktop/electron/action-runtime/action-registry.ts`: main registry.
- `desktop/electron/action-runtime/builtin-actions.ts`: built-in main registrations.
- `desktop/electron/runtime/network/outbound-http.ts`: small outbound HTTP helper used by the HTTP action.
- `desktop/electron/runtime/network/index.ts`: export the outbound HTTP helper.

Create renderer runtime:

- `desktop/src/action-runtime/action-registry.ts`: renderer registry.
- `desktop/src/action-runtime/builtin-actions.ts`: built-in renderer registrations.
- `desktop/src/action-runtime/action-config-form.tsx`: generic action selector/config renderer.
- `desktop/src/action-runtime/action-result-view.tsx`: generic result renderer.

Modify scheduler main:

- `desktop/electron/services/task-scheduler/types.ts`: schema version 2 task/run/action/result types.
- `desktop/electron/services/task-scheduler/task-repository.ts`: create/update with action refs and schema validation through registry.
- `desktop/electron/services/task-scheduler/run-repository.ts`: persist generic results.
- `desktop/electron/services/task-scheduler/execution-service.ts`: resolve actions, check permissions, execute, finish runs.
- `desktop/electron/services/task-scheduler/task-scheduler-service.ts`: remove shell-specific permission check, keep scheduling behavior.
- `desktop/electron/services/task-scheduler/schedule-calculator.ts`: keep current cron/interval behavior and accept new trigger refs.
- `desktop/electron/bootstrap/descriptors.ts`: wire main action registry into task scheduler.
- `desktop/electron/modules/task-scheduler/ipc.ts`: update request and response zod schemas.

Modify renderer scheduler:

- `desktop/src/types/task-scheduler.ts`: schema version 2 types.
- `desktop/src/types/bridge.ts`: keep task scheduler method signatures aligned.
- `desktop/electron/preload.ts`: no channel changes expected, only payload type alignment.
- `desktop/src/modules/task-scheduler/types.ts`: form state uses generic action type/config text fields.
- `desktop/src/modules/task-scheduler/utils.ts`: build and parse action payloads using renderer registry.
- `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`: render action selector and selected action config form.
- `desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx`: render `ActionRunResult`.
- `desktop/src/modules/task-scheduler/index.tsx`: add action summary column.

Modify config:

- `desktop/tsconfig.json`: include `action-packages`.
- `desktop/tsconfig.electron.json`: include `action-packages`.
- `desktop/tsconfig.test.json`: include `action-packages` tests.

## Task 1: Shared Action Contracts

**Files:**

- Create: `desktop/action-packages/types.ts`
- Create: `desktop/action-packages/records.ts`
- Modify: `desktop/tsconfig.json`
- Modify: `desktop/tsconfig.electron.json`
- Modify: `desktop/tsconfig.test.json`
- Test: `desktop/action-packages/__tests__/records.test.ts`

- [ ] **Step 1: Write record utility tests**

Create `desktop/action-packages/__tests__/records.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { parseRecordText, stringifyRecordText } from "../records"

describe("action package record text utilities", () => {
  it("parses KEY=value lines and preserves values after the first equals sign", () => {
    expect(parseRecordText("A=1\nTOKEN=a=b\n\n")).toEqual({
      A: "1",
      TOKEN: "a=b",
    })
  })

  it("rejects lines without a key", () => {
    expect(() => parseRecordText("=missing")).toThrow(/名称不能为空/)
  })

  it("rejects lines without an equals sign", () => {
    expect(() => parseRecordText("TOKEN")).toThrow(/KEY=value/)
  })

  it("stringifies records as newline-delimited entries", () => {
    expect(stringifyRecordText({ A: "1", TOKEN: "a=b" })).toBe("A=1\nTOKEN=a=b")
  })
})
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/__tests__/records.test.ts
```

Expected: fail because `desktop/action-packages/records.ts` does not exist.

- [ ] **Step 3: Add shared action types**

Create `desktop/action-packages/types.ts`:

```ts
import type { z } from "zod"

export type ActionRunStatus = "success" | "failed" | "timeout" | "cancelled"

export type ActionRunResult = {
  readonly status: ActionRunStatus
  readonly summary?: string
  readonly logs?: readonly ActionRunLog[]
  readonly outputs?: Record<string, unknown>
  readonly error?: string
  readonly metrics?: ActionRunMetrics
}

export type ActionRunLog = {
  readonly label: string
  readonly value: string
}

export type ActionRunMetrics = {
  readonly durationMs?: number
  readonly exitCode?: number | null
  readonly httpStatus?: number
}

export type ActionConfig = Record<string, unknown>

export type ActionPermissionName =
  | "shell.exec"
  | "network.connect"
  | string

export type ActionManifest<TConfig extends ActionConfig = ActionConfig> = {
  readonly id: string
  readonly title: string
  readonly permissions: readonly ActionPermissionName[]
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
}
```

- [ ] **Step 4: Add shared record utilities**

Create `desktop/action-packages/records.ts`:

```ts
export function parseRecordText(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = rawLine.indexOf("=")
    if (separatorIndex < 0) {
      throw new Error("配置项需使用 KEY=value")
    }
    const key = rawLine.slice(0, separatorIndex).trim()
    if (!key) {
      throw new Error("配置项名称不能为空")
    }
    result[key] = rawLine.slice(separatorIndex + 1)
  }
  return result
}

export function stringifyRecordText(record: Record<string, string> | undefined): string {
  if (!record) return ""
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}
```

- [ ] **Step 5: Include `action-packages` in TypeScript configs**

Modify `desktop/tsconfig.json`:

```json
{
  "include": ["src", "action-packages", "vite.config.ts"]
}
```

Modify `desktop/tsconfig.electron.json`:

```json
{
  "include": ["electron/**/*.ts", "action-packages/**/*.ts", "database/shared/**/*.ts"]
}
```

Modify `desktop/tsconfig.test.json`:

```json
{
  "include": [
    "action-packages/**/__tests__/**/*.ts",
    "action-packages/**/*.test.ts",
    "electron/**/__tests__/**/*.ts",
    "electron/**/*.test.ts",
    "electron/**/*.spec.ts",
    "src/**/__tests__/**/*.ts",
    "src/**/__tests__/**/*.tsx",
    "src/**/*.test.{ts,tsx}",
    "src/**/*.spec.{ts,tsx}",
    "src/types/**/*.d.ts",
    "tests/**/*.ts",
    "vitest.config.ts"
  ]
}
```

Keep all existing compiler options unchanged.

- [ ] **Step 6: Run the utility test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/__tests__/records.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add desktop/action-packages/types.ts desktop/action-packages/records.ts desktop/action-packages/__tests__/records.test.ts desktop/tsconfig.json desktop/tsconfig.electron.json desktop/tsconfig.test.json
git commit -m "feat: add action package contracts"
```

## Task 2: Main Action Registry

**Files:**

- Create: `desktop/electron/action-runtime/action-registry.ts`
- Create: `desktop/electron/action-runtime/__tests__/action-registry.test.ts`

- [ ] **Step 1: Write registry tests**

Create `desktop/electron/action-runtime/__tests__/action-registry.test.ts`:

```ts
import { z } from "zod"
import { describe, expect, it } from "vitest"

import {
  MainActionRegistry,
  type MainActionDefinition,
} from "../action-registry"

const testSchema = z.object({ message: z.string().min(1) })
type TestConfig = z.infer<typeof testSchema>

const action: MainActionDefinition<TestConfig> = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    permissions: ["shell.exec"],
    defaultConfig: { message: "ok" },
    configSchema: testSchema,
  },
  buildPermissionRequest: ({ config, context }) => ({
    action: "shell.exec",
    actor: context.actor,
    resource: config.message,
    context: { source: "test" },
  }),
  execute: async ({ config }) => ({
    status: "success",
    summary: config.message,
  }),
}

describe("MainActionRegistry", () => {
  it("registers and resolves actions", () => {
    const registry = new MainActionRegistry()
    registry.register(action)

    expect(registry.get("builtin.test")).toBe(action)
    expect(registry.list().map((item) => item.manifest.id)).toEqual(["builtin.test"])
  })

  it("rejects duplicate action ids", () => {
    const registry = new MainActionRegistry()
    registry.register(action)

    expect(() => registry.register(action)).toThrow(/already registered/)
  })

  it("throws for unknown action ids", () => {
    const registry = new MainActionRegistry()

    expect(() => registry.get("missing.action")).toThrow(/not registered/)
  })

  it("validates config through the action schema", () => {
    const registry = new MainActionRegistry()
    registry.register(action)

    expect(registry.parseConfig("builtin.test", { message: "hello" })).toEqual({ message: "hello" })
    expect(() => registry.parseConfig("builtin.test", { message: "" })).toThrow()
  })
})
```

- [ ] **Step 2: Run the registry test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/action-runtime/__tests__/action-registry.test.ts
```

Expected: fail because `desktop/electron/action-runtime/action-registry.ts` does not exist.

- [ ] **Step 3: Implement the main registry**

Create `desktop/electron/action-runtime/action-registry.ts`:

```ts
import type {
  ActionConfig,
  ActionManifest,
  ActionRunResult,
} from "../../action-packages/types"
import type {
  ActorIdentity,
  PermissionRequest,
} from "../runtime/security"

export type ActionRuntimeContext = {
  readonly taskId: string
  readonly runId: string
  readonly triggeredBy: "schedule" | "manual" | "missed_run"
  readonly cwd: string
  readonly actor: ActorIdentity
  readonly abortSignal: AbortSignal
}

export type ActionPermissionInput<TConfig extends ActionConfig = ActionConfig> = {
  readonly config: TConfig
  readonly context: ActionRuntimeContext
}

export type ActionExecutionInput<TConfig extends ActionConfig = ActionConfig> = {
  readonly config: TConfig
  readonly context: ActionRuntimeContext
}

export type MainActionDefinition<TConfig extends ActionConfig = ActionConfig> = {
  readonly manifest: ActionManifest<TConfig>
  buildPermissionRequest(input: ActionPermissionInput<TConfig>): PermissionRequest
  execute(input: ActionExecutionInput<TConfig>): Promise<ActionRunResult>
}

export class MainActionRegistry {
  private readonly actions = new Map<string, MainActionDefinition>()

  register(action: MainActionDefinition): void {
    const { id } = action.manifest
    if (this.actions.has(id)) {
      throw new Error(`Task action "${id}" is already registered`)
    }
    this.actions.set(id, action)
  }

  get(id: string): MainActionDefinition {
    const action = this.actions.get(id)
    if (!action) {
      throw new Error(`Task action "${id}" is not registered`)
    }
    return action
  }

  list(): readonly MainActionDefinition[] {
    return [...this.actions.values()]
  }

  parseConfig(id: string, config: ActionConfig): ActionConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }
}
```

- [ ] **Step 4: Run the registry test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/action-runtime/__tests__/action-registry.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add desktop/electron/action-runtime/action-registry.ts desktop/electron/action-runtime/__tests__/action-registry.test.ts
git commit -m "feat: add main action registry"
```

## Task 3: Command And Script Action Packages

**Files:**

- Create: `desktop/action-packages/builtin/shell-process.main.ts`
- Create: `desktop/action-packages/builtin/command/schema.ts`
- Create: `desktop/action-packages/builtin/command/manifest.ts`
- Create: `desktop/action-packages/builtin/command/index.shared.ts`
- Create: `desktop/action-packages/builtin/command/executor.main.ts`
- Create: `desktop/action-packages/builtin/script/schema.ts`
- Create: `desktop/action-packages/builtin/script/manifest.ts`
- Create: `desktop/action-packages/builtin/script/index.shared.ts`
- Create: `desktop/action-packages/builtin/script/executor.main.ts`
- Create: `desktop/electron/action-runtime/builtin-actions.ts`
- Test: `desktop/action-packages/builtin/command/__tests__/executor.test.ts`
- Test: `desktop/action-packages/builtin/script/__tests__/executor.test.ts`

- [ ] **Step 1: Write command executor test**

Create `desktop/action-packages/builtin/command/__tests__/executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createCommandAction } from "../executor.main"

describe("builtin.command executor", () => {
  it("runs command config and stores stdout/stderr in ActionRunResult", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      durationMs: 12,
    }))
    const action = createCommandAction({
      processRunner: { run },
      platform: "darwin",
      baseEnv: { PATH: "/usr/bin" },
    })

    const result = await action.execute({
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(result).toEqual({
      status: "success",
      summary: "退出码 0",
      logs: [{ label: "stdout", value: "ok" }],
      outputs: { stdout: "ok", stderr: "", exitCode: 0 },
      metrics: { durationMs: 12, exitCode: 0 },
    })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      command: "/bin/sh",
      args: ["-lc", "echo ok"],
      cwd: "/tmp",
    }))
  })

  it("builds shell.exec permission context", () => {
    const action = createCommandAction({ processRunner: { run: vi.fn() } })
    const request = action.buildPermissionRequest({
      config: { command: "echo ok", shell: "posix", env: { TOKEN: "x" }, timeoutMins: 5 },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(request).toEqual(expect.objectContaining({
      action: "shell.exec",
      resource: "echo ok",
      context: expect.objectContaining({
        actionType: "builtin.command",
        taskId: "task:1",
        runId: "run:1",
        shell: "posix",
        cwd: "/tmp",
        envKeys: ["TOKEN"],
        timeoutMins: 5,
      }),
    }))
  })
})
```

- [ ] **Step 2: Write script executor test**

Create `desktop/action-packages/builtin/script/__tests__/executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createScriptAction } from "../executor.main"

describe("builtin.script executor", () => {
  it("runs script config through the selected shell", async () => {
    const run = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "bad",
      timedOut: false,
      durationMs: 7,
    }))
    const action = createScriptAction({
      processRunner: { run },
      platform: "darwin",
    })

    const result = await action.execute({
      config: {
        script: "exit 1",
        shell: "posix",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(result.status).toBe("failed")
    expect(result.error).toBe("shell command exited with 1")
    expect(result.logs).toEqual([{ label: "stderr", value: "bad" }])
    expect(result.outputs).toEqual({ stdout: "", stderr: "bad", exitCode: 1 })
  })
})
```

- [ ] **Step 3: Run the action tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/command/__tests__/executor.test.ts action-packages/builtin/script/__tests__/executor.test.ts
```

Expected: fail because action package files do not exist.

- [ ] **Step 4: Add command schema and manifest**

Create `desktop/action-packages/builtin/command/schema.ts`:

```ts
import { z } from "zod"

export const commandActionConfigSchema = z.object({
  command: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type CommandActionConfig = z.infer<typeof commandActionConfigSchema>
```

Create `desktop/action-packages/builtin/command/manifest.ts`:

```ts
import type { ActionManifest } from "../../../types"
import {
  commandActionConfigSchema,
  type CommandActionConfig,
} from "./schema"

export const commandActionManifest = {
  id: "builtin.command",
  title: "命令",
  permissions: ["shell.exec"],
  defaultConfig: {
    command: "",
    shell: "posix",
    timeoutMins: 30,
  },
  configSchema: commandActionConfigSchema,
} satisfies ActionManifest<CommandActionConfig>
```

Create `desktop/action-packages/builtin/command/index.shared.ts`:

```ts
export {
  commandActionConfigSchema,
  type CommandActionConfig,
} from "./schema"
export { commandActionManifest } from "./manifest"
```

- [ ] **Step 5: Add script schema and manifest**

Create `desktop/action-packages/builtin/script/schema.ts`:

```ts
import { z } from "zod"

export const scriptActionConfigSchema = z.object({
  script: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type ScriptActionConfig = z.infer<typeof scriptActionConfigSchema>
```

Create `desktop/action-packages/builtin/script/manifest.ts`:

```ts
import type { ActionManifest } from "../../../types"
import {
  scriptActionConfigSchema,
  type ScriptActionConfig,
} from "./schema"

export const scriptActionManifest = {
  id: "builtin.script",
  title: "脚本",
  permissions: ["shell.exec"],
  defaultConfig: {
    script: "",
    shell: "posix",
    timeoutMins: 30,
  },
  configSchema: scriptActionConfigSchema,
} satisfies ActionManifest<ScriptActionConfig>
```

Create `desktop/action-packages/builtin/script/index.shared.ts`:

```ts
export {
  scriptActionConfigSchema,
  type ScriptActionConfig,
} from "./schema"
export { scriptActionManifest } from "./manifest"
```

- [ ] **Step 6: Add shared shell process helper**

Create `desktop/action-packages/builtin/shell-process.main.ts`:

```ts
import type { ControlledProcessRunner } from "../../electron/runtime/process"
import { resolveShellCommand } from "../../electron/services/shell-exec"
import type {
  ActionRunResult,
} from "../types"
import type { ActionRuntimeContext } from "../../electron/action-runtime/action-registry"

const UNLIMITED_OUTPUT_BYTES = Number.MAX_SAFE_INTEGER

export type ShellActionConfig = {
  readonly shell: "posix" | "cmd" | "powershell"
  readonly env?: Record<string, string>
  readonly timeoutMins?: number | null
}

export async function runShellAction(input: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly content: string
  readonly config: ShellActionConfig
  readonly context: ActionRuntimeContext
}): Promise<ActionRunResult> {
  const platform = input.platform ?? process.platform
  const shell = resolveShellCommand(input.config.shell, input.content, {
    platform,
    windowsDefault: "cmd",
  })
  const timeoutMs = input.config.timeoutMins === null
    ? undefined
    : (input.config.timeoutMins ?? 30) * 60_000
  const startedAt = Date.now()
  const result = await input.processRunner.run({
    actor: input.context.actor,
    action: "shell.exec",
    command: shell.command,
    args: [...shell.args],
    cwd: input.context.cwd,
    env: { ...(input.baseEnv ?? process.env), ...(input.config.env ?? {}) },
    envAllowlist: input.config.env ? Object.keys(input.config.env) : undefined,
    timeoutMs,
    abortSignal: input.context.abortSignal,
    output: {
      stdout: "buffer",
      stderr: "buffer",
      maxBufferBytes: UNLIMITED_OUTPUT_BYTES,
    },
    metadata: {
      source: "task-scheduler",
      actionType: "shell",
      taskId: input.context.taskId,
      runId: input.context.runId,
      triggeredBy: input.context.triggeredBy,
    },
  })

  const logs = [
    result.stdout ? { label: "stdout", value: result.stdout } : undefined,
    result.stderr ? { label: "stderr", value: result.stderr } : undefined,
  ].filter((item): item is { label: string; value: string } => item !== undefined)
  const metrics = {
    durationMs: result.durationMs ?? Date.now() - startedAt,
    exitCode: result.exitCode,
  }
  const outputs = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  }

  if (result.timedOut) {
    return {
      status: "timeout",
      summary: "超时",
      logs,
      outputs,
      error: "shell command timed out",
      metrics,
    }
  }
  if (input.context.abortSignal.aborted && result.signal !== null) {
    return {
      status: "cancelled",
      summary: "已停止",
      logs,
      outputs,
      error: "shell command cancelled",
      metrics,
    }
  }
  if (result.exitCode !== 0 || result.error) {
    return {
      status: "failed",
      summary: `退出码 ${String(result.exitCode)}`,
      logs,
      outputs,
      error: result.error ?? `shell command exited with ${String(result.exitCode)}`,
      metrics,
    }
  }
  return {
    status: "success",
    summary: `退出码 ${String(result.exitCode)}`,
    logs,
    outputs,
    metrics,
  }
}
```

- [ ] **Step 7: Add command executor**

Create `desktop/action-packages/builtin/command/executor.main.ts`:

```ts
import type { ControlledProcessRunner } from "../../../electron/runtime/process"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { runShellAction } from "../shell-process.main"
import { commandActionManifest } from "./manifest"
import type { CommandActionConfig } from "./schema"

export function createCommandAction(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
}): MainActionDefinition<CommandActionConfig> {
  return {
    manifest: commandActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.command,
      context: {
        source: "task-scheduler",
        actionType: commandActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        shell: config.shell,
        cwd: context.cwd,
        envKeys: config.env ? Object.keys(config.env).sort() : [],
        timeoutMins: config.timeoutMins,
      },
    }),
    execute: (input) =>
      runShellAction({
        ...deps,
        content: input.config.command,
        config: input.config,
        context: input.context,
      }),
  }
}
```

- [ ] **Step 8: Add script executor**

Create `desktop/action-packages/builtin/script/executor.main.ts`:

```ts
import type { ControlledProcessRunner } from "../../../electron/runtime/process"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { runShellAction } from "../shell-process.main"
import { scriptActionManifest } from "./manifest"
import type { ScriptActionConfig } from "./schema"

export function createScriptAction(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
}): MainActionDefinition<ScriptActionConfig> {
  return {
    manifest: scriptActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.script.slice(0, 240),
      context: {
        source: "task-scheduler",
        actionType: scriptActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        shell: config.shell,
        cwd: context.cwd,
        envKeys: config.env ? Object.keys(config.env).sort() : [],
        timeoutMins: config.timeoutMins,
      },
    }),
    execute: (input) =>
      runShellAction({
        ...deps,
        content: input.config.script,
        config: input.config,
        context: input.context,
      }),
  }
}
```

- [ ] **Step 9: Add built-in main registrations**

Create `desktop/electron/action-runtime/builtin-actions.ts`:

```ts
import type { ControlledProcessRunner } from "../runtime/process"
import { createCommandAction } from "../../action-packages/builtin/command/executor.main"
import { createScriptAction } from "../../action-packages/builtin/script/executor.main"
import { MainActionRegistry } from "./action-registry"

export function createBuiltinMainActionRegistry(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createCommandAction(deps))
  registry.register(createScriptAction(deps))
  return registry
}
```

- [ ] **Step 10: Run command/script tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/command/__tests__/executor.test.ts action-packages/builtin/script/__tests__/executor.test.ts
```

Expected: pass.

- [ ] **Step 11: Commit**

Run:

```bash
git add desktop/action-packages/builtin desktop/electron/action-runtime/builtin-actions.ts
git commit -m "feat: add shell action packages"
```

## Task 4: HTTP Action Package

**Files:**

- Create: `desktop/electron/runtime/network/outbound-http.ts`
- Modify: `desktop/electron/runtime/network/index.ts`
- Create: `desktop/action-packages/builtin/http-request/schema.ts`
- Create: `desktop/action-packages/builtin/http-request/manifest.ts`
- Create: `desktop/action-packages/builtin/http-request/index.shared.ts`
- Create: `desktop/action-packages/builtin/http-request/executor.main.ts`
- Modify: `desktop/electron/action-runtime/builtin-actions.ts`
- Test: `desktop/action-packages/builtin/http-request/__tests__/executor.test.ts`
- Test: `desktop/electron/runtime/network/__tests__/outbound-http.test.ts`

- [ ] **Step 1: Write outbound HTTP helper test**

Create `desktop/electron/runtime/network/__tests__/outbound-http.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { sendOutboundHttpRequest } from "../outbound-http"

describe("sendOutboundHttpRequest", () => {
  it("sends method, headers, body, and returns text response", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "text/plain" },
    }))

    const response = await sendOutboundHttpRequest({
      method: "POST",
      url: "https://example.com/api",
      headers: { Authorization: "Bearer token" },
      body: "hello",
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(response).toEqual({
      status: 201,
      statusText: "Created",
      headers: { "content-type": "text/plain" },
      body: "ok",
    })
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/api", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: "hello",
    }))
  })
})
```

- [ ] **Step 2: Write HTTP action executor test**

Create `desktop/action-packages/builtin/http-request/__tests__/executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createHttpRequestAction } from "../executor.main"

describe("builtin.http-request executor", () => {
  it("builds request URL with query and stores response outputs", async () => {
    const sendRequest = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: "{\"ok\":true}",
    }))
    const action = createHttpRequestAction({ sendRequest })

    const result = await action.execute({
      config: {
        method: "GET",
        url: "https://example.com/api",
        query: { page: "1" },
        headers: { Authorization: "Bearer token" },
        bodyType: "none",
        timeoutMins: 1,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "manual",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "https://example.com/api?page=1",
      headers: { Authorization: "Bearer token" },
      timeoutMs: 60_000,
    }))
    expect(result).toEqual({
      status: "success",
      summary: "200 OK",
      logs: [{ label: "response", value: "{\"ok\":true}" }],
      outputs: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: "{\"ok\":true}",
      },
      metrics: { httpStatus: 200 },
    })
  })

  it("builds network.connect permission context", () => {
    const action = createHttpRequestAction({ sendRequest: vi.fn() })
    const request = action.buildPermissionRequest({
      config: {
        method: "POST",
        url: "https://example.com/api",
        headers: { Authorization: "Bearer token" },
        bodyType: "json",
        body: "{\"ok\":true}",
        timeoutMins: 2,
      },
      context: {
        taskId: "task:1",
        runId: "run:1",
        triggeredBy: "schedule",
        cwd: "/tmp",
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
        abortSignal: new AbortController().signal,
      },
    })

    expect(request).toEqual(expect.objectContaining({
      action: "network.connect",
      resource: "https://example.com/api",
      context: expect.objectContaining({
        actionType: "builtin.http-request",
        method: "POST",
        headerKeys: ["Authorization"],
        timeoutMins: 2,
      }),
    }))
  })
})
```

- [ ] **Step 3: Run HTTP tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/network/__tests__/outbound-http.test.ts action-packages/builtin/http-request/__tests__/executor.test.ts
```

Expected: fail because files do not exist.

- [ ] **Step 4: Add outbound HTTP helper**

Create `desktop/electron/runtime/network/outbound-http.ts`:

```ts
export type OutboundHttpRequest = {
  readonly method: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly body?: string
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}

export type OutboundHttpResponse = {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
}

export async function sendOutboundHttpRequest(
  request: OutboundHttpRequest,
): Promise<OutboundHttpResponse> {
  const controller = new AbortController()
  const timeout = request.timeoutMs === undefined
    ? undefined
    : setTimeout(() => controller.abort(), request.timeoutMs)
  const onAbort = () => controller.abort()
  request.abortSignal?.addEventListener("abort", onAbort, { once: true })
  try {
    const response = await (request.fetchImpl ?? fetch)(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    request.abortSignal?.removeEventListener("abort", onAbort)
  }
}
```

Modify `desktop/electron/runtime/network/index.ts`:

```ts
export {
  sendOutboundHttpRequest,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
} from "./outbound-http"
```

Keep existing exports.

- [ ] **Step 5: Add HTTP schema and manifest**

Create `desktop/action-packages/builtin/http-request/schema.ts`:

```ts
import { z } from "zod"

export const httpRequestActionConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  bodyType: z.enum(["none", "json", "text"]),
  body: z.string().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type HttpRequestActionConfig = z.infer<typeof httpRequestActionConfigSchema>
```

Create `desktop/action-packages/builtin/http-request/manifest.ts`:

```ts
import type { ActionManifest } from "../../../types"
import {
  httpRequestActionConfigSchema,
  type HttpRequestActionConfig,
} from "./schema"

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
  configSchema: httpRequestActionConfigSchema,
} satisfies ActionManifest<HttpRequestActionConfig>
```

Create `desktop/action-packages/builtin/http-request/index.shared.ts`:

```ts
export {
  httpRequestActionConfigSchema,
  type HttpRequestActionConfig,
} from "./schema"
export { httpRequestActionManifest } from "./manifest"
```

- [ ] **Step 6: Add HTTP executor**

Create `desktop/action-packages/builtin/http-request/executor.main.ts`:

```ts
import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
} from "../../../electron/runtime/network"
import { sendOutboundHttpRequest } from "../../../electron/runtime/network"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { httpRequestActionManifest } from "./manifest"
import type { HttpRequestActionConfig } from "./schema"

export function createHttpRequestAction(deps: {
  readonly sendRequest?: (request: OutboundHttpRequest) => Promise<OutboundHttpResponse>
} = {}): MainActionDefinition<HttpRequestActionConfig> {
  const sendRequest = deps.sendRequest ?? sendOutboundHttpRequest
  return {
    manifest: httpRequestActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "network.connect",
      actor: context.actor,
      resource: config.url,
      context: {
        source: "task-scheduler",
        actionType: httpRequestActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        method: config.method,
        url: config.url,
        headerKeys: config.headers ? Object.keys(config.headers).sort() : [],
        timeoutMins: config.timeoutMins,
      },
    }),
    execute: async ({ config, context }) => {
      const response = await sendRequest({
        method: config.method,
        url: buildUrl(config),
        headers: config.headers,
        body: buildBody(config),
        timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
        abortSignal: context.abortSignal,
      })
      return {
        status: "success",
        summary: `${String(response.status)} ${response.statusText}`,
        logs: response.body ? [{ label: "response", value: response.body }] : [],
        outputs: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
        },
        metrics: { httpStatus: response.status },
      }
    },
  }
}

function buildUrl(config: HttpRequestActionConfig): string {
  const url = new URL(config.url)
  for (const [key, value] of Object.entries(config.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function buildBody(config: HttpRequestActionConfig): string | undefined {
  if (config.bodyType === "none") return undefined
  return config.body ?? ""
}
```

- [ ] **Step 7: Register HTTP action**

Modify `desktop/electron/action-runtime/builtin-actions.ts`:

```ts
import { createHttpRequestAction } from "../../action-packages/builtin/http-request/executor.main"
```

Inside `createBuiltinMainActionRegistry`:

```ts
registry.register(createHttpRequestAction())
```

- [ ] **Step 8: Run HTTP tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/network/__tests__/outbound-http.test.ts action-packages/builtin/http-request/__tests__/executor.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add desktop/electron/runtime/network desktop/action-packages/builtin/http-request desktop/electron/action-runtime/builtin-actions.ts
git commit -m "feat: add http request action package"
```

## Task 5: Scheduler Schema Version 2

**Files:**

- Modify: `desktop/electron/services/task-scheduler/types.ts`
- Modify: `desktop/electron/services/task-scheduler/task-repository.ts`
- Modify: `desktop/electron/services/task-scheduler/run-repository.ts`
- Modify: `desktop/electron/services/task-scheduler/schedule-calculator.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/run-repository.test.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/schedule-calculator.test.ts`

- [ ] **Step 1: Update repository tests for v2 action refs**

In `desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts`, update create/update expectations to use:

```ts
const action = {
  type: "builtin.command",
  config: {
    command: "echo ok",
    shell: "posix",
    timeoutMins: 30,
  },
}
```

Expected task assertions:

```ts
expect(task).toEqual(expect.objectContaining({
  schemaVersion: 2,
  action,
  trigger: {
    type: "builtin.interval",
    config: {
      everyMinutes: 10,
      anchor: "created_at",
    },
  },
}))
```

In `desktop/electron/services/task-scheduler/__tests__/run-repository.test.ts`, update finished run assertions to expect:

```ts
expect(finished).toEqual(expect.objectContaining({
  schemaVersion: 2,
  status: "success",
  result: {
    status: "success",
    summary: "退出码 0",
    outputs: { stdout: "ok" },
  },
}))
```

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/task-repository.test.ts electron/services/task-scheduler/__tests__/run-repository.test.ts electron/services/task-scheduler/__tests__/schedule-calculator.test.ts
```

Expected: fail because production types still use schema version 1 and old action shape.

- [ ] **Step 3: Replace scheduler service types**

Modify `desktop/electron/services/task-scheduler/types.ts` so the central types are:

```ts
import type { ActionRunResult } from "../../../action-packages/types"

export const TASK_SCHEDULER_SERVICE_ID = "core.task-scheduler"

export type TaskTrigger =
  | {
      readonly type: "builtin.cron"
      readonly config: {
        readonly expr: string
        readonly timezone?: string
      }
    }
  | {
      readonly type: "builtin.interval"
      readonly config: {
        readonly everyMinutes: number
        readonly anchor?: "created_at" | "last_completed_at"
      }
    }

export type TaskScope =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }

export type TaskActionRef = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type ScheduledTaskStatus = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatus = "running" | ScheduledTaskStatus
export type ScheduledTaskRunTrigger = "schedule" | "manual" | "missed_run"

export interface ScheduledTaskEntryV2 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 2
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskActionRef
  readonly enabled: boolean
  readonly missedRunPolicy: "skip" | "run_once"
  readonly overlapPolicy: "skip"
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: ScheduledTaskStatus
  readonly runCount: number
}

export type ScheduledTaskEntry = ScheduledTaskEntryV2

export interface ScheduledTaskCreateInput {
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskActionRef
  readonly enabled?: boolean
  readonly missedRunPolicy?: "skip" | "run_once"
}

export interface ScheduledTaskUpdateInput {
  readonly name?: string
  readonly description?: string
  readonly scope?: TaskScope
  readonly cwd?: string
  readonly trigger?: TaskTrigger
  readonly action?: TaskActionRef
  readonly enabled?: boolean
  readonly missedRunPolicy?: "skip" | "run_once"
}

export interface ScheduledTaskRunEntryV2 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 2
  readonly taskId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: ScheduledTaskRunStatus
  readonly triggeredBy: ScheduledTaskRunTrigger
  readonly result?: ActionRunResult
  readonly error?: string
}

export type ScheduledTaskRunEntry = ScheduledTaskRunEntryV2

export interface ScheduledTaskRunFinishInput {
  readonly status: Exclude<ScheduledTaskRunStatus, "running">
  readonly result?: ActionRunResult
  readonly error?: string
}
```

Replace imports of `ScheduledTaskEntryV1` and `ScheduledTaskRunEntryV1` inside task scheduler service files with `ScheduledTaskEntry` and `ScheduledTaskRunEntry`.

- [ ] **Step 4: Update schedule calculator for trigger refs**

Modify `desktop/electron/services/task-scheduler/schedule-calculator.ts`:

```ts
export function computeNextRunAt(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
}): Date {
  if (input.trigger.type === "builtin.cron") {
    return nextCronRun(input.trigger.config.expr, input.from)
  }
  const everyMs = input.trigger.config.everyMinutes * 60_000
  const anchor = new Date(input.createdAt).getTime()
  const from = input.from.getTime()
  const elapsed = Math.max(0, from - anchor)
  const steps = Math.floor(elapsed / everyMs) + 1
  return new Date(anchor + steps * everyMs)
}
```

Keep `resolveStartupSchedule` behavior unchanged except for reading the new trigger shape.

- [ ] **Step 5: Update task repository defaults and validation**

Modify `desktop/electron/services/task-scheduler/task-repository.ts`:

```ts
const task: ScheduledTaskEntry = {
  id: this.idFactory(),
  schemaVersion: 2,
  name: input.name,
  description: input.description,
  scope: input.scope,
  cwd: input.cwd,
  trigger: normalizeTrigger(input.trigger),
  action: input.action,
  enabled,
  missedRunPolicy: input.missedRunPolicy ?? "skip",
  overlapPolicy: "skip",
  createdAt: now,
  updatedAt: now,
  runCount: 0,
}
```

Add helpers:

```ts
function normalizeTrigger(trigger: TaskTrigger): TaskTrigger {
  if (trigger.type === "builtin.interval") {
    return {
      type: "builtin.interval",
      config: {
        ...trigger.config,
        anchor: trigger.config.anchor ?? "created_at",
      },
    }
  }
  return trigger
}

function validateTask(task: ScheduledTaskEntry): void {
  if (!task.name.trim()) throw new Error("name is required")
  if (task.scope.type === "project" && !task.scope.projectId.trim()) {
    throw new Error("projectId is required")
  }
  if (task.trigger.type === "builtin.cron") {
    validateCronExpression(task.trigger.config.expr)
  } else if (
    !Number.isInteger(task.trigger.config.everyMinutes)
    || task.trigger.config.everyMinutes < 1
  ) {
    throw new Error("everyMinutes must be >= 1")
  }
  if (!task.action.type.trim()) throw new Error("action type is required")
}
```

Do not validate action config here. That happens in the execution service through the action registry and in IPC through zod shape checks.

- [ ] **Step 6: Update run repository finish shape**

Modify `desktop/electron/services/task-scheduler/run-repository.ts`:

```ts
const run: ScheduledTaskRunEntry = {
  id: this.idFactory(taskId, this.nextIndex),
  schemaVersion: 2,
  taskId,
  startedAt: this.isoNow(),
  status: "running",
  triggeredBy,
}
```

Modify `finish`:

```ts
const next: ScheduledTaskRunEntry = {
  ...existing,
  finishedAt: this.isoNow(),
  status: input.status,
  result: input.result,
  error: input.error,
}
```

- [ ] **Step 7: Run repository and schedule tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/task-repository.test.ts electron/services/task-scheduler/__tests__/run-repository.test.ts electron/services/task-scheduler/__tests__/schedule-calculator.test.ts
```

Expected: pass after updating all old trigger fixtures to `builtin.cron` or `builtin.interval`.

- [ ] **Step 8: Commit**

Run:

```bash
git add desktop/electron/services/task-scheduler desktop/electron/services/task-scheduler/__tests__
git commit -m "feat: update scheduler task schema"
```

## Task 6: Execution Service Uses Action Registry

**Files:**

- Modify: `desktop/electron/services/task-scheduler/execution-service.ts`
- Modify: `desktop/electron/services/task-scheduler/task-scheduler-service.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts`
- Modify: `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts`

- [ ] **Step 1: Update execution-service tests**

In `desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts`, replace the old `TaskActionRegistry` setup with `MainActionRegistry`:

```ts
const actions = new MainActionRegistry()
actions.register({
  manifest: {
    id: "builtin.test",
    title: "Test",
    permissions: ["shell.exec"],
    defaultConfig: { message: "ok" },
    configSchema: z.object({ message: z.string().min(1) }),
  },
  buildPermissionRequest: ({ config, context }) => ({
    action: "shell.exec",
    actor: context.actor,
    resource: config.message as string,
    context: { taskId: context.taskId, runId: context.runId },
  }),
  execute: async () => ({
    status: "success",
    summary: "ok",
    outputs: { stdout: "ok" },
  }),
})
```

Create the task with:

```ts
action: { type: "builtin.test", config: { message: "ok" } }
```

Expected run assertion:

```ts
expect(run.result).toEqual({
  status: "success",
  summary: "ok",
  outputs: { stdout: "ok" },
})
```

Add a permission denial test:

```ts
it("records failed run when action permission is denied", async () => {
  const harness = createExecutionHarness({
    permissionGuard: permissionGuard({ allowed: false, reason: "denied by test" }),
  })
  const run = await harness.service.runTask(harness.task, "manual")

  expect(run.status).toBe("failed")
  expect(run.error).toBe("denied by test")
})
```

- [ ] **Step 2: Run execution tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/execution-service.test.ts electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts
```

Expected: fail because execution service still expects the old action registry.

- [ ] **Step 3: Refactor execution service**

Modify `desktop/electron/services/task-scheduler/execution-service.ts` constructor deps:

```ts
import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type { AuditSink, PermissionGuard } from "../../runtime/security"

export interface TaskSchedulerExecutionServiceDeps {
  readonly tasks: Pick<ScheduledTaskRepository, "markRunResult">
  readonly runs: Pick<ScheduledTaskRunRepository, "start" | "finish">
  readonly actions: MainActionRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly defaultCwd: string
}
```

Replace `runTask` internals with:

```ts
const run = await this.deps.runs.start(task.id, triggeredBy)
const controller = new AbortController()
this.activeRuns.set(run.id, controller)
try {
  const action = this.deps.actions.get(task.action.type)
  const config = action.manifest.configSchema.parse(task.action.config)
  const context = {
    taskId: task.id,
    runId: run.id,
    triggeredBy,
    cwd: resolveCwd(task, this.deps.defaultCwd),
    actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" } as const,
    abortSignal: controller.signal,
  }
  const permissionRequest = action.buildPermissionRequest({ config, context })
  const permission = await this.deps.permissionGuard.check(permissionRequest)
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
  this.deps.auditSink.record({
    action: permissionRequest.action,
    actor: permissionRequest.actor,
    resource: permissionRequest.resource,
    outcome: "allowed",
    metadata: {
      source: "task-scheduler",
      taskId: task.id,
      runId: run.id,
      actionType: task.action.type,
      triggeredBy,
    },
  })
  const result = await action.execute({ config, context })
  const finished = await this.deps.runs.finish(run.id, {
    status: result.status,
    result,
    error: result.error,
  })
  await this.deps.tasks.markRunResult(task.id, { status: result.status })
  return finished
} catch (error) {
  const message = errorMessage(error)
  const status = controller.signal.aborted ? "cancelled" : "failed"
  const finished = await this.deps.runs.finish(run.id, {
    status,
    error: message,
    result: {
      status,
      error: message,
      summary: status === "cancelled" ? "已停止" : "执行失败",
    },
  })
  await this.deps.tasks.markRunResult(task.id, { status })
  return finished
} finally {
  this.activeRuns.delete(run.id)
}
```

- [ ] **Step 4: Remove shell permission from scheduler service**

Modify `desktop/electron/services/task-scheduler/task-scheduler-service.ts`:

- Remove `permissionGuard` from `TaskSchedulerServiceDeps`.
- Remove `assertShellPermission`.
- In `createTask`, call `this.deps.tasks.create(input)` directly.
- In `updateTask`, remove the pre-save shell permission block.

The service should still cancel/reschedule on update and enable changes.

- [ ] **Step 5: Wire built-in main action registry**

Modify `desktop/electron/bootstrap/descriptors.ts`:

```ts
import { createBuiltinMainActionRegistry } from "../action-runtime/builtin-actions"
```

Inside `coreTaskSchedulerDescriptor.create`:

```ts
const actions = createBuiltinMainActionRegistry({
  processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
})
const execution = new TaskSchedulerExecutionService({
  tasks,
  runs,
  actions,
  permissionGuard,
  auditSink,
  defaultCwd,
})
return new TaskSchedulerService({
  tasks,
  runs,
  execution,
  defaultCwd,
})
```

- [ ] **Step 6: Run execution tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/execution-service.test.ts electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts
```

Expected: pass after updating task fixtures to v2 action refs.

- [ ] **Step 7: Commit**

Run:

```bash
git add desktop/electron/services/task-scheduler desktop/electron/bootstrap/descriptors.ts desktop/electron/services/task-scheduler/__tests__
git commit -m "feat: execute scheduled action refs"
```

## Task 7: IPC And Shared Renderer Types

**Files:**

- Modify: `desktop/electron/modules/task-scheduler/ipc.ts`
- Modify: `desktop/src/types/task-scheduler.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`

- [ ] **Step 1: Update IPC tests**

In `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`, update create payloads to:

```ts
{
  name: "Build",
  scope: { type: "global" },
  trigger: {
    type: "builtin.interval",
    config: { everyMinutes: 10, anchor: "created_at" },
  },
  action: {
    type: "builtin.command",
    config: { command: "echo ok", shell: "posix", timeoutMins: 30 },
  },
}
```

Update mocked task responses to `schemaVersion: 2` and run responses to:

```ts
{
  id: "run:1",
  schemaVersion: 2,
  taskId: "task:1",
  startedAt: "2026-05-01T00:00:00.000Z",
  finishedAt: "2026-05-01T00:00:01.000Z",
  status: "success",
  triggeredBy: "manual",
  result: {
    status: "success",
    summary: "退出码 0",
  },
}
```

- [ ] **Step 2: Run IPC tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/task-scheduler/__tests__/ipc.test.ts
```

Expected: fail because IPC schemas still require version 1 and `shell_command`.

- [ ] **Step 3: Update renderer task scheduler types**

Modify `desktop/src/types/task-scheduler.ts`:

```ts
import type { ActionRunResult } from "../../action-packages/types"

export type ScheduledTaskTrigger =
  | {
      type: "builtin.cron"
      config: { expr: string; timezone?: string }
    }
  | {
      type: "builtin.interval"
      config: {
        everyMinutes: number
        anchor?: "created_at" | "last_completed_at"
      }
    }

export type ScheduledTaskScope =
  | { type: "global" }
  | { type: "project"; projectId: string }

export type ScheduledTaskActionRef = {
  type: string
  config: Record<string, unknown>
}

export type ScheduledTaskStatus = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatus = "running" | ScheduledTaskStatus
export type ScheduledTaskRunTrigger = "schedule" | "manual" | "missed_run"

export type ScheduledTask = {
  id: string
  schemaVersion: 2
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  enabled: boolean
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: ScheduledTaskStatus
  runCount: number
}

export type ScheduledTaskCreateInput = {
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  enabled?: boolean
  missedRunPolicy?: "skip" | "run_once"
}

export type ScheduledTaskUpdateInput = Partial<ScheduledTaskCreateInput>

export type ScheduledTaskRun = {
  id: string
  schemaVersion: 2
  taskId: string
  startedAt: string
  finishedAt?: string
  status: ScheduledTaskRunStatus
  triggeredBy: ScheduledTaskRunTrigger
  result?: ActionRunResult
  error?: string
}
```

- [ ] **Step 4: Update IPC zod schemas**

Modify `desktop/electron/modules/task-scheduler/ipc.ts`:

```ts
const taskTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("builtin.cron"),
    config: z.object({
      expr: z.string().min(1),
      timezone: z.string().min(1).optional(),
    }),
  }),
  z.object({
    type: z.literal("builtin.interval"),
    config: z.object({
      everyMinutes: z.number().int().positive(),
      anchor: z.enum(["created_at", "last_completed_at"]).optional(),
    }),
  }),
])

const taskActionSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})

const actionRunResultSchema = z.object({
  status: z.enum(["success", "failed", "timeout", "cancelled"]),
  summary: z.string().optional(),
  logs: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  metrics: z.object({
    durationMs: z.number().optional(),
    exitCode: z.number().nullable().optional(),
    httpStatus: z.number().optional(),
  }).optional(),
})
```

Update `taskSchema.schemaVersion` and `runSchema.schemaVersion` to `z.literal(2)`.

Remove `exitCode`, `stdout`, and `stderr` from `runSchema`.

Add:

```ts
result: actionRunResultSchema.optional(),
```

- [ ] **Step 5: Run IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/task-scheduler/__tests__/ipc.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add desktop/electron/modules/task-scheduler/ipc.ts desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts desktop/src/types/task-scheduler.ts desktop/src/types/bridge.ts
git commit -m "feat: expose action refs through task scheduler ipc"
```

## Task 8: Renderer Action Runtime

**Files:**

- Create: `desktop/src/action-runtime/action-registry.ts`
- Create: `desktop/src/action-runtime/builtin-actions.ts`
- Create: `desktop/src/action-runtime/action-result-view.tsx`
- Create: `desktop/action-packages/builtin/command/config.renderer.tsx`
- Create: `desktop/action-packages/builtin/script/config.renderer.tsx`
- Create: `desktop/action-packages/builtin/http-request/config.renderer.tsx`
- Create: `desktop/action-packages/builtin/command/result.renderer.tsx`
- Create: `desktop/action-packages/builtin/script/result.renderer.tsx`
- Create: `desktop/action-packages/builtin/http-request/result.renderer.tsx`
- Test: `desktop/src/action-runtime/__tests__/action-registry.test.tsx`
- Test: `desktop/src/action-runtime/__tests__/action-result-view.test.tsx`

- [ ] **Step 1: Write renderer registry tests**

Create `desktop/src/action-runtime/__tests__/action-registry.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"

import { rendererActionRegistry } from "../builtin-actions"

describe("renderer action registry", () => {
  it("registers built-in actions", () => {
    expect(rendererActionRegistry.list().map((action) => action.manifest.id)).toEqual([
      "builtin.command",
      "builtin.script",
      "builtin.http-request",
    ])
  })

  it("summarizes built-in configs", () => {
    expect(rendererActionRegistry.summarize("builtin.command", {
      command: "echo ok",
      shell: "posix",
    })).toBe("命令 · echo ok")

    expect(rendererActionRegistry.summarize("builtin.http-request", {
      method: "POST",
      url: "https://example.com/api",
      bodyType: "none",
    })).toBe("POST · https://example.com/api")
  })
})
```

- [ ] **Step 2: Write generic result view test**

Create `desktop/src/action-runtime/__tests__/action-result-view.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ActionResultView } from "../action-result-view"

describe("ActionResultView", () => {
  it("renders summary, metrics, and logs", () => {
    const html = renderToStaticMarkup(
      <ActionResultView
        result={{
          status: "success",
          summary: "200 OK",
          metrics: { httpStatus: 200, durationMs: 25 },
          logs: [{ label: "response", value: "{\"ok\":true}" }],
        }}
      />,
    )

    expect(html).toContain("200 OK")
    expect(html).toContain("HTTP 200")
    expect(html).toContain("25 ms")
    expect(html).toContain("response")
    expect(html).toContain("{&quot;ok&quot;:true}")
  })
})
```

- [ ] **Step 3: Run renderer runtime tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/action-runtime/__tests__/action-registry.test.tsx src/action-runtime/__tests__/action-result-view.test.tsx
```

Expected: fail because renderer runtime files do not exist.

- [ ] **Step 4: Add renderer action registry**

Create `desktop/src/action-runtime/action-registry.ts`:

```ts
import type {
  ActionConfig,
  ActionManifest,
  ActionRunResult,
} from "../../action-packages/types"

export type ActionConfigFormComponent<TConfig extends ActionConfig = ActionConfig> = (props: {
  readonly value: TConfig
  readonly onChange: (value: TConfig) => void
}) => JSX.Element

export type ActionResultViewComponent = (props: {
  readonly result: ActionRunResult
}) => JSX.Element

export type RendererActionDefinition<TConfig extends ActionConfig = ActionConfig> = {
  readonly manifest: ActionManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: ActionConfigFormComponent<TConfig>
  ResultView?: ActionResultViewComponent
}

export class RendererActionRegistry {
  private readonly actions = new Map<string, RendererActionDefinition>()

  register(action: RendererActionDefinition): void {
    const { id } = action.manifest
    if (this.actions.has(id)) {
      throw new Error(`Task action "${id}" is already registered`)
    }
    this.actions.set(id, action)
  }

  get(id: string): RendererActionDefinition {
    const action = this.actions.get(id)
    if (!action) {
      throw new Error(`Task action "${id}" is not registered`)
    }
    return action
  }

  list(): readonly RendererActionDefinition[] {
    return [...this.actions.values()]
  }

  getDefaultConfig(id: string): ActionConfig {
    return this.get(id).manifest.defaultConfig
  }

  parseConfig(id: string, config: ActionConfig): ActionConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }

  summarize(id: string, config: ActionConfig): string {
    const action = this.get(id)
    return action.summarizeConfig(action.manifest.configSchema.parse(config))
  }
}
```

- [ ] **Step 5: Add config renderer components**

Create `desktop/action-packages/builtin/command/config.renderer.tsx`:

```tsx
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Field, FieldContent, FieldLabel } from "../../../src/components/ui/field"
import type { CommandActionConfig } from "./schema"
import { parseRecordText, stringifyRecordText } from "../../records"

export function CommandConfigForm({
  value,
  onChange,
}: {
  readonly value: CommandActionConfig
  readonly onChange: (value: CommandActionConfig) => void
}) {
  return (
    <div className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="task-action-command-shell">Shell</FieldLabel>
        <FieldContent>
          <Select value={value.shell} onValueChange={(shell) => onChange({ ...value, shell: shell as CommandActionConfig["shell"] })}>
            <SelectTrigger id="task-action-command-shell" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="posix">POSIX</SelectItem>
              <SelectItem value="cmd">cmd</SelectItem>
              <SelectItem value="powershell">PowerShell</SelectItem>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-content">命令</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-command-content"
            value={value.command}
            onChange={(event) => onChange({ ...value, command: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-env">环境变量</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-command-env"
            rows={3}
            value={stringifyRecordText(value.env)}
            onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
          />
        </FieldContent>
      </Field>
    </div>
  )
}
```

Create `script/config.renderer.tsx` with the same structure, changing `command` to `script` and using a textarea for script content.

Create `http-request/config.renderer.tsx` with fields for method, URL, query, headers, body type, body, and timeout. Use `Input`, `Textarea`, and `Select`; use `parseRecordText` for query and headers.

- [ ] **Step 6: Add result renderer**

Create `desktop/src/action-runtime/action-result-view.tsx`:

```tsx
import type { ActionRunResult } from "../../action-packages/types"

function ActionResultView({ result }: { readonly result: ActionRunResult }) {
  return (
    <div className="grid gap-3">
      {result.summary ? <p className="text-sm text-muted-foreground">{result.summary}</p> : null}
      {result.metrics ? <MetricsView metrics={result.metrics} /> : null}
      {result.error ? <OutputBlock label="错误" value={result.error} /> : null}
      {result.logs?.map((log) => (
        <OutputBlock key={log.label} label={log.label} value={log.value} />
      ))}
    </div>
  )
}

function MetricsView({ metrics }: { readonly metrics: NonNullable<ActionRunResult["metrics"]> }) {
  const items = [
    metrics.httpStatus !== undefined ? `HTTP ${String(metrics.httpStatus)}` : undefined,
    metrics.exitCode !== undefined ? `退出码 ${String(metrics.exitCode)}` : undefined,
    metrics.durationMs !== undefined ? `${String(metrics.durationMs)} ms` : undefined,
  ].filter((item): item is string => item !== undefined)

  if (items.length === 0) return null
  return <p className="text-sm text-muted-foreground">{items.join(" · ")}</p>
}

function OutputBlock({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{value}</pre>
    </div>
  )
}

export { ActionResultView }
```

For `result.renderer.tsx` in each built-in package, export the generic view:

```tsx
export { ActionResultView as CommandResultView } from "../../../src/action-runtime/action-result-view"
```

Use corresponding names for script and HTTP.

- [ ] **Step 7: Add built-in renderer registry**

Create `desktop/src/action-runtime/builtin-actions.ts`:

```ts
import { commandActionManifest, type CommandActionConfig } from "../../action-packages/builtin/command"
import { scriptActionManifest, type ScriptActionConfig } from "../../action-packages/builtin/script"
import { httpRequestActionManifest, type HttpRequestActionConfig } from "../../action-packages/builtin/http-request"
import { CommandConfigForm } from "../../action-packages/builtin/command/config.renderer"
import { ScriptConfigForm } from "../../action-packages/builtin/script/config.renderer"
import { HttpRequestConfigForm } from "../../action-packages/builtin/http-request/config.renderer"
import { ActionResultView } from "./action-result-view"
import {
  RendererActionRegistry,
  type RendererActionDefinition,
} from "./action-registry"

const commandRendererAction: RendererActionDefinition<CommandActionConfig> = {
  manifest: commandActionManifest,
  summarizeConfig: (config) => `命令 · ${config.command || "未设置"}`,
  ConfigForm: CommandConfigForm,
  ResultView: ActionResultView,
}

const scriptRendererAction: RendererActionDefinition<ScriptActionConfig> = {
  manifest: scriptActionManifest,
  summarizeConfig: (config) => `脚本 · ${config.shell}`,
  ConfigForm: ScriptConfigForm,
  ResultView: ActionResultView,
}

const httpRequestRendererAction: RendererActionDefinition<HttpRequestActionConfig> = {
  manifest: httpRequestActionManifest,
  summarizeConfig: (config) => `${config.method} · ${config.url || "未设置 URL"}`,
  ConfigForm: HttpRequestConfigForm,
  ResultView: ActionResultView,
}

export const rendererActionRegistry = new RendererActionRegistry()
rendererActionRegistry.register(commandRendererAction)
rendererActionRegistry.register(scriptRendererAction)
rendererActionRegistry.register(httpRequestRendererAction)
```

- [ ] **Step 8: Run renderer runtime tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/action-runtime/__tests__/action-registry.test.tsx src/action-runtime/__tests__/action-result-view.test.tsx
```

Expected: pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add desktop/src/action-runtime desktop/action-packages/builtin/*/*.renderer.tsx
git commit -m "feat: add renderer action runtime"
```

## Task 9: Task Form Uses Action Packages

**Files:**

- Modify: `desktop/src/modules/task-scheduler/types.ts`
- Modify: `desktop/src/modules/task-scheduler/utils.ts`
- Modify: `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`
- Modify: `desktop/src/modules/task-scheduler/__tests__/utils.test.ts`
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`

- [ ] **Step 1: Inspect existing unstaged task form changes**

Run:

```bash
git diff -- desktop/src/modules/task-scheduler/components/task-form-dialog.tsx desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Use the current file contents as the base. Do not discard the existing local edits.

- [ ] **Step 2: Update utility tests for action refs**

In `desktop/src/modules/task-scheduler/__tests__/utils.test.ts`, update payload expectations:

```ts
expect(buildTaskCreateInput({
  ...DEFAULT_TASK_FORM_STATE,
  actionType: "builtin.command",
  actionConfig: {
    command: "echo ok",
    shell: "posix",
    timeoutMins: 30,
  },
})).toEqual(expect.objectContaining({
  action: {
    type: "builtin.command",
    config: {
      command: "echo ok",
      shell: "posix",
      timeoutMins: 30,
    },
  },
}))
```

Add an HTTP payload assertion:

```ts
expect(buildTaskCreateInput({
  ...DEFAULT_TASK_FORM_STATE,
  actionType: "builtin.http-request",
  actionConfig: {
    method: "POST",
    url: "https://example.com/api",
    bodyType: "json",
    body: "{\"ok\":true}",
    timeoutMins: 5,
  },
}).action).toEqual({
  type: "builtin.http-request",
  config: {
    method: "POST",
    url: "https://example.com/api",
    bodyType: "json",
    body: "{\"ok\":true}",
    timeoutMins: 5,
  },
})
```

- [ ] **Step 3: Update task form test expectations**

In `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`, keep existing section tests and add:

```tsx
it("renders action type choices", () => {
  const html = renderToStaticMarkup(
    <TaskFormDialog
      busy={false}
      open
      projects={[]}
      state={{ mode: "create" }}
      onCreate={vi.fn()}
      onOpenChange={vi.fn()}
      onUpdate={vi.fn()}
      platform="darwin"
    />,
  )

  expect(html).toContain("命令")
  expect(html).toContain("脚本")
  expect(html).toContain("HTTP 请求")
})
```

- [ ] **Step 4: Run renderer task scheduler tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/utils.test.ts src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: fail because form state still uses `actionMode` and `actionContent`.

- [ ] **Step 5: Replace task form state action fields**

Modify `desktop/src/modules/task-scheduler/types.ts`:

```ts
import type { ActionConfig } from "../../../action-packages/types"
```

Replace action-specific form fields with:

```ts
type TaskFormState = {
  name: string
  description: string
  scopeType: TaskFormScopeType
  projectId: string
  cwd: string
  enabled: boolean
  triggerType: TaskFormTriggerType
  cronExpr: string
  everyMinutes: string
  intervalAnchor: "created_at" | "last_completed_at"
  actionType: string
  actionConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}
```

Remove `TaskFormShell` export if no remaining module uses it.

- [ ] **Step 6: Update form utilities**

Modify `desktop/src/modules/task-scheduler/utils.ts`:

```ts
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
```

Set defaults:

```ts
const DEFAULT_ACTION_TYPE = "builtin.command"

const DEFAULT_TASK_FORM_STATE: TaskFormState = {
  name: "",
  description: "",
  scopeType: "global",
  projectId: "",
  cwd: "",
  enabled: true,
  triggerType: "cron",
  cronExpr: "0 9 * * *",
  everyMinutes: "60",
  intervalAnchor: "created_at",
  actionType: DEFAULT_ACTION_TYPE,
  actionConfig: rendererActionRegistry.getDefaultConfig(DEFAULT_ACTION_TYPE),
  missedRunPolicy: "skip",
}
```

Create state from task:

```ts
actionType: task.action.type,
actionConfig: task.action.config,
```

Build trigger payload:

```ts
trigger: form.triggerType === "cron"
  ? { type: "builtin.cron", config: { expr: requireTrimmed(form.cronExpr, "Cron") } }
  : {
      type: "builtin.interval",
      config: {
        everyMinutes: readPositiveInteger(form.everyMinutes, "间隔"),
        anchor: form.intervalAnchor,
      },
    },
```

Build action payload:

```ts
const actionConfig = rendererActionRegistry.parseConfig(form.actionType, form.actionConfig)

action: {
  type: form.actionType,
  config: actionConfig,
},
```

Remove `parseTaskEnv`, `stringifyTaskEnv`, `defaultTaskShell`, and shell-specific helpers from this file once action packages own those details.

- [ ] **Step 7: Update form dialog action section**

In `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`, import:

```ts
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
```

Inside the component:

```ts
const selectedAction = rendererActionRegistry.get(form.actionType)
const ActionConfigForm = selectedAction.ConfigForm
```

Replace the existing action mode/shell/content/env/timeout fields with:

```tsx
<TaskField label="动作" htmlFor="task-form-action-type">
  <Select
    value={form.actionType}
    onValueChange={(actionType) => {
      const nextConfig = rendererActionRegistry.getDefaultConfig(actionType)
      updateField("actionType", actionType)
      updateField("actionConfig", nextConfig)
    }}
  >
    <SelectTrigger id="task-form-action-type" className="w-full">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {rendererActionRegistry.list().map((action) => (
        <SelectItem key={action.manifest.id} value={action.manifest.id}>
          {action.manifest.title}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</TaskField>
{ActionConfigForm ? (
  <ActionConfigForm
    value={form.actionConfig}
    onChange={(actionConfig) => updateField("actionConfig", actionConfig)}
  />
) : null}
```

If confirmation on action switch is implemented in the same task, use the existing `AlertDialog` primitive and keep the message short:

```text
切换后会清空当前动作配置。
```

- [ ] **Step 8: Run form tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/utils.test.ts src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add desktop/src/modules/task-scheduler/types.ts desktop/src/modules/task-scheduler/utils.ts desktop/src/modules/task-scheduler/components/task-form-dialog.tsx desktop/src/modules/task-scheduler/__tests__/utils.test.ts desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
git commit -m "feat: render scheduled task action forms"
```

## Task 10: Task List And Run History UI

**Files:**

- Modify: `desktop/src/modules/task-scheduler/index.tsx`
- Modify: `desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx`
- Modify: `desktop/src/modules/task-scheduler/utils.ts`
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

- [ ] **Step 1: Update module test for action column**

In `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`, update fixture action:

```ts
action: {
  type: "builtin.command",
  config: {
    command: "echo ok",
    shell: "posix",
    timeoutMins: 30,
  },
},
trigger: {
  type: "builtin.interval",
  config: { everyMinutes: 1, anchor: "created_at" },
},
schemaVersion: 2,
```

Add:

```ts
it("renders action summaries", () => {
  useTaskSchedulerTasksMock.mockReturnValue({
    tasks: [createTask()],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const html = renderToStaticMarkup(<TaskSchedulerModule />)

  expect(html).toContain("命令 · echo ok")
})
```

- [ ] **Step 2: Run module tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: fail because the action column is not rendered.

- [ ] **Step 3: Update formatter utilities**

Modify `desktop/src/modules/task-scheduler/utils.ts`:

```ts
function formatTaskTrigger(task: ScheduledTask): string {
  if (task.trigger.type === "builtin.cron") {
    return `Cron · ${task.trigger.config.expr}`
  }
  return task.trigger.config.anchor === "last_completed_at"
    ? `每 ${task.trigger.config.everyMinutes} 分钟 · 完成后`
    : `每 ${task.trigger.config.everyMinutes} 分钟`
}

function formatTaskAction(task: ScheduledTask): string {
  try {
    return rendererActionRegistry.summarize(task.action.type, task.action.config)
  } catch {
    return task.action.type
  }
}
```

Export `formatTaskAction`.

- [ ] **Step 4: Add action column to task list**

Modify `desktop/src/modules/task-scheduler/index.tsx`:

```ts
import {
  formatTaskAction,
  formatTaskDate,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
} from "./utils"
```

Add header:

```tsx
<TableHead>动作</TableHead>
```

Add cell after trigger:

```tsx
<TableCell>{formatTaskAction(task)}</TableCell>
```

The final order should be:

```text
名称 | 作用域 | 触发 | 动作 | 上次 | 下次 | 状态 | 启用 | 操作
```

- [ ] **Step 5: Update run history dialog**

Modify `desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx`:

```ts
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { ActionResultView } from "@/action-runtime/action-result-view"
```

Inside each run block, replace `exitCode/stdout/stderr` rendering with:

```tsx
{run.result ? (
  <RunResult task={task} result={run.result} />
) : null}
{run.error && !run.result?.error ? <OutputBlock label="错误" value={run.error} /> : null}
```

Add:

```tsx
function RunResult({
  task,
  result,
}: {
  readonly task: ScheduledTask | null
  readonly result: ScheduledTaskRun["result"]
}) {
  if (!result) return null
  if (task) {
    try {
      const ResultView = rendererActionRegistry.get(task.action.type).ResultView
      if (ResultView) return <ResultView result={result} />
    } catch {
      return <ActionResultView result={result} />
    }
  }
  return <ActionResultView result={result} />
}
```

- [ ] **Step 6: Run module tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add desktop/src/modules/task-scheduler/index.tsx desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx desktop/src/modules/task-scheduler/utils.ts desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
git commit -m "feat: show scheduled action results"
```

## Task 11: Cross-Module Typecheck And Test Repair

**Files:**

- Modify only files surfaced by focused tests, typecheck, or hard-constraints.

- [ ] **Step 1: Run focused task scheduler test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler src/modules/task-scheduler electron/modules/task-scheduler action-packages src/action-runtime
```

Expected: pass. If a failure occurs, fix only the file named in the failure and rerun the same command.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass. Common expected repair points:

- Import paths from `desktop/action-packages` into `desktop/src`.
- Old `ScheduledTaskEntryV1` or `ScheduledTaskRunEntryV1` imports.
- Old `shell_command`, `stdout`, `stderr`, or `exitCode` properties.
- `ActionConfigFormComponent` JSX type compatibility.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass. If the network helper triggers a hard-constraint failure, move the failing network operation into `desktop/electron/runtime/network/` and call it from the action package.

- [ ] **Step 4: Run desktop tests**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: pass.

- [ ] **Step 5: Commit repairs**

If Step 1 through Step 4 required code changes, commit them:

```bash
git add desktop/action-packages desktop/electron/action-runtime desktop/electron/runtime/network desktop/electron/services/task-scheduler desktop/electron/modules/task-scheduler desktop/electron/bootstrap/descriptors.ts desktop/src/action-runtime desktop/src/modules/task-scheduler desktop/src/types
git commit -m "fix: align action package integration"
```

If there were no changes after Task 10, do not create an empty commit.

## Task 12: Final Verification

**Files:**

- No planned edits.

- [ ] **Step 1: Confirm worktree contains only intentional changes**

Run:

```bash
git status --short
```

Expected: no unstaged or staged changes from the implementation tasks. If unrelated user changes remain, leave them untouched and mention them in the final report.

- [ ] **Step 2: Run final verification commands**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Expected: all pass.

- [ ] **Step 3: Prepare final summary**

Report:

- Action package foundation added.
- Command and script split into `builtin.command` and `builtin.script`.
- HTTP request added as `builtin.http-request`.
- Scheduler now stores `action: { type, config }`.
- Run history stores `ActionRunResult`.
- Verification command results.
- Any unrelated pre-existing modified files left untouched.

## Self-Review Notes

Spec coverage:

- Standalone built-in Action Package foundation: Tasks 1 through 4 and 8.
- Command/script split: Task 3.
- HTTP request action: Task 4.
- Schema-driven config and optional custom UI: Tasks 1 and 8.
- Generic result shape: Tasks 1, 5, 6, 10.
- Scheduler action ref persistence: Tasks 5 through 7.
- Permissions and audit: Task 6.
- Trigger registry-ready shape: Task 5.
- shadcn/Radix UI with concise copy: Tasks 8 through 10.
- Verification: Tasks 11 and 12.

No dynamic plugin loading, workflow composition, or legacy data migration is included.
