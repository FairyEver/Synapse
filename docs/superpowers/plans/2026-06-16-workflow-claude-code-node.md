# Workflow Claude Code Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Workflow `claude_code` node that calls the user's local `claude -p` CLI and returns the final reply as workflow output.

**Architecture:** Follow the existing `desktop/workflow-nodes/codex/` pattern: a self-contained node package with schema, command builder, artifact helpers, executor, panel, card, and tests. Register it through the Workflow node registries and keep it separate from `AgentRuntimeService` and Synapse's bundled Claude Code runtime.

**Tech Stack:** Electron main process, React, TypeScript, Zod, Vitest, shadcn/Radix UI, Workflow node registry, controlled process runner.

---

## File Structure

- Create `desktop/workflow-nodes/claude-code/schema.ts`: Zod schema, inferred config types, defaults.
- Create `desktop/workflow-nodes/claude-code/command.ts`: build `ControlledProcessRunRequest` for `claude -p`.
- Create `desktop/workflow-nodes/claude-code/artifacts.main.ts`: artifact paths, output parsing, debug redaction helpers.
- Create `desktop/workflow-nodes/claude-code/executor.main.ts`: resolve project/cwd/paths, run process, return node result.
- Create `desktop/workflow-nodes/claude-code/manifest.ts`: node metadata and MCP-facing field list.
- Create `desktop/workflow-nodes/claude-code/card.tsx`: compact editor/runner node card.
- Create `desktop/workflow-nodes/claude-code/panel.tsx`: configuration panel using existing Workflow UI components.
- Create `desktop/workflow-nodes/claude-code/index.ts`: main registration exports.
- Create tests under `desktop/workflow-nodes/claude-code/__tests__/`.
- Modify `desktop/workflow-nodes/register.main.ts`, `register.renderer.ts`, and `panel-registry.ts`.
- Modify `desktop/src/modules/workflow/editor/node-wrappers.tsx` and `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`.
- Modify `desktop/electron/services/workflow/workflow-validator.ts`.
- Modify `desktop/electron/services/workflow/run-snapshot-sanitize.ts`.
- Modify `desktop/src/modules/workflow/runner/node-result-panel.tsx` and `run-report.ts`.
- Modify workflow capability tests and descriptions in `desktop/synapse-capabilities/shared/workflow-domain.ts`.
- Modify `RELEASE_NOTES_PENDING.md`.

## Task 1: Schema, Command Builder, And Artifact Helpers

**Files:**
- Create: `desktop/workflow-nodes/claude-code/schema.ts`
- Create: `desktop/workflow-nodes/claude-code/command.ts`
- Create: `desktop/workflow-nodes/claude-code/artifacts.main.ts`
- Test: `desktop/workflow-nodes/claude-code/__tests__/schema.test.ts`
- Test: `desktop/workflow-nodes/claude-code/__tests__/command.test.ts`
- Test: `desktop/workflow-nodes/claude-code/__tests__/artifacts.test.ts`

- [ ] **Step 1: Write schema tests**

Create `desktop/workflow-nodes/claude-code/__tests__/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { claudeCodeNodeConfigSchema, defaultClaudeCodeNodeConfig } from "../schema"

describe("claudeCodeNodeConfigSchema", () => {
  it("keeps unattended local CLI defaults", () => {
    expect(defaultClaudeCodeNodeConfig).toEqual({
      variables: [],
      prompt: "",
      permissionMode: "acceptEdits",
      outputFormat: "stream-json",
      verbose: true,
      safeMode: false,
      bareMode: false,
      noSessionPersistence: false,
      settingSources: ["user", "project", "local"],
      strictMcpConfig: false,
      additionalDirectories: [],
      allowedTools: [],
      disallowedTools: [],
      captureDebugArtifacts: true,
    })
  })

  it("trims optional strings and list values", () => {
    const parsed = claudeCodeNodeConfigSchema.parse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "  Run tests  ",
      model: "  sonnet  ",
      workingDirectory: "  packages/app  ",
      settingsPath: "  .claude/settings.json  ",
      mcpConfigPath: "  mcp.json  ",
      additionalDirectories: ["  ../lib  "],
      allowedTools: ["  Read  "],
      disallowedTools: ["  Bash(rm *)  "],
    })

    expect(parsed.prompt).toBe("Run tests")
    expect(parsed.model).toBe("sonnet")
    expect(parsed.workingDirectory).toBe("packages/app")
    expect(parsed.settingsPath).toBe(".claude/settings.json")
    expect(parsed.mcpConfigPath).toBe("mcp.json")
    expect(parsed.additionalDirectories).toEqual(["../lib"])
    expect(parsed.allowedTools).toEqual(["Read"])
    expect(parsed.disallowedTools).toEqual(["Bash(rm *)"])
  })

  it("rejects empty prompt, invalid numbers, and duplicate setting sources", () => {
    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: " ",
    }).success).toBe(false)

    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run",
      timeoutMins: 0,
    }).success).toBe(false)

    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run",
      maxTurns: 0,
    }).success).toBe(false)

    expect(claudeCodeNodeConfigSchema.safeParse({
      ...defaultClaudeCodeNodeConfig,
      prompt: "Run",
      settingSources: ["user", "user"],
    }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run schema tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/claude-code/__tests__/schema.test.ts
```

Expected: fail because `../schema` does not exist.

- [ ] **Step 3: Implement schema**

Create `desktop/workflow-nodes/claude-code/schema.ts`:

