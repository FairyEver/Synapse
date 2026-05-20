# Workflow Node Info Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich workflow node graph with icons and content previews so users can understand each node without opening the config panel.

**Architecture:** Change `NodeManifest.icon` from string to LucideIcon component type. Create an `AgentIcon` component (mirroring `EditorIcon`). Update node cards to three-line layout and node palette to show icons.

**Tech Stack:** React 19, lucide-react, TypeScript, shadcn/ui Select

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `workflow-nodes/types.ts` | Modify | Change `icon` type from `string` to `LucideIcon` |
| `workflow-nodes/prompt/manifest.ts` | Modify | Import and export `MessageSquare` component |
| `workflow-nodes/switch/manifest.ts` | Modify | Import and export `GitBranch` component |
| `workflow-nodes/end/manifest.ts` | Modify | Import and export `LogOut` component |
| `workflow-nodes/agent-icon.tsx` | Create | `AgentIcon` component + `getAgentLabel` utility |
| `workflow-nodes/prompt/card.tsx` | Modify | Three-line layout with manifest icon, agent icon, prompt preview |
| `workflow-nodes/switch/card.tsx` | Modify | Add agent icon row to header |
| `workflow-nodes/switch/constants.ts` | Modify | Increase `SWITCH_HEADER_H` to accommodate agent row |
| `workflow-nodes/prompt/panel.tsx` | Modify | Add `AgentIcon` to Select items |
| `workflow-nodes/switch/panel.tsx` | Modify | Add `AgentIcon` to Select items |
| `src/modules/workflow/editor/node-palette.tsx` | Modify | Render manifest icon next to title |

---

### Task 1: Change `NodeManifest.icon` type from string to LucideIcon

**Files:**
- Modify: `workflow-nodes/types.ts`

- [ ] **Step 1: Update the icon type in NodeManifest**

```typescript
// workflow-nodes/types.ts
import type { LucideIcon } from "lucide-react"
import type { ZodType } from "zod"

export interface PortDefinition { id: string; label: string }
export interface ConfigFieldDescriptor {
  name: string
  kind: "text" | "select" | "variable-binding-list" | "branch-list"
  label: string
  optional?: boolean
}

export interface NodeManifest<TConfig = unknown> {
  type: string
  title: string
  icon: LucideIcon
  color: string
  ports: { inputs: PortDefinition[]; outputs: PortDefinition[] | "dynamic" }
  resolveDynamicPorts?: (config: TConfig) => PortDefinition[]
  cardSummary: (config: TConfig) => { title: string; subtitle: string }
  configFields: readonly ConfigFieldDescriptor[]
  configSchema: ZodType<TConfig>
}
```

- [ ] **Step 2: Verify TypeScript catches the type mismatch in manifests**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`

Expected: Type errors in `prompt/manifest.ts`, `switch/manifest.ts`, `end/manifest.ts` because they still assign strings.

---

### Task 2: Update all manifests to export LucideIcon components

**Files:**
- Modify: `workflow-nodes/prompt/manifest.ts`
- Modify: `workflow-nodes/switch/manifest.ts`
- Modify: `workflow-nodes/end/manifest.ts`

- [ ] **Step 1: Update prompt manifest**

```typescript
// workflow-nodes/prompt/manifest.ts
import { MessageSquare } from "lucide-react"
import type { NodeManifest } from "../types"
import type { PromptNodeConfig } from "./schema"
import { promptNodeConfigSchema } from "./schema"

export const promptNodeManifest: NodeManifest<PromptNodeConfig> = {
  type: "prompt", title: "Prompt", icon: MessageSquare, color: "bg-primary/10",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({ title: c.agent || "未选择 Agent", subtitle: c.prompt.slice(0, 60) || "无 Prompt" }),
  configFields: [
    { name: "agent", kind: "select", label: "Agent" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "Prompt 模板" },
  ],
  configSchema: promptNodeConfigSchema,
}
```

- [ ] **Step 2: Update switch manifest**

```typescript
// workflow-nodes/switch/manifest.ts
import { GitBranch } from "lucide-react"
import type { NodeManifest } from "../types"
import type { SwitchNodeConfig } from "./schema"
import { switchNodeConfigSchema } from "./schema"

