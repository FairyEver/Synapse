# 工作流节点类型扩展 Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为工作流引擎添加基础设施支持（runtimeDeps 注入）并实现 HTTP Request 和 Script 两个新节点类型。

**Architecture:** 扩展 `NodeExecutionInput` 增加 `runtimeDeps` 字段，由 `WorkflowEngine` 构造时注入 `processRunner` 和 `sendHttpRequest`。新节点复用 `action-packages/builtin/` 的 schema 和配置表单组件，各自编写薄 executor wrapper。

**Tech Stack:** TypeScript, Zod, React, Vitest, Electron main process APIs

---

## File Map

### 基础设施改动

- Modify: `workflow-nodes/types.ts` — 增加 `NodeRuntimeDeps` 接口和 `runtimeDeps` 字段
- Modify: `electron/services/workflow/workflow-engine.ts` — 构造函数接收并传递 runtimeDeps
- Modify: `electron/bootstrap/descriptors.ts` — 创建引擎时注入 processRunner + sendHttpRequest
- Modify: `action-packages/builtin/http-request/config.renderer.tsx` — 增加 idPrefix prop
- Modify: `action-packages/builtin/script/config.renderer.tsx` — 增加 idPrefix prop

### HTTP Request 节点

- Create: `workflow-nodes/http-request/schema.ts`
- Create: `workflow-nodes/http-request/executor.main.ts`
- Create: `workflow-nodes/http-request/manifest.ts`
- Create: `workflow-nodes/http-request/panel.tsx`
- Create: `workflow-nodes/http-request/card.tsx`
- Create: `workflow-nodes/http-request/index.ts`
- Create: `workflow-nodes/http-request/__tests__/executor.test.ts`
- Modify: `workflow-nodes/register.main.ts` — 注册 http_request
- Modify: `workflow-nodes/register.renderer.ts` — 注册 manifest
- Modify: `workflow-nodes/panel-registry.ts` — 注册 panel

### Script 节点

- Create: `workflow-nodes/script/schema.ts`
- Create: `workflow-nodes/script/executor.main.ts`
- Create: `workflow-nodes/script/manifest.ts`
- Create: `workflow-nodes/script/panel.tsx`
- Create: `workflow-nodes/script/card.tsx`
- Create: `workflow-nodes/script/index.ts`
- Create: `workflow-nodes/script/__tests__/executor.test.ts`
- Modify: `workflow-nodes/register.main.ts` — 注册 script
- Modify: `workflow-nodes/register.renderer.ts` — 注册 manifest
- Modify: `workflow-nodes/panel-registry.ts` — 注册 panel

---

## Task 1: 扩展 NodeExecutionInput 增加 runtimeDeps

**Files:**
- Modify: `workflow-nodes/types.ts`

- [ ] **Step 1: 在 types.ts 末尾增加 NodeRuntimeDeps 接口并扩展 NodeExecutionInput**

```typescript
// 在 AgentSendDeps 接口之后添加：

export interface NodeRuntimeDeps {
  processRunner: {
    run(request: {
      actor: { kind: string; id: string; display: string }
      action: string
      command: string
      args: string[]
      cwd: string
      env?: Record<string, string>
      envAllowlist?: string[]
      pathStrategy?: "merge" | "replace"
      timeoutMs?: number
      abortSignal?: AbortSignal
      output: { stdout: "buffer"; stderr: "buffer"; maxBufferBytes: number }
      metadata?: Record<string, unknown>
    }): Promise<{
      stdout: string | null
      stderr: string | null
      exitCode: number | null
      signal: string | null
      timedOut: boolean
      durationMs: number
      error?: string
      diagnostics?: unknown
    }>
  }
  sendHttpRequest: (request: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
    abortSignal?: AbortSignal
  }) => Promise<{
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
  }>
  platform: string
  defaultCwd: string
}
```

然后在 `NodeExecutionInput` 接口中增加可选字段：

```typescript
export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
  runtimeDeps?: NodeRuntimeDeps      // 新增
  onProgress?: (phase: string, label: string) => void
}
```

