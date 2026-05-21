# Workflow Run Report Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click Markdown copying for whole workflow run reports and selected node reports in the workflow runner.

**Architecture:** Keep the feature renderer-only. Put report generation in one pure module under the workflow runner, then wire clipboard actions into `WorkflowRunnerApp`, `RunnerToolbar`, and `NodeResultPanel` using existing shadcn buttons and `sonner` toasts.

**Tech Stack:** Electron renderer, React, TypeScript, Vitest/jsdom, shadcn/ui, lucide-react, sonner.

---

## File Structure

- Create `desktop/src/modules/workflow/runner/run-report.ts`
  - Owns Markdown report generation, node ordering, JSON-safe formatting, timestamp formatting, and duration formatting.
  - Exports `formatWorkflowRunReport` and `formatNodeRunReport`.
- Create `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts`
  - Tests report content, node ordering, node-type headings, unredacted values, and JSON-safe formatting.
- Modify `desktop/src/modules/workflow/runner/runner-toolbar.tsx`
  - Adds a `复制` toolbar button and `onCopyRunReport` prop.
- Modify `desktop/src/modules/workflow/runner/node-result-panel.tsx`
  - Adds a `复制` header button and `onCopyNodeReport` prop.
- Modify `desktop/src/modules/workflow/runner/runner-app.tsx`
  - Builds reports from existing runner state and writes them to `navigator.clipboard`.
  - Shows concise success/failure toasts.
- Modify tests:
  - `desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx`
  - `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`
  - `desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx`

## Task 1: Markdown Report Formatter

**Files:**
- Create: `desktop/src/modules/workflow/runner/run-report.ts`
- Create: `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Create `desktop/src/modules/workflow/runner/__tests__/run-report.test.ts` with tests that define expected report behavior before implementation:

```ts
import { describe, expect, it } from "vitest"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import { formatNodeRunReport, formatWorkflowRunReport } from "../run-report"

