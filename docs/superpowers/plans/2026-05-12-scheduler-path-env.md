# Scheduler PATH/Env Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix PATH handling in scheduled tasks so nvm/asdf/Homebrew tools work by default, add diagnostics on failure, and provide clear UI controls for advanced PATH/shell options.

**Architecture:** Extend `buildAllowedEnv` in `controlled-runner.ts` with a `pathStrategy` parameter. New optional schema fields (`pathStrategy`, `posixLogin`) flow from action config schemas through `shell-process.main.ts` to the controlled runner. Diagnostics are always populated in `ControlledProcessResult` but only rendered in the UI on failure.

**Tech Stack:** TypeScript, Zod, React, shadcn/ui (ToggleGroup, Checkbox, FieldDescription), Vitest

**Spec:** `docs/superpowers/specs/2026-05-12-scheduler-path-env-design.md`

---

## File Map

### Modified files

| File | Responsibility |
|------|---------------|
| `desktop/electron/runtime/process/controlled-runner.ts` | PATH merge logic, diagnostics population, `PathStrategy` type |
| `desktop/action-packages/builtin/shell-process.main.ts` | Pass `pathStrategy` and `posixLogin` through to runner and shell-exec |
| `desktop/action-packages/builtin/command/schema.ts` | Add `pathStrategy` and `posixLogin` to Zod schema |
| `desktop/action-packages/builtin/script/schema.ts` | Same as command schema |
| `desktop/action-packages/builtin/command/manifest.ts` | Add new fields to `configFields` |
| `desktop/action-packages/builtin/script/manifest.ts` | Same as command manifest |
| `desktop/action-packages/builtin/command/config.renderer.tsx` | Placeholder, FieldDescription, PATH mode toggle, posixLogin checkbox |
| `desktop/action-packages/builtin/script/config.renderer.tsx` | Same as command config form |
| `desktop/src/action-runtime/action-result-view.tsx` | Render diagnostics block on failure |

### Modified test files

| File | Responsibility |
|------|---------------|
| `desktop/electron/runtime/process/__tests__/controlled-runner.test.ts` | Tests for PATH merge/replace/dedup and diagnostics |
| `desktop/action-packages/builtin/command/__tests__/executor.test.ts` | Tests for pathStrategy and posixLogin passthrough |

### New files

| File | Responsibility |
|------|---------------|
| `docs/scheduler/path-and-env.md` | Technical reference doc |
| `website/advanced/scheduler-env.md` | User-facing doc (VitePress) |

---

## Task 1: PATH merge helpers in controlled-runner.ts

**Files:**
- Modify: `desktop/electron/runtime/process/controlled-runner.ts:1-6` (add import)
- Modify: `desktop/electron/runtime/process/controlled-runner.ts:714-734` (buildAllowedEnv + new helpers)
- Modify: `desktop/electron/runtime/process/controlled-runner.ts:60-77` (ControlledProcessRunRequest)
- Test: `desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`

- [ ] **Step 1: Write failing tests for PATH merge helpers**

Add to the bottom of `desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`:

```ts
import {
  computePath,
  splitPath,
  dedupePath,
} from "../controlled-runner"

describe("PATH merge helpers", () => {
  describe("splitPath", () => {
    it("splits POSIX paths on colon", () => {
      expect(splitPath("/usr/bin:/usr/local/bin", ":")).toEqual(["/usr/bin", "/usr/local/bin"])
    })

    it("filters empty segments", () => {
      expect(splitPath("/usr/bin::/usr/local/bin:", ":")).toEqual(["/usr/bin", "/usr/local/bin"])
    })

    it("splits Windows paths on semicolon", () => {
      expect(splitPath("C:\\Windows;C:\\Users\\bin", ";")).toEqual(["C:\\Windows", "C:\\Users\\bin"])
    })
  })

  describe("dedupePath", () => {
    it("deduplicates case-sensitively for POSIX", () => {
      expect(dedupePath(["/usr/bin", "/usr/local/bin", "/usr/bin"], false)).toEqual([
        "/usr/bin",
        "/usr/local/bin",
      ])
    })

    it("deduplicates case-insensitively for Windows", () => {
      expect(dedupePath(["C:\\Windows", "c:\\windows", "C:\\Users"], true)).toEqual([
        "C:\\Windows",
        "C:\\Users",
      ])
    })
  })

  describe("computePath", () => {
    it("merge: user paths first, shell paths appended, deduped", () => {
      const result = computePath(
        "merge",
        "/custom/bin:/usr/bin",
        "/usr/bin:/usr/local/bin:/opt/homebrew/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/custom/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin")
    })

    it("merge: no user PATH uses shell PATH only", () => {
      const result = computePath(
        "merge",
        undefined,
        "/usr/bin:/usr/local/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/usr/bin:/usr/local/bin")
    })

    it("merge: no shell PATH falls back", () => {
      const result = computePath(
        "merge",
        "/custom/bin",
        null,
        "/usr/bin:/usr/local/bin",
        ":",
        false,
      )
      expect(result).toBe("/custom/bin:/usr/bin:/usr/local/bin")
    })

    it("replace: uses user PATH verbatim", () => {
      const result = computePath(
        "replace",
        "/custom/bin",
        "/usr/bin:/usr/local/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/custom/bin")
    })

    it("replace: no user PATH falls back to shell PATH", () => {
      const result = computePath(
        "replace",
        undefined,
        "/usr/bin:/usr/local/bin",
        "/fallback",
        ":",
        false,
      )
      expect(result).toBe("/usr/bin:/usr/local/bin")
    })

    it("merge with Windows semicolons and case-insensitive dedup", () => {
      const result = computePath(
        "merge",
        "C:\\Custom;C:\\Windows",
        "c:\\windows;C:\\System32",
        "fallback",
        ";",
        true,
      )
      expect(result).toBe("C:\\Custom;C:\\Windows;C:\\System32")
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`

Expected: FAIL — `computePath`, `splitPath`, `dedupePath` are not exported.

- [ ] **Step 3: Implement PATH helpers and export them**

Add `delimiter` import at the top of `desktop/electron/runtime/process/controlled-runner.ts`:

```ts
import { delimiter as nodePathDelimiter } from "node:path"
```

Add the `PathStrategy` type and helper functions right before `buildAllowedEnv` (before line 714):

```ts
export type PathStrategy = "merge" | "replace"

export function splitPath(pathValue: string, delim: string): string[] {
  return pathValue.split(delim).filter(Boolean)
}

export function dedupePath(parts: string[], caseInsensitive: boolean): string[] {
  const seen = new Set<string>()
  return parts.filter((p) => {
    const key = caseInsensitive ? p.toLowerCase() : p
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function computePath(
  strategy: PathStrategy,
  userPath: string | undefined,
  shellPath: string | null,
  fallbackPath: string,
  delim: string,
  caseInsensitive: boolean,
): string {
  if (strategy === "replace" && userPath !== undefined) {
    return userPath
  }

  const base = shellPath ?? fallbackPath
  if (userPath === undefined) {
    return base
  }

  const parts = [...splitPath(userPath, delim), ...splitPath(base, delim)]
  return dedupePath(parts, caseInsensitive).join(delim)
}
```

Update `buildAllowedEnv` to accept `pathStrategy`:

```ts
function buildAllowedEnv(
  env: Record<string, string | undefined> | undefined,
  envAllowlist: readonly string[] | undefined,
  pathStrategy: PathStrategy = "merge",
): NodeJS.ProcessEnv {
  const allowlist = new Set([...DEFAULT_ENV_ALLOWLIST, ...(envAllowlist ?? [])])
  const nextEnv: NodeJS.ProcessEnv = {}

  for (const key of allowlist) {
    if (!key) continue
    if (key === "PATH") {
      const userEntry = findEnvEntry(env, "PATH")
      const shellPath = resolveShellPath()
      const fallbackPath = process.env.PATH ?? ""
      const delim = nodePathDelimiter
      const caseInsensitive = process.platform === "win32"
      nextEnv.PATH = computePath(
        pathStrategy,
        userEntry?.value,
        shellPath,
        fallbackPath,
        delim,
        caseInsensitive,
      )
      continue
    }
    let entry = findEnvEntry(env, key)
    if (!entry) entry = findEnvEntry(process.env, key)
    if (entry) nextEnv[entry.key] = entry.value
  }

  return nextEnv
}
```

Add `pathStrategy` to `ControlledProcessRunRequest`:

```ts
export interface ControlledProcessRunRequest {
  // ... existing fields (keep them all)
  readonly pathStrategy?: PathStrategy
}
```