```ts
import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const claudeCodePermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
])
export const claudeCodeOutputFormatSchema = z.enum(["text", "json", "stream-json"])
export const claudeCodeSettingSourceSchema = z.enum(["user", "project", "local"])

const nonEmptyTrimmedStringSchema = z.string().transform((value) => value.trim()).pipe(z.string().min(1))
const optionalTrimmedStringSchema = z
  .string()
  .transform((value) => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  })
  .optional()

export const claudeCodeNodeConfigSchema = z
  .object({
    variables: z.array(variableBindingSchema),
    prompt: z.string().trim().min(1, "指令不能为空"),
    projectId: z.string().optional(),
    workingDirectory: optionalTrimmedStringSchema,
    timeoutMins: z.number().int().min(1).optional(),
    permissionMode: claudeCodePermissionModeSchema,
    model: optionalTrimmedStringSchema,
    maxTurns: z.number().int().min(1).optional(),
    outputFormat: claudeCodeOutputFormatSchema,
    verbose: z.boolean(),
    safeMode: z.boolean(),
    bareMode: z.boolean(),
    noSessionPersistence: z.boolean(),
    settingSources: z.array(claudeCodeSettingSourceSchema),
    settingsPath: optionalTrimmedStringSchema,
    mcpConfigPath: optionalTrimmedStringSchema,
    strictMcpConfig: z.boolean(),
    additionalDirectories: z.array(nonEmptyTrimmedStringSchema),
    allowedTools: z.array(nonEmptyTrimmedStringSchema),
    disallowedTools: z.array(nonEmptyTrimmedStringSchema),
    captureDebugArtifacts: z.boolean(),
  })
  .superRefine((config, ctx) => {
    const seenSources = new Set<string>()
    config.settingSources.forEach((source, index) => {
      if (seenSources.has(source)) {
        ctx.addIssue({
          code: "custom",
          path: ["settingSources", index],
          message: "设置来源不能重复",
        })
      }
      seenSources.add(source)
    })
  })

export type ClaudeCodeNodeConfig = z.infer<typeof claudeCodeNodeConfigSchema>
export type ClaudeCodePermissionMode = z.infer<typeof claudeCodePermissionModeSchema>
export type ClaudeCodeOutputFormat = z.infer<typeof claudeCodeOutputFormatSchema>
export type ClaudeCodeSettingSource = z.infer<typeof claudeCodeSettingSourceSchema>

export const defaultClaudeCodeNodeConfig: ClaudeCodeNodeConfig = {
  variables: [],
  prompt: "",
  permissionMode: "acceptEdits",
  outputFormat: "stream-json",
  verbose: true,
  safeMode: false,
  bareMode: false,
  noSessionPersistence: false,
  settingSources: ["user", "project", "local"],
  strictMcpConfig: false,
  additionalDirectories: [],
  allowedTools: [],
  disallowedTools: [],
  captureDebugArtifacts: true,
}
```

- [ ] **Step 4: Write command builder tests**

Create `desktop/workflow-nodes/claude-code/__tests__/command.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildClaudeCodePrintRequest, sanitizeClaudeCodeArgsForDebug } from "../command"
import { defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "../schema"

function request(config: Partial<ClaudeCodeNodeConfig> = {}) {
  const abortSignal = new AbortController().signal
  return buildClaudeCodePrintRequest({
    config: { ...defaultClaudeCodeNodeConfig, prompt: "Run", ...config },
    prompt: "Write a summary",
    cwd: "/Users/liyang/project",
    abortSignal,
    timeoutMs: 60_000,
    actor: { kind: "system", id: "workflow-engine" },
    metadata: { source: "workflow", actionType: "workflow.claude_code" },
  })
}

describe("buildClaudeCodePrintRequest", () => {
  it("builds default claude print request from merged PATH", () => {
    const built = request()

    expect(built).toMatchObject({
      actor: { kind: "system", id: "workflow-engine" },
      action: "shell.exec",
      command: "claude",
      cwd: "/Users/liyang/project",
      timeoutMs: 60_000,
      pathStrategy: "merge",
      output: { stdout: "ignore", stderr: "ignore" },
      metadata: { source: "workflow", actionType: "workflow.claude_code" },
    })
    expect(built.args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--setting-sources",
      "user,project,local",
      "Write a summary",
    ])
  })

  it("maps optional Claude Code flags", () => {
    const built = request({
      model: "sonnet",
      maxTurns: 3,
      outputFormat: "json",
      verbose: false,
      safeMode: true,
      bareMode: true,
      noSessionPersistence: true,
      settingSources: ["user"],
      settingsPath: "/Users/liyang/project/.claude/settings.json",
      mcpConfigPath: "/Users/liyang/project/mcp.json",
      strictMcpConfig: true,
      additionalDirectories: ["/Users/liyang/lib"],
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash(rm *)"],
    })

    expect(built.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "sonnet",
      "--max-turns",
      "3",
      "--safe-mode",
      "--bare",
      "--no-session-persistence",
      "--setting-sources",
      "user",
      "--settings",
      "/Users/liyang/project/.claude/settings.json",
      "--mcp-config",
      "/Users/liyang/project/mcp.json",
      "--strict-mcp-config",
      "--add-dir",
      "/Users/liyang/lib",
      "--allowedTools",
      "Read",
      "--allowedTools",
      "Edit",
      "--disallowedTools",
      "Bash(rm *)",
      "Write a summary",
    ])
  })

  it("redacts prompt and secret-looking argv values for debug", () => {
    const built = request({
      settingsPath: "/Users/liyang/project/settings.json?token=sk-secret",
      allowedTools: ["Authorization=Bearer secret"],
    })

    expect(sanitizeClaudeCodeArgsForDebug(built.args ?? [], "Write a summary")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--setting-sources",
      "user,project,local",
      "[prompt]",
    ])
  })
})
```

- [ ] **Step 5: Run command tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/claude-code/__tests__/command.test.ts
```

Expected: fail because `../command` does not exist.

- [ ] **Step 6: Implement command builder**

Create `desktop/workflow-nodes/claude-code/command.ts`:

```ts
import type { ControlledProcessLineHandler, ControlledProcessRunRequest } from "../../electron/runtime/process"
import type { ActorIdentity } from "../../electron/runtime/security"
import { sanitizeError } from "../../electron/services/error-sanitize"
import type { ClaudeCodeNodeConfig } from "./schema"

