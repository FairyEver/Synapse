# Workflow Codex Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Workflow Codex node that runs local `codex exec` in the background, returns Codex's final reply as node output, and stores sanitized debug records in Workflow history.

**Architecture:** Implement a new `desktop/workflow-nodes/codex/` node following the existing schema/manifest/executor/panel/card pattern. Runtime execution uses existing `NodeRuntimeDeps.processRunner.run(...)` and does not touch `AgentRuntimeService` or Agent conversations. Codex command construction, artifact handling, and debug sanitization live in focused helpers so the executor stays small and testable.

**Tech Stack:** Electron main process, React, TypeScript, Zod, Vitest, shadcn/Radix UI, existing Workflow node registry, existing controlled process runtime.

---

## File Structure

- Create: `desktop/workflow-nodes/codex/schema.ts`
  - Owns `CodexNodeConfig`, enum schemas, defaults, and zod validation.
- Create: `desktop/workflow-nodes/codex/command.ts`
  - Pure helper that converts config, workspace path, artifact paths, and prompt into a controlled process request shape.
- Create: `desktop/workflow-nodes/codex/artifacts.main.ts`
  - Main-process helper for artifact directory creation, best-effort file writes/reads, previews, and path metadata.
- Create: `desktop/workflow-nodes/codex/executor.main.ts`
  - Workflow node executor; interpolates prompt, invokes `processRunner`, maps result to `NodeExecutionResult`.
- Create: `desktop/workflow-nodes/codex/manifest.ts`
  - Workflow node manifest.
- Create: `desktop/workflow-nodes/codex/card.tsx`
  - Editor and runner canvas card.
- Create: `desktop/workflow-nodes/codex/panel.tsx`
  - Renderer config panel using existing shadcn components, `VariableBindingEditor`, `PromptEditor`, and `ProjectSelect`.
- Create: `desktop/workflow-nodes/codex/index.ts`
  - Barrel export.
- Create tests:
  - `desktop/workflow-nodes/codex/__tests__/schema.test.ts`
  - `desktop/workflow-nodes/codex/__tests__/command.test.ts`
  - `desktop/workflow-nodes/codex/__tests__/executor.test.ts`
  - `desktop/workflow-nodes/codex/__tests__/panel.test.tsx`
- Modify:
  - `desktop/workflow-nodes/register.main.ts`
  - `desktop/workflow-nodes/register.renderer.ts`
  - `desktop/workflow-nodes/panel-registry.ts`
  - `desktop/src/modules/workflow/editor/node-wrappers.tsx`
  - `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`
  - `desktop/electron/services/workflow/workflow-validator.ts`
  - `desktop/electron/services/workflow/run-snapshot-sanitize.ts`
  - `desktop/src/modules/workflow/runner/node-result-panel.tsx`
  - `RELEASE_NOTES_PENDING.md`

## Task 1: Schema And Defaults

**Files:**
- Create: `desktop/workflow-nodes/codex/schema.ts`
- Test: `desktop/workflow-nodes/codex/__tests__/schema.test.ts`

- [ ] **Step 1: Write schema tests**

Create `desktop/workflow-nodes/codex/__tests__/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { codexNodeConfigSchema, defaultCodexNodeConfig } from "../schema"

describe("codexNodeConfigSchema", () => {
  it("accepts unattended-friendly defaults", () => {
    const parsed = codexNodeConfigSchema.parse(defaultCodexNodeConfig)
    expect(parsed).toEqual({
      variables: [],
      prompt: "",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      enableSearch: false,
      features: { goals: "enabled" },
      skipGitRepoCheck: true,
      strictConfig: false,
      bypassApprovalsAndSandbox: false,
      bypassHookTrust: false,
      additionalWritableDirs: [],
      images: [],
      configOverrides: [],
      captureDebugArtifacts: true,
    })
  })

  it("rejects duplicate config override keys", () => {
    const result = codexNodeConfigSchema.safeParse({
      ...defaultCodexNodeConfig,
      prompt: "run",
      configOverrides: [
        { key: "model_reasoning_effort", value: "high" },
        { key: "model_reasoning_effort", value: "low" },
      ],
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty list entries", () => {
    const result = codexNodeConfigSchema.safeParse({
      ...defaultCodexNodeConfig,
      prompt: "run",
      additionalWritableDirs: ["  "],
      images: [""],
    })
    expect(result.success).toBe(false)
  })

  it("accepts explicit CLI options", () => {
    const parsed = codexNodeConfigSchema.parse({
      ...defaultCodexNodeConfig,
      prompt: "run {{input}}",
      approvalPolicy: "on-request",
      sandbox: "danger-full-access",
      model: "gpt-5-codex",
      profile: "automation",
      enableSearch: true,
      features: { goals: "enabled" },
      strictConfig: true,
      bypassHookTrust: true,
      additionalWritableDirs: ["/Users/liyang/project-extra"],
      images: ["/Users/liyang/image.png"],
      configOverrides: [{ key: "model_reasoning_effort", value: "high" }],
    })
    expect(parsed.model).toBe("gpt-5-codex")
    expect(parsed.profile).toBe("automation")
    expect(parsed.enableSearch).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/schema.test.ts
```

Expected: FAIL because `desktop/workflow-nodes/codex/schema.ts` does not exist.

- [ ] **Step 3: Implement schema**

Create `desktop/workflow-nodes/codex/schema.ts`:

