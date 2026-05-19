# Workflow Error Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workflow editor's raw top alert validation display with a canvas-anchored floating error card, friendly validation copy, node selection, and right-panel repair hints.

**Architecture:** Keep validation semantics unchanged and add a renderer-side presentation layer under `desktop/src/modules/workflow/editor/`. Convert `ValidationError[]` into stable display items, render those items in a non-modal floating card over the canvas, add an imperative canvas selection method, and pass selected-node errors into the right configuration panel. This keeps Electron services, workflow validation rules, and node execution untouched.

**Tech Stack:** Electron, React, TypeScript, Vitest, shadcn/ui, Tailwind token classes, @xyflow/react.

---

## File Structure

- Create `desktop/src/modules/workflow/editor/validation-display.ts`: pure mapper from `WorkflowDefinition` + `ValidationError[]` to display items.
- Create `desktop/src/modules/workflow/editor/__tests__/validation-display.test.ts`: mapper unit coverage, especially raw Zod issue arrays.
- Create `desktop/src/modules/workflow/editor/workflow-error-card.tsx`: floating card and collapsed pill UI.
- Create `desktop/src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx`: card rendering, close/reopen, and row-click behavior.
- Modify `desktop/src/modules/workflow/editor/canvas.tsx`: add `selectNode(nodeId)` to `WorkflowCanvasHandle`.
- Modify `desktop/src/modules/workflow/editor/__tests__/canvas.test.tsx`: verify imperative node selection updates flow state and notifies selection.
- Modify `desktop/src/modules/workflow/editor/node-config-panel.tsx`: accept current-node validation display items and show concise repair hints above the node panel.
- Modify `desktop/workflow-nodes/panel-registry.ts`: allow node panels to receive validation display items without changing every panel immediately.
- Modify `desktop/workflow-nodes/prompt/panel.tsx` and `desktop/workflow-nodes/switch/panel.tsx`: show project/prompt/branch hints where known fields map cleanly.
- Modify `desktop/src/modules/workflow/editor/editor-app.tsx`: replace the top `Alert` with mapped display items, floating card, and selection bridge.
- Modify `desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx`: verify raw arrays are not displayed, floating card appears, collapsed entry works, and row click selects the node.

## Task 1: Validation Display Mapper

**Files:**
- Create: `desktop/src/modules/workflow/editor/validation-display.ts`
- Test: `desktop/src/modules/workflow/editor/__tests__/validation-display.test.ts`

- [ ] **Step 1: Write the failing mapper tests**

Create `desktop/src/modules/workflow/editor/__tests__/validation-display.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { ValidationError, WorkflowDefinition } from "@/types/workflow"
import { buildWorkflowValidationDisplayItems } from "../validation-display"

describe("buildWorkflowValidationDisplayItems", () => {
  it("converts raw Zod issue arrays into friendly copy", () => {
    const errors: ValidationError[] = [{
      type: "invalid_config",
      nodeId: "prompt-1",
      message: JSON.stringify([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["projectId"],
          message: "Required",
        },
      ]),
    }]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: "node:prompt-1:0",
      summary: "请选择项目，或设置工作流默认项目。",
      location: "提示词节点",
      nodeId: "prompt-1",
      fieldKey: "projectId",
      type: "invalid_config",
    })
    expect(items[0].summary).not.toContain("invalid_type")
    expect(items[0].summary).not.toContain("projectId")
    expect(items[0].summary).not.toContain("[")
  })

  it("keeps branch and workflow-level validation copy concise", () => {
    const errors: ValidationError[] = [
      {
        type: "invalid_switch_edge",
        nodeId: "switch-1",
        message: "Switch 节点「判断」的分支「兜底」没有连接到下游节点",
      },
      {
        type: "missing_end_node",
        message: "工作流必须包含一个结束节点",
      },
    ]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items[0]).toMatchObject({
      summary: "分支“兜底”需要连接到下游节点。",
      location: "判断",
      nodeId: "switch-1",
    })
    expect(items[1]).toMatchObject({
      summary: "工作流需要一个结束节点。",
      location: "工作流",
      nodeId: undefined,
    })
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Demo",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      {
        id: "prompt-1",
        name: "提示词节点",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { variables: [], prompt: "" },
      },
      {
        id: "switch-1",
        name: "判断",
        type: "switch",
        position: { x: 100, y: 0 },
        config: { variables: [], prompt: "", branches: [{ id: "fallback", label: "兜底" }] },
      },
    ],
    edges: [],
  }
}
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/validation-display.test.ts
```

