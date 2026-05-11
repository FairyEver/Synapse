# Workflow UI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 workflow UI issues: list layout (3 columns), right panel label order, params editor dialog (one-row-per-param table style), and switch node dynamic height + pixel-positioned handles.

**Architecture:** All changes are renderer-only. No IPC, no Electron main process changes. Switch node handle fix uses shared pixel constants (`switch/constants.ts`) consumed by both the card and the wrapper to guarantee handle centers align with branch rows. Params editor gets a dedicated inline `WorkflowParamRow` component that mirrors the `VariableBindingEditor` table aesthetic without reusing its code.

**Tech Stack:** React, TypeScript, Tailwind CSS, shadcn/ui, @xyflow/react

---

### Task 1: Workflow list — 3 columns

**Files:**
- Modify: `desktop/src/modules/workflow/components/workflow-list.tsx:41`

- [ ] **Step 1: Change grid columns class**

In `workflow-list.tsx` line 41, replace:
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
```
with:
```tsx
<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/components/workflow-list.tsx
git commit -m "fix(workflow): show 3 cards per row from sm breakpoint"
```

---

### Task 2: Right panel — fix label / input order

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx`

Current header renders: `[Input] → [type text]` (input on top, label below).
Target renders: `[type text] → [节点名称 label] → [Input]`.

- [ ] **Step 1: Add Label import**

In `node-config-panel.tsx`, the current import block is:
```tsx
import { Input } from "@/components/ui/input"
import type { WorkflowDefinition } from "@/types/workflow"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"
```

Replace with:
```tsx
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { WorkflowDefinition } from "@/types/workflow"
import { getPanel } from "../../../../workflow-nodes/panel-registry"
import { useUpstreamNodes } from "../hooks/use-upstream-nodes"
```

- [ ] **Step 2: Rearrange header elements**

Replace the header `<div>` (lines 21-28):
```tsx
          <div className="border-b px-3 py-2 grid gap-1">
            <Input
              className="h-7 text-xs font-medium"
              defaultValue={node.name}
              key={node.id}
              onBlur={(e) => onNameChange(node.id, e.target.value)}
            />
            <p className="text-xs text-muted-foreground capitalize">{node.type} 节点</p>
          </div>
```

with:
```tsx
          <div className="border-b px-3 py-2 grid gap-1.5">
            <p className="text-xs text-muted-foreground capitalize">{node.type} 节点</p>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">节点名称</Label>
              <Input
                className="h-7 text-xs font-medium"
                defaultValue={node.name}
                key={node.id}
                onBlur={(e) => onNameChange(node.id, e.target.value)}
              />
            </div>
          </div>
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/workflow/editor/node-config-panel.tsx
git commit -m "fix(workflow): put 节点名称 label above input in right panel"
```

---

### Task 3: Switch node — shared pixel constants

**Files:**
- Create: `desktop/workflow-nodes/switch/constants.ts`

- [ ] **Step 1: Create constants file**

```ts
/** Height of the switch card header section (icon + name + agent info). */
export const SWITCH_HEADER_H = 56

/** Height of each branch row inside the switch card. */
export const SWITCH_BRANCH_H = 28
```

- [ ] **Step 2: Commit**

```bash
git add desktop/workflow-nodes/switch/constants.ts
git commit -m "feat(workflow): add switch node layout constants"
```

---

### Task 4: Switch node card — dynamic height + branch list

**Files:**
- Modify: `desktop/workflow-nodes/switch/card.tsx`

The card currently has a fixed ~56px height with no branch rows. After this task it grows by `SWITCH_BRANCH_H` per branch, and each branch label is visible inside the card.

- [ ] **Step 1: Rewrite card.tsx**

Replace the entire file content:
```tsx
import { GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SwitchNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "./constants"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary animate-pulse"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}

export function SwitchNodeCard({ config, name, selected, status }: { config: SwitchNodeConfig; name?: string; selected?: boolean; status?: NodeStatus }) {
  const totalHeight = SWITCH_HEADER_H + config.branches.length * SWITCH_BRANCH_H
  return (
    <div
      className={cn("rounded-lg border bg-card w-52 shadow-sm overflow-hidden flex flex-col", selected && "ring-2 ring-primary", statusClass(status))}
      style={{ height: totalHeight }}
    >
      <div className="px-3 py-2 flex flex-col justify-center shrink-0" style={{ height: SWITCH_HEADER_H }}>
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{name || config.agent || "Switch"}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {config.agent || "未选择 Agent"} · {config.branches.length} 个分支
        </p>
      </div>
      <div className="border-t border-border flex-1">
        {config.branches.map((b) => (
          <div
            key={b.id}
            className="flex items-center px-3 border-b border-border last:border-b-0"
            style={{ height: SWITCH_BRANCH_H }}
          >
            <span className="text-xs text-muted-foreground flex-1 truncate">{b.label}</span>
            <div className="h-px w-3 bg-muted-foreground/40" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/workflow-nodes/switch/card.tsx
git commit -m "feat(workflow): switch card dynamic height with branch rows"
```