```ts
import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const codexApprovalPolicySchema = z.enum(["never", "on-request", "untrusted"])
export const codexSandboxSchema = z.enum(["read-only", "workspace-write", "danger-full-access"])
export const codexFeatureStateSchema = z.enum(["default", "enabled", "disabled"])

const nonEmptyTrimmedString = z.string().transform((value) => value.trim()).pipe(z.string().min(1))

export const codexConfigOverrideSchema = z.object({
  key: nonEmptyTrimmedString,
  value: z.string(),
})

export const codexNodeConfigSchema = z.object({
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),
  timeoutMins: z.number().int().min(1, "超时分钟必须大于 0").optional(),
  approvalPolicy: codexApprovalPolicySchema,
  sandbox: codexSandboxSchema,
  model: z.string().trim().optional(),
  profile: z.string().trim().optional(),
  enableSearch: z.boolean(),
  features: z.object({
    goals: codexFeatureStateSchema,
  }),
  skipGitRepoCheck: z.boolean(),
  strictConfig: z.boolean(),
  bypassApprovalsAndSandbox: z.boolean(),
  bypassHookTrust: z.boolean(),
  additionalWritableDirs: z.array(nonEmptyTrimmedString),
  images: z.array(nonEmptyTrimmedString),
  configOverrides: z.array(codexConfigOverrideSchema),
  captureDebugArtifacts: z.boolean(),
}).superRefine((config, ctx) => {
  const seen = new Set<string>()
  config.configOverrides.forEach((item, index) => {
    if (seen.has(item.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["configOverrides", index, "key"],
        message: `配置项「${item.key}」重复`,
      })
    }
    seen.add(item.key)
  })
})

export type CodexNodeConfig = z.infer<typeof codexNodeConfigSchema>
export type CodexApprovalPolicy = z.infer<typeof codexApprovalPolicySchema>
export type CodexSandbox = z.infer<typeof codexSandboxSchema>
export type CodexFeatureState = z.infer<typeof codexFeatureStateSchema>

export const defaultCodexNodeConfig: CodexNodeConfig = {
  variables: [],
  prompt: "",
  approvalPolicy: "never",
  sandbox: "workspace-write",
  enableSearch: false,
  features: { goals: "enabled" },
  skipGitRepoCheck: true,
  strictConfig: false,
  bypassApprovalsAndSandbox: false,
  bypassHookTrust: false,
  additionalWritableDirs: [],
  images: [],
  configOverrides: [],
  captureDebugArtifacts: true,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/codex/schema.ts desktop/workflow-nodes/codex/__tests__/schema.test.ts
git commit -m "feat(workflow): add codex node schema"
```

## Task 2: Command Builder

**Files:**
- Create: `desktop/workflow-nodes/codex/command.ts`
- Test: `desktop/workflow-nodes/codex/__tests__/command.test.ts`

- [ ] **Step 1: Write command builder tests**

Create `desktop/workflow-nodes/codex/__tests__/command.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildCodexExecRequest } from "../command"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../schema"

function request(config: Partial<CodexNodeConfig> = {}) {
  return buildCodexExecRequest({
    config: { ...defaultCodexNodeConfig, prompt: "ignored", ...config },
    prompt: "Write a summary",
    cwd: "/Users/liyang/project",
    lastMessagePath: "/tmp/synapse/last-message.txt",
    abortSignal: new AbortController().signal,
    timeoutMs: 60_000,
    actor: { kind: "system", id: "workflow-engine" },
    metadata: { source: "workflow", actionType: "workflow.codex" },
  })
}

describe("buildCodexExecRequest", () => {
  it("builds unattended default codex exec args", () => {
    const built = request()
    expect(built.command).toBe("codex")
    expect(built.args).toEqual([
      "exec",
      "--ask-for-approval", "never",
      "--sandbox", "workspace-write",
      "--json",
      "--output-last-message", "/tmp/synapse/last-message.txt",
      "--skip-git-repo-check",
      "--enable", "goals",
      "--cd", "/Users/liyang/project",
      "-",
    ])
    expect(built.stdin).toBe("Write a summary")
    expect(built.cwd).toBe("/Users/liyang/project")
    expect(JSON.stringify(built.args)).not.toContain("Write a summary")
  })

  it("suppresses sandbox and approval flags when bypass is enabled", () => {
    const built = request({ bypassApprovalsAndSandbox: true })
    expect(built.args).toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(built.args).not.toContain("--ask-for-approval")
    expect(built.args).not.toContain("--sandbox")
  })

  it("maps optional CLI flags", () => {
    const built = request({
      model: "gpt-5-codex",
      profile: "automation",
      enableSearch: true,
      features: { goals: "enabled" },
      strictConfig: true,
      bypassHookTrust: true,
      additionalWritableDirs: ["/Users/liyang/extra"],
      images: ["/Users/liyang/image.png"],
      configOverrides: [{ key: "model_reasoning_effort", value: "high" }],
    })
    expect(built.args).toEqual(expect.arrayContaining([
      "--model", "gpt-5-codex",
      "--profile", "automation",
      "--search",
      "--enable", "goals",
      "--strict-config",
      "--dangerously-bypass-hook-trust",
      "--add-dir", "/Users/liyang/extra",
      "--image", "/Users/liyang/image.png",
      "--config", "model_reasoning_effort=high",
    ]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/command.test.ts
```

Expected: FAIL because `buildCodexExecRequest` is missing.

- [ ] **Step 3: Implement command builder**

Create `desktop/workflow-nodes/codex/command.ts`:

```ts
import type { ActorIdentity } from "../../electron/runtime/security"
import type { ControlledProcessRunRequest } from "../../electron/runtime/process"
import type { CodexNodeConfig } from "./schema"

export interface BuildCodexExecRequestInput {
  readonly config: CodexNodeConfig
  readonly prompt: string
  readonly cwd: string
  readonly lastMessagePath: string
  readonly abortSignal: AbortSignal
  readonly timeoutMs?: number
  readonly actor: ActorIdentity
  readonly metadata: Record<string, unknown>
}

export function buildCodexExecRequest(input: BuildCodexExecRequestInput): ControlledProcessRunRequest {
  return {
    actor: input.actor,
    action: "shell.exec",
    command: "codex",
    args: buildCodexExecArgs(input.config, input.cwd, input.lastMessagePath),
    cwd: input.cwd,
    stdin: input.prompt,
    timeoutMs: input.timeoutMs,
    abortSignal: input.abortSignal,
    pathStrategy: "login-shell",
    output: {
      stdout: "buffer",
      stderr: "buffer",
    },
    metadata: input.metadata,
  }
}

export function buildCodexExecArgs(config: CodexNodeConfig, cwd: string, lastMessagePath: string): string[] {
  const args = ["exec"]

  if (config.bypassApprovalsAndSandbox) {
    args.push("--dangerously-bypass-approvals-and-sandbox")
  } else {
    args.push("--ask-for-approval", config.approvalPolicy)
    args.push("--sandbox", config.sandbox)
  }

  args.push("--json")
  args.push("--output-last-message", lastMessagePath)

  if (config.skipGitRepoCheck) args.push("--skip-git-repo-check")
  if (config.model) args.push("--model", config.model)
  if (config.profile) args.push("--profile", config.profile)
  if (config.enableSearch) args.push("--search")
  if (config.features.goals === "enabled") {
    args.push("--enable", "goals")
  } else if (config.features.goals === "disabled") {
    args.push("--disable", "goals")
  }
  if (config.strictConfig) args.push("--strict-config")
  if (config.bypassHookTrust) args.push("--dangerously-bypass-hook-trust")

  for (const dir of config.additionalWritableDirs) {
    args.push("--add-dir", dir)
  }
  for (const image of config.images) {
    args.push("--image", image)
  }
  for (const item of config.configOverrides) {
    args.push("--config", `${item.key}=${item.value}`)
  }

  args.push("--cd", cwd)
  args.push("-")
  return args
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/command.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/codex/command.ts desktop/workflow-nodes/codex/__tests__/command.test.ts
git commit -m "feat(workflow): build codex exec command"
```

## Task 3: Artifact And Debug Helpers

**Files:**
- Create: `desktop/workflow-nodes/codex/artifacts.main.ts`
- Test: add helper tests in `desktop/workflow-nodes/codex/__tests__/executor.test.ts`

- [ ] **Step 1: Write artifact helper tests**

Create the first part of `desktop/workflow-nodes/codex/__tests__/executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { buildCodexDebugOutput, finalOutputFromResult } from "../artifacts.main"

describe("codex artifact helpers", () => {
  it("redacts debug previews while keeping paths", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec", "--config", "api_key=sk-secret", "--cd", "/Users/liyang/project", "-"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      signal: null,
      durationMs: 12,
      stdout: "Authorization: Bearer sk-secret\n/Users/liyang/project/file.ts",
      stderr: "Cookie: sid=secret",
      promptPath: "/tmp/prompt.txt",
      stdoutPath: "/tmp/stdout.log",
      stderrPath: "/tmp/stderr.log",
      lastMessagePath: "/tmp/last-message.txt",
    })
    const serialized = JSON.stringify(debug)
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("sid=secret")
    expect(serialized).toContain("/Users/liyang/project/file.ts")
  })

  it("uses last message before stdout fallback", () => {
    expect(finalOutputFromResult(" final answer \n", "stdout text")).toBe("final answer")
    expect(finalOutputFromResult("", "stdout text")).toBe("stdout text")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/executor.test.ts
```

Expected: FAIL because `artifacts.main.ts` does not exist.

- [ ] **Step 3: Implement artifact helper**

Create `desktop/workflow-nodes/codex/artifacts.main.ts`:

```ts
import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"

export interface CodexArtifactPaths {
  readonly directory: string
  readonly promptPath: string
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly lastMessagePath: string
}

export interface CodexNodeDebugOutput {
  readonly command: "codex exec"
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

export function codexArtifactPaths(baseDir: string, runId: string, nodeId: string): CodexArtifactPaths {
  const directory = path.join(baseDir, "workflow-runs", runId, "nodes", nodeId, "codex")
  return {
    directory,
    promptPath: path.join(directory, "prompt.txt"),
    stdoutPath: path.join(directory, "stdout.log"),
    stderrPath: path.join(directory, "stderr.log"),
    lastMessagePath: path.join(directory, "last-message.txt"),
  }
}

export async function ensureCodexArtifactDirectory(paths: CodexArtifactPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true })
}

export async function writeCodexArtifact(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, sanitizeError(content), "utf8")
}

export async function readCodexArtifact(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8")
}

export function finalOutputFromResult(lastMessage: string | undefined, stdout: string | undefined): string {
  const finalMessage = lastMessage?.trim()
  if (finalMessage) return finalMessage
  return (stdout ?? "").trim()
}

export function buildCodexDebugOutput(input: {
  readonly args: readonly string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | string | null
  readonly durationMs: number
  readonly stdout?: string
  readonly stderr?: string
  readonly promptPath?: string
  readonly stdoutPath?: string
  readonly stderrPath?: string
  readonly lastMessagePath?: string
}): CodexNodeDebugOutput {
  return {
    command: "codex exec",
    args: input.args.map((arg) => sanitizeError(arg)),
    cwd: input.cwd,
    exitCode: input.exitCode,
    ...(input.signal ? { signal: String(input.signal) } : {}),
    durationMs: input.durationMs,
    ...(input.stdoutPath ? { stdoutPath: input.stdoutPath } : {}),
    ...(input.stderrPath ? { stderrPath: input.stderrPath } : {}),
    ...(input.promptPath ? { promptPath: input.promptPath } : {}),
    ...(input.lastMessagePath ? { lastMessagePath: input.lastMessagePath } : {}),
    ...(input.stdout ? { stdoutPreview: truncateWithEllipsis(sanitizeError(input.stdout), 2_000) } : {}),
    ...(input.stderr ? { stderrPreview: truncateWithEllipsis(sanitizeError(input.stderr), 2_000) } : {}),
    sessionHints: extractSessionHints(input.stdout),
  }
}

function extractSessionHints(stdout: string | undefined): string[] {
  if (!stdout) return []
  const hints = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : undefined
      const sessionPath = typeof parsed.session_path === "string" ? parsed.session_path : undefined
      if (sessionId) hints.add(sanitizeError(sessionId))
      if (sessionPath) hints.add(sanitizeError(sessionPath))
    } catch {
      continue
    }
  }
  return [...hints]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/executor.test.ts
```