export interface BuildClaudeCodePrintRequestInput {
  readonly config: ClaudeCodeNodeConfig
  readonly prompt: string
  readonly cwd: string
  readonly actor: ActorIdentity
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly onStdoutLine?: ControlledProcessLineHandler
  readonly onStderrLine?: ControlledProcessLineHandler
  readonly metadata?: Record<string, unknown>
}

export function buildClaudeCodePrintRequest(input: BuildClaudeCodePrintRequestInput): ControlledProcessRunRequest {
  return {
    actor: input.actor,
    action: "shell.exec",
    command: "claude",
    args: buildClaudeCodePrintArgs(input.config, input.prompt),
    cwd: input.cwd,
    pathStrategy: "merge",
    output: { stdout: "ignore", stderr: "ignore" },
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
    ...(input.onStdoutLine === undefined ? {} : { onStdoutLine: input.onStdoutLine }),
    ...(input.onStderrLine === undefined ? {} : { onStderrLine: input.onStderrLine }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  }
}

export function buildClaudeCodePrintArgs(config: ClaudeCodeNodeConfig, prompt: string): string[] {
  const args = [
    "-p",
    "--output-format",
    config.outputFormat,
  ]

  if (config.verbose) args.push("--verbose")
  args.push("--permission-mode", config.permissionMode)

  if (config.model) args.push("--model", config.model)
  if (config.maxTurns !== undefined) args.push("--max-turns", String(config.maxTurns))
  if (config.safeMode) args.push("--safe-mode")
  if (config.bareMode) args.push("--bare")
  if (config.noSessionPersistence) args.push("--no-session-persistence")
  if (config.settingSources.length > 0) args.push("--setting-sources", config.settingSources.join(","))
  if (config.settingsPath) args.push("--settings", config.settingsPath)
  if (config.mcpConfigPath) args.push("--mcp-config", config.mcpConfigPath)
  if (config.strictMcpConfig) args.push("--strict-mcp-config")

  for (const dir of config.additionalDirectories) args.push("--add-dir", dir)
  for (const rule of config.allowedTools) args.push("--allowedTools", rule)
  for (const rule of config.disallowedTools) args.push("--disallowedTools", rule)

  args.push(prompt)
  return args
}

export function sanitizeClaudeCodeArgsForDebug(args: readonly string[], prompt: string): string[] {
  return args.map((arg) => arg === prompt ? "[prompt]" : sanitizeError(arg))
}
```

- [ ] **Step 7: Write artifact helper tests**

Create `desktop/workflow-nodes/claude-code/__tests__/artifacts.test.ts`:

```ts
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildClaudeCodeDebugOutput,
  claudeCodeArtifactPaths,
  finalOutputFromClaudeCodeResult,
} from "../artifacts.main"

describe("claude code artifacts", () => {
  it("creates safe per-node artifact paths", () => {
    const paths = claudeCodeArtifactPaths("/tmp/synapse", "run-1", "node-1")

    expect(paths.directory).toBe(path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "claude-code"))
    expect(paths.promptPath).toBe(path.join(paths.directory, "prompt.txt"))
    expect(paths.stdoutPath).toBe(path.join(paths.directory, "stdout.log"))
    expect(paths.stderrPath).toBe(path.join(paths.directory, "stderr.log"))
    expect(paths.lastMessagePath).toBe(path.join(paths.directory, "last-message.txt"))
  })

  it("extracts final output from stream-json, json, and text output", () => {
    const streamJson = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "draft" }] } }),
      JSON.stringify({ type: "result", subtype: "success", result: "final answer" }),
    ].join("\n")

    expect(finalOutputFromClaudeCodeResult(streamJson, "stream-json")).toBe("final answer")
    expect(finalOutputFromClaudeCodeResult(JSON.stringify({ result: "json answer" }), "json")).toBe("json answer")
    expect(finalOutputFromClaudeCodeResult("plain answer\n", "text")).toBe("plain answer")
  })

  it("redacts previews and keeps ordinary paths", () => {
    const debug = buildClaudeCodeDebugOutput({
      args: ["-p", "[prompt]"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 12,
      stdout: "Authorization: Bearer sk-secret\npath=/Users/liyang/project/file.ts",
      stderr: "COOKIE=session-secret",
    })

    expect(debug.stdoutPreview).toContain("[redacted]")
    expect(debug.stdoutPreview).toContain("/Users/liyang/project/file.ts")
    expect(debug.stderrPreview).toContain("[redacted]")
    expect(debug.cwd).toBe("/Users/liyang/project")
  })
})
```

- [ ] **Step 8: Run artifact tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/claude-code/__tests__/artifacts.test.ts
```

Expected: fail because `../artifacts.main` does not exist.

- [ ] **Step 9: Implement artifact helpers**

Create `desktop/workflow-nodes/claude-code/artifacts.main.ts` by adapting the Codex artifact helper with Claude Code names. Include these exported functions and interfaces exactly:

```ts
export interface ClaudeCodeArtifactPaths {
  readonly directory: string
  readonly promptPath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly lastMessagePath: string
}

export interface ClaudeCodeNodeDebugOutput {
  readonly command: "claude -p"
  readonly args: string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal?: string
  readonly durationMs: number
  readonly stdoutPath?: string
  readonly stderrPath?: string
  readonly promptPath?: string
  readonly lastMessagePath?: string
  readonly stdoutPreview?: string
  readonly stderrPreview?: string
  readonly sessionHints?: string[]
}
```

Implement `claudeCodeArtifactPaths(baseDir, runId, nodeId)` using `assertSafeWorkflowId`, `assertSafeWorkflowNodeId`, and directory segment `"claude-code"`. Implement `ensureClaudeCodeArtifactDirectory`, `writeClaudeCodeArtifact`, and `readClaudeCodeArtifact` with the same redaction path preservation strategy as `desktop/workflow-nodes/codex/artifacts.main.ts`.

Implement `finalOutputFromClaudeCodeResult(stdout, outputFormat)` with this behavior:

```ts
export function finalOutputFromClaudeCodeResult(stdout: string | undefined, outputFormat: ClaudeCodeOutputFormat): string {
  const text = stdout?.trim()
  if (!text) return ""
  if (outputFormat === "text") return text
  if (outputFormat === "json") return finalOutputFromJson(text) ?? text
  return finalOutputFromStreamJson(text) ?? text
}
```

