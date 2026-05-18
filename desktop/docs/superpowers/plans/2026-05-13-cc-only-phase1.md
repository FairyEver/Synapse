# Phase 1: Remove Codex/Hermes — CC Only

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Codex and Hermes adapter code, simplify the agent runtime to only support Claude Code, and hardcode all agentType references.

**Architecture:** Delete adapter files (codex-exec, codex-app-server, hermes-exec), remove AgentAdapterFactory indirection, simplify AgentRuntimeService to directly use ClaudeCodeAdapter, remove agent type selection UI from frontend.

**Tech Stack:** TypeScript, Electron, React, Zod

---

### Task 1: Delete Codex/Hermes adapter files and tests

**Files:**
- Delete: `electron/services/agent-runtime/adapters/codex-exec.ts`
- Delete: `electron/services/agent-runtime/adapters/codex-app-server-protocol.ts`
- Delete: `electron/services/agent-runtime/adapters/codex-app-server-session.ts`
- Delete: `electron/services/agent-runtime/adapters/hermes-exec.ts`
- Delete: `electron/services/agent-runtime/__tests__/codex-exec.test.ts`
- Delete: `electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts`

- [ ] **Step 1: Delete adapter implementation files**

```bash
rm electron/services/agent-runtime/adapters/codex-exec.ts
rm electron/services/agent-runtime/adapters/codex-app-server-protocol.ts
rm electron/services/agent-runtime/adapters/codex-app-server-session.ts
rm electron/services/agent-runtime/adapters/hermes-exec.ts
```

- [ ] **Step 2: Delete adapter test files**

```bash
rm electron/services/agent-runtime/__tests__/codex-exec.test.ts
rm electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts
```

- [ ] **Step 3: Delete availability and binary detect services**

```bash
rm electron/services/agent-runtime/agent-availability-service.ts
rm electron/services/agent-runtime/binary-detect-service.ts
rm electron/services/agent-runtime/__tests__/agent-availability-service.test.ts
rm electron/services/agent-runtime/__tests__/binary-detect-service.test.ts
```

- [ ] **Step 4: Delete codex-runtime from provider-config**

```bash
rm electron/services/provider-config/codex-runtime.ts
rm electron/services/provider-config/__tests__/codex-runtime.test.ts
```

- [ ] **Step 5: Verify TypeScript compilation fails with expected import errors**

```bash
pnpm tsc --noEmit 2>&1 | head -50
```

Expected: Errors about missing imports from deleted files (codex-exec, hermes-exec, binary-detect-service, agent-availability-service). This confirms we've identified all consumers.

- [ ] **Step 6: Commit deletions**

```bash
git add -A
git commit -m "chore: delete Codex/Hermes adapter files and related services"
```

---

### Task 2: Clean up index.ts exports

**Files:**
- Modify: `electron/services/agent-runtime/index.ts`

- [ ] **Step 1: Remove Codex/Hermes exports and binary-detect import**

In `electron/services/agent-runtime/index.ts`, remove these export blocks:

```typescript
// DELETE these lines:
export {
  CodexExecAdapter,
  CodexJsonLineParser,
  buildCodexExecArgs,
  parseCodexJsonLines,
  type CodexExecArgsOptions,
  type CodexExecOptions,
  type CodexParseResult,
  type CodexProcessRunner,
} from "./adapters/codex-exec"
```

Also remove the `whichBin` import:
```typescript
// DELETE:
import { whichBin } from "./binary-detect-service"
```

And remove the `AgentAdapterFactory` from the re-exports:
```typescript
// In the export block from "./agent-runtime-service", remove:
// type AgentAdapterFactory,
```

- [ ] **Step 2: Simplify createAgentRuntimeProjectService**

Replace the current `createAgentRuntimeProjectService` function. Remove `adapterFactory`, `agentType: "codex"`, and the dynamic adapter resolution. Directly instantiate `ClaudeCodeAdapter`:

```typescript
import {
  ClaudeCodeAdapter,
  type ClaudeCodeOptions,
} from "./adapters/claude-code"

export function createAgentRuntimeProjectService(): ProjectScopedService<AgentRuntimeService> {
  return {
    id: AGENT_RUNTIME_SERVICE_ID,
    create(ctx) {
      const permissionGuard = ctx.globalRegistry.get<PermissionGuard>("core.permission-guard")
      const auditSink = ctx.globalRegistry.get<AuditSink>("core.audit-sink")
      const dataRepository = ctx.globalRegistry.get<DataRepository>("core.data-repository")
      const runner = createControlledProcessRunner({ permissionGuard, auditSink })
      const outbox = new ReplyOutboxService({
        projectId: ctx.projectId,
        outbox: ctx.dataRepo.namespace<OutboxEntryV1>("outbox"),
        logger: ctx.logger,
      })
      const providerConfig = createProviderConfigServiceFromDataRepository({
        dataRepository,
        permissionGuard,
        auditSink,
      })
      const replyTargets = optionalService<NonNullable<AgentRuntimeServiceDeps["replyTargets"]>>(
        ctx.globalRegistry,
        "core.side-channel",
      )
      const executionIsolation = optionalService<ProcessIsolationResolver>(
        ctx.globalRegistry,
        "core.execution-isolation",
      )
      const customCommands = new CustomCommandRegistry({
        projectId: ctx.projectId,
        commands: ctx.dataRepo.namespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: ctx.projectMeta.workspacePath,
      })
      const skills = new SkillRegistry({
        workspacePath: ctx.projectMeta.workspacePath,
      })
      const adapter = new ClaudeCodeAdapter(runner)
      const service = new AgentRuntimeService({
        projectId: ctx.projectId,
        workDir: ctx.projectMeta.workspacePath,
        conversations: ctx.dataRepo.namespace<ConversationEntryV1>("conversations"),
        compressState: ctx.dataRepo.namespace<AgentCompressStateEntryV1>("agent.compress_state"),
        adapter,
        agentType: "claude-code",
        eventBus: ctx.eventBus,
        logger: ctx.logger,
        permissionGuard,
        auditSink,
        outbox,
        providerConfig,
        replyTargets,
        executionIsolation,
        customCommands,
        skills,
        commandRunner: runner,
      })
      service.startIdleReclaim()
      return service
    },
  }
}
```

- [ ] **Step 3: Remove createAdapterFromRuntimeDefinition and resolveRuntimeCommand**

Delete these two functions entirely from `index.ts`:

```typescript
// DELETE:
export function createAdapterFromRuntimeDefinition(...) { ... }
async function resolveRuntimeCommand(...) { ... }
```

Also remove the unused imports they relied on:
```typescript
// DELETE:
import type { AgentRuntimeDefinition, AgentRuntimeProcessRunner } from "../../../src/definitions/main-types"
import { agentRuntimeDefinitionById } from "../definitions/generated/main-registry"

// DELETE:
const agentRuntimeDefinitionsByStringId: ReadonlyMap<string, AgentRuntimeDefinition> = new Map(
  agentRuntimeDefinitionById,
)
```

- [ ] **Step 4: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -50
```

Expected: Remaining errors should be in `agent-runtime-service.ts` (AgentAdapterFactory references) and consumers of deleted exports.

- [ ] **Step 5: Commit**

```bash
git add electron/services/agent-runtime/index.ts
git commit -m "refactor: simplify agent-runtime index to CC-only"
```

---

### Task 3: Simplify AgentRuntimeService — remove adapter factory

**Files:**
- Modify: `electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `electron/services/agent-runtime/message-router.ts`

- [ ] **Step 1: Remove AgentAdapterFactory from service deps and class**

In `agent-runtime-service.ts`:

Remove `AgentAdapterFactory` type export:
```typescript
// DELETE this line:
export type AgentAdapterFactory = (view: ProviderRuntimeView) => AgentAdapter | Promise<AgentAdapter>
```

Remove `adapterFactory` from `AgentRuntimeServiceDeps`:
```typescript
// In AgentRuntimeServiceDeps, DELETE:
readonly adapterFactory?: AgentAdapterFactory
```

- [ ] **Step 2: Simplify resolveAdapter method**

Replace the `resolveAdapter` private method:

```typescript
private async resolveAdapter(_agentTypeOverride?: string): Promise<AgentAdapter> {
  return this.deps.adapter
}
```

This removes the dynamic provider-based adapter resolution (which was for Codex). The adapter is always the `ClaudeCodeAdapter` passed in deps.

- [ ] **Step 3: Remove prepareCodexRuntime import**