Update `buildLaunch` to pass `pathStrategy`:

```ts
function buildLaunch(request: ControlledProcessRunRequest): ControlledProcessLaunch {
  const args = request.args ?? []
  const env = buildAllowedEnv(request.env, request.envAllowlist, request.pathStrategy ?? "merge")
  // ... rest unchanged
```

Also export `PathStrategy` from `desktop/electron/runtime/process/index.ts`:

```ts
export type {
  // ... existing exports
  PathStrategy,
} from "./controlled-runner"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`

Expected: All new PATH merge helper tests PASS. All existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/runtime/process/controlled-runner.ts desktop/electron/runtime/process/index.ts desktop/electron/runtime/process/__tests__/controlled-runner.test.ts
git commit -m "feat(scheduler): add PATH merge helpers and pathStrategy to buildAllowedEnv"
```

---

## Task 2: Add diagnostics to ControlledProcessResult

**Files:**
- Modify: `desktop/electron/runtime/process/controlled-runner.ts:85-93` (ControlledProcessResult)
- Modify: `desktop/electron/runtime/process/controlled-runner.ts:216-392` (run method)
- Test: `desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`

- [ ] **Step 1: Write failing test for diagnostics**

Add to `desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`:

```ts
describe("diagnostics", () => {
  it("populates diagnostics on successful run", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    })

    expect(result.exitCode).toBe(0)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics!.envKeys).toEqual(expect.arrayContaining(["PATH"]))
    expect(result.diagnostics!.pathEntries.length).toBeGreaterThan(0)
    expect(result.diagnostics!.shell).toBe(process.execPath)
    expect(result.diagnostics!.args).toEqual(["-e", "process.exit(0)"])
  })

  it("populates diagnostics on failed run", async () => {
    const guard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const runner = createControlledProcessRunner({ permissionGuard: guard, auditSink })

    const result = await runner.run({
      actor: { kind: "user" },
      action: "shell.exec",
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
    })

    expect(result.exitCode).toBe(1)
    expect(result.diagnostics).toBeDefined()
    expect(result.diagnostics!.envKeys).toEqual(expect.arrayContaining(["PATH"]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/runtime/process/__tests__/controlled-runner.test.ts -t "diagnostics"`

Expected: FAIL — `diagnostics` is `undefined`.

- [ ] **Step 3: Implement diagnostics in ControlledProcessResult and run method**

Extend `ControlledProcessResult` interface in `controlled-runner.ts:85-93`:

```ts
export interface ControlledProcessDiagnostics {
  readonly envKeys: readonly string[]
  readonly pathSummary: string
  readonly pathEntries: readonly string[]
  readonly shell: string
  readonly args: readonly string[]
}

export interface ControlledProcessResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout?: string
  readonly stderr?: string
  readonly timedOut: boolean
  readonly durationMs: number
  readonly error?: string
  readonly diagnostics?: ControlledProcessDiagnostics
}
```

In the `run` method, after `const launch = buildLaunch(request)` (line 221), build diagnostics:

```ts
const launch = buildLaunch(request)
const launchPathEntries = splitPath(launch.env.PATH ?? "", nodePathDelimiter)
const launchDiagnostics: ControlledProcessDiagnostics = {
  envKeys: Object.keys(launch.env).sort(),
  pathSummary: launchPathEntries.length > 0
    ? `${launchPathEntries[0]}${launchPathEntries.length > 1 ? ` ... (${String(launchPathEntries.length)} entries)` : ""}`
    : "(empty)",
  pathEntries: launchPathEntries,
  shell: launch.command,
  args: [...launch.args],
}
```

Then when constructing the result object (around line 352), add diagnostics:

```ts
const result: ControlledProcessResult = {
  exitCode: closed.code,
  signal: closed.signal,
  stdout,
  stderr,
  timedOut,
  durationMs,
  error,
  diagnostics: launchDiagnostics,
}
```

Export `ControlledProcessDiagnostics` from `desktop/electron/runtime/process/index.ts`:

```ts
export type {
  // ... existing exports
  ControlledProcessDiagnostics,
} from "./controlled-runner"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/runtime/process/__tests__/controlled-runner.test.ts`

Expected: All tests PASS including the new diagnostics tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/runtime/process/controlled-runner.ts desktop/electron/runtime/process/index.ts desktop/electron/runtime/process/__tests__/controlled-runner.test.ts
git commit -m "feat(scheduler): populate diagnostics in ControlledProcessResult"
```

---

## Task 3: Update schemas, manifests, and ShellActionConfig

**Files:**
- Modify: `desktop/action-packages/builtin/command/schema.ts`
- Modify: `desktop/action-packages/builtin/script/schema.ts`
- Modify: `desktop/action-packages/builtin/command/manifest.ts`
- Modify: `desktop/action-packages/builtin/script/manifest.ts`
- Modify: `desktop/action-packages/builtin/shell-process.main.ts:8-12`
- Test: `desktop/action-packages/builtin/command/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing tests for pathStrategy and posixLogin passthrough**

Add to `desktop/action-packages/builtin/command/__tests__/executor.test.ts`:

```ts
it("passes pathStrategy through to processRunner.run", async () => {
  const run = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1,
  }))
  const action = createCommandAction({
    processRunner: { run },
    platform: "darwin",
  })

  await action.execute({
    config: {
      command: "echo ok",
      shell: "posix",
      timeoutMins: 1,
      pathStrategy: "replace",
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

  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ pathStrategy: "replace" }),
  )
})

