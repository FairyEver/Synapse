# Workflow Project Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workflow prompt/switch nodes specify which project (working directory) the agent runs in, with a workflow-level default and per-node override.

**Architecture:** Three-level resolution: node `projectId` → workflow `defaultProjectId` → `os.homedir()`. The `sendToAgent` interface gains a `projectId` parameter so the engine can forward the resolved project to the agent runtime instead of re-resolving from global config.

**Tech Stack:** TypeScript, Zod, React, shadcn/ui Select component, existing `useAppConfig()` hook for project list.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/types/workflow.ts` | Add `defaultProjectId` to `WorkflowDefinition` |
| Modify | `workflow-nodes/prompt/schema.ts` | Add optional `projectId` to prompt config |
| Modify | `workflow-nodes/switch/schema.ts` | Add optional `projectId` to switch config |
| Modify | `workflow-nodes/types.ts` | Add `projectId` to `AgentSendDeps.sendToAgent` input |
| Modify | `electron/bootstrap/descriptors.ts` | Accept `projectId` in `sendToAgent`, use it instead of re-resolving |
| Modify | `electron/services/workflow/workflow-engine.ts` | Resolve per-node projectId, pass to executor context |
| Modify | `electron/modules/workflow/ipc.ts` | Pass `def.defaultProjectId` to engine, resolve UUID→path |
| Create | `workflow-nodes/project-select.tsx` | Shared project selector component for node panels |
| Modify | `workflow-nodes/prompt/panel.tsx` | Add project selector to prompt node config |
| Modify | `workflow-nodes/switch/panel.tsx` | Add project selector to switch node config |
| Modify | `src/modules/workflow/editor/toolbar.tsx` | Add default project selector to toolbar |
| Modify | `electron/modules/workflow/ipc.ts` (zod schema) | Allow `defaultProjectId` in definition schema |

---

### Task 1: Add `defaultProjectId` to WorkflowDefinition type

**Files:**
- Modify: `src/types/workflow.ts:8-12`

- [ ] **Step 1: Add field to WorkflowDefinition interface**

```typescript
export interface WorkflowDefinition {
  id: string; name: string; description?: string; version: string
  createdAt: number; updatedAt: number
  defaultProjectId?: string
  params: WorkflowParam[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]
}
```

- [ ] **Step 2: Update IPC zod schema in workflow ipc.ts**

In `electron/modules/workflow/ipc.ts:66-72`, add `defaultProjectId` to the schema:

```typescript
const workflowDefinitionSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional(),
  version: z.string(), createdAt: z.number(), updatedAt: z.number(),
  defaultProjectId: z.string().optional(),
  params: z.array(z.object({ name: z.string(), type: z.enum(["text", "number"]), default: z.union([z.string(), z.number(), z.null()]), description: z.string().optional() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), config: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), branch: z.string().optional() })),
})
```

- [ ] **Step 3: Commit**

```bash
git add src/types/workflow.ts electron/modules/workflow/ipc.ts
git commit -m "feat(workflow): add defaultProjectId to WorkflowDefinition"
```

---

### Task 2: Add `projectId` to node config schemas

**Files:**
- Modify: `workflow-nodes/prompt/schema.ts:4-9`
- Modify: `workflow-nodes/switch/schema.ts:10-16`

- [ ] **Step 1: Add projectId to prompt node schema**

```typescript
import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const promptNodeConfigSchema = z.object({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),
})
export type PromptNodeConfig = z.infer<typeof promptNodeConfigSchema>
```

- [ ] **Step 2: Add projectId to switch node schema**

```typescript
export const switchNodeConfigSchema = z.object({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),
  branches: z.array(switchBranchSchema).min(1),
  defaultBranch: z.string().optional(),
}).superRefine((config, ctx) => {
  if (!config.defaultBranch) return
  if (config.branches.some((branch) => branch.id === config.defaultBranch)) return
  ctx.addIssue({
    code: "custom",
    path: ["defaultBranch"],
    message: "默认分支必须属于分支列表",
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add workflow-nodes/prompt/schema.ts workflow-nodes/switch/schema.ts
git commit -m "feat(workflow): add optional projectId to prompt and switch node configs"
```

---

### Task 3: Wire projectId through the agent execution path

This is the critical fix: currently `sendToAgent` ignores the engine's `context.projectId` and re-resolves from global config. We need to thread `projectId` through so the correct project is used.

**Files:**
- Modify: `workflow-nodes/types.ts:30-36`
- Modify: `electron/bootstrap/descriptors.ts:1016-1045`
- Modify: `electron/services/workflow/workflow-engine.ts:149-151`

- [ ] **Step 1: Add projectId to sendToAgent input interface**

In `workflow-nodes/types.ts`, update `AgentSendDeps`:

```typescript
export interface AgentSendDeps {
  sendToAgent: (input: {
    providerId: string
    modelTier: string
    prompt: string
    projectId: string
    abortSignal: AbortSignal
  }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
  }>
}
```

- [ ] **Step 2: Update prompt executor to pass projectId**

In `workflow-nodes/prompt/executor.main.ts:21`, add `projectId`:

```typescript
const result = await input.agentDeps.sendToAgent({
  providerId: input.config.providerId,
  modelTier: input.config.modelTier,
  prompt,
  projectId: input.context.projectId,
  abortSignal: input.context.abortSignal,
})
```

- [ ] **Step 3: Update switch executor to pass projectId**

Find the switch executor file and add `projectId: input.context.projectId` to its `sendToAgent` call (same pattern as prompt executor).

- [ ] **Step 4: Update sendToAgent implementation in descriptors.ts**

In `electron/bootstrap/descriptors.ts:1016-1045`, accept and use the `projectId` parameter:

```typescript
const sendToAgent: import("../../workflow-nodes/types").AgentSendDeps["sendToAgent"] = async ({ providerId, modelTier, prompt, projectId, abortSignal }) => {
  try {
    const config = await configStore.load()
    const repo = config.repositories.find((r) => r.uuid === projectId) ?? config.repositories.find((r) => r.uuid === config.activeRepoUuid) ?? config.repositories[0]
    const effectiveProjectId = repo?.uuid ?? ""
    const containers = registry.get<ProjectContainerRegistry>("core.project-containers")
    const container = await containers.open(effectiveProjectId, { name: "", workspacePath: repo?.localPath ?? "" })
    const agentRuntime = container.get<import("../services/agent-runtime").AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
    const result = await agentRuntime.sendScheduled({
      projectId: effectiveProjectId, agentType: "claude-code", mode: "bypassPermissions", prompt,
      providerId, modelTier,
      sessionPolicy: "fresh", timeoutMs: 120_000, abortSignal,
    })
    return { status: result.status === "success" ? "success" : "failed", response: result.summary ?? "", error: result.error, durationMs: result.durationMs }
  } catch (err) {
    const diagnostic = workflowAgentErrorDiagnostic(err)
    engineLogger.error("engine agent call failed (infrastructure)", {
      boundary: "workflow-engine.agent-deps",
      providerId, modelTier, projectId,
      ...diagnostic,
    })
    return { status: "failed", response: "", error: workflowAgentFailureMessage(diagnostic), durationMs: 0 }
  }
}
```

- [ ] **Step 5: Update engine to resolve per-node projectId**

In `electron/services/workflow/workflow-engine.ts`, around line 149-151, resolve projectId per-node:

```typescript
// Inside taskFactory, before executor.execute():
const nodeProjectId = (cfg as Record<string, unknown>)["projectId"] as string | undefined
const effectiveProjectId = nodeProjectId ?? projectId ?? def.id

const execResult = await executor.execute({
  config: cfg, resolvedVariables: resolved,
  context: { projectId: effectiveProjectId, runId, abortSignal: effectiveAbortSignal },
  agentDeps: this.agentDeps,
  onProgress: (phase, label) => {
    emit({ type: "node:progress", runId, nodeId, phase, label })
  },
})
```

- [ ] **Step 6: Update IPC run handler to resolve defaultProjectId**

In `electron/modules/workflow/ipc.ts:219-222`, use `def.defaultProjectId` instead of always using active repo:

```typescript
// Resolve the project ID for the runtime context
const appConfig = await configStore.load()
const defaultProject = def.defaultProjectId
  ? appConfig.repositories.find((r) => r.uuid === def.defaultProjectId)
  : undefined
const activeRepo = defaultProject ?? appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
const projectId = activeRepo?.uuid ?? ""
```

Apply the same change to the other two `engine.run` call sites (around lines 345 and 457).

- [ ] **Step 7: Run tests**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run workflow-nodes/ electron/services/workflow/`
Expected: All existing tests pass (they use hardcoded projectId "p1" in context).

- [ ] **Step 8: Commit**

```bash
git add workflow-nodes/types.ts workflow-nodes/prompt/executor.main.ts electron/bootstrap/descriptors.ts electron/services/workflow/workflow-engine.ts electron/modules/workflow/ipc.ts
git commit -m "feat(workflow): thread projectId through sendToAgent execution path"
```

---

### Task 4: Handle homedir fallback for empty projectId

**Files:**
- Modify: `electron/bootstrap/descriptors.ts:1016-1045`

- [ ] **Step 1: Add os.homedir() fallback when no project matches**

When `projectId` is empty or doesn't match any repository, use `os.homedir()` as the workspace path:

```typescript
import os from "node:os"

// Inside sendToAgent:
const repo = projectId
  ? config.repositories.find((r) => r.uuid === projectId)
  : (config.repositories.find((r) => r.uuid === config.activeRepoUuid) ?? config.repositories[0])
const effectiveProjectId = repo?.uuid ?? ""
const workspacePath = repo?.localPath ?? os.homedir()
const containers = registry.get<ProjectContainerRegistry>("core.project-containers")
const container = await containers.open(effectiveProjectId, { name: "", workspacePath })
```

- [ ] **Step 2: Commit**

```bash
git add electron/bootstrap/descriptors.ts
git commit -m "feat(workflow): fallback to homedir when no project configured"
```

---

### Task 5: Create shared ProjectSelect component for workflow nodes

**Files:**
- Create: `workflow-nodes/project-select.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SynapseProjectConfig } from "@/types/config"

export interface ProjectSelectProps {
  value?: string
  onChange: (id: string | undefined) => void
  projects: readonly SynapseProjectConfig[]
  placeholder?: string
}

const INHERIT_VALUE = "__inherit__"

export function ProjectSelect({ value, onChange, projects, placeholder = "继承默认" }: ProjectSelectProps) {
  return (
    <Select
      value={value ?? INHERIT_VALUE}
      onValueChange={(v) => onChange(v === INHERIT_VALUE ? undefined : v)}
    >
      <SelectTrigger className="w-full h-7 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={INHERIT_VALUE}>{placeholder}</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add workflow-nodes/project-select.tsx
git commit -m "feat(workflow): add shared ProjectSelect component for node panels"
```

---

### Task 6: Add project selector to prompt node panel

**Files:**
- Modify: `workflow-nodes/prompt/panel.tsx`

- [ ] **Step 1: Add projects prop and project selector UI**

Update the props interface and add the selector after the provider/model section:

```tsx
import { useRef, useState } from "react"
import { AlertTriangle, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import type { ModelTier } from "@/types/provider-model"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { PromptNodeConfig } from "./schema"
import { VariableBindingEditor } from "../variable-binding-editor"
import { PromptEditor } from "../prompt-editor"
import { CollapsibleSection } from "../collapsible-section"
import { useProviderLookup } from "../provider-lookup-context"
import { ProjectSelect } from "../project-select"

const TIER_LABELS: Record<ModelTier, string> = { default: "主模型", haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }

export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
}
```

Inside the component, add a project section after the "执行配置" CollapsibleSection:

```tsx
<CollapsibleSection title="项目">
  <ProjectSelect
    value={config.projectId}
    onChange={(projectId) => commit({ projectId })}
    projects={projects}
    placeholder={defaultProjectName ? `继承: ${defaultProjectName}` : "继承默认"}
  />
</CollapsibleSection>
```

- [ ] **Step 2: Commit**

```bash
git add workflow-nodes/prompt/panel.tsx
git commit -m "feat(workflow): add project selector to prompt node panel"
```

---

### Task 7: Add project selector to switch node panel

**Files:**
- Modify: `workflow-nodes/switch/panel.tsx`

- [ ] **Step 1: Add projects prop and project selector UI**

Same pattern as prompt panel — add `projects` and `defaultProjectName` to props, import `ProjectSelect`, add a `<CollapsibleSection title="项目">` with the selector. The switch panel has the same `config` commit pattern.

```tsx
import { ProjectSelect } from "../project-select"
import type { SynapseProjectConfig } from "@/types/config"

// Add to props interface:
export interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
}

// Add inside the component JSX, after the execution config section:
<CollapsibleSection title="项目">
  <ProjectSelect
    value={config.projectId}
    onChange={(projectId) => commit({ projectId })}
    projects={projects}
    placeholder={defaultProjectName ? `继承: ${defaultProjectName}` : "继承默认"}
  />
</CollapsibleSection>
```

- [ ] **Step 2: Commit**

```bash
git add workflow-nodes/switch/panel.tsx
git commit -m "feat(workflow): add project selector to switch node panel"
```

---

### Task 8: Pass projects to node config panels

**Files:**
- Modify: `src/modules/workflow/editor/node-config-panel.tsx`
- Modify: `src/modules/workflow/editor/editor-app.tsx`

- [ ] **Step 1: Thread projects through node-config-panel**

The `node-config-panel.tsx` renders node-specific panels. It needs to receive `projects` and `defaultProjectName` and forward them to prompt/switch panels.

Add to the panel's props:

```typescript
import type { SynapseProjectConfig } from "@/types/config"

// Add to NodeConfigPanelProps:
projects: readonly SynapseProjectConfig[]
defaultProjectName?: string
```

Forward these props when rendering prompt and switch panels.

- [ ] **Step 2: Provide projects from editor-app**

In `editor-app.tsx`, use `useAppConfig()` to get the project list and pass it down:

```typescript
import { useAppConfig } from "@/app-shell/config"

// Inside the component:
const { config } = useAppConfig()
const projects = config.global.projects
const defaultProjectName = definition?.defaultProjectId
  ? projects.find((p) => p.id === definition.defaultProjectId)?.name
  : undefined
```

Pass `projects` and `defaultProjectName` to `<NodeConfigPanel>`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/workflow/editor/node-config-panel.tsx src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow): thread project list to node config panels"
```

---

### Task 9: Add default project selector to workflow toolbar

**Files:**
- Modify: `src/modules/workflow/editor/toolbar.tsx`

- [ ] **Step 1: Add project selector to toolbar**

Import the Select components and add a project dropdown between the description input and the `ml-auto` button group:

```tsx
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SynapseProjectConfig } from "@/types/config"

interface WorkflowToolbarProps {
  definition: WorkflowDefinition
  saving?: boolean
  running?: boolean
  dirty?: boolean
  projects: readonly SynapseProjectConfig[]
  onSave: (def: WorkflowDefinition, silent?: boolean) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string | null>
  onChange: (def: WorkflowDefinition) => void
}

const NO_PROJECT_VALUE = "__none__"
```

Add the selector after the description input, before `<div className="ml-auto ...">`:

```tsx
<Select
  value={definition.defaultProjectId ?? NO_PROJECT_VALUE}
  onValueChange={(v) => onChange({ ...definition, defaultProjectId: v === NO_PROJECT_VALUE ? undefined : v })}
>
  <SelectTrigger className="h-7 w-40 text-xs">
    <SelectValue placeholder="默认项目（可选）" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectItem value={NO_PROJECT_VALUE}>无默认项目</SelectItem>
      {projects.map((project) => (
        <SelectItem key={project.id} value={project.id}>
          {project.name}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
</Select>
```

- [ ] **Step 2: Pass projects from editor-app to toolbar**

In `editor-app.tsx`, pass `projects={projects}` to `<WorkflowToolbar>`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/workflow/editor/toolbar.tsx src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow): add default project selector to workflow toolbar"
```

---

### Task 10: Update tests for new projectId parameter

**Files:**
- Modify: `workflow-nodes/prompt/__tests__/executor.test.ts`
- Modify: `workflow-nodes/switch/__tests__/executor.test.ts`

- [ ] **Step 1: Update prompt executor test mocks**

The `sendToAgent` mock needs to accept the new `projectId` field:

```typescript
const mockSendToAgent = vi.fn(async ({ providerId, modelTier, prompt, projectId, abortSignal }) => ({
  status: "success" as const,
  response: "mock response",
  durationMs: 100,
}))
```

- [ ] **Step 2: Update switch executor test mocks**

Same pattern — add `projectId` to the mock function signature.

- [ ] **Step 3: Run all workflow tests**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run workflow-nodes/ electron/services/workflow/`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add workflow-nodes/prompt/__tests__/executor.test.ts workflow-nodes/switch/__tests__/executor.test.ts
git commit -m "test(workflow): update executor tests for projectId parameter"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Type check**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 3: Manual verification**

1. Start dev server: `pnpm dev`
2. Open workflow editor
3. Verify toolbar shows project selector with "默认项目（可选）" placeholder
4. Select a project in toolbar
5. Open a prompt node config — verify "项目" section shows "继承: {project name}"
6. Override project in node — verify it shows the selected project name
7. Clear node project — verify it reverts to "继承: {project name}"
8. Run the workflow — verify agent executes in the correct project directory

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(workflow): address type/test issues from project association feature"
```