In `agent-runtime-service.ts`, remove:
```typescript
// DELETE from imports:
import {
  prepareCodexRuntime,
  type ProviderConfigService,
  type ProviderRuntimeView,
} from "../provider-config"
```

Replace with only what's still needed:
```typescript
import {
  type ProviderConfigService,
} from "../provider-config"
```

- [ ] **Step 4: Simplify getActiveAgentType**

Replace:
```typescript
async getActiveAgentType(): Promise<string> {
  if (!this.deps.providerConfig) return this.agentType()
  return this.deps.providerConfig.getActiveAgentType(this.deps.projectId, this.agentType())
}
```

With:
```typescript
async getActiveAgentType(): Promise<string> {
  return "claude-code"
}
```

- [ ] **Step 5: Simplify agentType method**

Replace:
```typescript
private agentType(): string {
  return this.deps.agentType ?? this.deps.adapter.agentType
}
```

With:
```typescript
private agentType(): string {
  return "claude-code"
}
```

- [ ] **Step 6: Update MessageRouter resolveAdapter callback type**

In `message-router.ts`, the `MessageRouterCallbacks` interface has:
```typescript
readonly resolveAdapter: (agentTypeOverride?: string) => Promise<AgentAdapter>
```

This stays as-is (the signature is fine, the implementation just always returns the same adapter now).

- [ ] **Step 7: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: Fewer errors. Remaining should be in provider-config consumers and frontend.

- [ ] **Step 8: Commit**

```bash
git add electron/services/agent-runtime/agent-runtime-service.ts electron/services/agent-runtime/message-router.ts
git commit -m "refactor: remove AgentAdapterFactory, hardcode CC agent type"
```

---

### Task 4: Clean up provider-config module (remove Codex references)

**Files:**
- Modify: `electron/services/provider-config/provider-config-service.ts`
- Modify: `electron/services/provider-config/index.ts`
- Modify: `electron/services/provider-config/types.ts`

- [ ] **Step 1: Remove prepareCodexRuntime export from index**

In `electron/services/provider-config/index.ts`, remove the `prepareCodexRuntime` export (the file was already deleted in Task 1):

```typescript
// DELETE any line like:
export { prepareCodexRuntime } from "./codex-runtime"
```

- [ ] **Step 2: Remove Codex-specific types**

In `electron/services/provider-config/types.ts`, remove `ProviderCodexOptionsV1` import if present, and simplify `AgentRuntimeAgentType`:

```typescript
// Change:
export type AgentRuntimeAgentType = "codex" | "claude-code" | string
// To:
export type AgentRuntimeAgentType = "claude-code"
```

- [ ] **Step 3: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add electron/services/provider-config/
git commit -m "refactor: remove Codex references from provider-config"
```

---

### Task 5: Delete frontend Codex/Hermes definitions

**Files:**
- Delete: `src/definitions/agent/codex/` (entire directory)
- Delete: `src/definitions/agent/hermes/` (entire directory)
- Modify: `src/definitions/generated/renderer-registry.ts` (or equivalent registry file)

- [ ] **Step 1: Delete definition directories**

```bash
rm -rf src/definitions/agent/codex
rm -rf src/definitions/agent/hermes
```

- [ ] **Step 2: Update the generated registry**

Find and update the registry file that imports these definitions. Remove codex and hermes entries so only claude-code remains.

```bash
grep -rn "codex\|hermes" src/definitions/ --include="*.ts" | grep -v __tests__
```

Update the file to only export the claude-code definition.

- [ ] **Step 3: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete Codex/Hermes frontend agent definitions"
```

---

### Task 6: Remove AgentPickerPopover and simplify sidebar

**Files:**
- Delete: `src/modules/agent/components/agent-picker-popover.tsx`
- Modify: `src/modules/agent/components/project-group.tsx`
- Modify: `src/modules/agent/components/agent-session-sidebar.tsx`
- Modify: `src/modules/agent/index.tsx`

- [ ] **Step 1: Delete agent-picker-popover**

```bash
rm src/modules/agent/components/agent-picker-popover.tsx
```

- [ ] **Step 2: Simplify project-group.tsx**

In `project-group.tsx`, remove the `AgentPickerPopover` import and usage. The "new session" button should directly call `onCreateSession` without agent type selection:

Change the prop type:
```typescript
// Change:
onCreateSession: (agentType: string) => void
// To:
onCreateSession: () => void
```