Expected: fail because `../validation-display` does not exist.

- [ ] **Step 3: Implement the mapper**

Create `desktop/src/modules/workflow/editor/validation-display.ts`:

```ts
import type { ValidationError, WorkflowDefinition } from "@/types/workflow"

export interface WorkflowValidationDisplayItem {
  readonly id: string
  readonly summary: string
  readonly location: string
  readonly nodeId?: string
  readonly edgeId?: string
  readonly fieldKey?: string
  readonly type: ValidationError["type"]
}

type ZodIssueLike = {
  readonly path?: readonly unknown[]
  readonly message?: unknown
}

const FIELD_MESSAGES: Record<string, string> = {
  projectId: "请选择项目，或设置工作流默认项目。",
  providerId: "请选择供应商，或设置工作流默认供应商。",
  modelTier: "请选择模型，或设置工作流默认模型。",
  prompt: "提示词不能为空。",
  branches: "请至少保留一个分支。",
  defaultBranch: "默认分支需要属于分支列表。",
  template: "输出模板不能为空。",
  variables: "请检查变量绑定。",
  url: "URL 不能为空。",
  script: "脚本不能为空。",
}

export function buildWorkflowValidationDisplayItems(
  definition: WorkflowDefinition,
  errors: readonly ValidationError[],
): WorkflowValidationDisplayItem[] {
  return errors.map((error, index) => {
    const node = error.nodeId ? definition.nodes.find((candidate) => candidate.id === error.nodeId) : undefined
    const fieldKey = fieldKeyFromMessage(error.message)
    return {
      id: `${error.nodeId ? `node:${error.nodeId}` : error.edgeId ? `edge:${error.edgeId}` : "workflow"}:${index}`,
      summary: friendlySummary(error, fieldKey),
      location: node?.name ?? (error.edgeId ? "连线" : "工作流"),
      ...(error.nodeId ? { nodeId: error.nodeId } : {}),
      ...(error.edgeId ? { edgeId: error.edgeId } : {}),
      ...(fieldKey ? { fieldKey } : {}),
      type: error.type,
    }
  })
}

function friendlySummary(error: ValidationError, fieldKey: string | undefined): string {
  if (fieldKey && FIELD_MESSAGES[fieldKey]) return FIELD_MESSAGES[fieldKey]

  const branch = /分支[「"]([^」"]+)[」"]/.exec(error.message)?.[1]
  if (branch && /没有连接到下游节点/.test(error.message)) return `分支“${branch}”需要连接到下游节点。`
  if (branch && /路径无法到达结束节点/.test(error.message)) return `分支“${branch}”需要连接到结束节点。`

  const templateVariable = /模板变量[「"]([^」"]+)[」"]未绑定/.exec(error.message)?.[1]
  if (templateVariable) return `模板变量“${templateVariable}”需要添加变量绑定。`

  switch (error.type) {
    case "missing_end_node":
      return "工作流需要一个结束节点。"
    case "multiple_end_nodes":
      return "工作流只能保留一个结束节点。"
    case "cycle":
      return "工作流不能包含循环连接。"
    case "missing_param":
      return ensurePeriod(error.message)
    case "invalid_config":
      return isRawIssueList(error.message) ? "请检查节点配置。" : ensurePeriod(error.message)
    default:
      return ensurePeriod(error.message)
  }
}

function fieldKeyFromMessage(message: string): string | undefined {
  const issues = parseIssueList(message)
  const firstPath = issues[0]?.path?.find((part): part is string => typeof part === "string")
  if (firstPath) return firstPath
  for (const key of Object.keys(FIELD_MESSAGES)) {
    if (message.includes(key)) return key
  }
  return undefined
}

function parseIssueList(message: string): ZodIssueLike[] {
  try {
    const value = JSON.parse(message) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is ZodIssueLike => typeof item === "object" && item !== null)
  } catch {
    return []
  }
}

function isRawIssueList(message: string): boolean {
  return parseIssueList(message).length > 0
}

function ensurePeriod(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return "请检查配置。"
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}。`
}
```

- [ ] **Step 4: Run the mapper test and confirm it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/validation-display.test.ts
```

Expected: pass.

## Task 2: Floating Error Card Component

**Files:**
- Create: `desktop/src/modules/workflow/editor/workflow-error-card.tsx`
- Test: `desktop/src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `desktop/src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowValidationDisplayItem } from "../validation-display"
import { WorkflowErrorCard } from "../workflow-error-card"

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots.length = 0
  document.body.innerHTML = ""
})