- [ ] **Step 2: 运行类型检查确认无破坏**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: 无错误（runtimeDeps 是可选字段，现有代码不受影响）

- [ ] **Step 3: Commit**

```bash
git add workflow-nodes/types.ts
git commit -m "feat(workflow): add NodeRuntimeDeps interface to NodeExecutionInput"
```

---

## Task 2: WorkflowEngine 注入并传递 runtimeDeps

**Files:**
- Modify: `electron/services/workflow/workflow-engine.ts`

- [ ] **Step 1: 修改 WorkflowEngine 构造函数接收 runtimeDeps**

在 `workflow-engine.ts` 中修改构造函数：

```typescript
import type { AgentSendDeps, NodeRuntimeDeps } from "../../../workflow-nodes/types"

export class WorkflowEngine {
  constructor(
    private readonly agentDeps: AgentSendDeps,
    private readonly runtimeDeps?: NodeRuntimeDeps,
    private readonly abortSignal?: AbortSignal,
  ) {}
```

- [ ] **Step 2: 在 taskFactory 中将 runtimeDeps 传递给节点 executor**

在 `workflow-engine.ts` 的 `taskFactory` 函数内，找到 `executor.execute(...)` 调用处（约第 163 行），增加 `runtimeDeps`：

```typescript
const execResult = await executor.execute({
  config: cfg, resolvedVariables: resolved,
  context: { projectId: effectiveProjectId, runId, abortSignal: effectiveAbortSignal },
  agentDeps: this.agentDeps,
  runtimeDeps: this.runtimeDeps,
  onProgress: (phase, label) => {
    emit({ type: "node:progress", runId, nodeId, phase, label })
  },
})
```

- [ ] **Step 3: 运行现有工作流引擎测试确认无破坏**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run electron/services/__tests__/workflow-engine.test.ts 2>&1 | tail -10`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add electron/services/workflow/workflow-engine.ts
git commit -m "feat(workflow): pass runtimeDeps through engine to node executors"
```

---

## Task 3: 在 bootstrap 中注入 runtimeDeps 到 WorkflowEngine

**Files:**
- Modify: `electron/bootstrap/descriptors.ts`

- [ ] **Step 1: 修改 coreWorkflowEngineDescriptor 创建逻辑**

在 `descriptors.ts` 约第 1108 行，修改 `new WorkflowEngine(...)` 调用：

```typescript
// 在 create(ctx) 函数内，sendToAgent 定义之后，return 之前添加：
const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
const processRunner = createControlledProcessRunner({ permissionGuard, auditSink })

const runtimeDeps: import("../../workflow-nodes/types").NodeRuntimeDeps = {
  processRunner,
  sendHttpRequest: sendOutboundHttpRequest,
  platform: process.platform,
  defaultCwd: os.homedir(),
}
return new WorkflowEngine({ sendToAgent }, runtimeDeps)
```

确保文件顶部有对应 import：

```typescript
import { sendOutboundHttpRequest } from "../runtime/network"
```

- [ ] **Step 2: 确认 dependsOn 包含 permission-guard 和 audit-sink**

检查 `coreWorkflowEngineDescriptor.dependsOn` 数组，确保包含 `"core.permission-guard"` 和 `"core.audit-sink"`（如果还没有的话添加）。