Replace the `AgentPickerPopover` wrapper around the new-session button with a direct button that calls `onCreateSession()`.

Remove the agent icon display per session (or keep it as a static CC icon).

- [ ] **Step 3: Simplify agent-session-sidebar.tsx**

Change the `onCreateSession` prop:
```typescript
// Change:
onCreateSession: (projectId: string, agentType: string) => void
// To:
onCreateSession: (projectId: string) => void
```

Update the call site:
```typescript
// Change:
onCreateSession={(agentType) => onCreateSession(project.id, agentType)}
// To:
onCreateSession={() => onCreateSession(project.id)}
```

- [ ] **Step 4: Simplify index.tsx**

In `src/modules/agent/index.tsx`, update the `onCreateSession` call:
```typescript
// Change:
onCreateSession={(projectId, agentType) => void chat.createSession(projectId, agentType)}
// To:
onCreateSession={(projectId) => void chat.createSession(projectId)}
```

Remove the `agentCliLabel` usage and agent definition lookup for the selected session (or keep it as static "Claude Code").

- [ ] **Step 5: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove agent picker, simplify session creation to CC-only"
```

---

### Task 7: Simplify chat connection hook

**Files:**
- Modify: `src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `src/modules/agent/hooks/use-agent-chat.ts`

- [ ] **Step 1: Simplify createSession in use-chat-connection.ts**

Change the signature:
```typescript
// Change:
readonly createSession: (projectId: string, agentType: string) => Promise<void>
// To:
readonly createSession: (projectId: string) => Promise<void>
```

In the implementation:
```typescript
// Change:
const createSession = useCallback(async (projectId: string, agentType: string) => {
  if (!projectId || !agentType) return
  // ...
  agentType,
  // ...
}, [...])
// To:
const createSession = useCallback(async (projectId: string) => {
  if (!projectId) return
  // ... remove agentType from the IPC call payload, or hardcode "claude-code"
  agentType: "claude-code",
  // ...
}, [...])
```

- [ ] **Step 2: Update use-agent-chat.ts type**

```typescript
// Change:
createSession: (projectId: string, agentType: string) => Promise<void>
// To:
createSession: (projectId: string) => Promise<void>
```

- [ ] **Step 3: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/agent/hooks/
git commit -m "refactor: simplify createSession to not require agentType"
```

---

### Task 8: Simplify prompt-run-dialog and task-scheduler

**Files:**
- Modify: `src/modules/prompts/components/prompt-run-dialog.tsx`
- Modify: `src/modules/prompts/hooks/use-prompt-run.ts`
- Modify: `src/modules/task-scheduler/components/task-form-dialog.tsx`

- [ ] **Step 1: Simplify prompt-run-dialog.tsx**

Remove the agent type selection UI (the `ToggleGroup` for agent selection). Remove `selectedAgentType` state. Remove `selectedAgentReady` check. Hardcode `"claude-code"` in the run call:

```typescript
const handleRun = async (navigate: boolean) => {
  if (!item || !selectedProjectId) return
  const success = await run({ item, projectId: selectedProjectId, agentType: "claude-code", navigate })
  if (success) {
    onOpenChange(false)
  }
}
```

Remove imports: `agentDefinitions`, `useAgentRuntimeStatus`, `ToggleGroup`, `ToggleGroupItem`.

- [ ] **Step 2: Simplify use-prompt-run.ts**

The `agentType` parameter can stay in the interface (it's just always `"claude-code"` now), or be removed. Keep it for now to minimize IPC changes:

```typescript
interface PromptRunArgs {
  item: SynapseContentMeta<"prompt">
  projectId: string
  agentType: string  // always "claude-code"
  navigate: boolean
}
```

- [ ] **Step 3: Simplify task-form-dialog.tsx**

Remove agent type selection from the task scheduler form. Hardcode `agentType` to `"claude-code"` when creating/editing scheduled tasks.

- [ ] **Step 4: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/prompts/ src/modules/task-scheduler/
git commit -m "refactor: remove agent type selection from prompts and scheduler"
```

---

### Task 9: Clean up backend IPC and ops references

**Files:**
- Modify: `electron/modules/agent/ipc-sessions.ts`
- Modify: `electron/modules/agent/ipc-shared.ts`
- Modify: `electron/modules/ops/ipc.ts`