describe("WorkflowErrorCard", () => {
  it("shows a compact list, overflow count, and supports row click", async () => {
    const onSelect = vi.fn()
    await renderCard(<WorkflowErrorCard items={items()} onSelectItem={onSelect} />)

    expect(document.body.textContent).toContain("需要处理 4 处")
    expect(document.body.textContent).toContain("请选择项目")
    expect(document.body.textContent).toContain("还有 1 处")

    await act(async () => {
      buttonByText("提示词节点 请选择项目，或设置工作流默认项目。").click()
    })

    expect(onSelect).toHaveBeenCalledWith(items()[0])
  })

  it("collapses and reopens without losing the error count", async () => {
    await renderCard(<WorkflowErrorCard items={items()} onSelectItem={vi.fn()} />)

    await act(async () => {
      buttonByLabel("关闭错误提示").click()
    })

    expect(document.body.textContent).toContain("4 处需要处理")
    expect(document.body.textContent).not.toContain("还有 1 处")

    await act(async () => {
      buttonByText("4 处需要处理").click()
    })

    expect(document.body.textContent).toContain("需要处理 4 处")
  })
})

async function renderCard(node: React.ReactNode): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
}

function items(): WorkflowValidationDisplayItem[] {
  return [
    { id: "1", summary: "请选择项目，或设置工作流默认项目。", location: "提示词节点", nodeId: "prompt-1", fieldKey: "projectId", type: "invalid_config" },
    { id: "2", summary: "分支“兜底”需要连接到下游节点。", location: "判断", nodeId: "switch-1", type: "invalid_switch_edge" },
    { id: "3", summary: "模板变量“customer”需要添加变量绑定。", location: "结束", nodeId: "end-1", fieldKey: "variables", type: "invalid_config" },
    { id: "4", summary: "工作流不能包含循环连接。", location: "工作流", type: "cycle" },
  ]
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx
```

Expected: fail because `../workflow-error-card` does not exist.

- [ ] **Step 3: Implement the floating card**

Create `desktop/src/modules/workflow/editor/workflow-error-card.tsx`:

```tsx
import { useEffect, useState } from "react"
import { AlertTriangle, ChevronUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { WorkflowValidationDisplayItem } from "./validation-display"

const MAX_VISIBLE_ERRORS = 3

interface WorkflowErrorCardProps {
  items: readonly WorkflowValidationDisplayItem[]
  onSelectItem: (item: WorkflowValidationDisplayItem) => void
}

export function WorkflowErrorCard({ items, onSelectItem }: WorkflowErrorCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (items.length > 0) setCollapsed(false)
  }, [items])

  if (items.length === 0) return null

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-3 top-16 z-20 gap-1.5 bg-background shadow-sm"
        onClick={() => setCollapsed(false)}
      >
        <AlertTriangle className="size-3.5 text-destructive" />
        {items.length} 处需要处理
        <ChevronUp className="size-3.5 text-muted-foreground" />
      </Button>
    )
  }

  const visibleItems = items.slice(0, MAX_VISIBLE_ERRORS)
  const hiddenCount = Math.max(0, items.length - visibleItems.length)

  return (
    <Card className="absolute right-3 top-16 z-20 w-80 bg-background shadow-md">
      <CardHeader className="flex flex-row items-center gap-2 px-3 py-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <CardTitle className="flex-1 text-sm">需要处理 {items.length} 处</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setCollapsed(true)}
          aria-label="关闭错误提示"
        >
          <X className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-1 px-3 pb-3 pt-0">
        {visibleItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelectItem(item)}
          >
            <span className="block font-medium text-foreground">{item.location}</span>
            <span className="block text-muted-foreground">{item.summary}</span>
          </button>
        ))}
        {hiddenCount > 0 && (
          <p className="px-2 pt-1 text-xs text-muted-foreground">还有 {hiddenCount} 处</p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run the component test and confirm it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx
```

Expected: pass.

## Task 3: Canvas Node Selection Handle

**Files:**
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx`
- Test: `desktop/src/modules/workflow/editor/__tests__/canvas.test.tsx`

- [ ] **Step 1: Write the failing selection test**

Add this test to `desktop/src/modules/workflow/editor/__tests__/canvas.test.tsx`:

```tsx
it("selects a node through the imperative handle", async () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const canvasRef = createRef<WorkflowCanvasHandle>()
  const onNodeSelect = vi.fn()

  await act(async () => {
    root.render(
      <WorkflowCanvas
        ref={canvasRef}
        definition={definitionWithConnectedPrompt()}
        onChange={vi.fn()}
        onNodeSelect={onNodeSelect}
      />,
    )
  })

  await act(async () => {
    canvasRef.current?.selectNode("prompt-1")
  })

  expect(onNodeSelect).toHaveBeenCalledWith("prompt-1")
})
```

Update the `@xyflow/react` test mock so `useNodesState` exposes state updates normally; the existing mock already does this through `React.useState(initial)`, so no additional mock API is needed.

- [ ] **Step 2: Run the focused canvas test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/canvas.test.tsx
```

Expected: fail because `selectNode` is missing from `WorkflowCanvasHandle`.

- [ ] **Step 3: Add `selectNode` to the canvas handle**

Modify `desktop/src/modules/workflow/editor/canvas.tsx`:

```ts
export interface WorkflowCanvasHandle {
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  updateNodeName: (nodeId: string, name: string) => void
  removeEdgesByIds: (edgeIds: string[]) => void
  updateEdgeLabels: (sourceNodeId: string, branches: Array<{ id: string; label: string }>) => void
  deleteNodes: (nodeIds: string[]) => void
  copyNodes: (nodeIds: string[]) => void
  selectNode: (nodeId: string) => void
}
```

Add this method inside the existing `useImperativeHandle` object:

```ts
selectNode: (nodeId) => {
  setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === nodeId })))
  onNodeSelectRef.current?.(nodeId)
},
```

Move the existing `onNodeSelectRef` declaration above `useImperativeHandle`, so the handle can read it before the current lower declaration:

```ts
const onNodeSelectRef = useRef(onNodeSelect)
onNodeSelectRef.current = onNodeSelect
```

Remove the later duplicate `onNodeSelectRef` declaration near the keyboard shortcut refs.

- [ ] **Step 4: Run the canvas test and confirm it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/canvas.test.tsx
```

