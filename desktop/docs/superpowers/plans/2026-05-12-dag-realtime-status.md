# DAG 实时运行状态可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作流 DAG 视图在运行时实时展示节点执行进度（进度条动画、阶段文字、计时器）和边的数据流动（光点动画 + 颜色变化）。

**Architecture:** 后端执行器通过新增 `onProgress` 回调发射阶段事件，引擎转发为 `node:progress` IPC 事件；前端 hook 接收后更新 `progressLabel` 到 nodeResults state；节点卡片组件读取状态渲染进度条、阶段文字和计时器；边组件根据 source 节点状态切换样式并在完成瞬间播放 SVG 光点动画。

**Tech Stack:** React 19, @xyflow/react, Tailwind CSS, Electron IPC

---

### Task 1: 扩展类型定义

**Files:**
- Modify: `src/types/workflow.ts`
- Modify: `workflow-nodes/types.ts`

- [ ] **Step 1: 扩展 NodeRunResult 添加 progressLabel**

在 `src/types/workflow.ts` 的 `NodeRunResult` 接口中添加字段：

```typescript
export interface NodeRunResult {
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "skipped"
  input: { variables: Record<string, string>; prompt?: string }
  output?: string; outputs?: Record<string, unknown>; activeBranch?: string; error?: string
  startedAt?: number; endedAt?: number; durationMs?: number
  progressLabel?: string
}
```

- [ ] **Step 2: 添加 node:progress 事件到 WorkflowEvent 联合类型**

在 `src/types/workflow.ts` 的 `WorkflowEvent` 类型中添加：

```typescript
export type WorkflowEvent =
  | { type: "workflow:started"; runId: string; workflowId: string }
  | { type: "node:started"; runId: string; nodeId: string; startedAt?: number }
  | { type: "node:progress"; runId: string; nodeId: string; phase: string; label: string }
  | { type: "node:completed"; runId: string; nodeId: string; output: unknown; result?: NodeRunResult }
  | { type: "node:failed"; runId: string; nodeId: string; error: string; result?: NodeRunResult }
  | { type: "node:skipped"; runId: string; nodeId: string; result?: NodeRunResult }
  | { type: "edge:activated"; runId: string; from: string; to: string }
  | { type: "workflow:completed"; runId: string; result: WorkflowRunResult }
  | { type: "workflow:failed"; runId: string; error: string; result?: WorkflowRunResult }
  | { type: "workflow:cancelled"; runId: string; result?: WorkflowRunResult }
```

- [ ] **Step 3: 扩展 NodeExecutionInput 添加 onProgress 回调**

在 `workflow-nodes/types.ts` 的 `NodeExecutionInput` 接口中添加：

```typescript
export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
  onProgress?: (phase: string, label: string) => void
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/workflow.ts workflow-nodes/types.ts
git commit -m "feat(workflow): add node:progress event type and onProgress callback"
```

---

### Task 2: 执行器发射 progress 事件

**Files:**
- Modify: `workflow-nodes/prompt/executor.main.ts`
- Modify: `workflow-nodes/switch/executor.main.ts`

- [ ] **Step 1: Prompt 执行器添加阶段发射**

```typescript
export const promptNodeExecutor: NodeExecutor<PromptNodeConfig> = {
  async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()

    input.onProgress?.("resolving_variables", "解析变量…")
    const prompt = interpolate(input.config.prompt, input.resolvedVariables)

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("prompt node executing", {
      runId: input.context.runId, agent: input.config.agent,
      promptPreview: prompt.slice(0, 200),
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    const result = await input.agentDeps.sendToAgent({ agent: input.config.agent, prompt, abortSignal: input.context.abortSignal })
    const durationMs = Date.now() - start

    if (result.status === "failed") {
      logger.warn("prompt node agent call failed", {
        runId: input.context.runId, agent: input.config.agent,
        error: result.error, durationMs,
      })
      return { status: "failed", output: "", error: result.error, durationMs }
    }

    input.onProgress?.("processing_output", "处理输出…")
    logger.info("prompt node succeeded", {
      runId: input.context.runId, agent: input.config.agent,
      outputPreview: result.response.slice(0, 200), durationMs,
    })
    return { status: "success", output: result.response, durationMs }
  },
}
```