describe("workflow run reports", () => {
  it("formats a full workflow report with overview, ordering, and every node", () => {
    const report = formatWorkflowRunReport({
      definition: workflowDefinition(),
      runId: "run-1",
      runState: "running",
      runParams: { topic: "debug-token=secret-value" },
      nodeResults: {
        "node-2": nodeResult("node-2", {
          status: "success",
          startedAt: 2000,
          endedAt: 2500,
          durationMs: 500,
          output: "HTTP output token=secret-value",
          outputs: { status: 200, body: { ok: true } },
        }),
        "node-1": nodeResult("node-1", {
          status: "success",
          startedAt: 1000,
          endedAt: 1500,
          durationMs: 500,
          input: {
            variables: { input: "raw prompt variable token=secret-value" },
            prompt: "Resolved prompt token=secret-value",
          },
          output: "Prompt output",
        }),
      },
      runError: null,
    })

    expect(report).toContain("# 工作流运行报告：Debug workflow")
    expect(report).toContain("- 工作流 ID：workflow-1")
    expect(report).toContain("- 运行 ID：run-1")
    expect(report).toContain("- 状态：running")
    expect(report).toContain("- 快照：是")
    expect(report).toContain('"topic": "debug-token=secret-value"')
    expect(report).toContain("- 节点数：3")
    expect(report).toContain("- 边数：2")
    expect(report).toContain("1. Prompt node（prompt）：success")
    expect(report).toContain("2. HTTP node（http_request）：success")
    expect(report).toContain("3. Never started（script）：pending")
    expect(report.indexOf("### 1. Prompt node")).toBeLessThan(report.indexOf("### 2. HTTP node"))
    expect(report.indexOf("### 2. HTTP node")).toBeLessThan(report.indexOf("### 3. Never started"))
    expect(report).toContain("Resolved prompt token=secret-value")
    expect(report).toContain("HTTP output token=secret-value")
    expect(report).toContain("## 设置")
  })

  it("formats a single node report with config, inputs, outputs, errors, and branch label", () => {
    const report = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[1],
      result: nodeResult("node-2", {
        status: "failed",
        startedAt: 3000,
        endedAt: 3600,
        durationMs: 600,
        input: { variables: { url: "https://example.test" } },
        output: "partial body",
        outputs: { response: { status: 500 } },
        activeBranch: "branch1",
        error: "backend failed token=secret-value",
      }),
      orderIndex: 2,
    })

    expect(report).toContain("# 节点运行报告：HTTP node")
    expect(report).toContain("- 节点 ID：node-2")
    expect(report).toContain("- 类型：http_request")
    expect(report).toContain("- 状态：failed")
    expect(report).toContain("- 定义顺序：2")
    expect(report).toContain("- 命中分支：branch1 (branch1)")
    expect(report).toContain("## 请求配置")
    expect(report).toContain('"Authorization": "Bearer token=secret-value"')
    expect(report).toContain('"url": "https://example.test"')
    expect(report).toContain("partial body")
    expect(report).toContain('"status": 500')
    expect(report).toContain("backend failed token=secret-value")
  })

  it("formats bigint and circular objects without throwing", () => {
    const cyclic: Record<string, unknown> = { label: "cycle" }
    cyclic.self = cyclic

    const report = formatNodeRunReport({
      definition: workflowDefinition(),
      node: workflowDefinition().nodes[0],
      result: nodeResult("node-1", {
        outputs: { count: BigInt(1), cyclic },
      }),
      orderIndex: 1,
    })

    expect(report).toContain('"count": "1"')
    expect(report).toContain('"self": "[Circular]"')
  })
})

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Debug workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    defaultProjectId: "project-1",
    defaultProviderId: "provider-1",
    defaultModelTier: "sonnet",
    defaultNodeTimeoutMins: 10,
    params: [{ name: "topic", type: "text", default: null }],
    nodes: [
      {
        id: "node-1",
        name: "Prompt node",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: {
          providerId: "provider-1",
          modelTier: "sonnet",
          variables: [{ name: "input", source: { type: "param", param: "topic" } }],
          prompt: "Prompt template {{input}}",
        },
      },
      {
        id: "node-2",
        name: "HTTP node",
        type: "http_request",
        position: { x: 100, y: 0 },
        config: {
          method: "GET",
          url: "https://example.test",
          headers: { Authorization: "Bearer token=secret-value" },
          bodyType: "none",
          variables: [{ name: "url", source: { type: "node_output", node: "node-1" } }],
          branches: [{ id: "branch1", label: "分支 1" }],
        },
      },
      {
        id: "node-3",
        name: "Never started",
        type: "script",
        position: { x: 200, y: 0 },
        config: { shell: "posix", script: "echo $value", variables: [] },
      },
    ],
    edges: [
      { id: "edge-1", from: "node-1", to: "node-2" },
      { id: "edge-2", from: "node-2", to: "node-3", branch: "branch1" },
    ],
  }
}

function nodeResult(nodeId: string, patch: Partial<NodeRunResult> = {}): NodeRunResult {
  return {
    nodeId,
    status: "success",
    input: { variables: {} },
    ...patch,
  }
}
```

- [ ] **Step 2: Run formatter tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/run-report.test.ts
```

Expected: failure because `../run-report` does not exist.

- [ ] **Step 3: Implement `run-report.ts`**

Create `desktop/src/modules/workflow/runner/run-report.ts`:

```ts
import type { NodeRunResult, WorkflowDefinition, WorkflowNode, WorkflowRunStatus } from "@/types/workflow"
import { resolveBranchLabel } from "../lib/branch-label"

interface WorkflowRunReportInput {
  readonly definition: WorkflowDefinition
  readonly runId: string
  readonly runState: WorkflowRunStatus["status"]
  readonly runParams: Record<string, unknown>
  readonly nodeResults: Record<string, NodeRunResult>
  readonly runError?: string | null
}

interface NodeRunReportInput {
  readonly definition: WorkflowDefinition
  readonly node: WorkflowNode
  readonly result: NodeRunResult
  readonly orderIndex: number
}

interface OrderedNodeRun {
  readonly node: WorkflowNode
  readonly result: NodeRunResult
  readonly definitionIndex: number
}

export function formatWorkflowRunReport(input: WorkflowRunReportInput): string {
  const orderedNodes = orderNodes(input.definition, input.nodeResults)
  const startedTimes = Object.values(input.nodeResults)
    .map((result) => result.startedAt)
    .filter((value): value is number => typeof value === "number")
  const endedTimes = Object.values(input.nodeResults)
    .map((result) => result.endedAt)
    .filter((value): value is number => typeof value === "number")

  const sections = [
    `# 工作流运行报告：${input.definition.name}`,
    [
      "## 运行概览",
      `- 工作流 ID：${input.definition.id}`,
      `- 运行 ID：${input.runId || "未记录"}`,
      `- 状态：${input.runState}`,
      `- 快照：${input.runState === "running" ? "是" : "否"}`,
      `- 开始时间：${formatTimestamp(startedTimes.length > 0 ? Math.min(...startedTimes) : undefined)}`,
      `- 结束时间：${formatTimestamp(endedTimes.length > 0 ? Math.max(...endedTimes) : undefined)}`,
      `- 总耗时：${formatDuration(resolveTotalDuration(input.nodeResults))}`,
      ...(input.runError ? [`- 错误：${input.runError}`] : []),
      "",
      "### 运行参数",
      codeBlock("json", formatJson(input.runParams)),
    ].join("\n"),
    [
      "## 工作流结构",
      `- 节点数：${input.definition.nodes.length}`,
      `- 边数：${input.definition.edges.length}`,
      `- 默认项目：${formatScalar(input.definition.defaultProjectId)}`,
      `- 默认供应商：${formatScalar(input.definition.defaultProviderId)}`,
      `- 默认模型：${formatScalar(input.definition.defaultModelTier)}`,
      `- 默认超时：${formatScalar(input.definition.defaultNodeTimeoutMins)}`,
    ].join("\n"),
    [
      "## 执行顺序",
      ...orderedNodes.map((entry, index) => `${index + 1}. ${entry.node.name}（${entry.node.type}）：${entry.result.status}，${formatDuration(entry.result.durationMs)}`),
    ].join("\n"),
    [
      "## 节点详情",
      ...orderedNodes.map((entry, index) => formatNodeRunReport({
        definition: input.definition,
        node: entry.node,
        result: entry.result,
        orderIndex: entry.definitionIndex + 1,
      }).replace(/^# 节点运行报告：.*\n\n/, `### ${index + 1}. ${entry.node.name}\n\n`)),
    ].join("\n\n"),
  ]

  return sections.join("\n\n").trimEnd() + "\n"
}

export function formatNodeRunReport(input: NodeRunReportInput): string {
  const { definition, node, result } = input
  const sections = [
    `# 节点运行报告：${node.name}`,
    formatNodeBasicInfo(definition, node, result, input.orderIndex),
    ["## 设置", codeBlock("json", formatJson(node.config))].join("\n"),
  ]

  const variables = node.config.variables
  if (variables !== undefined) {
    sections.push(["## 变量绑定", codeBlock("json", formatJson(variables))].join("\n"))
  }

  if (result.input.variables && Object.keys(result.input.variables).length > 0) {
    sections.push(["## 运行输入变量", codeBlock("json", formatJson(result.input.variables))].join("\n"))
  }

  const mainContent = resolveNodeMainContent(node, result)
  if (mainContent) {
    sections.push([`## ${mainContent.title}`, codeBlock(mainContent.language, mainContent.content)].join("\n"))
  }

  if (result.output !== undefined) {
    sections.push(["## 输出", codeBlock("text", formatTextValue(result.output))].join("\n"))
  }

  if (result.outputs && Object.keys(result.outputs).length > 0) {
    sections.push(["## 结构化输出", codeBlock("json", formatJson(result.outputs))].join("\n"))
  }

  if (result.error) {
    sections.push(["## 错误", codeBlock("text", result.error)].join("\n"))
  }

  return sections.join("\n\n").trimEnd() + "\n"
}