Expected: pass.

## Task 4: Right Panel Repair Hints

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx`
- Modify: `desktop/workflow-nodes/panel-registry.ts`
- Modify: `desktop/workflow-nodes/prompt/panel.tsx`
- Modify: `desktop/workflow-nodes/switch/panel.tsx`
- Test: extend `desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx`

- [ ] **Step 1: Add the failing editor-level test for repair hints**

Add this test to `desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx`:

```tsx
it("shows node repair hints without raw validation JSON", async () => {
  const rawMessage = JSON.stringify([{ code: "invalid_type", path: ["projectId"], message: "Required" }])
  const workflowApi = {
    get: vi.fn().mockResolvedValue(definitionWithPrompt()),
    openRunner: vi.fn(),
    runDefinition: vi.fn(),
    save: vi.fn().mockResolvedValue({
      errors: [{ type: "invalid_config", nodeId: "prompt-1", message: rawMessage }],
    }),
    onEditorRefocus: vi.fn(() => vi.fn()),
    onDefinitionUpdated: vi.fn(() => vi.fn()),
  }
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: { workflow: workflowApi },
  })
  window.history.replaceState({}, "", "/?workflowId=workflow-1")
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<WorkflowEditorApp />)
    await Promise.resolve()
  })

  await act(async () => {
    buttonByText("Run workflow").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })

  expect(document.body.textContent).toContain("需要处理 1 处")
  expect(document.body.textContent).toContain("请选择项目，或设置工作流默认项目。")
  expect(document.body.textContent).not.toContain("invalid_type")
  expect(document.body.textContent).not.toContain("[")
})

function definitionWithPrompt(): WorkflowDefinition {
  return {
    ...definition(),
    nodes: [
      {
        id: "prompt-1",
        name: "提示词节点",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { variables: [], prompt: "hello" },
      },
    ],
  }
}
```

Update the existing `NodeConfigPanel` mock in the same test file to render error text:

```tsx
vi.mock("../node-config-panel", () => ({
  NodeConfigPanel: ({ validationItems = [] }: { validationItems?: Array<{ summary: string }> }) => (
    <div data-testid="node-config-panel">
      {validationItems.map((item) => <p key={item.summary}>{item.summary}</p>)}
    </div>
  ),
}))
```

- [ ] **Step 2: Run the editor test and confirm it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: fail because `validationItems` is not passed and the floating card is not wired.

- [ ] **Step 3: Extend panel prop types**

Modify `desktop/workflow-nodes/panel-registry.ts`:

```ts
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"

