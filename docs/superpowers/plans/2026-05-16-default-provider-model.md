# Default Provider Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global "default provider + model" setting that pre-fills provider/model selection in Agent conversations, scheduled tasks, and workflow nodes.

**Architecture:** Extend `SynapseAgentGlobalConfig` with a nullable `defaultProviderModel` field. The settings panel gets a new row with `ProviderModelSelectDialog`. Each consumption site reads the config value and passes it as default/pre-fill.

**Tech Stack:** TypeScript, React, existing `ProviderModelSelectDialog`, `useAppConfig()` context, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `desktop/src/types/config.ts` | Add `defaultProviderModel` to type |
| Modify | `desktop/src/types/provider-model.ts` | (no change needed, already has `ModelTier`) |
| Modify | `desktop/src/constants/defaults.ts` | Add default value `null` |
| Modify | `desktop/src/lib/config.ts` | Normalize + validate new field |
| Modify | `desktop/src/lib/__tests__/config.test.ts` | Tests for normalization |
| Modify | `desktop/src/modules/settings/components/agent-defaults-panel.tsx` | Settings UI row |
| Modify | `desktop/src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx` | Settings UI tests |
| Modify | `desktop/src/modules/agent/components/agent-session-sidebar.tsx` | Pass default to dialog |
| Modify | `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx` | Pre-fill agent config |
| Modify | `desktop/src/modules/workflow/editor/canvas.tsx` | Fill dropped node config |

---

### Task 1: Config Type + Default + Normalization

**Files:**
- Modify: `desktop/src/types/config.ts:59-61`
- Modify: `desktop/src/constants/defaults.ts:52-54`
- Modify: `desktop/src/lib/config.ts:1-16,409-423`
- Test: `desktop/src/lib/__tests__/config.test.ts`

- [x] **Step 1: Write failing tests**

Add to `desktop/src/lib/__tests__/config.test.ts`:

```ts
it("defaults defaultProviderModel to null", () => {
  expect(createDefaultConfig().agent.defaultProviderModel).toBeNull()
})

it("normalizes valid defaultProviderModel", () => {
  const config = sanitizeSynapseConfig({
    activeRepoUuid: null,
    repositories: [],
    global: { themeMode: "light", projects: [] },
    agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "abc", modelTier: "sonnet" } },
  })
  expect(config.agent.defaultProviderModel).toEqual({ providerId: "abc", modelTier: "sonnet" })
})

it("normalizes invalid defaultProviderModel to null", () => {
  const empty = sanitizeSynapseConfig({
    activeRepoUuid: null,
    repositories: [],
    global: { themeMode: "light", projects: [] },
    agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "", modelTier: "sonnet" } },
  })
  const badTier = sanitizeSynapseConfig({
    activeRepoUuid: null,
    repositories: [],
    global: { themeMode: "light", projects: [] },
    agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "abc", modelTier: "turbo" } },
  })
  const notObj = sanitizeSynapseConfig({
    activeRepoUuid: null,
    repositories: [],
    global: { themeMode: "light", projects: [] },
    agent: { defaultPermissionMode: "default", defaultProviderModel: "hello" },
  })
  expect(empty.agent.defaultProviderModel).toBeNull()
  expect(badTier.agent.defaultProviderModel).toBeNull()
  expect(notObj.agent.defaultProviderModel).toBeNull()
})

it("applies defaultProviderModel patch", () => {
  const current = createDefaultConfig()
  const next = applySynapseConfigPatch(current, {
    agent: { defaultProviderModel: { providerId: "p1", modelTier: "opus" } },
  })
  expect(next.agent.defaultProviderModel).toEqual({ providerId: "p1", modelTier: "opus" })
  expect(next.agent.defaultPermissionMode).toBe("default")
})

it("clears defaultProviderModel with null patch", () => {
  const current = applySynapseConfigPatch(createDefaultConfig(), {
    agent: { defaultProviderModel: { providerId: "p1", modelTier: "opus" } },
  })
  const cleared = applySynapseConfigPatch(current, {
    agent: { defaultProviderModel: null },
  })
  expect(cleared.agent.defaultProviderModel).toBeNull()
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts`
Expected: Multiple type errors and test failures (property does not exist).

