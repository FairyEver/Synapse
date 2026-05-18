# Provider + Model Display Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show human-readable provider name and model name on task scheduler cards (for Agent tasks) and on workflow prompt/switch node cards (both editor and runner).

**Architecture:** Two independent changes. (1) Task card conditionally renders provider/model rows from existing `action.config` data. (2) Workflow nodes use a shared `ProviderLookupContext` that loads provider list once per window and exposes resolver functions consumed by card components.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing `window.synapse.agent.listProviders()` IPC bridge.

**Design spec:** `docs/superpowers/specs/2026-05-15-provider-model-display-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/src/modules/task-scheduler/components/task-card.tsx` | Modify | Add provider/model rows for agent tasks |
| `desktop/workflow-nodes/provider-lookup-context.tsx` | Create | Context + hook for runtime provider name resolution |
| `desktop/workflow-nodes/prompt/card.tsx` | Modify | Two-line provider/model display |
| `desktop/workflow-nodes/switch/card.tsx` | Modify | Two-line provider/model display |
| `desktop/workflow-nodes/switch/constants.ts` | Modify | Increase SWITCH_HEADER_H |
| `desktop/workflow-nodes/prompt/panel.tsx` | Modify | Use resolved names in selector button |
| `desktop/workflow-nodes/switch/panel.tsx` | Modify | Use resolved names in selector button |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | Modify | Wrap with ProviderLookupProvider |
| `desktop/src/modules/workflow/runner/runner-app.tsx` | Modify | Wrap with ProviderLookupProvider |

---

### Task 1: Task Card — Add Provider/Model Rows for Agent Tasks

**Files:**
- Modify: `desktop/src/modules/task-scheduler/components/task-card.tsx:70-133`

This task adds two conditional metadata rows (`供应商`, `模型`) above the existing `上次`/`范围` rows, only for `builtin.agent` action type tasks.

- [ ] **Step 1: Add helper to extract agent display info**

Add a helper function above the `TaskCard` component and adjust the label column width in the metadata grid:

```tsx
function getAgentDisplayInfo(task: ScheduledTask): { providerName: string; modelName: string } | null {
  if (task.action.type !== "builtin.agent") return null
  const config = task.action.config as Record<string, unknown>
  const providerName = (typeof config.providerName === "string" && config.providerName)
    || (typeof config.providerId === "string" && config.providerId)
    || null
  const modelName = (typeof config.modelName === "string" && config.modelName)
    || (typeof config.modelTier === "string" && config.modelTier)
    || null
  if (!providerName && !modelName) return null
  return { providerName: providerName ?? "—", modelName: modelName ?? "—" }
}
```

- [ ] **Step 2: Render provider/model rows in the card**

In the `TaskCard` component, call `getAgentDisplayInfo` and render the rows. Change the metadata grid section (currently lines 124–133) to:

```tsx
const agentInfo = getAgentDisplayInfo(task)

// In the JSX, replace the metadata grid:
<div className="mt-4 grid gap-1 text-xs">
  {agentInfo && (
    <>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
        <span className="text-muted-foreground">供应商</span>
        <span className="truncate">{agentInfo.providerName}</span>
      </div>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
        <span className="text-muted-foreground">模型</span>
        <span className="truncate">{agentInfo.modelName}</span>
      </div>
    </>
  )}
  <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
    <span className="text-muted-foreground">上次</span>
    <span className="truncate">{lastRun}</span>
  </div>
  <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
    <span className="text-muted-foreground">范围</span>
    <span className="truncate">{scope}</span>
  </div>
</div>
```

Note: label column changes from `2.5rem` to `3rem` to fit the 3-char label "供应商".

- [ ] **Step 3: Update existing tests**

In `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`, update the `createTask` helper to include `providerName` and `modelName` in the action config, and add a test:

```tsx
it("renders provider and model for agent tasks", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <TaskCard
        busy={false}
        projects={projects}
        task={createTask({
          action: {
            type: "builtin.agent",
            config: {
              agentType: "claude-code",
              projectId: "project-1",
              providerId: "provider-1",
              modelTier: "sonnet",
              providerName: "My Provider",
              modelName: "claude-sonnet-4-20250514",
              prompt: "run",
              sessionPolicy: "fresh",
            },
          },
        })}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onHistory={vi.fn()}
        onRun={vi.fn()}
        onStop={vi.fn()}
        onToggleEnabled={vi.fn()}
      />
    </TooltipProvider>,
  )

  expect(html).toContain("供应商")
  expect(html).toContain("My Provider")
  expect(html).toContain("模型")
  expect(html).toContain("claude-sonnet-4-20250514")
})

it("does not render provider/model for non-agent tasks", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <TaskCard
        busy={false}
        projects={projects}
        task={createTask({
          action: {
            type: "builtin.command",
            config: { command: "echo hello" },
          },
        })}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onHistory={vi.fn()}
        onRun={vi.fn()}
        onStop={vi.fn()}
        onToggleEnabled={vi.fn()}
      />
    </TooltipProvider>,
  )

  expect(html).not.toContain("供应商")
  expect(html).not.toContain("模型")
  expect(html).toContain("上次")
  expect(html).toContain("范围")
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`

Expected: all tests pass.

Also run the module-level test to verify existing assertions still hold:

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

Expected: all tests pass (the "上次" and "范围" assertions still hold, label column width change is CSS-only).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-card.tsx desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx
git commit -m "feat(task-scheduler): show provider and model on agent task cards"
```

---

### Task 2: Create ProviderLookupContext

**Files:**
- Create: `desktop/workflow-nodes/provider-lookup-context.tsx`

This context loads the provider list once per window and exposes lookup functions for resolving `providerId` → display name and `(providerId, modelTier)` → model name.

- [ ] **Step 1: Create the context file**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ModelTier } from "@/types/provider-model"

type ProviderLookup = {
  getProviderName: (providerId: string) => string | undefined
  getModelName: (providerId: string, modelTier: ModelTier) => string | undefined
}

const defaultLookup: ProviderLookup = {
  getProviderName: () => undefined,
  getModelName: () => undefined,
}

const ProviderLookupContext = createContext<ProviderLookup>(defaultLookup)

function tierModelValue(provider: SynapseAgentProvider, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

function ProviderLookupProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<SynapseAgentProvider[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await window.synapse?.agent.listProviders()
        if (!cancelled && list) setProviders(list)
      } catch {
        // Provider lookup is best-effort; cards fall back to raw IDs
      }
    })()
    return () => { cancelled = true }
  }, [])

  const lookup: ProviderLookup = {
    getProviderName: (providerId) =>
      providers.find((p) => p.id === providerId)?.name,
    getModelName: (providerId, modelTier) => {
      const provider = providers.find((p) => p.id === providerId)
      return provider ? tierModelValue(provider, modelTier) : undefined
    },
  }

  return (
    <ProviderLookupContext.Provider value={lookup}>
      {children}
    </ProviderLookupContext.Provider>
  )
}

function useProviderLookup(): ProviderLookup {
  return useContext(ProviderLookupContext)
}

export { ProviderLookupContext, ProviderLookupProvider, useProviderLookup }
export type { ProviderLookup }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/workflow-nodes/provider-lookup-context.tsx
git commit -m "feat(workflow): add ProviderLookupContext for runtime provider name resolution"
```

---

### Task 3: Update PromptNodeCard to Show Two-Line Provider/Model

**Files:**
- Modify: `desktop/workflow-nodes/prompt/card.tsx:1-53`

- [ ] **Step 1: Update the card to use ProviderLookupContext**

Replace the import section and the provider display section:

```tsx
import { cn } from "@/lib/utils"
import { promptNodeManifest } from "./manifest"
import type { PromptNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { useProviderLookup } from "../provider-lookup-context"

type NodeStatus = NodeRunResult["status"]

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

export function PromptNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: PromptNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = promptNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const { getProviderName, getModelName } = useProviderLookup()
  const providerDisplay = config.providerId ? (getProviderName(config.providerId) ?? config.providerId) : undefined
  const modelDisplay = config.providerId ? (getModelName(config.providerId, config.modelTier) ?? config.modelTier) : undefined
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56 shadow-sm", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "Prompt"}</span>
        {status === "running" && timer && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
      ) : config.providerId ? (
        <>
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-1 text-[11px] text-muted-foreground mb-1">
            <span>供应商</span>
            <span className="truncate">{providerDisplay}</span>
            <span>模型</span>
            <span className="truncate">{modelDisplay}</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">
            {config.prompt || "无 Prompt"}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] text-muted-foreground truncate">未选择供应商</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">
            {config.prompt || "无 Prompt"}
          </p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/workflow-nodes/prompt/card.tsx
git commit -m "feat(workflow): show provider name and model name on prompt node card"
```

---

### Task 4: Update SwitchNodeCard + Adjust Header Height

**Files:**
- Modify: `desktop/workflow-nodes/switch/card.tsx:1-69`
- Modify: `desktop/workflow-nodes/switch/constants.ts:2`

- [ ] **Step 1: Increase SWITCH_HEADER_H**

In `desktop/workflow-nodes/switch/constants.ts`, change:

```ts
export const SWITCH_HEADER_H = 88
```

The current value is 72. Adding two lines of text at ~11px font size + gap ≈ +16px → 88.

- [ ] **Step 2: Update the SwitchNodeCard**

Replace the full file content of `desktop/workflow-nodes/switch/card.tsx`:

```tsx
import { cn } from "@/lib/utils"
import { switchNodeManifest } from "./manifest"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "./constants"
import type { SwitchNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { useProviderLookup } from "../provider-lookup-context"

type NodeStatus = NodeRunResult["status"]

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

export function SwitchNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: SwitchNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = switchNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const { getProviderName, getModelName } = useProviderLookup()
  const providerDisplay = config.providerId ? (getProviderName(config.providerId) ?? config.providerId) : undefined
  const modelDisplay = config.providerId ? (getModelName(config.providerId, config.modelTier) ?? config.modelTier) : undefined
  const progressPadding = status === "running" ? 12 : 0
  const totalHeight = SWITCH_HEADER_H + config.branches.length * SWITCH_BRANCH_H + progressPadding
  return (
    <div
      className={cn("relative rounded-lg border bg-card w-56 shadow-sm overflow-hidden flex flex-col", selected && "ring-2 ring-primary", statusClass(status))}
      style={{ height: totalHeight }}
    >
      <div className="px-3 py-2 flex flex-col justify-center shrink-0" style={{ height: SWITCH_HEADER_H }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{name || "Switch"}</span>
          {status === "running" && timer && (
            <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
          )}
        </div>
        {status === "running" && progressLabel ? (
          <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
        ) : config.providerId ? (
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-1 text-[11px] text-muted-foreground">
            <span>供应商</span>
            <span className="truncate">{providerDisplay}</span>
            <span>模型</span>
            <span className="truncate flex items-center justify-between">
              {modelDisplay}
              <span className="ml-auto shrink-0 pl-2">{config.branches.length} 分支</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground truncate">未选择供应商</span>
            <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{config.branches.length} 分支</span>
          </div>
        )}
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
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/workflow-nodes/switch/card.tsx desktop/workflow-nodes/switch/constants.ts
git commit -m "feat(workflow): show provider name and model name on switch node card"
```

---

### Task 5: Update Panel Selector Button Text

**Files:**
- Modify: `desktop/workflow-nodes/prompt/panel.tsx:37-49`
- Modify: `desktop/workflow-nodes/switch/panel.tsx:72-84`

Both panels currently display `{config.providerId} · {TIER_LABELS[config.modelTier]}` in the selector button. Update to use resolved names.