- [ ] **Step 3: 运行类型检查**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add electron/bootstrap/descriptors.ts
git commit -m "feat(workflow): inject processRunner and sendHttpRequest into WorkflowEngine"
```

---

## Task 4: 共享配置表单组件增加 idPrefix prop

**Files:**
- Modify: `action-packages/builtin/http-request/config.renderer.tsx`
- Modify: `action-packages/builtin/script/config.renderer.tsx`

- [ ] **Step 1: 修改 HttpRequestConfigForm 接收 idPrefix**

在 `http-request/config.renderer.tsx` 中修改组件签名和内部 id 引用：

```typescript
export function HttpRequestConfigForm({
  value,
  onChange,
  idPrefix = "task-action-http",
}: {
  readonly value: HttpRequestActionConfig
  readonly onChange: (value: HttpRequestActionConfig) => void
  readonly idPrefix?: string
}) {
```

将所有 `task-action-http-` 硬编码替换为 `` `${idPrefix}-` ``。例如：
- `id="task-action-http-method-GET"` → `` id={`${idPrefix}-method-GET`} ``
- `data-track="task-action-http-method"` → `` data-track={`${idPrefix}-method`} ``

- [ ] **Step 2: 修改 ScriptConfigForm 接收 idPrefix**

在 `script/config.renderer.tsx` 中同样修改：

```typescript
export function ScriptConfigForm({
  value,
  onChange,
  idPrefix = "task-action-script",
}: {
  readonly value: ScriptActionConfig
  readonly onChange: (value: ScriptActionConfig) => void
  readonly idPrefix?: string
}) {
```

将所有 `task-action-script-` 硬编码替换为 `` `${idPrefix}-` ``。

- [ ] **Step 3: 确认定时任务侧不受影响（不传 idPrefix 时使用默认值）**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add action-packages/builtin/http-request/config.renderer.tsx action-packages/builtin/script/config.renderer.tsx
git commit -m "refactor(action-packages): add idPrefix prop to shared config forms"
```

---

## Task 5: HTTP Request 节点 — schema + executor + 测试

**Files:**
- Create: `workflow-nodes/http-request/schema.ts`
- Create: `workflow-nodes/http-request/executor.main.ts`
- Create: `workflow-nodes/http-request/__tests__/executor.test.ts`

- [ ] **Step 1: 创建 schema.ts**

```typescript
// workflow-nodes/http-request/schema.ts
import { z } from "zod"
import { httpRequestActionConfigSchema } from "../../action-packages/builtin/http-request/schema"
import { variableBindingSchema } from "../schemas/variable-binding"

export const httpRequestNodeConfigSchema = httpRequestActionConfigSchema.extend({
  variables: z.array(variableBindingSchema),
})
export type HttpRequestNodeConfig = z.infer<typeof httpRequestNodeConfigSchema>
```

- [ ] **Step 2: 编写 executor 测试**

```typescript
// workflow-nodes/http-request/__tests__/executor.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { httpRequestNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }

function mockRuntimeDeps(response: { status: number; statusText: string; headers: Record<string, string>; body: string }) {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn().mockResolvedValue(response),
    platform: "darwin",
    defaultCwd: "/tmp",
  }
}

const agentDeps = { sendToAgent: vi.fn() }

describe("httpRequestNodeExecutor", () => {
  beforeEach(() => { logger.info.mockClear(); logger.warn.mockClear() })

  it("sends request and returns response body as output", async () => {
    const deps = mockRuntimeDeps({ status: 200, statusText: "OK", headers: {}, body: '{"ok":true}' })
    const r = await httpRequestNodeExecutor.execute({
      config: { method: "GET", url: "https://example.com/api", bodyType: "none", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(r.status).toBe("success")
    expect(r.output).toBe('{"ok":true}')
    expect(deps.sendHttpRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      url: "https://example.com/api",
    }))
  })

  it("interpolates variables into url and body", async () => {
    const deps = mockRuntimeDeps({ status: 200, statusText: "OK", headers: {}, body: "done" })
    await httpRequestNodeExecutor.execute({
      config: { method: "POST", url: "https://example.com/{{path}}", bodyType: "json", body: '{"msg":"{{content}}"}', variables: [] },
      resolvedVariables: { path: "webhook", content: "hello" },
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(deps.sendHttpRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com/webhook",
      body: '{"msg":"hello"}',
    }))
  })

  it("returns failed when HTTP response is not ok (4xx/5xx)", async () => {
    const deps = mockRuntimeDeps({ status: 500, statusText: "Internal Server Error", headers: {}, body: "error" })
    const r = await httpRequestNodeExecutor.execute({
      config: { method: "GET", url: "https://example.com/fail", bodyType: "none", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(r.status).toBe("failed")
    expect(r.error).toContain("500")
  })

  it("returns failed when sendHttpRequest throws", async () => {
    const deps = {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn().mockRejectedValue(new Error("network timeout")),
      platform: "darwin",
      defaultCwd: "/tmp",
    }
    const r = await httpRequestNodeExecutor.execute({
      config: { method: "GET", url: "https://example.com/timeout", bodyType: "none", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(r.status).toBe("failed")
    expect(r.error).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败（executor 尚未实现）**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run workflow-nodes/http-request/__tests__/executor.test.ts 2>&1 | tail -5`
Expected: FAIL — cannot find module `../executor.main`

- [ ] **Step 4: 实现 executor.main.ts**

```typescript
// workflow-nodes/http-request/executor.main.ts
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { HttpRequestNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.http-request-executor")

export const httpRequestNodeExecutor: NodeExecutor<HttpRequestNodeConfig> = {
  async execute(input: NodeExecutionInput<HttpRequestNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, runtimeDeps, context } = input

    if (!runtimeDeps) {
      return { status: "failed", output: "", error: "runtimeDeps 未注入", durationMs: 0 }
    }

    input.onProgress?.("resolving_variables", "解析变量…")
    const url = interpolatePrompt(config.url, resolvedVariables)
    const body = config.body ? interpolatePrompt(config.body, resolvedVariables) : undefined
    const headers = config.headers ? Object.fromEntries(
      Object.entries(config.headers).map(([k, v]) => [k, interpolatePrompt(v, resolvedVariables)]),
    ) : undefined

    input.onProgress?.("sending_request", "发送请求…")
    logger.info("http-request node executing", {
      runId: context.runId, method: config.method, urlLength: url.length,
    })

    try {
      const response = await runtimeDeps.sendHttpRequest({
        method: config.method,
        url,
        headers,
        body: config.bodyType === "none" ? undefined : body,
        timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
        abortSignal: context.abortSignal,
      })
      const durationMs = Date.now() - start

      if (response.status >= 400) {
        logger.warn("http-request node got error response", {
          runId: context.runId, httpStatus: response.status, durationMs,
        })
        return {
          status: "failed",
          output: response.body,
          error: `HTTP ${String(response.status)} ${response.statusText}`,
          durationMs,
        }
      }

      logger.info("http-request node succeeded", {
        runId: context.runId, httpStatus: response.status, bodyLength: response.body.length, durationMs,
      })
      return { status: "success", output: response.body, durationMs }
    } catch (err) {
      const durationMs = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      logger.warn("http-request node failed", {
        runId: context.runId, errorLength: message.length, durationMs,
      })
      return { status: "failed", output: "", error: `请求失败：${message.slice(0, 120)}`, durationMs }
    }
  },
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run workflow-nodes/http-request/__tests__/executor.test.ts 2>&1 | tail -10`
Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add workflow-nodes/http-request/schema.ts workflow-nodes/http-request/executor.main.ts workflow-nodes/http-request/__tests__/executor.test.ts
git commit -m "feat(workflow): add http_request node executor with tests"
```

---

## Task 6: HTTP Request 节点 — manifest + card + panel + 注册

**Files:**
- Create: `workflow-nodes/http-request/manifest.ts`
- Create: `workflow-nodes/http-request/card.tsx`
- Create: `workflow-nodes/http-request/panel.tsx`
- Create: `workflow-nodes/http-request/index.ts`
- Modify: `workflow-nodes/register.main.ts`
- Modify: `workflow-nodes/register.renderer.ts`
- Modify: `workflow-nodes/panel-registry.ts`

- [ ] **Step 1: 创建 manifest.ts**

```typescript
// workflow-nodes/http-request/manifest.ts
import { Globe } from "lucide-react"
import type { NodeManifest } from "../types"
import type { HttpRequestNodeConfig } from "./schema"
import { httpRequestNodeConfigSchema } from "./schema"

export const httpRequestNodeManifest: NodeManifest<HttpRequestNodeConfig> = {
  type: "http_request",
  title: "HTTP 请求",
  icon: Globe,
  color: "bg-secondary",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({
    title: `${c.method} 请求`,
    subtitle: c.url.slice(0, 50) || "未配置 URL",
  }),
  configFields: [
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "method", kind: "select", label: "方法" },
    { name: "url", kind: "text", label: "URL" },
  ],
  configSchema: httpRequestNodeConfigSchema,
}
```

- [ ] **Step 2: 创建 card.tsx**

```tsx
// workflow-nodes/http-request/card.tsx
import { cn } from "@/lib/utils"
import { httpRequestNodeManifest } from "./manifest"
import type { HttpRequestNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "cancelled": return "opacity-60 border-muted-foreground"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}

export function HttpRequestNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: HttpRequestNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = httpRequestNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56 shadow-sm", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "HTTP 请求"}</span>
        {status === "running" && timer && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground truncate font-medium">{config.method}</p>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">{config.url || "未配置 URL"}</p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

- [ ] **Step 3: 创建 panel.tsx**

```tsx
// workflow-nodes/http-request/panel.tsx
import { useRef, useState } from "react"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { HttpRequestNodeConfig } from "./schema"
import { HttpRequestConfigForm } from "../../action-packages/builtin/http-request/config.renderer"
import { VariableBindingEditor } from "../variable-binding-editor"
import { CollapsibleSection } from "../collapsible-section"

export interface HttpRequestNodePanelProps {
  config: HttpRequestNodeConfig
  onChange: (config: HttpRequestNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
}

export function HttpRequestNodePanel({ config, onChange, upstreamNodes, workflowParams }: HttpRequestNodePanelProps) {
  const lastCommittedRef = useRef<HttpRequestNodeConfig>(config)

  const commit = (overrides?: Partial<HttpRequestNodeConfig>) => {
    const next: HttpRequestNodeConfig = { ...lastCommittedRef.current, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="请求配置">
        <HttpRequestConfigForm
          value={config}
          onChange={(v) => commit(v)}
          idPrefix="workflow-node-http"
        />
      </CollapsibleSection>
    </div>
  )
}
```

- [ ] **Step 4: 创建 index.ts**

```typescript
// workflow-nodes/http-request/index.ts
export { httpRequestNodeManifest } from "./manifest"
export { httpRequestNodeExecutor } from "./executor.main"
export { httpRequestNodeConfigSchema } from "./schema"
export type { HttpRequestNodeConfig } from "./schema"
```

- [ ] **Step 5: 注册到 register.main.ts**

在 `workflow-nodes/register.main.ts` 末尾追加：

```typescript
import { httpRequestNodeManifest, httpRequestNodeExecutor } from "./http-request"
nodeTypeRegistry.register(httpRequestNodeManifest, httpRequestNodeExecutor)
```

- [ ] **Step 6: 注册到 register.renderer.ts**

在 `workflow-nodes/register.renderer.ts` 末尾追加：

```typescript
import { httpRequestNodeManifest } from "./http-request/manifest"
nodeTypeRegistry.registerManifest(httpRequestNodeManifest)
```

- [ ] **Step 7: 注册到 panel-registry.ts**

在 `workflow-nodes/panel-registry.ts` 中添加 import 和注册：

```typescript
import { HttpRequestNodePanel } from "./http-request/panel"

// 在 panelRegistry Map 中追加：
["http_request", HttpRequestNodePanel as unknown as PanelComponent],
```

- [ ] **Step 8: 运行类型检查和测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20 && npx vitest run workflow-nodes/http-request/ 2>&1 | tail -10`
Expected: 类型检查通过，测试通过

- [ ] **Step 9: Commit**

```bash
git add workflow-nodes/http-request/ workflow-nodes/register.main.ts workflow-nodes/register.renderer.ts workflow-nodes/panel-registry.ts
git commit -m "feat(workflow): add http_request node with manifest, card, panel, and registration"
```

---

## Task 7: Script 节点 — schema + executor + 测试

**Files:**
- Create: `workflow-nodes/script/schema.ts`
- Create: `workflow-nodes/script/executor.main.ts`
- Create: `workflow-nodes/script/__tests__/executor.test.ts`

- [ ] **Step 1: 创建 schema.ts**

```typescript
// workflow-nodes/script/schema.ts
import { z } from "zod"
import { scriptActionConfigSchema } from "../../action-packages/builtin/script/schema"
import { variableBindingSchema } from "../schemas/variable-binding"

export const scriptNodeConfigSchema = scriptActionConfigSchema.extend({
  variables: z.array(variableBindingSchema),
})
export type ScriptNodeConfig = z.infer<typeof scriptNodeConfigSchema>
```

- [ ] **Step 2: 编写 executor 测试**

```typescript
// workflow-nodes/script/__tests__/executor.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { scriptNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }
const agentDeps = { sendToAgent: vi.fn() }

function mockRuntimeDeps(result: {
  stdout: string | null; stderr: string | null; exitCode: number | null
  signal: string | null; timedOut: boolean; durationMs: number; error?: string
}) {
  return {
    processRunner: { run: vi.fn().mockResolvedValue(result) },
    sendHttpRequest: vi.fn(),
    platform: "darwin",
    defaultCwd: "/home/user",
  }
}

describe("scriptNodeExecutor", () => {
  beforeEach(() => { logger.info.mockClear(); logger.warn.mockClear() })

  it("executes script and returns stdout as output", async () => {
    const deps = mockRuntimeDeps({ stdout: "hello world\n", stderr: null, exitCode: 0, signal: null, timedOut: false, durationMs: 50 })
    const r = await scriptNodeExecutor.execute({
      config: { script: "echo hello world", shell: "posix", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(r.status).toBe("success")
    expect(r.output).toBe("hello world\n")
  })

  it("interpolates variables into script content", async () => {
    const deps = mockRuntimeDeps({ stdout: "ok", stderr: null, exitCode: 0, signal: null, timedOut: false, durationMs: 10 })
    await scriptNodeExecutor.execute({
      config: { script: "echo {{msg}}", shell: "posix", variables: [] },
      resolvedVariables: { msg: "interpolated" },
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    const call = deps.processRunner.run.mock.calls[0][0]
    expect(call.args[1]).toContain("echo interpolated")
  })

  it("returns failed when exit code is non-zero", async () => {
    const deps = mockRuntimeDeps({ stdout: "", stderr: "not found", exitCode: 1, signal: null, timedOut: false, durationMs: 20 })
    const r = await scriptNodeExecutor.execute({
      config: { script: "false", shell: "posix", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(r.status).toBe("failed")
    expect(r.error).toContain("1")
  })

  it("returns failed when process times out", async () => {
    const deps = mockRuntimeDeps({ stdout: "", stderr: "", exitCode: null, signal: null, timedOut: true, durationMs: 60000 })
    const r = await scriptNodeExecutor.execute({
      config: { script: "sleep 999", shell: "posix", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(r.status).toBe("failed")
    expect(r.error).toContain("超时")
  })

  it("uses defaultCwd from runtimeDeps when no cwd in config", async () => {
    const deps = mockRuntimeDeps({ stdout: "ok", stderr: null, exitCode: 0, signal: null, timedOut: false, durationMs: 5 })
    await scriptNodeExecutor.execute({
      config: { script: "pwd", shell: "posix", variables: [] },
      resolvedVariables: {},
      context: ctx,
      agentDeps,
      runtimeDeps: deps,
    })
    expect(deps.processRunner.run.mock.calls[0][0].cwd).toBe("/home/user")
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run workflow-nodes/script/__tests__/executor.test.ts 2>&1 | tail -5`
Expected: FAIL

- [ ] **Step 4: 实现 executor.main.ts**

```typescript
// workflow-nodes/script/executor.main.ts
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { ScriptNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { resolveShellCommand } from "../../electron/services/shell-exec"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.script-executor")

const UNLIMITED_OUTPUT_BYTES = Number.MAX_SAFE_INTEGER

export const scriptNodeExecutor: NodeExecutor<ScriptNodeConfig> = {
  async execute(input: NodeExecutionInput<ScriptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, runtimeDeps, context } = input

    if (!runtimeDeps) {
      return { status: "failed", output: "", error: "runtimeDeps 未注入", durationMs: 0 }
    }

    input.onProgress?.("resolving_variables", "解析变量…")
    const script = interpolatePrompt(config.script, resolvedVariables)

    input.onProgress?.("executing", "执行脚本…")
    logger.info("script node executing", {
      runId: context.runId, shell: config.shell, scriptLength: script.length,
    })

    const shell = resolveShellCommand(config.shell, script, {
      platform: runtimeDeps.platform as NodeJS.Platform,
      posixLogin: config.posixLogin,
      windowsDefault: "cmd",
    })
    const timeoutMs = config.timeoutMins === null
      ? undefined
      : (config.timeoutMins ?? 30) * 60_000

    const result = await runtimeDeps.processRunner.run({
      actor: { kind: "user", id: "workflow", display: "Workflow" },
      action: "shell.exec",
      command: shell.command,
      args: [...shell.args],
      cwd: runtimeDeps.defaultCwd,
      env: config.env,
      envAllowlist: config.env ? Object.keys(config.env) : undefined,
      pathStrategy: config.pathStrategy,
      timeoutMs,
      abortSignal: context.abortSignal,
      output: { stdout: "buffer", stderr: "buffer", maxBufferBytes: UNLIMITED_OUTPUT_BYTES },
      metadata: { source: "workflow", runId: context.runId },
    })

    const durationMs = Date.now() - start

    if (result.timedOut) {
      logger.warn("script node timed out", { runId: context.runId, durationMs })
      return { status: "failed", output: result.stdout ?? "", error: "脚本执行超时", durationMs }
    }

    if (context.abortSignal.aborted && result.signal !== null) {
      return { status: "cancelled", output: "", error: "运行被取消", durationMs }
    }

    if (result.exitCode !== 0 || result.error) {
      logger.warn("script node failed", {
        runId: context.runId, exitCode: result.exitCode, durationMs,
      })
      return {
        status: "failed",
        output: result.stdout ?? "",
        error: `脚本退出码 ${String(result.exitCode)}`,
        durationMs,
      }
    }

    logger.info("script node succeeded", {
      runId: context.runId, outputLength: (result.stdout ?? "").length, durationMs,
    })
    return { status: "success", output: result.stdout ?? "", durationMs }
  },
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run workflow-nodes/script/__tests__/executor.test.ts 2>&1 | tail -10`
Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add workflow-nodes/script/schema.ts workflow-nodes/script/executor.main.ts workflow-nodes/script/__tests__/executor.test.ts
git commit -m "feat(workflow): add script node executor with tests"
```

---

## Task 8: Script 节点 — manifest + card + panel + 注册

**Files:**
- Create: `workflow-nodes/script/manifest.ts`
- Create: `workflow-nodes/script/card.tsx`
- Create: `workflow-nodes/script/panel.tsx`
- Create: `workflow-nodes/script/index.ts`
- Modify: `workflow-nodes/register.main.ts`
- Modify: `workflow-nodes/register.renderer.ts`
- Modify: `workflow-nodes/panel-registry.ts`

- [ ] **Step 1: 创建 manifest.ts**

```typescript
// workflow-nodes/script/manifest.ts
import { Terminal } from "lucide-react"
import type { NodeManifest } from "../types"
import type { ScriptNodeConfig } from "./schema"
import { scriptNodeConfigSchema } from "./schema"

export const scriptNodeManifest: NodeManifest<ScriptNodeConfig> = {
  type: "script",
  title: "脚本",
  icon: Terminal,
  color: "bg-secondary",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({
    title: `${c.shell.toUpperCase()} 脚本`,
    subtitle: c.script.split("\n")[0]?.slice(0, 50) || "空脚本",
  }),
  configFields: [
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "shell", kind: "select", label: "Shell" },
    { name: "script", kind: "text", label: "脚本" },
  ],
  configSchema: scriptNodeConfigSchema,
}
```

- [ ] **Step 2: 创建 card.tsx**

```tsx
// workflow-nodes/script/card.tsx
import { cn } from "@/lib/utils"
import { scriptNodeManifest } from "./manifest"
import type { ScriptNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "cancelled": return "opacity-60 border-muted-foreground"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}

export function ScriptNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: ScriptNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = scriptNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56 shadow-sm", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "脚本"}</span>
        {status === "running" && timer && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground truncate font-medium">{config.shell.toUpperCase()}</p>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">{config.script.split("\n")[0] || "空脚本"}</p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

- [ ] **Step 3: 创建 panel.tsx**

```tsx
// workflow-nodes/script/panel.tsx
import { useRef } from "react"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { ScriptNodeConfig } from "./schema"
import { ScriptConfigForm } from "../../action-packages/builtin/script/config.renderer"
import { VariableBindingEditor } from "../variable-binding-editor"
import { CollapsibleSection } from "../collapsible-section"

export interface ScriptNodePanelProps {
  config: ScriptNodeConfig
  onChange: (config: ScriptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
}

export function ScriptNodePanel({ config, onChange, upstreamNodes, workflowParams }: ScriptNodePanelProps) {
  const lastCommittedRef = useRef<ScriptNodeConfig>(config)

  const commit = (overrides?: Partial<ScriptNodeConfig>) => {
    const next: ScriptNodeConfig = { ...lastCommittedRef.current, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  const varSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="输入映射" summary={varSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="脚本配置">
        <ScriptConfigForm
          value={config}
          onChange={(v) => commit(v)}
          idPrefix="workflow-node-script"
        />
      </CollapsibleSection>
    </div>
  )
}
```

- [ ] **Step 4: 创建 index.ts**

```typescript
// workflow-nodes/script/index.ts
export { scriptNodeManifest } from "./manifest"
export { scriptNodeExecutor } from "./executor.main"
export { scriptNodeConfigSchema } from "./schema"
export type { ScriptNodeConfig } from "./schema"
```

- [ ] **Step 5: 注册到 register.main.ts**

在 `workflow-nodes/register.main.ts` 末尾追加：

```typescript
import { scriptNodeManifest, scriptNodeExecutor } from "./script"
nodeTypeRegistry.register(scriptNodeManifest, scriptNodeExecutor)
```

- [ ] **Step 6: 注册到 register.renderer.ts**

在 `workflow-nodes/register.renderer.ts` 末尾追加：

```typescript
import { scriptNodeManifest } from "./script/manifest"
nodeTypeRegistry.registerManifest(scriptNodeManifest)
```

- [ ] **Step 7: 注册到 panel-registry.ts**

在 `workflow-nodes/panel-registry.ts` 中添加 import 和注册：

```typescript
import { ScriptNodePanel } from "./script/panel"

// 在 panelRegistry Map 中追加：
["script", ScriptNodePanel as unknown as PanelComponent],
```

- [ ] **Step 8: 运行全量类型检查和测试**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20 && npx vitest run workflow-nodes/ 2>&1 | tail -15`
Expected: 类型检查通过，所有工作流节点测试通过

- [ ] **Step 9: Commit**

```bash
git add workflow-nodes/script/ workflow-nodes/register.main.ts workflow-nodes/register.renderer.ts workflow-nodes/panel-registry.ts
git commit -m "feat(workflow): add script node with manifest, card, panel, and registration"
```

---

## Task 9: 集成验证

**Files:** 无新文件

- [ ] **Step 1: 运行全量测试套件**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx vitest run 2>&1 | tail -20`
Expected: 所有测试通过，无回归

- [ ] **Step 2: 运行类型检查**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --project tsconfig.json 2>&1 | tail -5`
Expected: 无错误

- [ ] **Step 3: 启动 dev 验证节点出现在编辑器面板**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

验证：
1. 打开工作流编辑器
2. 节点面板中应出现 "HTTP 请求" 和 "脚本" 两个新节点
3. 拖入画布后能打开配置面板
4. 配置面板中共享表单组件正常渲染

- [ ] **Step 4: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix(workflow): integration fixes for http_request and script nodes"
```