function orderNodes(definition: WorkflowDefinition, nodeResults: Record<string, NodeRunResult>): OrderedNodeRun[] {
  return definition.nodes
    .map((node, index) => ({
      node,
      definitionIndex: index,
      result: nodeResults[node.id] ?? { nodeId: node.id, status: "pending" as const, input: { variables: {} } },
    }))
    .sort((a, b) => {
      const aStarted = a.result.startedAt
      const bStarted = b.result.startedAt
      if (typeof aStarted === "number" && typeof bStarted === "number") return aStarted - bStarted
      if (typeof aStarted === "number") return -1
      if (typeof bStarted === "number") return 1
      return a.definitionIndex - b.definitionIndex
    })
}

function formatNodeBasicInfo(definition: WorkflowDefinition, node: WorkflowNode, result: NodeRunResult, orderIndex: number): string {
  const lines = [
    "## 基本信息",
    `- 节点 ID：${node.id}`,
    `- 类型：${node.type}`,
    `- 状态：${result.status}`,
    `- 定义顺序：${orderIndex}`,
    `- 开始时间：${formatTimestamp(result.startedAt)}`,
    `- 结束时间：${formatTimestamp(result.endedAt)}`,
    `- 耗时：${formatDuration(result.durationMs)}`,
  ]

  if (result.activeBranch) {
    const label = resolveBranchLabel(definition, node.id, result.activeBranch)
    lines.push(`- 命中分支：${label} (${result.activeBranch})`)
  }

  return lines.join("\n")
}

function resolveNodeMainContent(node: WorkflowNode, result: NodeRunResult): { title: string; language: string; content: string } | null {
  if ((node.type === "prompt" || node.type === "switch") && result.input.prompt) {
    return { title: node.type === "switch" ? "判断 Prompt" : "完整 Prompt", language: "text", content: result.input.prompt }
  }
  if (node.type === "script" && typeof node.config.script === "string") {
    return { title: "脚本", language: "text", content: node.config.script }
  }
  if (node.type === "http_request") {
    return { title: "请求配置", language: "json", content: formatJson(node.config) }
  }
  if (node.type === "end" && typeof node.config.template === "string") {
    return { title: "返回模板", language: "text", content: node.config.template }
  }
  return null
}

function resolveTotalDuration(nodeResults: Record<string, NodeRunResult>): number | undefined {
  const durations = Object.values(nodeResults)
    .map((result) => result.durationMs)
    .filter((value): value is number => typeof value === "number")
  if (durations.length === 0) return undefined
  return durations.reduce((total, duration) => total + duration, 0)
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== "number") return "未记录"
  return `${new Date(value).toLocaleString()} (${value})`
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== "number") return "未记录"
  if (value >= 1000) return `${value}ms (${(value / 1000).toFixed(2)}s)`
  return `${value}ms`
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "未记录"
  if (value === "") return "（空）"
  return String(value)
}

function formatTextValue(value: unknown): string {
  if (value === null || value === undefined) return "未记录"
  if (value === "") return "（空）"
  return String(value)
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, createJsonReplacer(), 2)
}

function createJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>()
  return (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value
  }
}

function codeBlock(language: string, content: string): string {
  const fence = content.includes("```") ? "````" : "```"
  return `${fence}${language}\n${content}\n${fence}`
}
```

- [ ] **Step 4: Run formatter tests to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/run-report.test.ts
```

Expected: all tests pass.

## Task 2: Node Result Panel Copy Action

**Files:**
- Modify: `desktop/src/modules/workflow/runner/node-result-panel.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`

- [ ] **Step 1: Write failing node panel copy test**

Append this test inside the existing `describe("NodeResultPanel", ...)` block in `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`:

```ts
it("copies the selected node report from the panel header", async () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  const onCopyNodeReport = vi.fn(async () => {})

  await act(async () => {
    root.render(
      <NodeResultPanel
        result={nodeResult()}
        nodeName="Prompt node"
        onClose={vi.fn()}
        onCopyNodeReport={onCopyNodeReport}
      />,
    )
  })

  const copyButton = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("复制"))
  expect(copyButton).toBeInstanceOf(HTMLButtonElement)

  await act(async () => {
    copyButton?.click()
    await Promise.resolve()
  })

  expect(onCopyNodeReport).toHaveBeenCalledTimes(1)

  await act(async () => {
    root.unmount()
  })
})
```