---

### Task 5: Switch node wrapper — pixel-positioned handles

**Files:**
- Modify: `desktop/src/modules/workflow/editor/node-wrappers.tsx`

Currently handles use `top: X%` (percentage of card height). After this task handles use `top: Npx` derived from `SWITCH_HEADER_H` and `SWITCH_BRANCH_H`, guaranteed to align with each branch row center.

- [ ] **Step 1: Add constants import to node-wrappers.tsx**

Current imports in `node-wrappers.tsx`:
```tsx
import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import { EndNodeCard } from "../../../../workflow-nodes/end/card"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"
import type { EndNodeConfig } from "../../../../workflow-nodes/end/schema"
import type { NodeRunResult } from "@/types/workflow"
```

Replace with:
```tsx
import { createContext, useContext } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"
import { EndNodeCard } from "../../../../workflow-nodes/end/card"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "../../../../workflow-nodes/switch/constants"
import type { PromptNodeConfig } from "../../../../workflow-nodes/prompt/schema"
import type { SwitchNodeConfig } from "../../../../workflow-nodes/switch/schema"
import type { EndNodeConfig } from "../../../../workflow-nodes/end/schema"
import type { NodeRunResult } from "@/types/workflow"
```

- [ ] **Step 2: Replace handle style in SwitchNodeWrapper**

Replace the current `SwitchNodeWrapper` function:
```tsx
export function SwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard config={data as SwitchNodeConfig} name={name} selected={selected} status={status} />
      {(data as { branches?: Array<{ id: string; label: string }> }).branches?.map((b, i, arr) => (
        <Handle key={b.id} type="source" position={Position.Right} id={b.id} style={{ top: `${((i + 0.5) / arr.length) * 100}%` }} />
      ))}
    </>
  )
}
```

with:
```tsx
export function SwitchNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  const branches = (data as { branches?: Array<{ id: string; label: string }> }).branches ?? []
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard config={data as SwitchNodeConfig} name={name} selected={selected} status={status} />
      {branches.map((b, i) => (
        <Handle
          key={b.id}
          type="source"
          position={Position.Right}
          id={b.id}
          style={{ top: `${SWITCH_HEADER_H + (i + 0.5) * SWITCH_BRANCH_H}px` }}
        />
      ))}
    </>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/workflow/editor/node-wrappers.tsx
git commit -m "fix(workflow): switch handles use pixel positions aligned to branch rows"
```

---

### Task 6: Params editor dialog — one row per param

**Files:**
- Modify: `desktop/src/modules/workflow/components/params-editor-dialog.tsx`

Current: each param is a `border rounded-md p-3` card with multiple stacked rows (name, type, default, description on separate rows).
Target: one horizontal row per param in a shared-border table, modal widened to `max-w-2xl`.

- [ ] **Step 1: Rewrite params-editor-dialog.tsx**