- [ ] **Step 2: Switch 执行器添加阶段发射**

```typescript
export const switchNodeExecutor: NodeExecutor<SwitchNodeConfig> = {
  async execute(input: NodeExecutionInput<SwitchNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, agentDeps, context } = input
    const ids = config.branches.map((b) => b.id)

    input.onProgress?.("resolving_variables", "解析变量…")
    const basePrompt = interpolate(config.prompt, resolvedVariables)
    const prompt = `${basePrompt}\n\n---\n你必须只回复以下选项之一（不要包含任何其他文字）：\n${ids.map((id) => `- ${id}`).join("\n")}`

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("switch node executing", {
      runId: context.runId, agent: config.agent,
      branchIds: ids, defaultBranch: config.defaultBranch ?? null,
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    const agentResult = await agentDeps.sendToAgent({ agent: config.agent, prompt, abortSignal: context.abortSignal })
    const durationMs = Date.now() - start

    if (agentResult.status === "failed") {
      logger.warn("switch node agent call failed", {
        runId: context.runId, error: agentResult.error, durationMs,
      })
      return { status: "failed", output: "", error: agentResult.error, durationMs }
    }

    input.onProgress?.("matching_branch", "匹配分支…")
    const rawResponse = agentResult.response.trim()
    const matched = matchBranch(rawResponse, ids)

    if (matched) {
      logger.info("switch node branch matched", {
        runId: context.runId, activeBranch: matched,
        rawResponse: rawResponse.slice(0, 200), durationMs,
        normalizedResponse: normalizeResponse(rawResponse).slice(0, 100),
      })
      return { status: "success", output: matched, activeBranch: matched, durationMs }
    }

    if (config.defaultBranch) {
      logger.info("switch node using default branch (no match)", {
        runId: context.runId, activeBranch: config.defaultBranch,
        rawResponse: rawResponse.slice(0, 200), durationMs,
      })
      return { status: "success", output: config.defaultBranch, activeBranch: config.defaultBranch, durationMs }
    }

    logger.warn("switch node branch match failed — no match and no default", {
      runId: context.runId, rawResponse: rawResponse.slice(0, 500),
      branchIds: ids, durationMs,
    })
    return {
      status: "failed", output: "", durationMs,
      error: `Agent 响应 "${rawResponse.slice(0, 100)}" 不匹配任何分支 [${ids.join(", ")}]`,
    }
  },
}
```

- [ ] **Step 3: Commit**

```bash
git add workflow-nodes/prompt/executor.main.ts workflow-nodes/switch/executor.main.ts
git commit -m "feat(workflow): emit progress phases from prompt and switch executors"
```

---

### Task 3: 引擎转发 progress 事件

**Files:**
- Modify: `electron/services/workflow/workflow-engine.ts`

- [ ] **Step 1: 在 executor.execute 调用时传入 onProgress 回调**

在 `workflow-engine.ts` 第 134 行附近，修改 `executor.execute` 调用，添加 `onProgress`：

```typescript
const execResult = await executor.execute({
  config: cfg, resolvedVariables: resolved,
  context: { projectId: projectId ?? def.id, runId, abortSignal: effectiveAbortSignal },
  agentDeps: this.agentDeps,
  onProgress: (phase, label) => {
    emit({ type: "node:progress", runId, nodeId, phase, label })
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/workflow/workflow-engine.ts
git commit -m "feat(workflow): forward node:progress events from engine to IPC"
```

---

### Task 4: 前端 hook 处理 node:progress 事件

**Files:**
- Modify: `src/modules/workflow/hooks/use-workflow-events.ts`
- Modify: `src/modules/workflow/runner/runner-app.tsx`

- [ ] **Step 1: 扩展 WorkflowEventCallbacks 接口**

在 `use-workflow-events.ts` 中添加 `onNodeProgress` 回调：