export interface NodePanelProps {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}
```

- [ ] **Step 4: Render node-level hints in `NodeConfigPanel`**

Modify `NodeConfigPanelProps` in `desktop/src/modules/workflow/editor/node-config-panel.tsx`:

```ts
import type { WorkflowValidationDisplayItem } from "./validation-display"

interface NodeConfigPanelProps {
  collapsed?: boolean
  nodeId: string | null
  definition: WorkflowDefinition
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void
  onNameChange: (nodeId: string, name: string) => void
  onDeleteNode?: (nodeId: string) => void
  onCopyNode?: (nodeId: string) => void
  renameSignal?: number
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  onDefinitionChange?: (def: WorkflowDefinition) => void
  validationItems?: readonly WorkflowValidationDisplayItem[]
}
```

In the component signature, include `validationItems = []`. Above `<PanelComponent ... />`, add:

```tsx
{validationItems.length > 0 && (
  <div className="mb-3 rounded-md border border-destructive/40 bg-background px-3 py-2">
    <p className="text-xs font-medium text-destructive">当前节点需要处理</p>
    <div className="mt-1 grid gap-1">
      {validationItems.map((item) => (
        <p key={item.id} className="text-xs text-muted-foreground">{item.summary}</p>
      ))}
    </div>
  </div>
)}
```

Pass the items into panel components:

```tsx
<PanelComponent
  key={`${node.id}::${definition.version ?? "0"}`}
  config={node.config}
  onChange={(c) => onConfigChange(node.id, c)}
  upstreamNodes={upstreamNodes}
  workflowParams={definition.params}
  projects={projects}
  defaultProjectName={defaultProjectName}
  defaultProviderId={definition.defaultProviderId}
  defaultModelTier={definition.defaultModelTier}
  validationItems={validationItems}
/>
```

- [ ] **Step 5: Add field-level project/prompt hints to prompt panel**

Modify `desktop/workflow-nodes/prompt/panel.tsx`:

```ts
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"

export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}
```

Include `validationItems = []` in the component signature and add this helper near the summaries:

```ts
const errorFor = (fieldKey: string) => validationItems.find((item) => item.fieldKey === fieldKey)?.summary
```

Under `<ProjectSelect ... />`, add:

```tsx
{errorFor("projectId") && <p className="text-xs text-destructive">{errorFor("projectId")}</p>}
```

Under `<PromptEditor ... />`, add:

```tsx
{errorFor("prompt") && <p className="text-xs text-destructive">{errorFor("prompt")}</p>}
```

- [ ] **Step 6: Add field-level project/prompt/branch hints to switch panel**

Modify `desktop/workflow-nodes/switch/panel.tsx` the same way:

```ts
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"

export interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderId?: string
  defaultModelTier?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}
```

Include `validationItems = []` in the component signature and add:

```ts
const errorFor = (fieldKey: string) => validationItems.find((item) => item.fieldKey === fieldKey)?.summary
```

Render `projectId`, `prompt`, and `branches` messages below their corresponding controls:

```tsx
{errorFor("projectId") && <p className="text-xs text-destructive">{errorFor("projectId")}</p>}
{errorFor("prompt") && <p className="text-xs text-destructive">{errorFor("prompt")}</p>}
{errorFor("branches") && <p className="text-xs text-destructive">{errorFor("branches")}</p>}
```

- [ ] **Step 7: Run the editor test and confirm the right-panel pieces are ready to wire**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: still fail until Task 5 wires `validationItems` from `WorkflowEditorApp`.

## Task 5: Wire Floating Card Into WorkflowEditorApp

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx`
- Test: extend `desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx`

- [ ] **Step 1: Add the failing floating-card interaction test**

Add this test to `desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx`:

```tsx
it("collapses the floating validation card", async () => {
  const workflowApi = {
    get: vi.fn().mockResolvedValue(definitionWithPrompt()),
    openRunner: vi.fn(),
    runDefinition: vi.fn(),
    save: vi.fn().mockResolvedValue({
      errors: [{ type: "missing_end_node", message: "工作流必须包含一个结束节点" }],
    }),
    onEditorRefocus: vi.fn(() => vi.fn()),
    onDefinitionUpdated: vi.fn(() => vi.fn()),
  }
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: { workflow: workflowApi },
  })
  window.history.replaceState({}, "", "/?workflowId=workflow-1")
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<WorkflowEditorApp />)
    await Promise.resolve()
  })

  await act(async () => {
    buttonByText("Run workflow").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()
  })

  buttonByLabel("关闭错误提示").click()

  expect(document.body.textContent).toContain("1 处需要处理")
  expect(document.body.textContent).not.toContain("需要处理 1 处")
})
```

