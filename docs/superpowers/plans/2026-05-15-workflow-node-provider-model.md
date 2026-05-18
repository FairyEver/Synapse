# Workflow Node Provider + Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `agent` field in Prompt and Switch nodes with `providerId` + `modelTier`.

**Architecture:** Schema → bridge interface → executors → manifests → panels → tests. Reuse `ProviderModelSelectDialog`. No data migration.

**Tech Stack:** TypeScript, Zod, React, shadcn/ui, Vitest

**Spec:** `docs/superpowers/specs/2026-05-15-workflow-node-provider-model-design.md`

---

## Task 1: Update Schemas

**Files:** `desktop/workflow-nodes/prompt/schema.ts`, `desktop/workflow-nodes/switch/schema.ts`

- [x] In both files, replace `agent: z.string().min(1)` with two fields:
  ```typescript
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
  ```
- [x] Commit: `refactor(workflow): replace agent with providerId+modelTier in schemas`

---

## Task 2: Update AgentSendDeps Bridge

**Files:** `desktop/workflow-nodes/types.ts`, `desktop/electron/bootstrap/descriptors.ts`

- [x] In `types.ts`, change `sendToAgent` input from `{ agent: string; prompt; abortSignal }` to `{ providerId: string; modelTier: string; prompt; abortSignal }`
- [x] In `descriptors.ts` (~L887), destructure `{ providerId, modelTier, prompt, abortSignal }` instead of `{ agent, prompt, abortSignal }`
- [x] In `descriptors.ts` `sendScheduled` call (~L895), hardcode `agentType: "claude-code"` and add `providerId, modelTier`
- [x] Commit: `refactor(workflow): AgentSendDeps uses providerId+modelTier`

---

## Task 3: Update Executors

**Files:** `desktop/workflow-nodes/prompt/executor.main.ts`, `desktop/workflow-nodes/switch/executor.main.ts`

- [x] In prompt executor, change `sendToAgent` arg from `{ agent: input.config.agent, ... }` to `{ providerId: input.config.providerId, modelTier: input.config.modelTier, ... }`
- [x] In prompt executor, replace all `agent: input.config.agent` in logger calls with `providerId: input.config.providerId, modelTier: input.config.modelTier`
- [x] In switch executor, same two changes (`config.agent` → `config.providerId`/`config.modelTier`)
- [x] Commit: `refactor(workflow): executors use providerId+modelTier`

---

## Task 4: Update Manifests

**Files:** `desktop/workflow-nodes/prompt/manifest.ts`, `desktop/workflow-nodes/switch/manifest.ts`

- [x] In both, change `cardSummary` title from `c.agent || "未选择 Agent"` to `c.providerId ? \`${c.providerId} · ${c.modelTier}\` : "未选择供应商"`
- [x] In both, update `configFields`: replace `{ name: "agent", kind: "select", label: "Agent" }` with `{ name: "providerId", kind: "text", label: "供应商" }, { name: "modelTier", kind: "select", label: "模型" }`
- [x] Commit: `refactor(workflow): manifests use providerId+modelTier`

---

## Task 5: Update Prompt Panel UI

**File:** `desktop/workflow-nodes/prompt/panel.tsx`

- [x] Remove imports: `Select/SelectContent/SelectItem/SelectTrigger/SelectValue`, `agentDefinitions`, `AgentIcon`, `getAgentLabel`
- [x] Add imports: `{ useState } from "react"`, `{ ChevronDown } from "lucide-react"`, `{ Button } from "@/components/ui/button"`, `{ ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"`, `type { ModelTier } from "@/types/provider-model"`
- [x] Add tier label map:
  ```typescript
  const TIER_LABELS: Record<ModelTier, string> = { default: "主模型", haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }
  ```
- [x] Add `const [providerDialogOpen, setProviderDialogOpen] = useState(false)` in component
- [x] Replace the "执行配置" `CollapsibleSection` content (the `<Select>` block) with:
  ```tsx
  <Button variant="outline" className="w-full justify-between h-7 text-xs" onClick={() => setProviderDialogOpen(true)}>
    <span className="truncate">
      {config.providerId ? `${config.providerId} · ${TIER_LABELS[config.modelTier] ?? config.modelTier}` : "选择供应商 + 模型"}
    </span>
    <ChevronDown className="size-3.5 text-muted-foreground" />
  </Button>
  <ProviderModelSelectDialog
    open={providerDialogOpen}
    onOpenChange={setProviderDialogOpen}
    defaultSelection={config.providerId ? { providerId: config.providerId, modelTier: config.modelTier } : undefined}
    onSelect={(s) => commit({ providerId: s.providerId, modelTier: s.modelTier })}
  />
  ```
- [x] Commit: `refactor(workflow): prompt panel uses ProviderModelSelectDialog`

---

## Task 6: Update Switch Panel UI

**File:** `desktop/workflow-nodes/switch/panel.tsx`

- [x] Same import changes as Task 5 (remove Select/agentDefinitions/AgentIcon/getAgentLabel, add Button/ChevronDown/ProviderModelSelectDialog/ModelTier)
- [x] Add same `TIER_LABELS` map and `providerDialogOpen` state
- [x] Replace the "执行配置" `CollapsibleSection` content with the same Button + Dialog pattern from Task 5
- [x] Commit: `refactor(workflow): switch panel uses ProviderModelSelectDialog`

---

## Task 7: Update Tests

**Files:**
- `desktop/workflow-nodes/prompt/__tests__/executor.test.ts`
- `desktop/workflow-nodes/switch/__tests__/executor.test.ts`
- `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [x] In prompt executor test: replace all `{ agent: "claude-code", ... }` configs with `{ providerId: "test-provider", modelTier: "sonnet", ... }`. Update log assertions from `agent: "claude-code"` to `providerId: "test-provider", modelTier: "sonnet"`
- [x] In switch executor test: same config replacement. Update log assertions similarly.
- [x] In workflow engine test: update `nodeA`, `nodeB`, orphan node, and `nodeC` configs from `{ agent: "claude-code", ... }` to `{ providerId: "test-provider", modelTier: "sonnet", ... }`. Update `fakeAgent` helper: `sendToAgent` mock args now expect `{ providerId, modelTier, prompt, abortSignal }` (no behavior change needed, just the mock signature matches). Update log test's config block similarly.
- [x] Run all tests: `pnpm --filter @synapse/desktop run test`
- [x] Commit: `test(workflow): update tests for providerId+modelTier`

---

## Verification

- [ ] Run `pnpm --filter @synapse/desktop run test` — all green
- [ ] Run `pnpm --filter @synapse/desktop run check:hard-constraints` — passes
- [ ] Manual: open workflow editor, click a Prompt node, see "执行配置" shows button "选择供应商 + 模型", click opens dialog, select confirms and shows `providerId · tierLabel`
