# Scheduled Agent Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `builtin.agent` action type to the task scheduler, allowing scheduled tasks to trigger Agent sessions with configurable permissions, and improve the Agent module's permission UI.

**Architecture:** New action package (`action-packages/builtin/agent/`) follows the existing pattern (schema + manifest + executor + config form). The executor calls `AgentRuntimeService.sendScheduled()` which reuses the existing session creation and message routing pipeline. Agent definitions gain an `unattended` flag on modes to control which modes are available for scheduled execution.

**Tech Stack:** TypeScript, Zod, React, Electron IPC, shadcn/ui components, Lucide icons

---

## File Structure

### New Files
- `action-packages/builtin/agent/schema.ts` — Zod schema for agent action config
- `action-packages/builtin/agent/manifest.ts` — Action manifest (id, title, fields, permissions)
- `action-packages/builtin/agent/executor.main.ts` — Main process executor (calls AgentRuntimeService)
- `action-packages/builtin/agent/config.renderer.tsx` — Config form (project/agent/mode/prompt/policy)
- `action-packages/builtin/agent/result.renderer.tsx` — Result view re-export
- `action-packages/builtin/agent/index.ts` — Shared exports
- `action-packages/builtin/agent/index.shared.ts` — Shared exports alias

### Modified Files
- `desktop/src/definitions/types.ts` — Add `unattended` to `SynapseAgentModeOption`
- `desktop/src/definitions/agent/claude-code/agent-shared.ts` — Mark unattended modes
- `desktop/src/definitions/agent/codex/agent-shared.ts` — Mark unattended modes
- `desktop/electron/action-runtime/builtin-actions.ts` — Register agent action
- `desktop/src/action-runtime/builtin-actions.ts` — Register agent renderer action
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts` — Add `sendScheduled()` method
- `desktop/electron/services/agent-runtime/types.ts` — Add `ScheduledAgentContext` type
- `desktop/src/modules/agent/components/agent-session-sidebar.tsx` — Clock badge
- `desktop/src/modules/agent/components/agent-permission-panel.tsx` — Inline card redesign
- `desktop/src/modules/agent/components/agent-timeline-item.tsx` — Render permission as timeline item

---

---

## Phase 1: Core Pipeline

### Task 1: Extend Agent Mode Type with `unattended` Flag

**Files:**
- Modify: `desktop/src/definitions/types.ts:53-56`
- Modify: `desktop/src/definitions/agent/claude-code/agent-shared.ts:12-19`
- Modify: `desktop/src/definitions/agent/codex/agent-shared.ts:12-17`

- [ ] **Step 1: Update SynapseAgentModeOption type**

```typescript
// desktop/src/definitions/types.ts
export type SynapseAgentModeOption = {
  key: string
  label: string
  unattended?: boolean
}
```

- [ ] **Step 2: Mark Claude Code unattended modes**

```typescript
// desktop/src/definitions/agent/claude-code/agent-shared.ts
modes: [
  { key: "default", label: "Default" },
  { key: "acceptEdits", label: "Accept Edits" },
  { key: "plan", label: "Plan" },
  { key: "auto", label: "Auto", unattended: true },
  { key: "bypassPermissions", label: "Bypass Permissions", unattended: true },
  { key: "dontAsk", label: "Don't Ask", unattended: true },
],
```

- [ ] **Step 3: Mark Codex unattended modes**

```typescript
// desktop/src/definitions/agent/codex/agent-shared.ts
modes: [
  { key: "suggest", label: "Suggest" },
  { key: "auto-edit", label: "Auto Edit" },
  { key: "full-auto", label: "Full Auto", unattended: true },
  { key: "yolo", label: "YOLO", unattended: true },
],
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/src/definitions/types.ts desktop/src/definitions/agent/claude-code/agent-shared.ts desktop/src/definitions/agent/codex/agent-shared.ts
git commit -m "feat(agent): add unattended flag to agent mode definitions"
```

---

### Task 2: Create Agent Action Schema & Manifest

**Files:**
- Create: `desktop/action-packages/builtin/agent/schema.ts`
- Create: `desktop/action-packages/builtin/agent/manifest.ts`
- Create: `desktop/action-packages/builtin/agent/index.ts`
- Create: `desktop/action-packages/builtin/agent/index.shared.ts`

- [ ] **Step 1: Create schema**

```typescript
// desktop/action-packages/builtin/agent/schema.ts
import { z } from "zod"