The JSON parsing helpers must read `result`, `message`, `content`, `text`, and nested `message.content[].text` strings. `buildClaudeCodeDebugOutput` must return `command: "claude -p"`, sanitized args, path-preserving previews, and `sessionHints` extracted only from structured stdout fields named `session_id`, `sessionId`, `transcript_path`, or `transcriptPath`.

- [ ] **Step 10: Run Task 1 tests to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/workflow-nodes/claude-code/__tests__/schema.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/command.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/artifacts.test.ts
```

Expected: all tests pass.

- [ ] **Step 11: Commit Task 1**

```bash
git add desktop/workflow-nodes/claude-code/schema.ts \
  desktop/workflow-nodes/claude-code/command.ts \
  desktop/workflow-nodes/claude-code/artifacts.main.ts \
  desktop/workflow-nodes/claude-code/__tests__/schema.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/command.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/artifacts.test.ts
git commit -m "feat(workflow): add claude code node core helpers"
```

## Task 2: Executor

**Files:**
- Create: `desktop/workflow-nodes/claude-code/executor.main.ts`
- Test: `desktop/workflow-nodes/claude-code/__tests__/executor.test.ts`

- [ ] **Step 1: Write executor tests**

Create `desktop/workflow-nodes/claude-code/__tests__/executor.test.ts` by adapting the Codex executor test harness. Include these cases:

```ts
it("fails when process runner is missing", async () => {
  const result = await claudeCodeNodeExecutor.execute(makeInput({}, {
    resolveProjectWorkspacePath: vi.fn(),
  } as unknown as NodeRuntimeDeps))
  expect(result).toMatchObject({ status: "failed", error: "Claude Code 执行能力不可用" })
})

it("resolves project id to cwd and does not call sendToAgent", async () => {
  const runtimeDeps = makeRuntimeDeps()
  const input = makeInput({}, runtimeDeps)
  const result = await claudeCodeNodeExecutor.execute(input)
  expect(result.status).toBe("success")
  expect(result.output).toBe("final answer")
  expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
  expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
    command: "claude",
    cwd: projectWorkspacePath,
    args: expect.arrayContaining(["-p", "--permission-mode", "acceptEdits"]),
    metadata: expect.objectContaining({
      source: "workflow",
      actionType: "workflow.claude_code",
      workflowId: "wf-1",
      workflowRunId: "run-1",
      workflowNodeId: "node-1",
    }),
  }))
})

it("uses interpolated workingDirectory as process cwd", async () => {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-workdir-"))
  const runtimeDeps = makeRuntimeDeps()
  const input = makeInput({ workingDirectory: "{{targetDir}}" }, runtimeDeps)
  input.resolvedVariables = { ...input.resolvedVariables, targetDir }
  const result = await claudeCodeNodeExecutor.execute(input)
  expect(result.status).toBe("success")
  expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({ cwd: targetDir }))
})

it("resolves additional directories and config files before spawning", async () => {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-paths-"))
  const extraDir = path.join(targetDir, "extra")
  const settingsPath = path.join(targetDir, "settings.json")
  const mcpConfigPath = path.join(targetDir, "mcp.json")
  await mkdir(extraDir)
  await writeFile(settingsPath, "{}", "utf8")
  await writeFile(mcpConfigPath, "{}", "utf8")
  const runtimeDeps = makeRuntimeDeps()
  const result = await claudeCodeNodeExecutor.execute(makeInput({
    workingDirectory: targetDir,
    additionalDirectories: ["./extra"],
    settingsPath: "./settings.json",
    mcpConfigPath: "{{mcpConfigPath}}",
  }, runtimeDeps, { mcpConfigPath }))
  expect(result.status).toBe("success")
  expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
    args: expect.arrayContaining(["--add-dir", extraDir, "--settings", settingsPath, "--mcp-config", mcpConfigPath]),
  }))
})

it("normalizes missing CLI errors", async () => {
  const runtimeDeps = makeRuntimeDeps({
    processRunner: { run: vi.fn().mockRejectedValue(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })) },
  })
  const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))
  expect(result).toMatchObject({ status: "failed", error: "未找到 Claude Code CLI" })
})

it("returns sanitized debug output for non-zero exits", async () => {
  const runtimeDeps = makeRuntimeDeps({
    processRunner: {
      run: vi.fn().mockResolvedValue({
        exitCode: 1,
        signal: null,
        timedOut: false,
        durationMs: 10,
        stdout: "Authorization: Bearer sk-secret",
        stderr: "not authenticated",
      }),
    },
  })
  const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))
  expect(result.status).toBe("failed")
  expect(result.outputs?.claudeCodeDebug).toBeDefined()
  expect(JSON.stringify(result.outputs)).not.toContain("sk-secret")
})
```

Use helper functions equivalent to the Codex executor test: mock `electron.app.getPath`, mock logger, create `makeRuntimeDeps`, `makeInput`, `context`, and a fake `processRunner.run` that returns stream-json stdout containing `{"type":"result","subtype":"success","result":"final answer"}`.

- [ ] **Step 2: Run executor tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/claude-code/__tests__/executor.test.ts
```

Expected: fail because `../executor.main` does not exist.

- [ ] **Step 3: Implement executor**

Create `desktop/workflow-nodes/claude-code/executor.main.ts` by adapting `desktop/workflow-nodes/codex/executor.main.ts` with these required differences:

```ts
const logger = createMainLogger("workflow.node.claude-code-executor")
const MISSING_CLAUDE_CODE_CLI_ERROR = "未找到 Claude Code CLI"
```

Use errors:

```ts
"Claude Code 执行能力不可用"
"Claude Code 节点缺少项目"
"Claude Code 项目路径解析能力不可用"
"Claude Code 节点项目不存在"
"Claude Code 工作目录不能为空"
"Claude Code 工作目录不存在"
"Claude Code 工作目录不是文件夹"
"Claude Code 执行超时"
```