```typescript
export interface WorkflowEventCallbacks {
  onNodeStarted?: (nodeId: string, partial?: Partial<NodeRunResult>) => void
  onNodeProgress?: (nodeId: string, phase: string, label: string) => void
  onNodeCompleted?: (nodeId: string, output: unknown, result?: NodeRunResult) => void
  onNodeFailed?: (nodeId: string, error: string, result?: NodeRunResult) => void
  onNodeSkipped?: (nodeId: string, result?: NodeRunResult) => void
  onCompleted?: (nodeResults: Record<string, NodeRunResult>) => void
  onFailed?: (error: string, nodeResults?: Record<string, NodeRunResult>) => void
  onCancelled?: (nodeResults?: Record<string, NodeRunResult>) => void
}
```

- [ ] **Step 2: 在事件监听中处理 node:progress**

在 `useWorkflowEvents` 的 event listener 中，`node:started` 分支之后添加：

```typescript
} else if (event.type === "node:progress") {
  cbRef.current.onNodeProgress?.(event.nodeId, event.phase, event.label)
}
```

- [ ] **Step 3: 在 runner-app.tsx 中连接 onNodeProgress**

在 `useWorkflowEvents` 调用中添加 `onNodeProgress` 回调：

```typescript
useWorkflowEvents(runId, {
  onNodeStarted: (nodeId, partial) => setNodeResults((r) => ({
    ...r,
    [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), ...partial, status: "running" as const },
  })),
  onNodeProgress: (nodeId, _phase, label) => setNodeResults((r) => {
    const existing = r[nodeId]
    if (!existing || existing.status !== "running") return r
    return { ...r, [nodeId]: { ...existing, progressLabel: label } }
  }),
  // ...rest unchanged
})
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/workflow/hooks/use-workflow-events.ts src/modules/workflow/runner/runner-app.tsx
git commit -m "feat(workflow): handle node:progress events in renderer"
```

---

### Task 5: 进度条组件

**Files:**
- Create: `src/modules/workflow/runner/node-progress-bar.tsx`

- [ ] **Step 1: 创建 NodeProgressBar 组件**

```typescript
export function NodeProgressBar() {
  return (
    <div className="absolute bottom-1.5 left-2 right-2 h-[3px] rounded-sm bg-zinc-800 overflow-hidden">
      <div className="absolute top-0 left-0 h-full w-[35%] rounded-sm will-change-transform animate-[indeterminate-slide_1.8s_cubic-bezier(0.4,0,0.2,1)_infinite] bg-[linear-gradient(90deg,#2563eb,#3b82f6,#60a5fa,#93c5fd,#60a5fa,#3b82f6)] bg-[length:200%_100%] animate-[indeterminate-slide_1.8s_cubic-bezier(0.4,0,0.2,1)_infinite,indeterminate-shimmer_3s_linear_infinite]" />
    </div>
  )
}
```

注意：由于 Tailwind 不支持复合 animation，需要在 `src/styles/globals.css` 中添加 keyframes，或使用内联 style。实际实现使用 style 属性：

```typescript
export function NodeProgressBar() {
  return (
    <div className="absolute bottom-1.5 left-2 right-2 h-[3px] rounded-sm overflow-hidden" style={{ background: "#27272a" }}>
      <div
        className="absolute top-0 left-0 h-full w-[35%] rounded-sm"
        style={{
          background: "linear-gradient(90deg, #2563eb, #3b82f6, #60a5fa, #93c5fd, #60a5fa, #3b82f6)",
          backgroundSize: "200% 100%",
          willChange: "transform",
          animation: "indeterminate-slide 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite, indeterminate-shimmer 3s linear infinite",
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: 添加 keyframes 到 globals.css**

在 `src/styles/globals.css` 末尾添加：

```css
@keyframes indeterminate-slide {
  0% { transform: translateX(-100%); }
  85% { transform: translateX(290%); }
  100% { transform: translateX(290%); }
}