- [ ] **Step 1: Simplify ipc-sessions.ts createSession schema**

The `agentType` field in `createSessionRequestSchema` can remain optional (for backward compat) but will be ignored:

```typescript
const createSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  name: z.string().optional(),
  agentType: z.string().optional(),  // kept for backward compat, ignored
})
```

No change needed here — the handler already passes it through and the service ignores it now.

- [ ] **Step 2: Simplify ipc-shared.ts resolveProjectAgent**

The function imports `ProviderConfigService` — keep this for now (Phase 2 will replace it). No changes needed.

- [ ] **Step 3: Simplify ops/ipc.ts**

In `electron/modules/ops/ipc.ts`, the `agentType` field should default to `"claude-code"`:

```typescript
// Where agentType is used in request schemas, add .default("claude-code"):
agentType: z.string().default("claude-code"),
```

- [ ] **Step 4: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add electron/modules/
git commit -m "refactor: default agentType to claude-code in IPC schemas"
```

---

### Task 10: Update settings panel and types

**Files:**
- Modify: `src/modules/settings/components/agent-runtime-panel.tsx`
- Modify: `src/modules/settings/hooks/use-agent-runtime-status.ts`
- Modify: `src/types/agent.ts`

- [ ] **Step 1: Simplify agent-runtime-panel.tsx**

Remove multi-agent status display. Show only CC status. Remove any agent type iteration/selection.

- [ ] **Step 2: Simplify use-agent-runtime-status.ts**

If this hook fetches availability for multiple agents, simplify to only check CC.

- [ ] **Step 3: Clean up types/agent.ts**

Remove `SynapseAgentAvailability` type if it was only used for multi-agent availability checking. Keep `agentType` fields in session types (backward compat with existing data).

- [ ] **Step 4: Verify compilation**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/settings/ src/types/agent.ts
git commit -m "refactor: simplify settings panel to CC-only status"
```

---

### Task 11: Fix remaining compilation errors and run tests

**Files:**
- Various (based on tsc output)

- [ ] **Step 1: Run full type check**

```bash
pnpm tsc --noEmit
```

Fix any remaining import errors, unused variables, or type mismatches.

- [ ] **Step 2: Run existing tests**

```bash
pnpm test 2>&1 | tail -30
```

Fix any test failures caused by removed exports or changed interfaces. Delete test files that test deleted functionality.

- [ ] **Step 3: Run the dev server**

```bash
pnpm dev
```

Verify the app starts without errors. Check the agent conversation UI works (create session, send message).

- [ ] **Step 4: Commit all fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type errors and test failures after CC-only refactor"
```

---

### Task 12: Clean up unused test files

**Files:**
- Delete: `electron/services/agent-runtime/__tests__/agent-runtime-definition-lookup.test.ts`
- Delete: `electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts` (if it tests multi-adapter state)
- Delete: `electron/services/definitions/__tests__/agent-runtime-registry.test.ts`
- Delete: `src/definitions/__tests__/agent-registry.test.ts`

- [ ] **Step 1: Identify and delete obsolete test files**

```bash
grep -l "codex\|hermes\|AdapterFactory\|agentRuntimeDefinition" electron/services/agent-runtime/__tests__/*.ts electron/services/definitions/__tests__/*.ts src/definitions/__tests__/*.ts 2>/dev/null
```

Delete files that primarily test deleted functionality.

- [ ] **Step 2: Update remaining test files**

For tests like `agent-runtime-service.test.ts` that may reference `adapterFactory`, update them to use the simplified interface (just pass `adapter: new ClaudeCodeAdapter(mockRunner)`).

- [ ] **Step 3: Run tests again**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete tests for deleted adapters"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full build**

```bash
pnpm build
```

Expected: Build succeeds.

- [ ] **Step 2: Start dev and test conversation flow**

```bash
pnpm dev
```

Test:
1. Open agent conversation
2. Create new session (should not show agent picker)
3. Send a message (should work with CC)
4. Check settings panel (should show CC status only)
5. Run a prompt (should not show agent selection)

- [ ] **Step 3: Check git diff stats**

```bash
git diff --stat main
```

Expected: Net deletion of ~1600-2000 lines.

- [ ] **Step 4: Final commit if any remaining changes**

```bash
git status
```

If clean, Phase 1 is complete.