Call `buildClaudeCodePrintRequest` with metadata:

```ts
metadata: {
  source: "workflow",
  actionType: "workflow.claude_code",
  workflowId: context.workflowId,
  workflowRunId: context.runId,
  workflowNodeId: context.nodeId,
  workflowNodeName: context.nodeName,
}
```

Use `finalOutputFromClaudeCodeResult(stdout, requestConfig.outputFormat)` for successful output. Use `claudeCodeArtifactPaths(app.getPath("userData"), context.runId, context.nodeId ?? "unknown-node")` for artifacts. Stream capture can mirror Codex's `CodexStreamCapture`, renamed to `ClaudeCodeStreamCapture`, with the same limits and redaction.

Implement missing CLI detection:

```ts
function isMissingClaudeCodeCliError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code).toUpperCase()
    : undefined
  if (code === "ENOENT") return true
  const message = error instanceof Error ? error.message : (typeof error === "string" ? error : undefined)
  return Boolean(message && (
    /\bENOENT\b/iu.test(message)
    || /spawn\s+claude/iu.test(message)
    || /claude.*(?:command not found|not found|not recognized|no such file)/iu.test(message)
    || /(?:command not found|not found|not recognized|no such file).*claude/iu.test(message)
  ))
}
```

- [ ] **Step 4: Run executor tests to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/claude-code/__tests__/executor.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add desktop/workflow-nodes/claude-code/executor.main.ts desktop/workflow-nodes/claude-code/__tests__/executor.test.ts
git commit -m "feat(workflow): run local claude code cli"
```

## Task 3: Manifest, Card, Panel, And Renderer Tests

**Files:**
- Create: `desktop/workflow-nodes/claude-code/manifest.ts`
- Create: `desktop/workflow-nodes/claude-code/card.tsx`
- Create: `desktop/workflow-nodes/claude-code/panel.tsx`
- Create: `desktop/workflow-nodes/claude-code/index.ts`
- Test: `desktop/workflow-nodes/claude-code/__tests__/panel.test.tsx`
- Test: `desktop/workflow-nodes/claude-code/__tests__/card.test.tsx`

- [ ] **Step 1: Write panel and card tests**

Create `desktop/workflow-nodes/claude-code/__tests__/panel.test.tsx` with SSR or DOM tests matching Codex panel style:

```ts
it("renders Claude Code execution controls", () => {
  const html = renderToStaticMarkup(
    <ClaudeCodeNodePanel
      config={{ ...defaultClaudeCodeNodeConfig, prompt: "Run tests" }}
      onChange={vi.fn()}
      upstreamNodes={[]}
      workflowParams={[]}
      projects={[]}
      validationItems={[]}
    />,
  )
  expect(html).toContain("执行配置")
  expect(html).toContain("Permission mode")
  expect(html).toContain("模型")
  expect(html).toContain("Max turns")
  expect(html).toContain("Claude Code 配置")
  expect(html).toContain("权限规则")
  expect(html).toContain("调试记录")
})

it("updates model and permission mode", () => {
  const onChange = vi.fn()
  render(
    <ClaudeCodeNodePanel
      config={{ ...defaultClaudeCodeNodeConfig, prompt: "Run tests" }}
      onChange={onChange}
      upstreamNodes={[]}
      workflowParams={[]}
      projects={[]}
      validationItems={[]}
    />,
  )
  fireEvent.change(screen.getByLabelText("模型"), { target: { value: "sonnet" } })
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: "sonnet" }))
})
```

Create `desktop/workflow-nodes/claude-code/__tests__/card.test.tsx`:

```ts
it("renders permission mode and prompt summary", () => {
  const html = renderToStaticMarkup(
    <ClaudeCodeNodeCard
      config={{ ...defaultClaudeCodeNodeConfig, prompt: "Review this change", permissionMode: "plan" }}
      nodeId="claude-1"
    />,
  )
  expect(html).toContain("Claude Code")
  expect(html).toContain("plan")
  expect(html).toContain("Review this change")
})
```

- [ ] **Step 2: Run renderer tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/workflow-nodes/claude-code/__tests__/panel.test.tsx \
  desktop/workflow-nodes/claude-code/__tests__/card.test.tsx
```

Expected: fail because panel and card files do not exist.

- [ ] **Step 3: Implement manifest and index**

Create `desktop/workflow-nodes/claude-code/manifest.ts`:

```ts
import { Bot } from "lucide-react"
import type { NodeManifest } from "../types"
import { claudeCodeNodeConfigSchema, defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "./schema"

export const claudeCodeNodeManifest: NodeManifest<ClaudeCodeNodeConfig> = {
  type: "claude_code",
  title: "Claude Code",
  icon: Bot,
  color: "bg-primary/10",
  defaultConfig: defaultClaudeCodeNodeConfig,
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "Claude Code",
    subtitle: config.prompt.slice(0, 60) || "未编写指令",
  }),
  configFields: [
    { name: "permissionMode", kind: "select", label: "权限模式" },
    { name: "model", kind: "text", label: "模型", optional: true },
    { name: "maxTurns", kind: "number", label: "最大轮数", optional: true },
    { name: "outputFormat", kind: "select", label: "输出格式" },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "workingDirectory", kind: "text", label: "工作目录", optional: true },
    { name: "safeMode", kind: "select", label: "Safe mode", optional: true },
    { name: "bareMode", kind: "select", label: "Bare mode", optional: true },
    { name: "noSessionPersistence", kind: "select", label: "不保存会话", optional: true },
    { name: "settingSources", kind: "record", label: "设置来源", optional: true },
    { name: "settingsPath", kind: "text", label: "Settings 路径", optional: true },
    { name: "mcpConfigPath", kind: "text", label: "MCP 配置路径", optional: true },
    { name: "strictMcpConfig", kind: "select", label: "严格 MCP 配置", optional: true },
    { name: "additionalDirectories", kind: "record", label: "额外目录", optional: true },
    { name: "allowedTools", kind: "record", label: "允许工具", optional: true },
    { name: "disallowedTools", kind: "record", label: "禁用工具", optional: true },
    { name: "captureDebugArtifacts", kind: "select", label: "保存调试文件", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "指令" },
  ],
  configSchema: claudeCodeNodeConfigSchema,
}
```