Replace the entire file content:
```tsx
import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "lucide-react"
import type { WorkflowParam } from "@/types/workflow"

// ─── Cell style tokens (dedicated — not shared with variable-binding-editor) ──

const CELL_INPUT =
  "h-full w-full bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"

const CELL_TRIGGER =
  "h-full w-full border-0 rounded-none shadow-none bg-transparent focus-visible:ring-0 focus-visible:border-transparent text-xs px-2"

// ─── WorkflowParamRow ─────────────────────────────────────────────────────────

interface WorkflowParamRowProps {
  param: WorkflowParam
  onChange: (patch: Partial<WorkflowParam>) => void
  onDelete: () => void
}

function WorkflowParamRow({ param, onChange, onDelete }: WorkflowParamRowProps) {
  return (
    <div className="flex items-stretch h-9 divide-x divide-border">
      <div className="w-[120px] shrink-0 flex items-center">
        <input
          className={CELL_INPUT}
          value={param.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="参数名"
        />
      </div>
      <div className="w-[80px] shrink-0 flex items-center">
        <Select
          value={param.type}
          onValueChange={(v) => onChange({ type: v as WorkflowParam["type"] })}
        >
          <SelectTrigger className={CELL_TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text" className="text-xs">文本</SelectItem>
            <SelectItem value="number" className="text-xs">数字</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-[120px] shrink-0 flex items-center">
        <input
          className={CELL_INPUT}
          type={param.type === "number" ? "number" : "text"}
          value={param.default ?? ""}
          onChange={(e) =>
            onChange({
              default:
                e.target.value === ""
                  ? null
                  : param.type === "number"
                  ? Number(e.target.value)
                  : e.target.value,
            })
          }
          placeholder="默认值"
        />
      </div>
      <div className="flex-1 flex items-center min-w-0">
        <input
          className={CELL_INPUT}
          value={param.description ?? ""}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="描述（可选）"
        />
      </div>
      <div className="w-8 shrink-0 flex items-center justify-center">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  )
}

// ─── ParamsEditorDialog ───────────────────────────────────────────────────────

interface ParamsEditorDialogProps {
  open: boolean
  params: WorkflowParam[]
  onChange: (params: WorkflowParam[]) => void
  onClose: () => void
}

export function ParamsEditorDialog({ open, params, onChange, onClose }: ParamsEditorDialogProps) {
  const [draft, setDraft] = useState<WorkflowParam[]>(params)

  useEffect(() => {
    if (open) setDraft(params)
  }, [open, params])

  const handleOpenChange = (o: boolean) => { if (!o) onClose() }

  const addParam = () => {
    setDraft((d) => [...d, { name: "", type: "text", default: null }])
  }

  const removeParam = (i: number) => {
    setDraft((d) => d.filter((_, j) => j !== i))
  }

  const updateParam = (i: number, patch: Partial<WorkflowParam>) => {
    setDraft((d) => d.map((p, j) => j === i ? { ...p, ...patch } : p))
  }

  const handleSave = () => {
    onChange(draft.filter((p) => p.name.trim() !== ""))
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>编辑工作流参数</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground">暂无参数。</p>
          )}
          {draft.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
              <div className="flex items-center h-7 text-xs text-muted-foreground divide-x divide-border bg-muted/50">
                <div className="w-[120px] shrink-0 px-2">参数名</div>
                <div className="w-[80px] shrink-0 px-2">类型</div>
                <div className="w-[120px] shrink-0 px-2">默认值</div>
                <div className="flex-1 px-2">描述</div>
                <div className="w-8 shrink-0" />
              </div>
              {draft.map((p, i) => (
                <WorkflowParamRow
                  key={i}
                  param={p}
                  onChange={(patch) => updateParam(i, patch)}
                  onDelete={() => removeParam(i)}
                />
              ))}
            </div>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground justify-start gap-1.5 px-2 border border-dashed w-fit" onClick={addParam}>
            <Plus className="h-3 w-3" />添加参数
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/workflow/components/params-editor-dialog.tsx
git commit -m "feat(workflow): params editor one-row-per-param table layout"
```

---

## Self-Review

**Spec coverage:**
- ✅ 列表三列 → Task 1
- ✅ 右面板 label 顺序（节点名称 label 在上） → Task 2
- ✅ Switch 常量 → Task 3
- ✅ Switch 卡动态高度 + 分支行 → Task 4
- ✅ Switch handle 像素定位 → Task 5
- ✅ 参数对话框一行一参数 → Task 6
- ✅ 参数对话框不复用 VariableBindingEditor 组件 → 确认：CELL_INPUT/CELL_TRIGGER 在 params-editor-dialog.tsx 内独立定义
- ✅ 参数对话框变宽 max-w-2xl → Task 6
- ⚠️ 工作目录：本期明确推迟，不在计划内

**Placeholder scan:** 无 TBD/TODO，所有步骤含完整代码。

**Type consistency:**
- `WorkflowParam` 来自 `@/types/workflow`，Tasks 1-6 全部一致。
- `SWITCH_HEADER_H` / `SWITCH_BRANCH_H` 在 Task 3 定义，Task 4、5 使用，名称一致。
- `WorkflowParamRow` 在 Task 6 内定义并使用，无跨文件引用。