- [ ] **Step 2: Run node panel test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: failure because `NodeResultPanelProps` has no `onCopyNodeReport` prop and no copy button.

- [ ] **Step 3: Implement node panel copy button**

Update imports in `desktop/src/modules/workflow/runner/node-result-panel.tsx`:

```ts
import { ChevronDown, Copy, X } from "lucide-react"
```

Update `NodeResultPanelProps`:

```ts
interface NodeResultPanelProps {
  result: NodeRunResult
  nodeName: string
  definition?: WorkflowDefinition
  onClose: () => void
  onCopyNodeReport?: () => Promise<void>
}
```

Update the component signature:

```ts
export function NodeResultPanel({ result, nodeName, definition, onClose, onCopyNodeReport }: NodeResultPanelProps) {
```

Add this button in the header before the close button:

```tsx
{onCopyNodeReport && (
  <Button
    size="sm"
    variant="ghost"
    className="h-7"
    data-track="workflow-runner-copy-node-report"
    onClick={() => void onCopyNodeReport()}
  >
    <Copy className="h-3.5 w-3.5 mr-1" />复制
  </Button>
)}
```

Keep the existing close button unchanged.

- [ ] **Step 4: Run node panel test to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: all node panel tests pass.

## Task 3: Runner Toolbar Copy Action

**Files:**
- Modify: `desktop/src/modules/workflow/runner/runner-toolbar.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx`

- [ ] **Step 1: Write failing toolbar copy test**

Update the existing render call in `runner-toolbar.test.tsx` to pass `onCopyRunReport={onCopyRunReport}` and add copy assertions:

```ts
const onCopyRunReport = vi.fn(async () => {})

// inside <RunnerToolbar ... />
onCopyRunReport={onCopyRunReport}

const copyButton = Array.from(container.querySelectorAll("button"))
  .find((button) => button.textContent?.includes("复制"))
expect(copyButton).toBeInstanceOf(HTMLButtonElement)

await act(async () => {
  copyButton?.click()
  await Promise.resolve()
})

expect(onCopyRunReport).toHaveBeenCalledTimes(1)
expect(track).toHaveBeenCalledWith({
  component: "button",
  name: "workflow-runner-copy-run-report",
  action: "click",
})
```

- [ ] **Step 2: Run toolbar test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx
```

Expected: failure because `RunnerToolbarProps` has no `onCopyRunReport` prop and no copy button.

- [ ] **Step 3: Implement toolbar copy button**

Update imports in `desktop/src/modules/workflow/runner/runner-toolbar.tsx`:

```ts
import { Square, RotateCcw, PenLine, LayoutDashboard, List, Loader2, Copy } from "lucide-react"
```

Update `RunnerToolbarProps`:

```ts
interface RunnerToolbarProps {
  definition: WorkflowDefinition
  runState: WorkflowRunStatus["status"]
  runError?: string | null
  viewMode: ViewMode
  rerunning?: boolean
  cancelling?: boolean
  onViewModeChange: (mode: ViewMode) => void
  onCancel: () => Promise<void>
  onRerun: () => Promise<void>
  onOpenEditor: () => void
  onCopyRunReport: () => Promise<void>
}
```

Update the component signature to include `onCopyRunReport`, then add this button before the running/terminal action buttons:

```tsx
<Button size="sm" variant="outline" data-track="workflow-runner-copy-run-report" onClick={() => void onCopyRunReport()}>
  <Copy className="h-3.5 w-3.5 mr-1" />复制
</Button>
```

- [ ] **Step 4: Run toolbar test to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx
```

Expected: all toolbar tests pass.

## Task 4: Clipboard Wiring in Runner App

**Files:**
- Modify: `desktop/src/modules/workflow/runner/runner-app.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx`

- [ ] **Step 1: Update runner app mocks and write failing clipboard tests**