export const switchNodeManifest: NodeManifest<SwitchNodeConfig> = {
  type: "switch", title: "Switch", icon: GitBranch, color: "bg-secondary",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: "dynamic" },
  resolveDynamicPorts: (c) => c.branches.map((b) => ({ id: b.id, label: b.label })),
  cardSummary: (c) => ({ title: c.agent || "未选择 Agent", subtitle: `${c.branches.length} 个分支` }),
  configFields: [
    { name: "agent", kind: "select", label: "Agent" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "判断 Prompt" },
    { name: "branches", kind: "branch-list", label: "分支" },
    { name: "defaultBranch", kind: "select", label: "默认分支", optional: true },
  ],
  configSchema: switchNodeConfigSchema,
}
```

- [ ] **Step 3: Update end manifest**

```typescript
// workflow-nodes/end/manifest.ts
import { LogOut } from "lucide-react"
import type { NodeManifest } from "../types"
import type { EndNodeConfig } from "./schema"
import { endNodeConfigSchema } from "./schema"

export const endNodeManifest: NodeManifest<EndNodeConfig> = {
  type: "end",
  title: "结束",
  icon: LogOut,
  color: "bg-primary/10",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [] },
  cardSummary: (c) => ({ title: "结束", subtitle: c.template.slice(0, 40) || "返回文本" }),
  configFields: [
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "template", kind: "text", label: "返回文本" },
  ],
  configSchema: endNodeConfigSchema,
}
```

- [ ] **Step 4: Verify type errors are resolved**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | head -30`

Expected: Remaining errors only in card files (which still import icons directly).

- [ ] **Step 5: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/types.ts workflow-nodes/prompt/manifest.ts workflow-nodes/switch/manifest.ts workflow-nodes/end/manifest.ts
git commit -m "refactor(workflow): change NodeManifest.icon from string to LucideIcon component"
```

---

### Task 3: Create AgentIcon component and getAgentLabel utility

**Files:**
- Create: `workflow-nodes/agent-icon.tsx`

- [ ] **Step 1: Create the AgentIcon component**

```tsx
// workflow-nodes/agent-icon.tsx
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { cn } from "@/lib/utils"

const AGENT_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

const agentMap = new Map(agentDefinitions.map((def) => [def.id, def]))

export function getAgentLabel(agentId: string): string {
  return agentMap.get(agentId)?.label ?? agentId
}

function getAgentIconSrc(agentId: string): string | undefined {
  return agentMap.get(agentId)?.icon
}