export const agentActionConfigSchema = z.object({
  projectId: z.string().min(1),
  agentType: z.enum(["claude-code", "codex"]),
  mode: z.string().min(1),
  prompt: z.string().min(1),
  sessionPolicy: z.enum(["fresh", "resume"]),
  timeoutMins: z.number().int().min(1).max(120).nullable().optional(),
})

export type AgentActionConfig = z.infer<typeof agentActionConfigSchema>
```

- [ ] **Step 2: Create manifest**

```typescript
// desktop/action-packages/builtin/agent/manifest.ts
import type { ActionManifest } from "../../types"
import { agentActionConfigSchema, type AgentActionConfig } from "./schema"

export const agentActionManifest = {
  id: "builtin.agent",
  title: "Agent",
  permissions: ["agent.execute"],
  defaultConfig: {
    projectId: "",
    agentType: "claude-code",
    mode: "bypassPermissions",
    prompt: "",
    sessionPolicy: "fresh",
    timeoutMins: 30,
  },
  configFields: [
    {
      name: "projectId",
      kind: "string",
      required: true,
      description: "Target project ID.",
    },
    {
      name: "agentType",
      kind: "enum",
      required: true,
      description: "Agent type to use.",
      choices: ["claude-code", "codex"],
      defaultValue: "claude-code",
    },
    {
      name: "mode",
      kind: "string",
      required: true,
      description: "Agent execution mode (must be unattended-capable).",
    },
    {
      name: "prompt",
      kind: "string",
      required: true,
      description: "Prompt to send to the agent.",
    },
    {
      name: "sessionPolicy",
      kind: "enum",
      required: true,
      description: "Session lifecycle policy.",
      choices: ["fresh", "resume"],
      defaultValue: "fresh",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes (1-120). Null disables.",
      defaultValue: 30,
    },
  ],
  configSchema: agentActionConfigSchema,
} satisfies ActionManifest<AgentActionConfig>
```

- [ ] **Step 3: Create index exports**

```typescript
// desktop/action-packages/builtin/agent/index.ts
export { agentActionConfigSchema, type AgentActionConfig } from "./schema"
export { agentActionManifest } from "./manifest"

// desktop/action-packages/builtin/agent/index.shared.ts
export { agentActionConfigSchema, type AgentActionConfig } from "./schema"
export { agentActionManifest } from "./manifest"
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/action-packages/builtin/agent/
git commit -m "feat(scheduler): add agent action schema and manifest"
```

---

### Task 3: Implement Agent Action Executor

**Files:**
- Create: `desktop/action-packages/builtin/agent/executor.main.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`

- [ ] **Step 1: Add ScheduledAgentContext type**

```typescript
// Add to desktop/electron/services/agent-runtime/types.ts
export type ScheduledAgentSendInput = {
  readonly projectId: string
  readonly agentType: string
  readonly mode: string
  readonly prompt: string
  readonly sessionPolicy: "fresh" | "resume"
  readonly timeoutMs: number
  readonly lastConversationId?: string
  readonly abortSignal?: AbortSignal
}