Create `desktop/workflow-nodes/claude-code/index.ts`:

```ts
export { claudeCodeNodeManifest } from "./manifest"
export { claudeCodeNodeExecutor } from "./executor.main"
export type { ClaudeCodeNodeConfig } from "./schema"
```

- [ ] **Step 4: Implement card**

Create `desktop/workflow-nodes/claude-code/card.tsx` with this structure:

```tsx
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { cn } from "@/lib/utils"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { claudeCodeNodeManifest } from "./manifest"
import type { ClaudeCodeNodeConfig } from "./schema"

export function ClaudeCodeNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: ClaudeCodeNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = claudeCodeNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "Claude Code"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{timer}</span> : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-muted-foreground">{config.permissionMode}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">
            {config.prompt ? config.prompt.slice(0, 60) : "未编写指令"}
          </p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
```

- [ ] **Step 5: Implement panel**

Create `desktop/workflow-nodes/claude-code/panel.tsx` as a focused form component that exports:

```ts
export interface ClaudeCodeNodePanelProps {
  config: ClaudeCodeNodeConfig
  onChange: (config: ClaudeCodeNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

export function ClaudeCodeNodePanel(props: ClaudeCodeNodePanelProps) {
  // Use updateConfig(patch) to call props.onChange({ ...props.config, ...patch }).
}
```

Reuse these existing components:

```ts
import { CollapsibleSection } from "../collapsible-section"
import { ProjectSelect } from "../project-select"
import { PromptEditor } from "../prompt-editor"
import { VariableBindingEditor } from "../variable-binding-editor"
```

Expose these controls with existing shadcn components:

- `ProjectSelect` for `projectId`
- `PromptEditor` for `prompt`
- `Select` for `permissionMode` and `outputFormat`
- `Input` for `model`, `workingDirectory`, `timeoutMins`, `maxTurns`, `settingsPath`, `mcpConfigPath`
- `Checkbox` for `verbose`, `safeMode`, `bareMode`, `noSessionPersistence`, `strictMcpConfig`, `captureDebugArtifacts`
- A local `StringListEditor` helper with add, update, and remove buttons for `additionalDirectories`, `allowedTools`, and `disallowedTools`
- Checkbox group for `settingSources` with `user`, `project`, `local`

Keep labels concise and avoid implementation explanation paragraphs. The component must not use inline styles, custom colors, or card nesting.

- [ ] **Step 6: Run renderer tests to verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/workflow-nodes/claude-code/__tests__/panel.test.tsx \
  desktop/workflow-nodes/claude-code/__tests__/card.test.tsx
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add desktop/workflow-nodes/claude-code/manifest.ts \
  desktop/workflow-nodes/claude-code/card.tsx \
  desktop/workflow-nodes/claude-code/panel.tsx \
  desktop/workflow-nodes/claude-code/index.ts \
  desktop/workflow-nodes/claude-code/__tests__/panel.test.tsx \
  desktop/workflow-nodes/claude-code/__tests__/card.test.tsx
git commit -m "feat(workflow): add claude code node UI"
```

## Task 4: Workflow Registration, Validation, And Capability Surface

**Files:**
- Modify: `desktop/workflow-nodes/register.main.ts`
- Modify: `desktop/workflow-nodes/register.renderer.ts`
- Modify: `desktop/workflow-nodes/panel-registry.ts`
- Modify: `desktop/src/modules/workflow/editor/node-wrappers.tsx`
- Modify: `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Modify: `desktop/electron/services/workflow/run-snapshot-sanitize.ts`
- Modify: `desktop/electron/capabilities/__tests__/workflow-tools.test.ts`
- Modify: `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`
- Modify: `desktop/synapse-capabilities/shared/workflow-domain.ts`
- Test: `desktop/workflow-nodes/__tests__/registry.test.ts`
- Test: `desktop/electron/services/workflow/__tests__/workflow-validator.test.ts`
- Test: `desktop/electron/services/workflow/__tests__/run-snapshot-sanitize.test.ts`

- [ ] **Step 1: Update registry tests first**

Extend `desktop/workflow-nodes/__tests__/registry.test.ts`:

```ts
it("registers claude code manifest in renderer registry", async () => {
  await import("../register.renderer")
  const { nodeTypeRegistry } = await import("../registry")
  const manifest = nodeTypeRegistry.getManifest("claude_code")
  expect(manifest.title).toBe("Claude Code")
  expect(manifest.type).toBe("claude_code")
})

it("registers claude code manifest and executor in main registry", async () => {
  vi.doMock("electron", () => ({
    app: { getPath: () => "/tmp", getAppPath: () => "/tmp" },
  }))
  vi.doMock("../../electron/services/log-store", () => ({
    createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }))
  await import("../register.main")
  const [{ nodeTypeRegistry }, { claudeCodeNodeExecutor }] = await Promise.all([
    import("../registry"),
    import("../claude-code/executor.main"),
  ])
  expect(nodeTypeRegistry.getManifest("claude_code").title).toBe("Claude Code")
  expect(nodeTypeRegistry.getExecutor("claude_code")).toBe(claudeCodeNodeExecutor)
})
```