export function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  const iconSrc = getAgentIconSrc(agentId)

  if (!iconSrc) {
    return null
  }

  return (
    <img
      src={iconSrc}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0 rounded-sm", className)}
      style={AGENT_ICON_CLIP_STYLE}
    />
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep agent-icon`

Expected: No errors from `agent-icon.tsx`.

- [ ] **Step 3: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/agent-icon.tsx
git commit -m "feat(workflow): add AgentIcon component and getAgentLabel utility"
```

---

### Task 4: Update node-palette to show manifest icons

**Files:**
- Modify: `src/modules/workflow/editor/node-palette.tsx`

- [ ] **Step 1: Render the icon from manifest**

```tsx
// src/modules/workflow/editor/node-palette.tsx
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"

export function NodePalette() {
  const types = nodeTypeRegistry.listTypes().filter((t) => t !== "end")
  return (
    <div className="w-44 border-r bg-background flex flex-col gap-1 p-2">
      <p className="text-xs font-medium text-muted-foreground px-1 pb-1">节点</p>
      {types.map((type) => {
        const manifest = nodeTypeRegistry.getManifest(type)
        const Icon = manifest.icon
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-grab hover:bg-muted active:cursor-grabbing"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{manifest.title}</span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep node-palette`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add src/modules/workflow/editor/node-palette.tsx
git commit -m "feat(workflow): show node type icons in palette sidebar"
```

---

### Task 5: Update Prompt node card to three-line layout

**Files:**
- Modify: `workflow-nodes/prompt/card.tsx`

- [ ] **Step 1: Rewrite PromptNodeCard with three-line layout**

```tsx
// workflow-nodes/prompt/card.tsx
import { cn } from "@/lib/utils"
import { promptNodeManifest } from "./manifest"
import { AgentIcon, getAgentLabel } from "../agent-icon"
import type { PromptNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

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

export function PromptNodeCard({ config, name, selected, status }: { config: PromptNodeConfig; name?: string; selected?: boolean; status?: NodeStatus }) {
  const Icon = promptNodeManifest.icon
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2 w-56 shadow-sm", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "Prompt"}</span>
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        {config.agent ? (
          <>
            <AgentIcon agentId={config.agent} />
            <span className="text-[11px] text-muted-foreground truncate">{getAgentLabel(config.agent)}</span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">未选择 Agent</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground truncate opacity-70">
        {config.prompt || "无 Prompt"}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep "prompt/card"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/prompt/card.tsx
git commit -m "feat(workflow): prompt node card three-line layout with agent icon and prompt preview"
```

---

### Task 6: Update Switch node card header with agent icon row

**Files:**
- Modify: `workflow-nodes/switch/card.tsx`
- Modify: `workflow-nodes/switch/constants.ts`

- [ ] **Step 1: Increase SWITCH_HEADER_H to accommodate the new agent row**

```typescript
// workflow-nodes/switch/constants.ts
/** Height of the switch card header section (icon + name + agent info + prompt hint). */
export const SWITCH_HEADER_H = 72

/** Height of each branch row inside the switch card. */
export const SWITCH_BRANCH_H = 28
```

- [ ] **Step 2: Rewrite SwitchNodeCard header with agent icon row**

```tsx
// workflow-nodes/switch/card.tsx
import { cn } from "@/lib/utils"
import { switchNodeManifest } from "./manifest"
import { AgentIcon, getAgentLabel } from "../agent-icon"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "./constants"
import type { SwitchNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

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
  const Icon = switchNodeManifest.icon
  const totalHeight = SWITCH_HEADER_H + config.branches.length * SWITCH_BRANCH_H
  return (
    <div
      className={cn("rounded-lg border bg-card w-56 shadow-sm overflow-hidden flex flex-col", selected && "ring-2 ring-primary", statusClass(status))}
      style={{ height: totalHeight }}
    >
      <div className="px-3 py-2 flex flex-col justify-center shrink-0" style={{ height: SWITCH_HEADER_H }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{name || "Switch"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {config.agent ? (
            <>
              <AgentIcon agentId={config.agent} />
              <span className="text-[11px] text-muted-foreground truncate">{getAgentLabel(config.agent)}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">未选择 Agent</span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{config.branches.length} 分支</span>
        </div>
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

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep "switch/"`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/switch/card.tsx workflow-nodes/switch/constants.ts
git commit -m "feat(workflow): switch node card header with agent icon row"
```

---

### Task 7: Update End node card to use manifest icon

**Files:**
- Modify: `workflow-nodes/end/card.tsx`

- [ ] **Step 1: Replace direct icon import with manifest reference**

```tsx
// workflow-nodes/end/card.tsx
import { cn } from "@/lib/utils"
import { endNodeManifest } from "./manifest"
import type { EndNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary animate-pulse"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "skipped": return "opacity-40 border-dashed"
    default: return "border-primary"
  }
}

export function EndNodeCard({ config, name, selected, status }: { config: EndNodeConfig; name?: string; selected?: boolean; status?: NodeStatus }) {
  const Icon = endNodeManifest.icon
  return (
    <div className={cn("rounded-lg border-2 bg-card px-3 py-2 w-56 shadow-sm", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "结束"}</span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{config.template.slice(0, 40) || "返回文本"}</p>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep "end/card"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/end/card.tsx
git commit -m "refactor(workflow): end node card uses manifest icon instead of direct import"
```

---

### Task 8: Add AgentIcon to Prompt panel Agent selector

**Files:**
- Modify: `workflow-nodes/prompt/panel.tsx`

- [ ] **Step 1: Update the Select to show agent icons**

```tsx
// workflow-nodes/prompt/panel.tsx
import { useRef, useState } from "react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { WorkflowParam } from "@/types/workflow"
import type { PromptNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { AgentIcon, getAgentLabel } from "../agent-icon"

export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
}

export function PromptNodePanel({ config, onChange, upstreamNodes, workflowParams }: PromptNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const lastCommittedRef = useRef<PromptNodeConfig>(config)

  const commit = (overrides?: Partial<PromptNodeConfig>) => {
    const next: PromptNodeConfig = { ...lastCommittedRef.current, prompt, ...overrides }
    lastCommittedRef.current = next
    onChange(next)
  }

  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Select
          value={config.agent}
          onValueChange={(agent) => commit({ agent })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="选择 Agent">
              {config.agent ? (
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={config.agent} />
                  {getAgentLabel(config.agent)}
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agentDefinitions.map((def) => (
              <SelectItem key={def.id} value={def.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={def.id} />
                  {def.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <VariableBindingEditor
        variables={config.variables}
        onChange={(variables) => commit({ variables })}
        upstreamNodes={upstreamNodes}
        workflowParams={workflowParams}
      />
      <div className="grid gap-1.5">
        <Label className="text-xs">Prompt</Label>
        <Textarea
          className="text-xs resize-none"
          rows={8}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => commit({ prompt })}
          placeholder="输入提示词，用 {{变量名}} 引用变量…"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep "prompt/panel"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/prompt/panel.tsx
git commit -m "feat(workflow): show agent icons in prompt panel selector"
```

---

### Task 9: Add AgentIcon to Switch panel Agent selector

**Files:**
- Modify: `workflow-nodes/switch/panel.tsx`

- [ ] **Step 1: Update the Agent Select in switch panel**

Replace the Agent `<Select>` block (lines 67-83) with:

```tsx
      <div className="grid gap-1.5">
        <Label className="text-xs">Agent</Label>
        <Select
          value={config.agent}
          onValueChange={(agent) => commit({ agent })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="选择 Agent">
              {config.agent ? (
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={config.agent} />
                  {getAgentLabel(config.agent)}
                </span>
              ) : null}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agentDefinitions.map((def) => (
              <SelectItem key={def.id} value={def.id} className="text-xs">
                <span className="flex items-center gap-2">
                  <AgentIcon agentId={def.id} />
                  {def.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
```

Add import at top of file:

```tsx
import { AgentIcon, getAgentLabel } from "../agent-icon"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit 2>&1 | grep "switch/panel"`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add workflow-nodes/switch/panel.tsx
git commit -m "feat(workflow): show agent icons in switch panel selector"
```

---

### Task 10: Final type-check and visual verification

**Files:** None (verification only)

- [ ] **Step 1: Full type-check**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit`

Expected: Clean — zero errors.

- [ ] **Step 2: Start dev server and verify visually**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm dev`

Verify in the workflow editor:
1. Node palette shows Lucide icons next to each node type name
2. Drag a Prompt node — card shows three lines (name, agent+icon, prompt preview)
3. Open config panel — Agent dropdown shows icons in each option
4. Select an agent — trigger shows icon, card updates with agent icon + label
5. Type a prompt — card third line shows truncated preview
6. Drag a Switch node — header shows agent icon row
7. End node — unchanged layout, icon sourced from manifest

- [ ] **Step 3: Commit any final adjustments if needed**

```bash
cd /Users/liyang/Documents/code/github/Synapse/desktop
git add -A
git commit -m "fix(workflow): final adjustments from visual verification"
```