export type ScheduledAgentSendResult = {
  readonly conversationId: string
  readonly status: "success" | "error" | "timeout"
  readonly summary?: string
  readonly error?: string
  readonly durationMs: number
}
```

- [ ] **Step 2: Add sendScheduled() to AgentRuntimeService**

Add this method to the `AgentRuntimeService` class in `agent-runtime-service.ts`:

```typescript
async sendScheduled(input: ScheduledAgentSendInput): Promise<ScheduledAgentSendResult> {
  const startTime = Date.now()
  const sessionKey = `scheduled:${input.projectId}:${Date.now()}`

  try {
    // Determine session: resume existing or create fresh
    let conversationId: string | undefined = input.lastConversationId
    if (input.sessionPolicy === "resume" && conversationId) {
      const existing = await this.repository.findById(conversationId)
      if (!existing) conversationId = undefined
    }

    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey: conversationId
        ? `scheduled:${conversationId}`
        : sessionKey,
      platform: "scheduled",
      content: input.prompt,
      modeOverride: input.mode,
    }

    // Set up timeout
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), input.timeoutMs)
    const combinedSignal = input.abortSignal
      ? AbortSignal.any([input.abortSignal, timeoutController.signal])
      : timeoutController.signal

    try {
      const result = input.sessionPolicy === "fresh" || !conversationId
        ? await this.sendNewSession(message, `Scheduled ${new Date().toISOString()}`)
        : await this.send(message)

      clearTimeout(timeoutId)

      return {
        conversationId: result.conversationId ?? sessionKey,
        status: result.error ? "error" : "success",
        summary: result.summary,
        error: result.error,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      clearTimeout(timeoutId)
      if (timeoutController.signal.aborted) {
        return {
          conversationId: conversationId ?? sessionKey,
          status: "timeout",
          error: `Execution timed out after ${input.timeoutMs / 60000} minutes`,
          durationMs: Date.now() - startTime,
        }
      }
      throw err
    }
  } catch (err) {
    return {
      conversationId: input.lastConversationId ?? sessionKey,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    }
  }
}
```

- [ ] **Step 3: Create executor**

```typescript
// desktop/action-packages/builtin/agent/executor.main.ts
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type { AgentRuntimeService } from "../../../electron/services/agent-runtime/agent-runtime-service"
import { agentActionManifest } from "./manifest"
import type { AgentActionConfig } from "./schema"

export function createAgentAction(deps: {
  readonly getAgentRuntime: (projectId: string) => AgentRuntimeService | undefined
}): MainActionDefinition<AgentActionConfig> {
  return {
    manifest: agentActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "agent.execute",
      actor: context.actor,
      resource: `${config.agentType}:${config.mode}`,
      context: {
        source: "task-scheduler",
        actionType: agentActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        projectId: config.projectId,
        agentType: config.agentType,
        mode: config.mode,
        sessionPolicy: config.sessionPolicy,
      },
    }),
    async execute(input) {
      const runtime = deps.getAgentRuntime(input.config.projectId)
      if (!runtime) {
        return {
          status: "failed",
          error: `No agent runtime found for project "${input.config.projectId}"`,
          metrics: { durationMs: 0 },
        }
      }

      const result = await runtime.sendScheduled({
        projectId: input.config.projectId,
        agentType: input.config.agentType,
        mode: input.config.mode,
        prompt: input.config.prompt,
        sessionPolicy: input.config.sessionPolicy,
        timeoutMs: (input.config.timeoutMins ?? 30) * 60_000,
        abortSignal: input.context.abortSignal,
      })

      return {
        status: result.status === "success" ? "success" : "failed",
        summary: result.summary,
        error: result.error,
        outputs: { conversationId: result.conversationId },
        metrics: { durationMs: result.durationMs },
      }
    },
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/action-packages/builtin/agent/executor.main.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/types.ts
git commit -m "feat(scheduler): implement agent action executor with sendScheduled()"
```

---

### Task 4: Register Agent Action in Both Registries

**Files:**
- Modify: `desktop/electron/action-runtime/builtin-actions.ts`
- Modify: `desktop/src/action-runtime/builtin-actions.ts`
- Create: `desktop/action-packages/builtin/agent/result.renderer.tsx`

- [ ] **Step 1: Create result renderer re-export**

```typescript
// desktop/action-packages/builtin/agent/result.renderer.tsx
export { ActionResultView as AgentResultView } from "../../../src/action-runtime/action-result-view"
```

- [ ] **Step 2: Register in main process registry**

```typescript
// desktop/electron/action-runtime/builtin-actions.ts
import type { ControlledProcessRunner } from "../runtime/process"
import type { AgentRuntimeService } from "../services/agent-runtime/agent-runtime-service"
import { createCommandAction } from "../../action-packages/builtin/command/executor.main"
import { createHttpRequestAction } from "../../action-packages/builtin/http-request/executor.main"
import { createScriptAction } from "../../action-packages/builtin/script/executor.main"
import { createAgentAction } from "../../action-packages/builtin/agent/executor.main"
import { MainActionRegistry } from "./action-registry"