Add helper:

```ts
function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}
```

- [ ] **Step 2: Run the editor tests and confirm they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: fail because `WorkflowEditorApp` still renders the old top alert and does not pass mapped validation items.

- [ ] **Step 3: Replace top alert state rendering with display items and floating card**

Modify imports in `desktop/src/modules/workflow/editor/editor-app.tsx`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { buildWorkflowValidationDisplayItems, type WorkflowValidationDisplayItem } from "./validation-display"
import { WorkflowErrorCard } from "./workflow-error-card"
```

Remove the `X`, `AlertAction`, and top validation `Alert` imports that become unused.

After `definitionRef.current = definition`, add:

```ts
const validationItems = useMemo(
  () => definition ? buildWorkflowValidationDisplayItems(definition, runErrors) : [],
  [definition, runErrors],
)
const selectedNodeValidationItems = useMemo(
  () => selectedNodeId ? validationItems.filter((item) => item.nodeId === selectedNodeId) : [],
  [selectedNodeId, validationItems],
)
```

Add the selection bridge before the `if (!definition)` branch:

```ts
const handleValidationItemSelect = useCallback((item: WorkflowValidationDisplayItem) => {
  if (!item.nodeId) return
  setSelectedNodeId(item.nodeId)
  canvasRef.current?.selectNode(item.nodeId)
}, [])
```

Remove the old block:

```tsx
{runErrors.length > 0 && (
  <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
    ...
  </Alert>
)}
```

Render the floating card inside the canvas wrapper, after `<CanvasFloatingToolbar ... />`:

```tsx
<WorkflowErrorCard items={validationItems} onSelectItem={handleValidationItemSelect} />
```

Pass selected-node items into `NodeConfigPanel`:

```tsx
<NodeConfigPanel
  collapsed={rightCollapsed}
  nodeId={selectedNodeId}
  definition={definition}
  onConfigChange={handleConfigChange}
  onNameChange={handleNameChange}
  onDeleteNode={(id) => { canvasRef.current?.deleteNodes([id]); setSelectedNodeId(null) }}
  onCopyNode={(id) => canvasRef.current?.copyNodes([id])}
  renameSignal={renameSignal}
  projects={projects}
  defaultProjectName={defaultProjectName}
  onDefinitionChange={handleDefinitionChange}
  validationItems={selectedNodeValidationItems}
/>
```

- [ ] **Step 4: Run editor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: pass.

## Task 6: Verification And Hard Constraints

**Files:**
- Verify only unless tests reveal a bug from this change.

- [ ] **Step 1: Run all focused workflow editor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/workflow/editor/__tests__/validation-display.test.ts \
  src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx \
  src/modules/workflow/editor/__tests__/canvas.test.tsx \
  src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass. If it fails on unrelated existing worktree changes, record the exact failure and then run the narrower TypeScript command only if needed:

```bash
pnpm --filter @synapse/desktop exec tsc -p tsconfig.json --noEmit
```

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff -- desktop/src/modules/workflow/editor desktop/workflow-nodes/panel-registry.ts desktop/workflow-nodes/prompt/panel.tsx desktop/workflow-nodes/switch/panel.tsx
```

Expected: diff only touches the planned workflow error feedback files. No custom colors, inline styles, raw JSON rendering, or dev-server/browser verification.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add \
  desktop/src/modules/workflow/editor/validation-display.ts \
  desktop/src/modules/workflow/editor/workflow-error-card.tsx \
  desktop/src/modules/workflow/editor/canvas.tsx \
  desktop/src/modules/workflow/editor/editor-app.tsx \
  desktop/src/modules/workflow/editor/node-config-panel.tsx \
  desktop/src/modules/workflow/editor/__tests__/validation-display.test.ts \
  desktop/src/modules/workflow/editor/__tests__/workflow-error-card.test.tsx \
  desktop/src/modules/workflow/editor/__tests__/canvas.test.tsx \
  desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx \
  desktop/workflow-nodes/panel-registry.ts \
  desktop/workflow-nodes/prompt/panel.tsx \
  desktop/workflow-nodes/switch/panel.tsx
git commit -m "feat: improve workflow validation feedback"
```

Expected: commit succeeds with only these files staged.