- [ ] **Step 2: Run registry tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/workflow-nodes/__tests__/registry.test.ts
```

Expected: fail because the new node is not registered.

- [ ] **Step 3: Register node in main, renderer, panel, editor, and runner**

Modify `desktop/workflow-nodes/register.main.ts`:

```ts
import { claudeCodeNodeManifest, claudeCodeNodeExecutor } from "./claude-code"
nodeTypeRegistry.register(claudeCodeNodeManifest, claudeCodeNodeExecutor)
```

Modify `desktop/workflow-nodes/register.renderer.ts`:

```ts
import { claudeCodeNodeManifest } from "./claude-code/manifest"
nodeTypeRegistry.registerManifest(claudeCodeNodeManifest)
```

Modify `desktop/workflow-nodes/panel-registry.ts`:

```ts
import { ClaudeCodeNodePanel } from "./claude-code/panel"
["claude_code", ClaudeCodeNodePanel as unknown as PanelComponent],
```

Modify editor and runner wrapper maps by importing `ClaudeCodeNodeCard` and `ClaudeCodeNodeConfig`, adding `ClaudeCodeNodeWrapper` and `RunnerClaudeCodeNodeWrapper`, and mapping:

```ts
claude_code: ClaudeCodeNodeWrapper
claude_code: RunnerClaudeCodeNodeWrapper
```

- [ ] **Step 4: Update validator tests**

Extend `desktop/electron/services/workflow/__tests__/workflow-validator.test.ts` with cases matching Codex:

```ts
it("requires a project for claude code nodes when workflow default is missing", () => {
  const result = validateWorkflow({
    ...baseWorkflow(),
    defaultProjectId: undefined,
    nodes: [claudeCodeNode(), endNode()],
    edges: [{ id: "edge-1", from: "claude-code-1", to: "end" }],
  })
  expect(result.errors).toEqual(expect.arrayContaining([
    expect.objectContaining({ nodeId: "claude-code-1", field: "defaultProjectId" }),
  ]))
})

it("checks template placeholders inside claude code prompts and paths", () => {
  const result = validateWorkflow({
    ...baseWorkflow(),
    nodes: [
      claudeCodeNode({
        prompt: "Use {{missingVar}}",
        workingDirectory: "{{missingDir}}",
        additionalDirectories: ["{{missingExtra}}"],
      }),
      endNode(),
    ],
    edges: [{ id: "edge-1", from: "claude-code-1", to: "end" }],
  })
  expect(result.errors.map((error) => error.nodeId)).toContain("claude-code-1")
})
```

Add helper:

```ts
function claudeCodeNode(config: Partial<typeof defaultClaudeCodeNodeConfig> = {}): WorkflowDefinition["nodes"][number] {
  return {
    id: "claude-code-1",
    name: "Claude Code",
    type: "claude_code",
    position: { x: 0, y: 0 },
    config: { ...defaultClaudeCodeNodeConfig, prompt: "Run Claude Code", ...config },
  }
}
```

- [ ] **Step 5: Implement validator support**

Modify `desktop/electron/services/workflow/workflow-validator.ts`:

- Include `node.type === "claude_code"` anywhere Codex gets project-only validation.
- Include `claude_code` in `collectTemplateTexts`.
- For `claude_code`, collect `prompt`, `workingDirectory`, `settingsPath`, `mcpConfigPath`, and `additionalDirectories`.
- Check configured project ids for `claude_code` the same way as Codex.

- [ ] **Step 6: Update snapshot sanitizer tests and implementation**

Extend `desktop/electron/services/workflow/__tests__/run-snapshot-sanitize.test.ts` with a `claudeCodeDebug` case that preserves `cwd`, `stdoutPath`, `stderrPath`, `promptPath`, and `lastMessagePath` while redacting `Authorization`, `Bearer`, `Cookie`, and env secrets from previews.

Modify `desktop/electron/services/workflow/run-snapshot-sanitize.ts`:

```ts
const DEBUG_PATH_KEYS = new Set(["cwd", "stdoutPath", "stderrPath", "promptPath", "lastMessagePath"])
```

Use `DEBUG_PATH_KEYS` instead of `CODEX_DEBUG_PATH_KEYS` so both `codexDebug` and `claudeCodeDebug` keep useful paths. Add config sanitization for `claude_code` if future config fields can contain secrets; initial implementation can rely on `sanitizeSnapshotValue` for `settingsPath`, `mcpConfigPath`, and tool lists.

- [ ] **Step 7: Update Workflow MCP/capability tests and descriptions**

Modify `desktop/electron/capabilities/__tests__/workflow-tools.test.ts` so node type descriptions include `claude_code`, and config field descriptions include:

```ts
expect(configDescription).toContain("claude_code")
expect(configDescription).toContain("permissionMode")
expect(configDescription).toContain("settingSources")
expect(configProperties).toHaveProperty("permissionMode")
expect(configProperties).toHaveProperty("additionalDirectories")
expect(configProperties).toHaveProperty("captureDebugArtifacts")
```

Update `desktop/synapse-capabilities/shared/workflow-domain.ts` to mention `claude_code` alongside existing node types and include the new config properties in the broad node config schema.

- [ ] **Step 8: Run integration tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/workflow-nodes/__tests__/registry.test.ts \
  desktop/electron/services/workflow/__tests__/workflow-validator.test.ts \
  desktop/electron/services/workflow/__tests__/run-snapshot-sanitize.test.ts \
  desktop/electron/capabilities/__tests__/workflow-tools.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 4**

```bash
git add desktop/workflow-nodes/register.main.ts \
  desktop/workflow-nodes/register.renderer.ts \
  desktop/workflow-nodes/panel-registry.ts \
  desktop/src/modules/workflow/editor/node-wrappers.tsx \
  desktop/src/modules/workflow/runner/runner-node-wrappers.tsx \
  desktop/electron/services/workflow/workflow-validator.ts \
  desktop/electron/services/workflow/run-snapshot-sanitize.ts \
  desktop/workflow-nodes/__tests__/registry.test.ts \
  desktop/electron/services/workflow/__tests__/workflow-validator.test.ts \
  desktop/electron/services/workflow/__tests__/run-snapshot-sanitize.test.ts \
  desktop/electron/capabilities/__tests__/workflow-tools.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts \
  desktop/synapse-capabilities/shared/workflow-domain.ts