export function createBuiltinMainActionRegistry(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly getAgentRuntime?: (projectId: string) => AgentRuntimeService | undefined
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createCommandAction(deps))
  registry.register(createScriptAction(deps))
  registry.register(createHttpRequestAction())
  if (deps.getAgentRuntime) {
    registry.register(createAgentAction({ getAgentRuntime: deps.getAgentRuntime }))
  }
  return registry
}
```

- [ ] **Step 3: Register in renderer registry**

```typescript
// Add to desktop/src/action-runtime/builtin-actions.ts
import { agentActionManifest, type AgentActionConfig } from "../../action-packages/builtin/agent"
import { AgentConfigForm } from "../../action-packages/builtin/agent/config.renderer"
import { ActionResultView } from "./action-result-view"

const agentRendererAction: RendererActionDefinition<AgentActionConfig> = {
  manifest: agentActionManifest,
  summarizeConfig: (config) => {
    const agentLabel = config.agentType === "claude-code" ? "Claude Code" : "Codex"
    return `${agentLabel} · ${config.mode}`
  },
  ConfigForm: AgentConfigForm,
  ResultView: ActionResultView,
}

// Add after httpRequestRendererAction registration:
rendererActionRegistry.register(agentRendererAction)
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/action-packages/builtin/agent/result.renderer.tsx desktop/electron/action-runtime/builtin-actions.ts desktop/src/action-runtime/builtin-actions.ts
git commit -m "feat(scheduler): register agent action in main and renderer registries"
```

---

### Task 5: Create Agent Action Config Form

**Files:**
- Create: `desktop/action-packages/builtin/agent/config.renderer.tsx`

- [ ] **Step 1: Create the config form component**

```tsx
// desktop/action-packages/builtin/agent/config.renderer.tsx
import { useMemo } from "react"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { agentBaseDefinition as claudeCodeDef } from "../../../src/definitions/agent/claude-code/agent-shared"
import { agentBaseDefinition as codexDef } from "../../../src/definitions/agent/codex/agent-shared"
import type { AgentActionConfig } from "./schema"

const AGENT_DEFINITIONS = [claudeCodeDef, codexDef] as const