In `workflow-runner-app.test.tsx`, replace the `NodeResultPanel` mock with a prop-aware mock:

```ts
vi.mock("../node-result-panel", () => ({
  NodeResultPanel: ({ onCopyNodeReport }: { readonly onCopyNodeReport: () => Promise<void> }) => (
    <button type="button" data-testid="node-result-panel-copy" onClick={() => void onCopyNodeReport()}>
      copy node
    </button>
  ),
}))
```

Add a `sonner` mock near the other mocks:

```ts
const toast = vi.hoisted(() => vi.fn())

vi.mock("sonner", () => ({
  toast,
}))
```

Add clipboard setup in `beforeEach`:

```ts
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: vi.fn(async () => {}) },
})
toast.mockClear()
vi.mocked(navigator.clipboard.writeText).mockClear()
```

Add this test for whole-run copy:

```ts
it("copies the whole workflow run report from the toolbar", async () => {
  installWorkflowBridge({
    runStatus: vi.fn(async () => ({
      definition: workflowDefinition(),
      params: { topic: "token=secret-value" },
    })),
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<WorkflowRunnerApp />)
    await Promise.resolve()
  })

  const copyButton = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("复制"))
  expect(copyButton).toBeInstanceOf(HTMLButtonElement)

  await act(async () => {
    copyButton?.click()
    await Promise.resolve()
  })

  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
  const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? ""
  expect(copied).toContain("# 工作流运行报告：Workflow")
  expect(copied).toContain('"topic": "token=secret-value"')
  expect(toast).toHaveBeenCalledWith("运行报告已复制。")
})
```

Add this test for node copy:

```ts
it("copies the selected node report from the node panel", async () => {
  installWorkflowBridge({
    runStatus: vi.fn(async () => ({
      definition: workflowDefinition(),
      params: {},
    })),
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<WorkflowRunnerApp />)
    await Promise.resolve()
  })

  const dagButton = container.querySelector("[data-testid='dag-view']")
  await act(async () => {
    dagButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })

  const copyButton = container.querySelector("[data-testid='node-result-panel-copy']")
  expect(copyButton).toBeInstanceOf(HTMLButtonElement)

  await act(async () => {
    copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })

  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
  const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? ""
  expect(copied).toContain("# 节点运行报告：Prompt node")
  expect(toast).toHaveBeenCalledWith("节点报告已复制。")
})
```

Add this test for failure toast:

```ts
it("shows a concise error when report copy fails", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("clipboard denied token=secret-value"))
  installWorkflowBridge({
    runStatus: vi.fn(async () => ({
      definition: workflowDefinition(),
      params: {},
    })),
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<WorkflowRunnerApp />)
    await Promise.resolve()
  })

  const copyButton = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("复制"))

  await act(async () => {
    copyButton?.click()
    await Promise.resolve()
  })

  expect(toast).toHaveBeenCalledWith("复制失败。")
  expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=secret-value")
})
```

- [ ] **Step 2: Run runner app test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
```

Expected: failure because `WorkflowRunnerApp` does not pass copy handlers yet.

- [ ] **Step 3: Implement clipboard handlers**

Update imports in `desktop/src/modules/workflow/runner/runner-app.tsx`:

```ts
import { toast } from "sonner"
import { formatNodeRunReport, formatWorkflowRunReport } from "./run-report"
```

Add this helper near other local helpers at the bottom of the file:

```ts
function clipboardErrorDiagnostic(err: unknown): { readonly errorName?: string; readonly errorLength: number } {
  if (err instanceof Error) return { errorName: err.name, errorLength: err.message.length }
  const message = String(err)
  return { errorLength: message.length }
}
```

Add copy handlers inside `WorkflowRunnerApp` after `handleRetry`:

```ts
const handleCopyRunReport = useCallback(async () => {
  if (!definition) return
  try {
    await navigator.clipboard.writeText(formatWorkflowRunReport({
      definition,
      runId,
      runState,
      runParams,
      nodeResults,
      runError,
    }))
    toast("运行报告已复制。")
  } catch (err) {
    logger.warn("copy workflow run report failed", {
      runId,
      workflowId,
      boundary: "renderer.workflow.runner.copy-run-report",
      ...clipboardErrorDiagnostic(err),
    })
    toast("复制失败。")
  }
}, [definition, nodeResults, runError, runId, runParams, runState, workflowId])