git commit -m "feat(workflow): register claude code node"
```

## Task 5: Runner Display, Reports, Release Notes, And Verification

**Files:**
- Modify: `desktop/src/modules/workflow/runner/node-result-panel.tsx`
- Modify: `desktop/src/modules/workflow/runner/run-report.ts`
- Modify: `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts`
- Modify: `desktop/electron/services/workflow/__tests__/workflow-engine.test.ts`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Write runner display tests**

Extend `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx` with:

```ts
it("renders sanitized claude code debug output", async () => {
  renderNodeResultPanel({
    outputs: {
      claudeCodeDebug: {
        command: "claude -p",
        args: ["-p", "[prompt]"],
        cwd: "/Users/liyang/project",
        exitCode: 0,
        durationMs: 12,
        stdoutPath: "/Users/liyang/Library/Application Support/Synapse/workflow-runs/run-1/nodes/claude-code-1/claude-code/stdout.log",
        stdoutPreview: "Authorization: Bearer [redacted]\n/path=/Users/liyang/project/file.ts",
      },
    },
  })
  const renderedText = document.body.textContent ?? ""
  expect(renderedText).toContain("Claude Code 调试")
  expect(renderedText).toContain("claude -p")
  expect(renderedText).toContain("/Users/liyang/project")
  expect(renderedText).not.toContain("Bearer sk-")
  expect(renderedText).not.toContain("claudeCodeDebug")
})
```

Extend `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts` with a report case that includes a `claude_code` node and asserts the report contains `claude -p`, debug artifact paths, and no raw secret.

- [ ] **Step 2: Run runner tests to verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx \
  desktop/src/modules/workflow/runner/__tests__/run-report.test.ts
```

Expected: fail because runner only treats `codexDebug` specially.

- [ ] **Step 3: Implement runner display and report support**

Modify `desktop/src/modules/workflow/runner/node-result-panel.tsx`:

- Read `claudeCodeDebug` from `displayStructuredOutputs`.
- Omit both `codexDebug` and `claudeCodeDebug` from generic structured output.
- Add a section title `Claude Code 调试`.
- Generalize `renderCodexDebugFields` to `renderCliDebugFields` and reuse it for both debug objects.

Modify `desktop/src/modules/workflow/runner/run-report.ts`:

- Ensure `resolveReportStructuredOutputs` omits neither debug object from reports.
- Extend `sanitizeNodeConfigForReport` only if needed for `claude_code`; use generic sanitization for current fields.
- Add `claude_code` prompt handling in `resolveNodeMainContent`:

```ts
if ((node.type === "prompt" || node.type === "switch" || node.type === "claude_code") && result.input.prompt) {
  return { title: node.type === "switch" ? "判断 Prompt" : "完整 Prompt", language: "text", content: sanitizeWorkflowResultText(result.input.prompt) }
}
```

- [ ] **Step 4: Add workflow engine regression test**

Extend `desktop/electron/services/workflow/__tests__/workflow-engine.test.ts` with a test matching the Codex output preservation case:

```ts
it("passes claude code final output to downstream node bindings", async () => {
  const claudeExecutor: NodeExecutor<ClaudeCodeNodeConfig> = {
    execute: vi.fn(async () => ({
      status: "success",
      output: "claude done",
      outputs: { claudeCodeDebug: { command: "claude -p", args: ["-p", "[prompt]"], cwd: "/tmp", exitCode: 0, durationMs: 1 } },
      durationMs: 1,
    })),
  }
  nodeTypeRegistry.register(claudeCodeNodeManifest, claudeExecutor)
  const result = await runWorkflowDefinition({
    ...definition,
    nodes: [
      { id: "claude-code-1", name: "Claude Code", type: "claude_code", position: { x: 0, y: 0 }, config: { ...defaultClaudeCodeNodeConfig, prompt: "Run" } },
      { id: "end", name: "End", type: "end", position: { x: 200, y: 0 }, config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "claude-code-1" } }] } },
    ],
    edges: [{ id: "edge-1", from: "claude-code-1", to: "end" }],
  })
  expect(result.nodeResults.end.output).toBe("claude done")
})
```

Use existing workflow engine test helpers and imports rather than adding a new runner.

- [ ] **Step 5: Update release notes**

Append to `RELEASE_NOTES_PENDING.md`:

```text
工作流新增 Claude Code 节点，可以调用用户本机终端里的 Claude Code CLI，并在运行历史中保留调试记录。
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/workflow-nodes/claude-code/__tests__/schema.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/command.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/artifacts.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/executor.test.ts \
  desktop/workflow-nodes/claude-code/__tests__/panel.test.tsx \
  desktop/workflow-nodes/claude-code/__tests__/card.test.tsx \
  desktop/workflow-nodes/__tests__/registry.test.ts \
  desktop/electron/services/workflow/__tests__/workflow-validator.test.ts \
  desktop/electron/services/workflow/__tests__/run-snapshot-sanitize.test.ts \
  desktop/electron/services/workflow/__tests__/workflow-engine.test.ts \
  desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx \
  desktop/src/modules/workflow/runner/__tests__/run-report.test.ts \
  desktop/electron/capabilities/__tests__/workflow-tools.test.ts \
  desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: all tests and hard-constraints pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add desktop/src/modules/workflow/runner/node-result-panel.tsx \
  desktop/src/modules/workflow/runner/run-report.ts \
  desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx \
  desktop/src/modules/workflow/runner/__tests__/run-report.test.ts \
  desktop/electron/services/workflow/__tests__/workflow-engine.test.ts \
  RELEASE_NOTES_PENDING.md
git commit -m "feat(workflow): show claude code run details"
```

## Self-Review

- Spec coverage: The plan covers local `claude -p` execution, PATH merge, no Synapse bundled runtime, no AgentRuntimeService, project/cwd resolution, debug artifacts, redaction, UI controls, validation, runner display, Workflow MCP/capability descriptions, and release notes.
- Scope check: The feature is one subsystem, a new Workflow node; no separate plan is needed.
- Type consistency: The node type is `claude_code`, config type is `ClaudeCodeNodeConfig`, debug output key is `claudeCodeDebug`, and action metadata is `workflow.claude_code` throughout.
- Verification: Each task has RED/GREEN commands and a final focused verification command.