export function AgentConfigForm({
  value,
  onChange,
}: {
  readonly value: AgentActionConfig
  readonly onChange: (value: AgentActionConfig) => void
}) {
  const selectedDef = AGENT_DEFINITIONS.find((d) => d.id === value.agentType)
  const unattendedModes = useMemo(
    () => selectedDef?.modes.filter((m) => m.unattended) ?? [],
    [selectedDef],
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-agent-type">Agent</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Agent type"
            className="w-full"
            type="single"
            value={value.agentType}
            variant="outline"
            onValueChange={(agentType) => {
              if (!agentType) return
              const def = AGENT_DEFINITIONS.find((d) => d.id === agentType)
              const firstUnattended = def?.modes.find((m) => m.unattended)
              onChange({
                ...value,
                agentType: agentType as AgentActionConfig["agentType"],
                mode: firstUnattended?.key ?? "",
              })
            }}
          >
            {AGENT_DEFINITIONS.map((def) => (
              <ToggleGroupItem key={def.id} className="flex-1" value={def.id}>
                {def.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="task-action-agent-mode">执行模式</FieldLabel>
        <FieldContent>
          <Select
            value={value.mode}
            onValueChange={(mode) => onChange({ ...value, mode })}
          >
            <SelectTrigger id="task-action-agent-mode">
              <SelectValue placeholder="选择模式" />
            </SelectTrigger>
            <SelectContent>
              {unattendedModes.map((mode) => (
                <SelectItem key={mode.key} value={mode.key}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="task-action-agent-prompt">提示词</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-agent-prompt"
            rows={5}
            placeholder="输入要发送给 Agent 的提示词..."
            value={value.prompt}
            onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="task-action-agent-session-policy">会话策略</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Session policy"
            className="w-full"
            type="single"
            value={value.sessionPolicy}
            variant="outline"
            onValueChange={(policy) => {
              if (policy) onChange({ ...value, sessionPolicy: policy as "fresh" | "resume" })
            }}
          >
            <ToggleGroupItem className="flex-1" value="fresh">
              每次新建
            </ToggleGroupItem>
            <ToggleGroupItem className="flex-1" value="resume">
              复用上次
            </ToggleGroupItem>
          </ToggleGroup>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="task-action-agent-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-agent-timeout"
            type="number"
            min={1}
            max={120}
            value={value.timeoutMins ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                timeoutMins: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
```

Note: The `projectId` field is not shown in this form because the task scheduler already has a project scope selector at the task level. The executor will use `context.cwd` or the task's scope `projectId` to resolve the target project. If the scheduler's task scope doesn't provide `projectId`, add a project selector field here using the same pattern as the existing scope selector in `task-form-dialog.tsx`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/action-packages/builtin/agent/config.renderer.tsx
git commit -m "feat(scheduler): add agent action config form UI"
```

---

### Task 6: Wire getAgentRuntime into Bootstrap

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts` (or wherever `createBuiltinMainActionRegistry` is called)

- [ ] **Step 1: Find where createBuiltinMainActionRegistry is called**

Run: `grep -rn "createBuiltinMainActionRegistry" desktop/electron/ --include="*.ts" | grep -v dist`

- [ ] **Step 2: Add getAgentRuntime dependency**

At the call site, pass a `getAgentRuntime` function that resolves the `AgentRuntimeService` for a given projectId. The exact implementation depends on how project containers are managed. The pattern should be:

```typescript
createBuiltinMainActionRegistry({
  processRunner,
  platform: process.platform,
  baseEnv: process.env,
  getAgentRuntime: (projectId) => {
    const container = projectContainerRegistry.get(projectId)
    return container?.agentRuntime
  },
})
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts
git commit -m "feat(scheduler): wire agent runtime into action registry bootstrap"
```

---

## Phase 2: Frontend Experience

### Task 7: Add Clock Badge to Scheduled Sessions in Sidebar

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`

- [ ] **Step 1: Identify the session list item rendering**

Find where `SynapseAgentSessionSummary` items are rendered in the sidebar. Look for the agent icon element.

- [ ] **Step 2: Add clock badge overlay**

Add a conditional clock icon when `session.platform === "scheduled"`:

```tsx
import { Clock } from "lucide-react"

// Inside the session list item, wrap the agent icon in a relative container:
<div className="relative">
  {/* existing agent icon */}
  <AgentIcon agentType={session.agentType} />
  {session.platform === "scheduled" && (
    <Clock className="absolute -bottom-0.5 -right-0.5 size-2.5 text-muted-foreground" />
  )}
</div>
```

- [ ] **Step 3: Verify the platform field is available on SynapseAgentSessionSummary**

Check `src/types/agent.ts` — if `platform` is not on the summary type, add it to the IPC response mapping in `ipc-sessions.ts`.

- [ ] **Step 4: Verify visually in dev mode**

Run: `pnpm dev`
Create a test session with platform "scheduled" (or temporarily hardcode one) and verify the clock badge appears.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-session-sidebar.tsx
git commit -m "feat(agent): show clock badge on scheduled session items"
```

---

### Task 8: Add Clock Icon to Agent Capsule in Chat Area

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-run-status.tsx` (or the component rendering the agent capsule/badge in the chat header)

- [ ] **Step 1: Locate the agent capsule component**

Search for where `agentLabel` or the agent badge/capsule is rendered in the chat timeline area. It may be in `agent-run-status.tsx`, `agent-timeline-item.tsx`, or a dedicated component.

- [ ] **Step 2: Add clock icon after agent name**

```tsx
import { Clock } from "lucide-react"

// Inside the capsule Badge:
<Badge variant="secondary" className="gap-1">
  <AgentIcon agentType={agentType} className="size-3" />
  <span>{agentLabel}</span>
  {platform === "scheduled" && (
    <Clock className="size-3 text-muted-foreground" />
  )}
</Badge>
```

- [ ] **Step 3: Verify visually**

Run: `pnpm dev`
Confirm the clock icon appears inline in the capsule for scheduled sessions.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/components/
git commit -m "feat(agent): show clock icon in agent capsule for scheduled sessions"
```

---

## Phase 3: Permission UI Redesign

### Task 9: Redesign Permission Request as Inline Timeline Card

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-permission-panel.tsx`
- Modify: `desktop/src/modules/agent/components/agent-timeline-item.tsx`

- [ ] **Step 1: Read current permission panel implementation**

Read `agent-permission-panel.tsx` to understand the current rendering and event handling (approve/deny callbacks).

- [ ] **Step 2: Create inline permission card component**

Replace the top-bar modal with an inline card rendered as a timeline item:

```tsx
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown, ShieldAlert } from "lucide-react"

function AgentPermissionCard({
  permission,
  onAllow,
  onDeny,
  resolved,
  resolvedAction,
}: {
  readonly permission: SynapseAgentPendingPermission
  readonly onAllow: () => void
  readonly onDeny: () => void
  readonly resolved?: boolean
  readonly resolvedAction?: "allowed" | "denied"
}) {
  return (
    <Card className="border-l-2 border-l-primary">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" />
          <span className="text-sm font-medium">{permission.toolName}</span>
        </div>

        {permission.toolInput && (
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground">
              详情
              <ChevronDown className="size-3 transition-transform group-data-[state=closed]:-rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                {permission.toolInput}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {resolved ? (
          <Badge variant={resolvedAction === "allowed" ? "secondary" : "outline"}>
            {resolvedAction === "allowed" ? "已允许" : "已拒绝"}
          </Badge>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={onAllow}>
              允许
            </Button>
            <Button size="sm" variant="outline" onClick={onDeny}>
              拒绝
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: Integrate into timeline rendering**

In `agent-timeline-item.tsx`, render `SynapseAgentPermissionRequestTimelineItem` using the new `AgentPermissionCard` instead of delegating to the top-bar panel.

- [ ] **Step 4: Remove or deprecate the top-bar permission panel**

If the top-bar panel is no longer needed, remove its rendering from the parent layout. Keep the component file but stop mounting it, or remove entirely if no other code references it.

- [ ] **Step 5: Verify visually**

Run: `pnpm dev`
Trigger a permission request in an interactive session (use default mode). Verify:
- Card appears inline in the conversation flow
- Allow/Deny buttons work
- Card transitions to resolved state after action

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/
git commit -m "feat(agent): redesign permission request as inline timeline card"
```

---

## Integration Verification

### Task 10: End-to-End Smoke Test

- [ ] **Step 1: Start dev environment**

Run: `pnpm dev`

- [ ] **Step 2: Create a scheduled task with agent action**

In the Task Scheduler UI:
1. Create new task
2. Set trigger to interval (every 1 minute for testing)
3. Select action type "Agent"
4. Configure: project, Claude Code, bypassPermissions mode, simple prompt like "echo hello"
5. Set session policy to "fresh"
6. Save and enable

- [ ] **Step 3: Verify execution**

Wait for the task to trigger. Check:
- A new session appears in the Agent panel under the selected project
- The session has a clock badge in the sidebar
- The conversation shows the prompt and agent response
- The task run history shows success status

- [ ] **Step 4: Test resume mode**

Update the task to use "resume" session policy. Let it trigger twice. Verify:
- Second trigger reuses the same conversation
- Messages accumulate in the same session

- [ ] **Step 5: Test timeout**

Create a task with 1-minute timeout and a prompt that would take longer (e.g., "sleep 120 seconds"). Verify:
- Task is killed after timeout
- Error timeline item appears
- Run history shows "timeout" status

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e smoke test"
```