Expected: PASS for helper tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/codex/artifacts.main.ts desktop/workflow-nodes/codex/__tests__/executor.test.ts
git commit -m "feat(workflow): add codex debug artifact helpers"
```

## Task 4: Executor

**Files:**
- Create: `desktop/workflow-nodes/codex/executor.main.ts`
- Modify: `desktop/workflow-nodes/codex/__tests__/executor.test.ts`
- Modify: `desktop/workflow-nodes/types.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`

- [ ] **Step 1: Extend executor tests**

Append these tests to `desktop/workflow-nodes/codex/__tests__/executor.test.ts`:

```ts
vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

import { codexNodeExecutor } from "../executor.main"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../schema"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"

const context = {
  projectId: "project-1",
  workflowId: "workflow-1",
  workflowName: "Workflow",
  runId: "run-1",
  nodeId: "codex-1",
  nodeName: "Codex",
  abortSignal: new AbortController().signal,
}

function makeInput(config: Partial<CodexNodeConfig>, runtimeDeps?: NodeRuntimeDeps): NodeExecutionInput<CodexNodeConfig> {
  return {
    config: { ...defaultCodexNodeConfig, prompt: "Summarize {{input}}", ...config },
    resolvedVariables: { input: "the result" },
    context,
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

function deps(exitCode = 0, stdout = "stdout fallback", stderr = ""): NodeRuntimeDeps {
  return {
    processRunner: {
      run: vi.fn().mockResolvedValue({
        exitCode,
        stdout,
        stderr,
        signal: null,
        timedOut: false,
        durationMs: 25,
      }),
    },
    sendHttpRequest: vi.fn(),
    resolveProjectWorkspacePath: vi.fn().mockResolvedValue("/Users/liyang/project"),
  }
}

describe("codexNodeExecutor", () => {
  it("fails when process runner is missing", async () => {
    const result = await codexNodeExecutor.execute(makeInput({}))
    expect(result.status).toBe("failed")
    expect(result.error).toContain("Codex 执行能力不可用")
  })

  it("passes interpolated prompt through stdin and does not call agent runtime", async () => {
    const runtimeDeps = deps()
    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))
    expect(result.status).toBe("success")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "codex",
      cwd: "/Users/liyang/project",
      stdin: "Summarize the result",
    }))
    expect(result.output).toBe("stdout fallback")
  })

  it("fails on non-zero exit code with debug metadata", async () => {
    const runtimeDeps = deps(1, "", "auth token=sk-secret failed")
    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))
    expect(result.status).toBe("failed")
    expect(result.output).toBe("")
    expect(result.outputs?.codexDebug).toEqual(expect.objectContaining({
      command: "codex exec",
      exitCode: 1,
    }))
    expect(JSON.stringify(result.outputs)).not.toContain("sk-secret")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/executor.test.ts