- [ ] **Step 1: Update prompt/panel.tsx**

Add the import and use it in the button label:

Add to imports:
```tsx
import { useProviderLookup } from "../provider-lookup-context"
```

Inside `PromptNodePanel`, before the return:
```tsx
const { getProviderName, getModelName } = useProviderLookup()
```

Change the button label span (line 39-41) from:
```tsx
{config.providerId ? `${config.providerId} · ${TIER_LABELS[config.modelTier] ?? config.modelTier}` : "选择供应商 + 模型"}
```
to:
```tsx
{config.providerId
  ? `${getProviderName(config.providerId) ?? config.providerId} · ${getModelName(config.providerId, config.modelTier) ?? TIER_LABELS[config.modelTier] ?? config.modelTier}`
  : "选择供应商 + 模型"}
```

- [ ] **Step 2: Update switch/panel.tsx**

Same pattern. Add the import:
```tsx
import { useProviderLookup } from "../provider-lookup-context"
```

Inside `SwitchNodePanel`, before the return:
```tsx
const { getProviderName, getModelName } = useProviderLookup()
```

Change the button label span (line 74-75) from:
```tsx
{config.providerId ? `${config.providerId} · ${TIER_LABELS[config.modelTier] ?? config.modelTier}` : "选择供应商 + 模型"}
```
to:
```tsx
{config.providerId
  ? `${getProviderName(config.providerId) ?? config.providerId} · ${getModelName(config.providerId, config.modelTier) ?? TIER_LABELS[config.modelTier] ?? config.modelTier}`
  : "选择供应商 + 模型"}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/workflow-nodes/prompt/panel.tsx desktop/workflow-nodes/switch/panel.tsx
git commit -m "feat(workflow): use resolved provider/model names in panel selector buttons"
```

---

### Task 6: Wrap Editor and Runner with ProviderLookupProvider

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx:1-19,322-401`
- Modify: `desktop/src/modules/workflow/runner/runner-app.tsx:1-14,270-328`

- [ ] **Step 1: Wrap editor-app.tsx**

Add import at the top of `editor-app.tsx`:
```tsx
import { ProviderLookupProvider } from "../../../../workflow-nodes/provider-lookup-context"
```

Wrap the returned JSX. The return block (line 322) currently starts with `<>`. Change:
```tsx
return (
  <>
  <div className="flex flex-col h-screen">
```
to:
```tsx
return (
  <ProviderLookupProvider>
  <div className="flex flex-col h-screen">
```

And change the closing (line 401):
```tsx
    </>
  )
```
to:
```tsx
    </ProviderLookupProvider>
  )
```

- [ ] **Step 2: Wrap runner-app.tsx**

Add import at the top of `runner-app.tsx`:
```tsx
import { ProviderLookupProvider } from "../../../../workflow-nodes/provider-lookup-context"
```

Wrap the main return block (line 270):
```tsx
return (
  <ProviderLookupProvider>
    <div className="flex flex-col h-screen">
```

And close it before the final `)`:
```tsx
    </div>
  </ProviderLookupProvider>
)
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @synapse/desktop exec vitest run`

Expected: all existing tests pass. The context provides a default no-op lookup, so existing tests that render cards without a provider will gracefully fall back to raw IDs.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/workflow/editor/editor-app.tsx desktop/src/modules/workflow/runner/runner-app.tsx
git commit -m "feat(workflow): wrap editor and runner with ProviderLookupProvider"
```

---

## Task Dependency Graph

```
Task 1 (task card)      — independent
Task 2 (context)        — independent
Task 3 (prompt card)    — depends on Task 2
Task 4 (switch card)    — depends on Task 2
Task 5 (panels)         — depends on Task 2
Task 6 (wrap apps)      — depends on Task 2
```

Tasks 1 and 2 are parallelizable. Tasks 3–6 all depend on Task 2 but are independent of each other and can be parallelized.