- [x] **Step 3: Add type**

In `desktop/src/types/config.ts`, add import and field:

```ts
import type { SynapseAgentPermissionMode } from "./agent"
import type { ModelTier } from "./provider-model"

// ...

export type SynapseAgentGlobalConfig = {
  defaultPermissionMode: SynapseAgentPermissionMode
  defaultProviderModel: { providerId: string; modelTier: ModelTier } | null
}
```

- [x] **Step 4: Add default value**

In `desktop/src/constants/defaults.ts`:

```ts
export const DEFAULT_AGENT_GLOBAL_CONFIG: SynapseAgentGlobalConfig = {
  defaultPermissionMode: "default",
  defaultProviderModel: null,
}
```

- [x] **Step 5: Add normalization**

In `desktop/src/lib/config.ts`, add import of `MODEL_TIERS` from `../types/provider-model` and update `normalizeAgentGlobalConfig`:

```ts
import { MODEL_TIERS } from "../types/provider-model"

// Inside normalizeAgentGlobalConfig, after defaultPermissionMode logic:

const defaultProviderModel = isRecord(value.defaultProviderModel)
  && isNonEmptyString(value.defaultProviderModel.providerId)
  && typeof value.defaultProviderModel.modelTier === "string"
  && (MODEL_TIERS as readonly string[]).includes(value.defaultProviderModel.modelTier)
  ? {
      providerId: value.defaultProviderModel.providerId.trim(),
      modelTier: value.defaultProviderModel.modelTier as ModelTier,
    }
  : null

return {
  defaultPermissionMode,
  defaultProviderModel,
}
```

Also add `ModelTier` type import:

```ts
import type { ModelTier } from "../types/provider-model"
```