```

Expected: FAIL because `codexNodeExecutor` is missing.

- [ ] **Step 3: Implement executor**

Create `desktop/workflow-nodes/codex/executor.main.ts`:

```ts
import { app } from "electron"
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { CodexNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { workflowNodeLogContext } from "../log-context"
import { buildCodexExecRequest } from "./command"
import {
  buildCodexDebugOutput,
  codexArtifactPaths,
  ensureCodexArtifactDirectory,
  finalOutputFromResult,
  readCodexArtifact,
  writeCodexArtifact,
} from "./artifacts.main"

const logger = createMainLogger("workflow.node.codex-executor")

export const codexNodeExecutor: NodeExecutor<CodexNodeConfig> = {
  async execute(input: NodeExecutionInput<CodexNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps } = input
    const logContext = workflowNodeLogContext(context)

    if (!runtimeDeps?.processRunner) {
      return { status: "failed", output: "", error: "Codex 执行能力不可用", durationMs: Date.now() - start }
    }

    const projectId = config.projectId?.trim() || context.projectId?.trim()
    if (!projectId) {
      return { status: "failed", output: "", error: "Codex 节点缺少项目", durationMs: Date.now() - start }
    }
    if (!runtimeDeps.resolveProjectWorkspacePath) {
      return { status: "failed", output: "", error: "Codex 项目路径解析能力不可用", durationMs: Date.now() - start }
    }
    const cwd = await runtimeDeps.resolveProjectWorkspacePath(projectId)
    if (!cwd) {
      return { status: "failed", output: "", error: "Codex 节点项目不存在", durationMs: Date.now() - start }
    }

    input.onProgress?.("preparing_codex", "准备 Codex…")

    let prompt: string
    try {
      prompt = interpolatePrompt(config.prompt, input.resolvedVariables)
    } catch (err) {
      return { status: "failed", output: "", error: `模板变量解析失败：${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
    }

    const paths = codexArtifactPaths(app.getPath("userData"), context.runId, context.nodeId ?? "unknown")
    let artifactPathsAvailable = false
    try {
      await ensureCodexArtifactDirectory(paths)
      artifactPathsAvailable = true
      if (config.captureDebugArtifacts) {
        await writeCodexArtifact(paths.promptPath, prompt)
      }
    } catch (err) {
      logger.warn("codex artifact preparation failed", {
        ...logContext,
        errorMessage: truncateWithEllipsis(sanitizeError(err instanceof Error ? err.message : String(err)), 200),
      })
    }

    const timeoutMs = config.timeoutMins ? config.timeoutMins * 60_000 : undefined
    const request = buildCodexExecRequest({
      config,
      prompt,
      cwd,
      lastMessagePath: paths.lastMessagePath,
      abortSignal: context.abortSignal,
      timeoutMs,
      actor: context.actor ?? { kind: "system", id: "workflow-engine" },
      metadata: {
        source: "workflow",
        actionType: "workflow.codex",
        workflowId: context.workflowId,
        runId: context.runId,
        nodeId: context.nodeId,
      },
    })

    logger.info("codex node executing", {
      ...logContext,
      cwd,
      promptLength: prompt.length,
      optionKeys: codexOptionKeys(config),
    })

    input.onProgress?.("running_codex", "执行 Codex…")
    try {
      const result = await runtimeDeps.processRunner.run(request)
      const durationMs = Date.now() - start
      if (artifactPathsAvailable) {
        try {
          await writeCodexArtifact(paths.stdoutPath, result.stdout ?? "")
          await writeCodexArtifact(paths.stderrPath, result.stderr ?? "")
        } catch (err) {
          logger.warn("codex artifact write failed", {
            ...logContext,
            errorMessage: truncateWithEllipsis(sanitizeError(err instanceof Error ? err.message : String(err)), 200),
          })
        }
      }

      input.onProgress?.("reading_result", "读取结果…")
      let lastMessage = ""
      try {
        lastMessage = await readCodexArtifact(paths.lastMessagePath)
      } catch {
        lastMessage = ""
      }
      const debug = buildCodexDebugOutput({
        args: request.args ?? [],
        cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(artifactPathsAvailable ? {
          promptPath: config.captureDebugArtifacts ? paths.promptPath : undefined,
          stdoutPath: paths.stdoutPath,
          stderrPath: paths.stderrPath,
          lastMessagePath: paths.lastMessagePath,
        } : {}),
      })

      if (context.abortSignal.aborted) {
        return { status: "cancelled", output: "", outputs: { codexDebug: debug }, error: "运行被取消", durationMs }
      }
      if (result.timedOut) {
        return { status: "failed", output: "", outputs: { codexDebug: debug }, error: "Codex 执行超时", durationMs }
      }
      if (result.exitCode !== 0 || result.error) {
        const raw = result.stderr || result.error || `Codex 退出码 ${String(result.exitCode)}`
        return {
          status: "failed",
          output: "",
          outputs: { codexDebug: debug },
          error: `Codex 执行失败：${truncateWithEllipsis(sanitizeError(raw), 120)}`,
          durationMs,
        }
      }

      const output = finalOutputFromResult(lastMessage, result.stdout)
      return { status: "success", output, outputs: { codexDebug: debug }, durationMs }
    } catch (err) {
      const durationMs = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      logger.warn("codex node threw exception", {
        ...logContext,
        errorMessage: truncateWithEllipsis(sanitizeError(message), 200),
        durationMs,
      })
      return {
        status: "failed",
        output: "",
        error: `Codex 执行异常：${truncateWithEllipsis(sanitizeError(message), 120)}`,
        durationMs,
      }
    }
  },
}

function codexOptionKeys(config: CodexNodeConfig): string[] {
  return [
    "approvalPolicy",
    "sandbox",
    config.model ? "model" : undefined,
    config.profile ? "profile" : undefined,
    config.enableSearch ? "search" : undefined,
    config.features.goals !== "default" ? "features.goals" : undefined,
    config.skipGitRepoCheck ? "skipGitRepoCheck" : undefined,
    config.strictConfig ? "strictConfig" : undefined,
    config.bypassApprovalsAndSandbox ? "bypassApprovalsAndSandbox" : undefined,
    config.bypassHookTrust ? "bypassHookTrust" : undefined,
  ].filter((value): value is string => Boolean(value))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/executor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/codex/executor.main.ts desktop/workflow-nodes/codex/__tests__/executor.test.ts
git commit -m "feat(workflow): execute codex node"
```

## Task 5: Manifest, Card, Registration

**Files:**
- Create: `desktop/workflow-nodes/codex/manifest.ts`
- Create: `desktop/workflow-nodes/codex/card.tsx`
- Create: `desktop/workflow-nodes/codex/index.ts`
- Modify: `desktop/workflow-nodes/register.main.ts`
- Modify: `desktop/workflow-nodes/register.renderer.ts`
- Modify: `desktop/src/modules/workflow/editor/node-wrappers.tsx`
- Modify: `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`
- Test: `desktop/workflow-nodes/__tests__/registry.test.ts`

- [ ] **Step 1: Add registry test**

Append to `desktop/workflow-nodes/__tests__/registry.test.ts`:

```ts
it("registers codex node manifests in renderer and main registries", async () => {
  const { nodeTypeRegistry } = await import("../registry")
  await import("../register.renderer")
  expect(nodeTypeRegistry.getManifest("codex").title).toBe("Codex")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/__tests__/registry.test.ts
```

Expected: FAIL because `codex` is not registered.

- [ ] **Step 3: Implement manifest and card**

Create `desktop/workflow-nodes/codex/manifest.ts`:

```ts
import { Bot } from "lucide-react"
import type { NodeManifest } from "../types"
import type { CodexNodeConfig } from "./schema"
import { codexNodeConfigSchema, defaultCodexNodeConfig } from "./schema"

export const codexNodeManifest: NodeManifest<CodexNodeConfig> = {
  type: "codex",
  title: "Codex",
  icon: Bot,
  color: "bg-primary/10",
  defaultConfig: defaultCodexNodeConfig,
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "Codex",
    subtitle: config.prompt ? config.prompt.slice(0, 60) : "未编写指令",
  }),
  configFields: [
    { name: "approvalPolicy", kind: "select", label: "审批策略" },
    { name: "sandbox", kind: "select", label: "沙箱" },
    { name: "model", kind: "text", label: "模型", optional: true },
    { name: "profile", kind: "text", label: "Profile", optional: true },
    { name: "features", kind: "record", label: "功能开关", optional: true },
    { name: "timeoutMins", kind: "number", label: "超时分钟", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "指令" },
  ],
  configSchema: codexNodeConfigSchema,
}
```

Create `desktop/workflow-nodes/codex/card.tsx` by following Script card styling and using Codex fields:

```tsx
import { cn } from "@/lib/utils"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { codexNodeManifest } from "./manifest"
import type { CodexNodeConfig } from "./schema"

export function CodexNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: CodexNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number; nodeId?: string
}) {
  const Icon = codexNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const mode = config.bypassApprovalsAndSandbox ? "bypass" : `${config.approvalPolicy} · ${config.sandbox}`
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "Codex"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? <span className="text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span> : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] font-mono text-muted-foreground">{mode}</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">
            {config.prompt ? config.prompt.slice(0, 60) : "未编写指令"}
          </p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
```

Create `desktop/workflow-nodes/codex/index.ts`:

```ts
export { codexNodeManifest } from "./manifest"
export { codexNodeExecutor } from "./executor.main"
export type { CodexNodeConfig } from "./schema"
```

- [ ] **Step 4: Register node**

Modify `desktop/workflow-nodes/register.main.ts`:

```ts
import { codexNodeManifest, codexNodeExecutor } from "./codex"

nodeTypeRegistry.register(codexNodeManifest, codexNodeExecutor)
```

Modify `desktop/workflow-nodes/register.renderer.ts`:

```ts
import { codexNodeManifest } from "./codex/manifest"

nodeTypeRegistry.registerManifest(codexNodeManifest)
```

Modify `desktop/src/modules/workflow/editor/node-wrappers.tsx`:

```tsx
import { CodexNodeCard } from "../../../../workflow-nodes/codex/card"
import type { CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"

export function CodexNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="codex">
      <div>
        <Handle type="target" position={Position.Left} />
        <CodexNodeCard config={data as CodexNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}

export const nodeTypes = {
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
  end: EndNodeWrapper,
  http_request: HttpRequestNodeWrapper,
  script: ScriptNodeWrapper,
  workflow_call: WorkflowCallNodeWrapper,
  codex: CodexNodeWrapper,
}
```

Modify `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`:

```tsx
import { CodexNodeCard } from "../../../../workflow-nodes/codex/card"
import type { CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"

function RunnerCodexNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <CodexNodeCard
        config={data as CodexNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const runnerNodeTypes = {
  prompt: RunnerPromptNodeWrapper,
  switch: RunnerSwitchNodeWrapper,
  end: RunnerEndNodeWrapper,
  http_request: RunnerHttpRequestNodeWrapper,
  script: RunnerScriptNodeWrapper,
  workflow_call: RunnerWorkflowCallNodeWrapper,
  codex: RunnerCodexNodeWrapper,
}
```

- [ ] **Step 5: Run registry test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/workflow-nodes/codex desktop/workflow-nodes/register.main.ts desktop/workflow-nodes/register.renderer.ts desktop/src/modules/workflow/editor/node-wrappers.tsx desktop/src/modules/workflow/runner/runner-node-wrappers.tsx desktop/workflow-nodes/__tests__/registry.test.ts
git commit -m "feat(workflow): register codex node"
```

## Task 6: Config Panel

**Files:**
- Create: `desktop/workflow-nodes/codex/panel.tsx`
- Modify: `desktop/workflow-nodes/panel-registry.ts`
- Test: `desktop/workflow-nodes/codex/__tests__/panel.test.tsx`

- [ ] **Step 1: Write panel tests**

Create `desktop/workflow-nodes/codex/__tests__/panel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CodexNodePanel } from "../panel"
import { defaultCodexNodeConfig } from "../schema"

describe("CodexNodePanel", () => {
  it("renders unattended default controls", () => {
    render(
      <CodexNodePanel
        config={{ ...defaultCodexNodeConfig, prompt: "Run" }}
        onChange={vi.fn()}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )
    expect(screen.getByText("执行配置")).toBeTruthy()
    expect(screen.getByLabelText("审批策略")).toBeTruthy()
    expect(screen.getByLabelText("沙箱")).toBeTruthy()
    expect(screen.getByLabelText("Goals")).toBeTruthy()
    expect(screen.getByLabelText("跳过 Git 仓库检查")).toBeTruthy()
    expect(screen.getByText("输入映射")).toBeTruthy()
    expect(screen.getByText("项目")).toBeTruthy()
    expect(screen.getByText("指令")).toBeTruthy()
    expect(screen.getByText("高级参数")).toBeTruthy()
    expect(screen.getByText("调试记录")).toBeTruthy()
  })

  it("commits prompt changes on blur", () => {
    const onChange = vi.fn()
    render(
      <CodexNodePanel
        config={{ ...defaultCodexNodeConfig, prompt: "Old" }}
        onChange={onChange}
        upstreamNodes={[]}
        workflowParams={[]}
        projects={[]}
      />,
    )
    const textbox = screen.getByDisplayValue("Old")
    fireEvent.change(textbox, { target: { value: "New prompt" } })
    fireEvent.blur(textbox)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: "New prompt" }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/panel.test.tsx
```

Expected: FAIL because `CodexNodePanel` is missing.

- [ ] **Step 3: Implement panel**

Create `desktop/workflow-nodes/codex/panel.tsx` with existing components only:

```tsx
import { useRef, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import { CollapsibleSection } from "../collapsible-section"
import { ProjectSelect } from "../project-select"
import { PromptEditor } from "../prompt-editor"
import { VariableBindingEditor } from "../variable-binding-editor"
import type { CodexApprovalPolicy, CodexFeatureState, CodexNodeConfig, CodexSandbox } from "./schema"

export interface CodexNodePanelProps {
  config: CodexNodeConfig
  onChange: (config: CodexNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
}

export function CodexNodePanel({ config, onChange, upstreamNodes, workflowParams, projects, defaultProjectName }: CodexNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const lastCommittedRef = useRef<CodexNodeConfig>(config)
  const commit = (overrides?: Partial<CodexNodeConfig>) => {
    const next = { ...lastCommittedRef.current, prompt, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }
  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="执行配置">
        <div className="grid gap-2">
          <Select value={config.approvalPolicy} onValueChange={(value) => commit({ approvalPolicy: value as CodexApprovalPolicy })}>
            <Label>审批策略</Label>
            <SelectTrigger aria-label="审批策略" className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="never">never</SelectItem>
              <SelectItem value="on-request">on-request</SelectItem>
              <SelectItem value="untrusted">untrusted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={config.sandbox} onValueChange={(value) => commit({ sandbox: value as CodexSandbox })}>
            <Label>沙箱</Label>
            <SelectTrigger aria-label="沙箱" className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="read-only">read-only</SelectItem>
              <SelectItem value="workspace-write">workspace-write</SelectItem>
              <SelectItem value="danger-full-access">danger-full-access</SelectItem>
            </SelectContent>
          </Select>
          <Input aria-label="模型" className="h-7 text-xs" value={config.model ?? ""} onChange={(event) => commit({ model: event.target.value || undefined })} />
          <Input aria-label="Profile" className="h-7 text-xs" value={config.profile ?? ""} onChange={(event) => commit({ profile: event.target.value || undefined })} />
          <Input aria-label="超时分钟" className="h-7 text-xs" type="number" min={1} value={config.timeoutMins ?? ""} onChange={(event) => commit({ timeoutMins: event.target.value ? Number(event.target.value) : undefined })} />
          <BooleanRow id="codex-search" label="启用搜索" checked={config.enableSearch} onChange={(checked) => commit({ enableSearch: checked })} />
          <Select value={config.features.goals} onValueChange={(value) => commit({ features: { ...config.features, goals: value as CodexFeatureState } })}>
            <Label>Goals</Label>
            <SelectTrigger aria-label="Goals" className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">默认</SelectItem>
              <SelectItem value="enabled">启用</SelectItem>
              <SelectItem value="disabled">禁用</SelectItem>
            </SelectContent>
          </Select>
          <BooleanRow id="codex-skip-git" label="跳过 Git 仓库检查" checked={config.skipGitRepoCheck} onChange={(checked) => commit({ skipGitRepoCheck: checked })} />
          <BooleanRow id="codex-strict-config" label="严格配置" checked={config.strictConfig} onChange={(checked) => commit({ strictConfig: checked })} />
          <BooleanRow id="codex-bypass" label="绕过审批和沙箱" checked={config.bypassApprovalsAndSandbox} onChange={(checked) => commit({ bypassApprovalsAndSandbox: checked })} />
          <BooleanRow id="codex-bypass-hook" label="绕过 Hook 信任检查" checked={config.bypassHookTrust} onChange={(checked) => commit({ bypassHookTrust: checked })} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor variables={config.variables} onChange={(variables) => commit({ variables })} upstreamNodes={upstreamNodes} workflowParams={workflowParams} />
      </CollapsibleSection>

      <CollapsibleSection title="项目">
        <ProjectSelect value={config.projectId} onChange={(projectId) => commit({ projectId })} projects={projects} placeholder={defaultProjectName ? `继承: ${defaultProjectName}` : "继承默认"} />
      </CollapsibleSection>

      <CollapsibleSection title="指令" summary={prompt ? `${prompt.length}字` : undefined}>
        <PromptEditor value={prompt} onChange={setPrompt} onBlur={() => commit({ prompt })} variables={config.variables} placeholder="输入指令，用 {{变量名}} 引用变量…" />
      </CollapsibleSection>

      <CollapsibleSection title="高级参数">
        <StringListEditor label="可写目录" values={config.additionalWritableDirs} onChange={(additionalWritableDirs) => commit({ additionalWritableDirs })} />
        <StringListEditor label="图片路径" values={config.images} onChange={(images) => commit({ images })} />
      </CollapsibleSection>

      <CollapsibleSection title="调试记录">
        <BooleanRow id="codex-debug-artifacts" label="保存调试文件" checked={config.captureDebugArtifacts} onChange={(checked) => commit({ captureDebugArtifacts: checked })} />
      </CollapsibleSection>
    </div>
  )
}

function BooleanRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="text-xs font-normal">{label}</Label>
    </div>
  )
}

function StringListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-7 text-xs" value={values.join("\n")} onChange={(event) => onChange(event.target.value.split(/\r?\n/).filter((value) => value.trim()))} />
    </div>
  )
}
```

Add `ConfigOverrideEditor` in the same file and render it in the **高级参数** section:

```tsx
<ConfigOverrideEditor
  values={config.configOverrides}
  onChange={(configOverrides) => commit({ configOverrides })}
/>
```

Use this implementation:

```tsx
function ConfigOverrideEditor({
  values,
  onChange,
}: {
  values: CodexNodeConfig["configOverrides"]
  onChange: (values: CodexNodeConfig["configOverrides"]) => void
}) {
  const update = (index: number, patch: Partial<CodexNodeConfig["configOverrides"][number]>) => {
    onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  return (
    <div className="grid gap-1">
      <Label className="text-xs">配置覆盖</Label>
      {values.map((item, index) => (
        <div key={index} className="grid grid-cols-2 gap-1">
          <Input className="h-7 text-xs" value={item.key} aria-label={`配置项 ${index + 1}`} onChange={(event) => update(index, { key: event.target.value })} />
          <Input className="h-7 text-xs" value={item.value} aria-label={`配置值 ${index + 1}`} onChange={(event) => update(index, { value: event.target.value })} />
        </div>
      ))}
      <Input
        className="h-7 text-xs"
        aria-label="新增配置覆盖"
        value=""
        onChange={(event) => {
          const key = event.target.value.trim()
          if (key) onChange([...values, { key, value: "" }])
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Register panel**

Modify `desktop/workflow-nodes/panel-registry.ts`:

```ts
import { CodexNodePanel } from "./codex/panel"

["codex", CodexNodePanel as unknown as PanelComponent],
```

- [ ] **Step 5: Run panel test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/codex/__tests__/panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/workflow-nodes/codex/panel.tsx desktop/workflow-nodes/codex/__tests__/panel.test.tsx desktop/workflow-nodes/panel-registry.ts
git commit -m "feat(workflow): add codex node panel"
```

## Task 7: Workflow Validation And Snapshot Sanitization

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Modify: `desktop/electron/services/workflow/run-snapshot-sanitize.ts`
- Test: `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Write validation and sanitization tests**

Add tests that construct a workflow with a `codex` node:

```ts
it("requires a project for codex nodes when workflow default is missing", () => {
  const result = validateWorkflow({
    id: "wf",
    name: "Workflow",
    version: 1,
    params: [],
    nodes: [
      { id: "n1", type: "codex", name: "Codex", config: { ...defaultCodexNodeConfig, prompt: "run" }, position: { x: 0, y: 0 } },
      { id: "end", type: "end", name: "End", config: { template: "{{n1}}" }, position: { x: 200, y: 0 } },
    ],
    edges: [{ id: "e1", from: "n1", to: "end" }],
  })
  expect(result.valid).toBe(false)
  expect(result.errors.some((error) => error.message.includes("项目"))).toBe(true)
})
```

Add a sanitization test with `outputs.codexDebug.stderrPreview = "Authorization: Bearer sk-secret /Users/liyang/project"` and assert the secret is redacted while the path remains.

- [ ] **Step 2: Run tests to verify they fail**

Run the targeted test file:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts
```

Expected: FAIL because validator does not know `codex` project requirements or snapshot redaction path.

- [ ] **Step 3: Update validator**

Modify `desktop/electron/services/workflow/workflow-validator.ts`:

```ts
if (node.type === "prompt" || node.type === "switch" || node.type === "codex") {
  const cfg = node.config as Record<string, unknown>
  const hasProjectId = typeof cfg.projectId === "string" && cfg.projectId.trim().length > 0
  if (!hasProjectId && !hasDefaultProjectId) {
    errors.push(missingWorkflowDefaultError({
      node,
      field: "defaultProjectId",
      nodeField: "projectId",
      label: "项目",
      cfg,
      defaultNodeTimeoutMins: def.defaultNodeTimeoutMins,
    }))
  }
}
```

Keep provider/model default checks limited to Prompt and Switch:

```ts
if (node.type === "prompt" || node.type === "switch") {
  // existing provider/model checks stay here
}
```

Also update `collectTemplateTexts`:

```ts
if (node.type === "codex") {
  pushString(cfg.prompt)
}
```

- [ ] **Step 4: Update snapshot sanitizer**

Modify `desktop/electron/services/workflow/run-snapshot-sanitize.ts` so `result.outputs` is sanitized recursively with existing `sanitizeError` for strings:

```ts
function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === "string") return sanitizeError(value)
  if (Array.isArray(value)) return value.map(sanitizeUnknown)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeUnknown(item)]))
  }
  return value
}
```

Use it when copying `outputs`.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts
```

Expected: PASS for modified tests.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/workflow/workflow-validator.ts desktop/electron/services/workflow/run-snapshot-sanitize.ts desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "feat(workflow): validate codex node history"
```

## Task 8: Runner Result Debug Display

**Files:**
- Modify: `desktop/src/modules/workflow/runner/node-result-panel.tsx`
- Test: `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`

- [ ] **Step 1: Write result panel test**

Add a test that passes a node result with:

```ts
outputs: {
  codexDebug: {
    command: "codex exec",
    args: ["exec", "--json", "-"],
    cwd: "/Users/liyang/project",
    exitCode: 0,
    durationMs: 100,
    stdoutPath: "/tmp/stdout.log",
    stderrPreview: "warning",
  },
}
```

Assert that the rendered panel contains `codex exec`, `/Users/liyang/project`, `0`, and `/tmp/stdout.log`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: FAIL because Codex debug output is not rendered specially.

- [ ] **Step 3: Add Codex debug renderer**

In `desktop/src/modules/workflow/runner/node-result-panel.tsx`, add a narrow branch:

```tsx
function CodexDebugView({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return null
  const debug = value as Record<string, unknown>
  return (
    <div className="grid gap-1 text-xs">
      <div className="font-medium">Codex</div>
      <div className="text-muted-foreground">command: {String(debug.command ?? "")}</div>
      <div className="text-muted-foreground">cwd: {String(debug.cwd ?? "")}</div>
      <div className="text-muted-foreground">exitCode: {String(debug.exitCode ?? "")}</div>
      {typeof debug.stdoutPath === "string" ? <div className="text-muted-foreground">stdout: {debug.stdoutPath}</div> : null}
      {typeof debug.stderrPath === "string" ? <div className="text-muted-foreground">stderr: {debug.stderrPath}</div> : null}
      {typeof debug.stderrPreview === "string" ? <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">{debug.stderrPreview}</pre> : null}
    </div>
  )
}
```

Render it only when `result.outputs?.codexDebug` exists. Keep existing generic output rendering intact for all other nodes.

- [ ] **Step 4: Run test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/runner/node-result-panel.tsx desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
git commit -m "feat(workflow): show codex debug output"
```

## Task 9: Release Note And Focused Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add this bullet under `## 新增功能` in `RELEASE_NOTES_PENDING.md`:

```md
- 工作流新增 Codex 节点，可以在本机后台运行 Codex 提示词，并在运行历史中保留调试记录。
```

- [ ] **Step 2: Run focused node tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  workflow-nodes/codex/__tests__/schema.test.ts \
  workflow-nodes/codex/__tests__/command.test.ts \
  workflow-nodes/codex/__tests__/executor.test.ts \
  workflow-nodes/codex/__tests__/panel.test.tsx \
  workflow-nodes/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run workflow renderer/main regression tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/__tests__/workflow-engine.test.ts \
  src/modules/workflow/editor/__tests__/node-palette.test.tsx \
  src/modules/workflow/editor/__tests__/node-config-panel.test.tsx \
  src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note workflow codex node"
```

## Self-Review

Spec coverage:

- Independent `codex` node: Tasks 1, 5, 6.
- `codex exec` background execution: Tasks 2 and 4.
- No Agent conversation integration: Task 4 tests `sendToAgent` is not used.
- CLI options exposed as controls: Tasks 1, 2, 6.
- Final reply text as node output: Tasks 3 and 4.
- Debug-grade history and redaction: Tasks 3, 7, 8.
- Prompt-node-like project semantics: Tasks 4, 6, 7.
- Release note: Task 9.

Plan hygiene scan:

- No placeholder tokens or open-ended implementation steps remain.
- Every task has exact files, commands, expected result, and concrete code or test snippets.

Type consistency:

- Config type is consistently `CodexNodeConfig`.
- Node type string is consistently `codex`.
- Debug output field is consistently `outputs.codexDebug`.
- Command helper names are consistently `buildCodexExecRequest` and `buildCodexExecArgs`.