const handleCopyNodeReport = useCallback(async () => {
  if (!definition || !selectedNodeId || !selectedResult) return
  const node = definition.nodes.find((candidate) => candidate.id === selectedNodeId)
  if (!node) return
  try {
    await navigator.clipboard.writeText(formatNodeRunReport({
      definition,
      node,
      result: selectedResult,
      orderIndex: definition.nodes.findIndex((candidate) => candidate.id === selectedNodeId) + 1,
    }))
    toast("节点报告已复制。")
  } catch (err) {
    logger.warn("copy workflow node report failed", {
      runId,
      workflowId,
      nodeId: selectedNodeId,
      boundary: "renderer.workflow.runner.copy-node-report",
      ...clipboardErrorDiagnostic(err),
    })
    toast("复制失败。")
  }
}, [definition, runId, selectedNodeId, selectedResult, workflowId])
```

Pass handlers into child components:

```tsx
<RunnerToolbar
  definition={definition}
  runState={runState}
  runError={runError}
  viewMode={viewMode}
  rerunning={rerunning}
  cancelling={cancelling}
  onViewModeChange={setViewMode}
  onCancel={handleCancel}
  onRerun={handleRerun}
  onOpenEditor={handleOpenEditor}
  onCopyRunReport={handleCopyRunReport}
/>
```

```tsx
<NodeResultPanel
  result={selectedResult}
  nodeName={definition.nodes.find((n) => n.id === selectedNodeId)?.name ?? selectedNodeId ?? ""}
  definition={definition}
  onClose={() => setSelectedNodeId(null)}
  onCopyNodeReport={handleCopyNodeReport}
/>
```

- [ ] **Step 4: Run runner app test to verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
```

Expected: all runner app tests pass.

## Task 5: Focused Verification and Cleanup

**Files:**
- Verify: all changed files from Tasks 1-4.

- [ ] **Step 1: Run focused workflow runner tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/workflow/runner/__tests__/run-report.test.ts \
  src/modules/workflow/runner/__tests__/node-result-panel.test.tsx \
  src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx \
  src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: command exits with code 0.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: command exits with code 0.

- [ ] **Step 4: Review final diff**

Run:

```bash
git diff -- desktop/src/modules/workflow/runner docs/superpowers/plans/2026-05-21-workflow-run-report-copy.md
```

Expected:

- No custom colors.
- No inline `style={{...}}`.
- No new IPC, storage, or workflow engine changes.
- Clipboard failure logs do not include raw copied content or raw clipboard error message.
- Copy report content itself remains unredacted.

- [ ] **Step 5: Commit implementation**

Only stage files touched by this feature:

```bash
git add \
  desktop/src/modules/workflow/runner/run-report.ts \
  desktop/src/modules/workflow/runner/__tests__/run-report.test.ts \
  desktop/src/modules/workflow/runner/runner-toolbar.tsx \
  desktop/src/modules/workflow/runner/node-result-panel.tsx \
  desktop/src/modules/workflow/runner/runner-app.tsx \
  desktop/src/modules/workflow/runner/__tests__/runner-toolbar.test.tsx \
  desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx \
  desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
git commit -m "feat: copy workflow run reports"
```

Expected: commit succeeds without staging unrelated dirty worktree files.

## Plan Self-Review

- Spec coverage: whole-run copy, node copy, Markdown report, all nodes, running snapshots, unredacted data, time/duration/order, renderer-only implementation, and focused tests are all mapped to Tasks 1-5.
- Placeholder scan: no placeholder steps remain; each code-changing step names the file and includes concrete code or exact edits.
- Type consistency: exported formatter names are `formatWorkflowRunReport` and `formatNodeRunReport`; UI callback names are `onCopyRunReport` and `onCopyNodeReport`; tests use the same names.