- [x] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts`
Expected: All tests PASS.

- [x] **Step 7: Commit**

```bash
git add desktop/src/types/config.ts desktop/src/constants/defaults.ts desktop/src/lib/config.ts desktop/src/lib/__tests__/config.test.ts
git commit -m "feat(config): add defaultProviderModel to agent global config"
```

---

### Task 2: Settings Panel UI

**Files:**
- Modify: `desktop/src/modules/settings/components/agent-defaults-panel.tsx`
- Test: `desktop/src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx`

- [x] **Step 1: Write failing test**

Add to `desktop/src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx`:

```ts
describe("AgentDefaultsPanel provider model", () => {
  it("renders provider model button with placeholder when no default is set", () => {
    renderPanel()
    const button = document.querySelector('button[aria-label="默认供应商"]')
    expect(button).toBeTruthy()
    expect(button?.textContent).toContain("选择供应商 + 模型")
  })

  it("opens provider model dialog on button click", () => {
    renderPanel()
    const button = document.querySelector('button[aria-label="默认供应商"]')
    if (!(button instanceof HTMLElement)) throw new Error("Button not rendered")
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("选择供应商 + 模型")
  })

  it("shows clear button when default is set", () => {
    mocks.config = {
      ...createDefaultConfig(),
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "p1", modelTier: "sonnet" } },
    }
    renderPanel()
    const clearButton = document.querySelector('button[aria-label="清除默认供应商"]')
    expect(clearButton).toBeTruthy()
  })

  it("clears default on clear button click", async () => {
    mocks.config = {
      ...createDefaultConfig(),
      agent: { defaultPermissionMode: "default", defaultProviderModel: { providerId: "p1", modelTier: "sonnet" } },
    }
    renderPanel()
    const clearButton = document.querySelector('button[aria-label="清除默认供应商"]')
    if (!(clearButton instanceof HTMLElement)) throw new Error("Clear button not rendered")
    await act(async () => {
      clearButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { defaultProviderModel: null },
    })
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx`
Expected: FAIL — button not found.

- [x] **Step 3: Implement settings panel changes**

In `desktop/src/modules/settings/components/agent-defaults-panel.tsx`, add provider/model row to `AgentDefaultsContent`:

```tsx
import { useCallback, useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
// ... existing imports ...
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { ProviderModelSelection } from "@/types/provider-model"
import type { ModelTier } from "@/types/provider-model"
import type { SynapseAgentProvider } from "@/types/bridge"

// Inside AgentDefaultsContent, after the existing SettingsFieldRow for permission mode:

// State for provider label resolution
const [providerDialogOpen, setProviderDialogOpen] = useState(false)
const [resolvedLabel, setResolvedLabel] = useState("")
const defaultPM = config.agent.defaultProviderModel

// Resolve display label
useEffect(() => {
  if (!defaultPM) {
    setResolvedLabel("")
    return
  }
  let cancelled = false
  void (async () => {
    try {
      const providers = await requireSynapseBridge().agent.listProviders()
      if (cancelled) return
      const provider = providers.find((p) => p.id === defaultPM.providerId)
      if (provider) {
        const tierField = defaultPM.modelTier === "default" ? provider.model
          : defaultPM.modelTier === "haiku" ? provider.haikuModel
          : defaultPM.modelTier === "sonnet" ? provider.sonnetModel
          : provider.opusModel
        setResolvedLabel(`${provider.name} ${tierField?.trim() || defaultPM.modelTier}`)
      } else {
        setResolvedLabel(defaultPM.providerId)
      }
    } catch {
      setResolvedLabel(defaultPM.providerId)
    }
  })()
  return () => { cancelled = true }
}, [defaultPM?.providerId, defaultPM?.modelTier])

const saveDefaultProviderModel = async (selection: ProviderModelSelection | null) => {
  const value = selection ? { providerId: selection.providerId, modelTier: selection.modelTier } : null
  try {
    await promise(
      () => updateConfig({ agent: { defaultProviderModel: value } }),
      {
        loading: "正在保存设置...",
        success: () => "设置已保存。",
        error: (error) => error instanceof Error ? error.message : "保存设置失败。",
      },
    )
  } catch (error) {
    logger.error("Agent default provider model save failed.", error)
  }
}

// JSX — add after the permission mode SettingsFieldRow:
<SettingsFieldRow
  label="默认供应商和模型"
  description="新建 Agent 对话、定时任务和工作流节点将默认使用此供应商和模型。"
  controlClassName="w-full md:w-[220px]"
>
  <div className="flex items-center gap-2">
    <Button
      type="button"
      variant="outline"
      className="w-full justify-between"
      aria-label="默认供应商"
      onClick={() => setProviderDialogOpen(true)}
    >
      <span className="truncate text-muted-foreground">
        {defaultPM ? resolvedLabel || "..." : "选择供应商 + 模型"}
      </span>
      <ChevronDown className="size-4 text-muted-foreground" />
    </Button>
    {defaultPM ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="清除默认供应商"
        onClick={() => void saveDefaultProviderModel(null)}
      >
        清除
      </Button>
    ) : null}
  </div>
  <ProviderModelSelectDialog
    open={providerDialogOpen}
    onOpenChange={setProviderDialogOpen}
    defaultSelection={defaultPM ?? undefined}
    onSelect={(selection) => void saveDefaultProviderModel(selection)}
  />
</SettingsFieldRow>
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx`
Expected: All tests PASS.

- [x] **Step 5: Commit**

```bash
git add desktop/src/modules/settings/components/agent-defaults-panel.tsx desktop/src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx
git commit -m "feat(settings): add default provider model selector"
```

---

### Task 3: Agent Sidebar — Pass Default to Dialog

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx:127-134`

- [x] **Step 1: Add config import and pass `defaultSelection`**

In `desktop/src/modules/agent/components/agent-session-sidebar.tsx`:

Add import:
```ts
import { useAppConfig } from "@/app-shell/config"
```

Inside `AgentSessionSidebar` function body, add:
```ts
const { config } = useAppConfig()
```

Update the `ProviderModelSelectDialog` usage (line ~127):
```tsx
<ProviderModelSelectDialog
  open={createProject !== null}
  onOpenChange={(open) => { if (!open) setCreateProject(null) }}
  defaultSelection={config.agent.defaultProviderModel ?? undefined}
  onSelect={(selection) => {
    if (createProject) onCreateSession(createProject.id, selection)
    setCreateProject(null)
  }}
/>
```

- [x] **Step 2: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit`
Expected: No errors related to this file.

- [x] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-session-sidebar.tsx
git commit -m "feat(agent): pre-select default provider in new session dialog"
```

---

### Task 4: Scheduled Tasks — Pre-fill Agent Config

**Files:**
- Modify: `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx:113-119`

- [x] **Step 1: Add config import and update `updateActionType`**

In `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`:

Add import:
```ts
import { useAppConfig } from "@/app-shell/config"
```

Inside `TaskFormDialog` component, add:
```ts
const { config: appConfig } = useAppConfig()
```

Update `updateActionType` function to pre-fill provider when switching to agent:
```ts
const updateActionType = (actionType: string) => {
  const baseConfig = rendererActionRegistry.getDefaultConfig(actionType)
  const defaultPM = appConfig.agent.defaultProviderModel
  const actionConfig = actionType === "builtin.agent" && defaultPM
    ? { ...baseConfig, providerId: defaultPM.providerId, modelTier: defaultPM.modelTier }
    : baseConfig
  setForm((current) => ({
    ...current,
    actionType,
    actionConfig,
  }))
}
```

- [x] **Step 2: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit`
Expected: No errors related to this file.

- [x] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-form-dialog.tsx
git commit -m "feat(scheduler): pre-fill default provider in new agent tasks"
```

---

### Task 5: Workflow Canvas — Fill Dropped Node Config

**Files:**
- Modify: `desktop/src/modules/workflow/editor/canvas.tsx:1,66-69,232-254`

- [x] **Step 1: Update `defaultConfig` to accept provider model**

In `desktop/src/modules/workflow/editor/canvas.tsx`:

Add import:
```ts
import { useAppConfig } from "@/app-shell/config"
import type { ModelTier } from "@/types/provider-model"
```

Update `defaultConfig`:
```ts
function defaultConfig(type: string, providerModel?: { providerId: string; modelTier: ModelTier } | null): Record<string, unknown> {
  const pm = providerModel ?? { providerId: "", modelTier: "sonnet" }
  if (type === "switch") return { providerId: pm.providerId, modelTier: pm.modelTier, prompt: "", variables: [], branches: [{ id: "branch1", label: "分支 1" }] }
  if (type === "end") return { outputType: "text", template: "", variables: [] }
  return { providerId: pm.providerId, modelTier: pm.modelTier, prompt: "", variables: [] }
}
```

- [x] **Step 2: Pass config to `onDrop`**

Inside `CanvasContent` component, add config access:
```ts
const { config: appConfig } = useAppConfig()
```

Update `onDrop` callback (line ~232):
```ts
const onDrop = useCallback((event: React.DragEvent) => {
  event.preventDefault()
  const type = event.dataTransfer.getData("application/workflow-node-type")
  if (!type) return
  const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
  const id = crypto.randomUUID()
  const config = defaultConfig(type, appConfig.agent.defaultProviderModel)
  const name = defaultName(type)
  setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat({ id, type, position, data: { ...config, name }, selected: true, deletable: true }))
  const newWfNode: WorkflowNode = { id, name, type, position, config }
  const newDef = { ...definitionRef.current, nodes: [...definitionRef.current.nodes, newWfNode] }
  definitionRef.current = newDef
  logger.info("node dropped", {
    nodeId: id,
    type,
    position,
    nodeCount: newDef.nodes.length,
  })
  onChange(newDef)
  onNodeSelect?.(id)
}, [screenToFlowPosition, onChange, setNodes, onNodeSelect, appConfig.agent.defaultProviderModel])
```

- [x] **Step 3: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit`
Expected: No errors.

- [x] **Step 4: Commit**

```bash
git add desktop/src/modules/workflow/editor/canvas.tsx
git commit -m "feat(workflow): use default provider model for new nodes"
```

---

### Task 6: Final Verification

- [x] **Step 1: Run full test suite**

Run: `pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/config.test.ts src/modules/settings/components/__tests__/agent-defaults-panel.test.tsx`
Expected: All tests PASS.

- [x] **Step 2: Type check entire project**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit`
Expected: No type errors.

- [x] **Step 3: Final commit (if any fixups needed)**

```bash
git status
# If clean, nothing to commit
```