it("passes posixLogin through to resolveShellCommand", async () => {
  const run = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1,
  }))
  const action = createCommandAction({
    processRunner: { run },
    platform: "darwin",
  })

  await action.execute({
    config: {
      command: "echo ok",
      shell: "posix",
      timeoutMins: 1,
      posixLogin: false,
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

  // posixLogin: false → args should use "-c" not "-lc"
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["-c", "echo ok"] }),
  )
})

it("defaults to -lc when posixLogin is undefined", async () => {
  const run = vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1,
  }))
  const action = createCommandAction({
    processRunner: { run },
    platform: "darwin",
  })

  await action.execute({
    config: {
      command: "echo ok",
      shell: "posix",
      timeoutMins: 1,
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

  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ args: ["-lc", "echo ok"] }),
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/action-packages/builtin/command/__tests__/executor.test.ts`

Expected: FAIL — `pathStrategy` not in schema, `posixLogin` not passed through.

- [ ] **Step 3: Update command schema**

In `desktop/action-packages/builtin/command/schema.ts`, replace the schema with:

```ts
import { z } from "zod"

export const commandActionConfigSchema = z.object({
  command: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  pathStrategy: z.enum(["merge", "replace"]).optional(),
  posixLogin: z.boolean().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type CommandActionConfig = z.infer<typeof commandActionConfigSchema>
```

- [ ] **Step 4: Update script schema**

In `desktop/action-packages/builtin/script/schema.ts`, replace the schema with:

```ts
import { z } from "zod"

export const scriptActionConfigSchema = z.object({
  script: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  pathStrategy: z.enum(["merge", "replace"]).optional(),
  posixLogin: z.boolean().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type ScriptActionConfig = z.infer<typeof scriptActionConfigSchema>
```

- [ ] **Step 5: Update command manifest**

In `desktop/action-packages/builtin/command/manifest.ts`, add to `configFields` array (after the `env` field):

```ts
{
  name: "pathStrategy",
  kind: "enum",
  required: false,
  description: "PATH resolution strategy. 'merge' prepends user PATH to shell PATH. 'replace' uses user PATH verbatim.",
  choices: ["merge", "replace"],
},
{
  name: "posixLogin",
  kind: "boolean",
  required: false,
  description: "Launch as login shell (-lc). Disable to skip macOS path_helper.",
  defaultValue: true,
},
```

- [ ] **Step 6: Update script manifest**

In `desktop/action-packages/builtin/script/manifest.ts`, add the same two `configFields` entries as command manifest (after the `env` field):

```ts
{
  name: "pathStrategy",
  kind: "enum",
  required: false,
  description: "PATH resolution strategy. 'merge' prepends user PATH to shell PATH. 'replace' uses user PATH verbatim.",
  choices: ["merge", "replace"],
},
{
  name: "posixLogin",
  kind: "boolean",
  required: false,
  description: "Launch as login shell (-lc). Disable to skip macOS path_helper.",
  defaultValue: true,
},
```

- [ ] **Step 7: Update ShellActionConfig and runShellAction**

In `desktop/action-packages/builtin/shell-process.main.ts`, update `ShellActionConfig`:

```ts
export type ShellActionConfig = {
  readonly shell: "posix" | "cmd" | "powershell"
  readonly env?: Record<string, string>
  readonly pathStrategy?: "merge" | "replace"
  readonly posixLogin?: boolean
  readonly timeoutMins?: number | null
}
```

Update the `resolveShellCommand` call to pass `posixLogin`:

```ts
const shell = resolveShellCommand(input.config.shell, input.content, {
  platform,
  windowsDefault: "cmd",
  posixLogin: input.config.posixLogin,
})
```

Update the `processRunner.run` call to pass `pathStrategy` and include `diagnostics` in outputs:

```ts
const result = await input.processRunner.run({
  actor: input.context.actor,
  action: "shell.exec",
  command: shell.command,
  args: [...shell.args],
  cwd: input.context.cwd,
  env: input.config.env,
  envAllowlist: input.config.env ? Object.keys(input.config.env) : undefined,
  pathStrategy: input.config.pathStrategy,
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
```

Update the `outputs` object to include diagnostics:

```ts
const outputs = {
  stdout: result.stdout ?? "",
  stderr: result.stderr ?? "",
  exitCode: result.exitCode,
  diagnostics: result.diagnostics,
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/action-packages/builtin/command/__tests__/executor.test.ts`

Expected: All tests PASS — including existing tests and new pathStrategy/posixLogin tests.

- [ ] **Step 9: Run all tests to check for regressions**

Run: `pnpm --filter @synapse/desktop run test`

Expected: All green.

- [ ] **Step 10: Commit**

```bash
git add desktop/action-packages/builtin/command/schema.ts desktop/action-packages/builtin/script/schema.ts desktop/action-packages/builtin/command/manifest.ts desktop/action-packages/builtin/script/manifest.ts desktop/action-packages/builtin/shell-process.main.ts desktop/action-packages/builtin/command/__tests__/executor.test.ts
git commit -m "feat(scheduler): add pathStrategy + posixLogin to schemas, manifests, and shell action"
```

---

## Task 4: UI — Placeholder, FieldDescription, PATH mode, posixLogin

**Files:**
- Modify: `desktop/action-packages/builtin/command/config.renderer.tsx`
- Modify: `desktop/action-packages/builtin/script/config.renderer.tsx`

- [ ] **Step 1: Update CommandConfigForm**

Replace the entire content of `desktop/action-packages/builtin/command/config.renderer.tsx`:

```tsx
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Checkbox } from "../../../src/components/ui/checkbox"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { CommandActionConfig } from "./schema"

const SHELL_OPTIONS: Array<{ label: string; value: CommandActionConfig["shell"] }> = [
  { label: "POSIX", value: "posix" },
  { label: "cmd", value: "cmd" },
  { label: "PowerShell", value: "powershell" },
]

export function CommandConfigForm({
  value,
  onChange,
}: {
  readonly value: CommandActionConfig
  readonly onChange: (value: CommandActionConfig) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-command-shell-posix">Shell</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Shell"
            className="w-full"
            data-track="task-action-command-shell"
            type="single"
            value={value.shell}
            variant="outline"
            onValueChange={(shell) => {
              if (shell) onChange({ ...value, shell: shell as CommandActionConfig["shell"] })
            }}
          >
            {SHELL_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-command-shell-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
      {value.shell === "posix" ? (
        <Field>
          <FieldContent>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.posixLogin !== false}
                onCheckedChange={(checked) =>
                  onChange({ ...value, posixLogin: checked === true })
                }
              />
              以登录 shell 启动
            </label>
            <FieldDescription>
              关闭后跳过 macOS path_helper 对 PATH 的重排。
            </FieldDescription>
          </FieldContent>
        </Field>
      ) : null}
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
            placeholder={"每行一条 KEY=VALUE\n示例：GITEE_TOKEN=xxx"}
            value={stringifyRecordText(value.env)}
            onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
          />
          <FieldDescription>
            不写 PATH 时自动使用登录终端 PATH。写了 PATH 默认与终端 PATH 合并。
          </FieldDescription>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>PATH 模式</FieldLabel>
        <FieldContent>
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full"
            value={value.pathStrategy ?? "merge"}
            onValueChange={(strategy) => {
              if (strategy) onChange({ ...value, pathStrategy: strategy as "merge" | "replace" })
            }}
          >
            <ToggleGroupItem value="merge" className="flex-1">合并</ToggleGroupItem>
            <ToggleGroupItem value="replace" className="flex-1">替换</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            合并：你写的 PATH 放在登录终端 PATH 前面。替换：完全使用你写的 PATH。
          </FieldDescription>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-command-timeout"
            type="number"
            min={1}
            value={value.timeoutMins ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutMins: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
```

- [ ] **Step 2: Update ScriptConfigForm**

Replace the entire content of `desktop/action-packages/builtin/script/config.renderer.tsx`:

```tsx
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Checkbox } from "../../../src/components/ui/checkbox"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { ScriptActionConfig } from "./schema"

const SHELL_OPTIONS: Array<{ label: string; value: ScriptActionConfig["shell"] }> = [
  { label: "POSIX", value: "posix" },
  { label: "cmd", value: "cmd" },
  { label: "PowerShell", value: "powershell" },
]

export function ScriptConfigForm({
  value,
  onChange,
}: {
  readonly value: ScriptActionConfig
  readonly onChange: (value: ScriptActionConfig) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-script-shell-posix">Shell</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Shell"
            className="w-full"
            data-track="task-action-script-shell"
            type="single"
            value={value.shell}
            variant="outline"
            onValueChange={(shell) => {
              if (shell) onChange({ ...value, shell: shell as ScriptActionConfig["shell"] })
            }}
          >
            {SHELL_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-script-shell-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
      {value.shell === "posix" ? (
        <Field>
          <FieldContent>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.posixLogin !== false}
                onCheckedChange={(checked) =>
                  onChange({ ...value, posixLogin: checked === true })
                }
              />
              以登录 shell 启动
            </label>
            <FieldDescription>
              关闭后跳过 macOS path_helper 对 PATH 的重排。
            </FieldDescription>
          </FieldContent>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="task-action-script-content">脚本</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-script-content"
            rows={6}
            value={value.script}
            onChange={(event) => onChange({ ...value, script: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-script-env">环境变量</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-script-env"
            rows={3}
            placeholder={"每行一条 KEY=VALUE\n示例：GITEE_TOKEN=xxx"}
            value={stringifyRecordText(value.env)}
            onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
          />
          <FieldDescription>
            不写 PATH 时自动使用登录终端 PATH。写了 PATH 默认与终端 PATH 合并。
          </FieldDescription>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>PATH 模式</FieldLabel>
        <FieldContent>
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full"
            value={value.pathStrategy ?? "merge"}
            onValueChange={(strategy) => {
              if (strategy) onChange({ ...value, pathStrategy: strategy as "merge" | "replace" })
            }}
          >
            <ToggleGroupItem value="merge" className="flex-1">合并</ToggleGroupItem>
            <ToggleGroupItem value="replace" className="flex-1">替换</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            合并：你写的 PATH 放在登录终端 PATH 前面。替换：完全使用你写的 PATH。
          </FieldDescription>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-script-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-script-timeout"
            type="number"
            min={1}
            value={value.timeoutMins ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutMins: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
```

- [ ] **Step 3: Run all tests**

Run: `pnpm --filter @synapse/desktop run test`

Expected: All green.

- [ ] **Step 4: Commit**

```bash
git add desktop/action-packages/builtin/command/config.renderer.tsx desktop/action-packages/builtin/script/config.renderer.tsx
git commit -m "feat(scheduler): add PATH mode toggle, posixLogin checkbox, and env hints to config forms"
```

---

## Task 5: Diagnostics UI in action-result-view

**Files:**
- Modify: `desktop/src/action-runtime/action-result-view.tsx`

- [ ] **Step 1: Update ActionResultView to render diagnostics on failure**

Replace the entire content of `desktop/src/action-runtime/action-result-view.tsx`:

```tsx
import type { ActionRunResult } from "../../action-packages/types"

type DiagnosticsData = {
  readonly envKeys?: readonly string[]
  readonly pathSummary?: string
  readonly pathEntries?: readonly string[]
  readonly shell?: string
  readonly args?: readonly string[]
}

function ActionResultView({ result }: { readonly result: ActionRunResult }) {
  const diagnostics = result.outputs?.diagnostics as DiagnosticsData | undefined
  const showDiagnostics = result.status !== "success" && diagnostics
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {result.summary ? <p className="text-sm text-muted-foreground break-words">{result.summary}</p> : null}
      {result.metrics ? <MetricsView metrics={result.metrics} /> : null}
      {result.error ? <OutputBlock label="错误" value={result.error} /> : null}
      {result.logs?.map((log) => (
        <OutputBlock key={log.label} label={log.label} value={log.value} />
      ))}
      {showDiagnostics ? <DiagnosticsBlock diagnostics={diagnostics} /> : null}
    </div>
  )
}

function DiagnosticsBlock({ diagnostics }: { readonly diagnostics: DiagnosticsData }) {
  const lines: string[] = []
  if (diagnostics.pathEntries && diagnostics.pathEntries.length > 0) {
    lines.push(`PATH (${String(diagnostics.pathEntries.length)} entries):`)
    for (const entry of diagnostics.pathEntries) {
      lines.push(`  ${entry}`)
    }
  } else if (diagnostics.pathSummary) {
    lines.push(`PATH: ${diagnostics.pathSummary}`)
  }
  if (diagnostics.envKeys && diagnostics.envKeys.length > 0) {
    lines.push(`\nEnv keys: ${diagnostics.envKeys.join(", ")}`)
  }
  if (diagnostics.shell) {
    const argsStr = diagnostics.args ? ` ${diagnostics.args.join(" ")}` : ""
    lines.push(`Shell: ${diagnostics.shell}${argsStr}`)
  }
  if (lines.length === 0) return null
  return <OutputBlock label="诊断信息" value={lines.join("\n")} />
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
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs font-medium">{label}</p>
      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2.5 text-xs break-all whitespace-pre-wrap">{value}</pre>
    </div>
  )
}

export { ActionResultView }
```

- [ ] **Step 2: Run all tests**

Run: `pnpm --filter @synapse/desktop run test`

Expected: All green.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/action-runtime/action-result-view.tsx
git commit -m "feat(scheduler): render diagnostics block in action result view on failure"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/scheduler/path-and-env.md`
- Create: `website/advanced/scheduler-env.md`

- [ ] **Step 1: Create technical reference doc**

Create `docs/scheduler/path-and-env.md`:

```markdown
# Scheduled Tasks — PATH and Environment Variables

## Overview

Synapse scheduled tasks run shell commands in a controlled subprocess. The environment is built by `buildAllowedEnv` in `controlled-runner.ts`, which applies an allowlist filter and resolves PATH from the user's login shell.

## PATH Resolution Chain

1. **User-provided PATH** — from the task's env config field.
2. **Login shell PATH** — resolved via `resolveShellPath()` which runs `$SHELL -i -l -c "echo $PATH"`.
3. **Fallback** — `process.env.PATH` (Electron app's inherited PATH).

## PATH Strategy

| Strategy | Behavior |
|----------|----------|
| `merge` (default) | User PATH entries prepended to login shell PATH, deduplicated |
| `replace` | User PATH used verbatim; login shell PATH ignored |

When no user PATH is provided, both strategies produce the same result: the login shell PATH is used.

## Login Shell Mode

By default, commands run via `/bin/sh -lc`, which is a login shell. On macOS this triggers `path_helper`, which may reorder PATH entries.

Set `posixLogin: false` to use `/bin/sh -c` instead, skipping `path_helper`. This is useful when PATH order matters and you've provided a complete PATH.

## Environment Allowlist

Only these variables are passed by default: `PATH`, `PATHEXT`, `HOME`, `USER`, `SHELL`, `TMPDIR`, `TEMP`, `TMP`, `SystemRoot`, `WINDIR`, `ComSpec`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH`.

User-specified env keys are added to the allowlist automatically.

## macOS + nvm/asdf Users

- **Recommended**: Leave the PATH field empty. Synapse automatically resolves your login shell PATH, which includes nvm/asdf paths.
- If you must set PATH, use `merge` mode (default) so nvm paths are appended automatically.
- Put global environment variables in `~/.zshenv`, not `~/.zshrc`. Non-interactive shells don't read `.zshrc`.

## Diagnostics

On task failure, the run log shows:
- **PATH entries**: the full resolved PATH that the subprocess received.
- **Env keys**: which environment variable names were passed (values are never shown).
- **Shell command**: the actual shell and arguments used.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `command not found: node` | PATH missing nvm bin | Remove PATH from env field, or use merge mode |
| PATH order unexpected | macOS `path_helper` reordering | Disable login shell (`posixLogin: false`) |
| Token not available | Variable in `.zshrc` only | Move to `~/.zshenv` |
```

- [ ] **Step 2: Create user-facing guide**

Create `website/advanced/scheduler-env.md`:

```markdown
---
title: 定时任务环境变量
---

# 定时任务环境变量

## PATH 行为

Synapse 定时任务默认使用你的登录终端 PATH，nvm、asdf、Homebrew 安装的工具自动可用。

### 什么时候需要手动设置 PATH？

大多数情况下不需要。只有当你需要在 PATH 中添加额外路径时，才在环境变量字段写 `PATH=...`。

### PATH 模式

| 模式 | 行为 |
|------|------|
| **合并**（默认） | 你写的路径放在前面，登录终端的 PATH 追加在后面 |
| **替换** | 完全使用你写的 PATH |

### 登录 shell 选项

默认以登录 shell（`-lc`）运行命令。macOS 下会触发 `path_helper` 重排 PATH。

如果你需要精确控制 PATH 顺序，可以关闭「以登录 shell 启动」选项。

## 环境变量格式

每行一条 `KEY=VALUE`：

```
GITEE_TOKEN=abc123
MY_API_URL=https://api.example.com
```

## macOS + nvm 用户须知

1. **推荐做法**：不写 PATH，让 Synapse 自动获取。
2. 如果脚本需要特定 node 版本，在脚本开头写：
   ```bash
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   nvm use default
   ```
3. 把全局环境变量放在 `~/.zshenv` 而不是 `~/.zshrc`。

## 任务失败排查

失败时运行日志会显示诊断信息：实际的 PATH 条目和环境变量 key 列表。

| 现象 | 原因 | 解决 |
|------|------|------|
| `command not found: node` | PATH 里没有 nvm 路径 | 删掉 PATH 行，或改用合并模式 |
| PATH 顺序不对 | macOS path_helper 重排 | 关闭「以登录 shell 启动」 |
| 环境变量取不到 | 变量只在 `.zshrc` 里 | 移到 `~/.zshenv` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/scheduler/path-and-env.md website/advanced/scheduler-env.md
git commit -m "docs(scheduler): add PATH/env technical reference and user guide"
```

---

## Task 7: CHANGELOG and README link

**Files:**
- Modify: `CHANGELOG.md` (if exists, else create)
- Modify: `README.md` or `desktop/README.md`

- [ ] **Step 1: Add CHANGELOG entry**

If `CHANGELOG.md` exists at the repo root, prepend an entry. If not, create it. The entry:

```markdown
## [Unreleased]

### Changed

- **Scheduled tasks**: PATH is now merged with login shell PATH by default. Previously, user-specified PATH fully replaced the login shell PATH. To restore the old behavior, set PATH mode to "替换" (replace) in the task form.

### Added

- **Scheduled tasks**: PATH mode toggle (合并/替换) in task configuration.
- **Scheduled tasks**: Login shell checkbox to control `-lc` vs `-c` for POSIX shells.
- **Scheduled tasks**: Environment variable field placeholder and description hints.
- **Scheduled tasks**: Diagnostics block (PATH entries, env keys, shell command) shown in run logs on failure.
- **Documentation**: `docs/scheduler/path-and-env.md` technical reference.
- **Documentation**: `website/advanced/scheduler-env.md` user guide.
```

- [ ] **Step 2: Add README link**

In `desktop/README.md`, find the section about scheduled tasks (or an appropriate location) and add:

```markdown
- [定时任务环境变量指南](../docs/scheduler/path-and-env.md)
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md desktop/README.md
git commit -m "docs: add CHANGELOG entry for PATH behavior change and README link"
```

---

## Task 8: Final regression check

- [ ] **Step 1: Run hard constraints check**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints`

Expected: PASS — no new singletons, no bare ipcMain, no bare fs.writeFile.

- [ ] **Step 2: Run full test suite**

Run: `pnpm --filter @synapse/desktop run test`

Expected: All green. Specifically verify:
- `executor.test.ts:52-89` — "does not spread baseEnv/process.env" PASS
- `executor.test.ts:91-127` — "passes user-specified config.env" PASS
- All new PATH merge tests PASS
- All new diagnostics tests PASS
- All new passthrough tests PASS

- [ ] **Step 3: Commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: final cleanup after scheduler PATH/env improvement"
```