@keyframes indeterminate-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/workflow/runner/node-progress-bar.tsx src/styles/globals.css
git commit -m "feat(workflow): add NodeProgressBar component with indeterminate animation"
```

---

### Task 6: 节点卡片集成进度条、阶段文字和计时器

**Files:**
- Modify: `workflow-nodes/prompt/card.tsx`
- Modify: `workflow-nodes/switch/card.tsx`
- Modify: `workflow-nodes/end/card.tsx`
- Modify: `src/modules/workflow/runner/runner-node-wrappers.tsx`

- [ ] **Step 1: 修改 runner-node-wrappers 传递 progressLabel 和 startedAt**

```typescript
export const RunnerNodeResultsContext = createContext<Record<string, NodeRunResult>>({})

export function RunnerPromptNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const status = result?.status
  const name = (data as { name?: string }).name
  return (
    <div>
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard
        config={data as PromptNodeConfig}
        name={name}
        selected={selected}
        status={status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

同样修改 `RunnerSwitchNodeWrapper` 和 `RunnerEndNodeWrapper`。

- [ ] **Step 2: 创建 NodeRunningTimer hook**

在 `src/modules/workflow/runner/node-progress-bar.tsx` 中添加（同文件）：

```typescript
import { useState, useEffect } from "react"

export function useRunningTimer(startedAt?: number, active?: boolean): string {
  const [elapsed, setElapsed] = useState("")

  useEffect(() => {
    if (!active || !startedAt) { setElapsed(""); return }
    const update = () => {
      const sec = Math.floor((Date.now() - startedAt) / 1000)
      const m = Math.floor(sec / 60)
      const s = sec % 60
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt, active])

  return elapsed
}
```

- [ ] **Step 3: 修改 PromptNodeCard 接收并渲染新 props**

```typescript
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"

export function PromptNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: PromptNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-52 shadow-sm", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || config.agent || "Prompt"}</span>
        {status === "running" && timer && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-xs text-muted-foreground truncate">{progressLabel}</p>
      ) : (
        <p className="text-xs text-muted-foreground truncate">{config.agent || config.prompt.slice(0, 50) || "无 Prompt"}</p>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

- [ ] **Step 4: 修改 SwitchNodeCard 同样集成**

在 SwitchNodeCard 中添加 `progressLabel`、`startedAt` props，在 header 区域显示计时器和阶段文字，在卡片底部（分支列表下方）显示进度条：

```typescript
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"

export function SwitchNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: SwitchNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const timer = useRunningTimer(startedAt, status === "running")
  const totalHeight = SWITCH_HEADER_H + config.branches.length * SWITCH_BRANCH_H
  return (
    <div
      className={cn("relative rounded-lg border bg-card w-52 shadow-sm overflow-hidden flex flex-col", selected && "ring-2 ring-primary", statusClass(status))}
      style={{ height: totalHeight }}
    >
      <div className="px-3 py-2 flex flex-col justify-center shrink-0" style={{ height: SWITCH_HEADER_H }}>
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{name || config.agent || "Switch"}</span>
          {status === "running" && timer && (
            <span className="ml-auto text-[10px] font-mono text-muted-foreground">{timer}</span>
          )}
        </div>
        {status === "running" && progressLabel ? (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{progressLabel}</p>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {config.agent || "未选择 Agent"} · {config.branches.length} 个分支
          </p>
        )}
      </div>
      <div className="border-t border-border flex-1">
        {config.branches.map((b) => (
          <div key={b.id} className="flex items-center px-3 border-b border-border last:border-b-0" style={{ height: SWITCH_BRANCH_H }}>
            <span className="text-xs text-muted-foreground flex-1 truncate">{b.label}</span>
            <div className="h-px w-3 bg-muted-foreground/40" />
          </div>
        ))}
      </div>
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

- [ ] **Step 5: 移除 animate-pulse，更新 statusClass**

在所有三个 card 文件中，将 `statusClass` 的 running 分支从 `"border-primary animate-pulse"` 改为 `"border-primary"`：

```typescript
function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add workflow-nodes/prompt/card.tsx workflow-nodes/switch/card.tsx workflow-nodes/end/card.tsx src/modules/workflow/runner/runner-node-wrappers.tsx src/modules/workflow/runner/node-progress-bar.tsx
git commit -m "feat(workflow): integrate progress bar, timer, and phase text into node cards"
```

---

### Task 7: 边的状态样式和光点动画

**Files:**
- Create: `src/modules/workflow/runner/runner-edge.tsx`
- Modify: `src/modules/workflow/runner/dag-view.tsx`

- [ ] **Step 1: 创建 RunnerEdge 组件**

```typescript
import { useContext, useEffect, useRef, useState } from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import { Badge } from "@/components/ui/badge"
import { RunnerNodeResultsContext } from "./runner-node-wrappers"

export function RunnerEdge({
  id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data,
}: EdgeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const sourceStatus = nodeResults[source]?.status
  const activated = sourceStatus === "success"

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  const label = (data as { label?: string } | undefined)?.label
  const [showParticle, setShowParticle] = useState(false)
  const prevStatusRef = useRef(sourceStatus)

  useEffect(() => {
    if (prevStatusRef.current === "running" && sourceStatus === "success") {
      setShowParticle(true)
      const timer = setTimeout(() => setShowParticle(false), 800)
      return () => clearTimeout(timer)
    }
    prevStatusRef.current = sourceStatus
  }, [sourceStatus])

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={activated ? "#3b82f6" : "#3f3f46"}
        strokeWidth={2}
        strokeOpacity={activated ? 0.6 : 1}
        strokeDasharray={activated ? undefined : "4 4"}
      />
      {showParticle && (
        <>
          <circle r={4} fill="#60a5fa" opacity={0.9}>
            <animateMotion dur="0.8s" fill="freeze" path={edgePath} calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" keyPoints="0;1" />
          </circle>
          <circle r={7} fill="#3b82f6" opacity={0.3}>
            <animateMotion dur="0.8s" fill="freeze" path={edgePath} calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" keyPoints="0;1" />
          </circle>
        </>
      )}
      {label && (
        <EdgeLabelRenderer>
          <Badge
            variant="outline"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
            className="absolute bg-background text-xs pointer-events-none nodrag nopan"
          >
            {label}
          </Badge>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
```

- [ ] **Step 2: 在 dag-view.tsx 中注册 RunnerEdge**

替换 `edgeTypes` 和边的映射逻辑：

```typescript
import { RunnerEdge } from "./runner-edge"

const edgeTypes = { default: RunnerEdge, branch: RunnerEdge }
```

移除旧的 `BranchEdge` import。

边映射中确保所有边都有 type：

```typescript
const edges: Edge[] = useMemo(() =>
  definition.edges.map((e) => {
    const label = e.branch ? resolveBranchLabel(definition, e.from, e.branch) : undefined
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: e.branch,
      type: e.branch ? "branch" : "default",
      data: label ? { label } : undefined,
    }
  }),
  [definition],
)
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/workflow/runner/runner-edge.tsx src/modules/workflow/runner/dag-view.tsx
git commit -m "feat(workflow): add RunnerEdge with status styling and particle animation"
```

---

### Task 8: 验证与清理

**Files:**
- All modified files

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm tsc --noEmit
```

修复所有类型错误。

- [ ] **Step 2: 启动 dev 并手动验证**

```bash
pnpm dev
```

验证清单：
1. 运行一个工作流，观察 running 节点是否显示进度条动画
2. 确认进度条是固定宽度 + ease 曲线 + 流光效果
3. 确认右上角计时器在跳动
4. 确认阶段文字在切换（"解析变量…" → "调用模型…" → "等待响应…"）
5. 确认节点完成时光点沿边播放一次
6. 确认完成后边变为蓝色实线
7. 确认 pending 节点的边保持灰色虚线
8. 确认 failed 节点的出边保持灰色虚线

- [ ] **Step 3: 确认无 animate-pulse 残留**

```bash
grep -r "animate-pulse" workflow-nodes/ src/modules/workflow/
```

应无匹配结果。

- [ ] **Step 4: Final commit（如有修复）**

```bash
git add -A && git commit -m "fix(workflow): address type errors and polish DAG status visuals"
```
