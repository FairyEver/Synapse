# Prompt "Run" — Implementation Plan

**Spec:** `2026-05-10-prompt-run-agent-design.md`

## Step 1: Add `canRunAsAgent` capability flag

**Files:**
- `desktop/src/config/content-types/types.ts` — add `canRunAsAgent: boolean` to `ContentTypeCapabilities`
- `desktop/src/config/content-types/prompt.ts` — set `canRunAsAgent: true`
- `desktop/src/config/content-types/rule.ts` — set `canRunAsAgent: false`
- `desktop/src/config/content-types/skill.ts` — set `canRunAsAgent: false`

**Verify:** TypeScript compiles with no errors.

---

## Step 2: Add Agent tab navigation event to `app-shell/navigation.ts`

**File:** `desktop/src/app-shell/navigation.ts`

Add a `requestOpenAgentSession` event pair (publish + subscribe), carrying `{ projectId: string; conversationId: string }`. Follow the same `CustomEvent` + subscribe/unsubscribe pattern used by `requestOpenSettingsTab`.

**File:** `desktop/src/App.tsx`

Subscribe to `requestOpenAgentSession` event: set active tab to `"agent"` and forward the target session info so `AgentModule` can select it.

**Verify:** TypeScript compiles. Navigation event can be dispatched and consumed.

---

## Step 3: Create `use-prompt-run` hook

**File (new):** `desktop/src/modules/prompts/hooks/use-prompt-run.ts`

Hook API:
```ts
function usePromptRun(): {
  run: (args: {
    item: SynapseContentMeta<"prompt">
    projectId: string
    agentType: string
    navigate: boolean
  }) => Promise<void>
  isRunning: boolean
}
```

Implementation:
1. `readContent("prompt", item.id)` → get `file.content`
2. `bridge.agent.createSession({ projectId, sessionKey: undefined, name: `${item.title} ...`, agentType })`
3. `bridge.agent.send({ projectId, sessionKey: created.sessionKey, content: file.content, clientSubmittedAt: now })`
4. If `navigate` → `requestOpenAgentSession({ projectId, conversationId: created.id })`
5. If `!navigate` → Toast "已发送到 Agent"

Error handling: Toast on each failure stage, do not close dialog.

**Verify:** TypeScript compiles.

---

## Step 4: Create `PromptRunDialog` component

**File (new):** `desktop/src/modules/prompts/components/prompt-run-dialog.tsx`

A `Dialog` containing:
- Header: `ContentItemIcon` + title + description (read-only)
- Project `Select`: data from `config.global.projects`, default to first
- Agent `ToggleGroup`: data from `agentDefinitions`, auto-select per project's `defaultAgentId`
- Agent readiness check via `useAgentRuntimeStatus(selectedProjectId)`
- Footer: "后台发送" (outline) + "发送并跳转" (default), both call `usePromptRun().run` with different `navigate` values
- Loading + disabled states during submission

Props:
```ts
{
  open: boolean
  onOpenChange: (open: boolean) => void
  item: SynapseContentMeta<"prompt"> | null
}
```

**Verify:** TypeScript compiles. Component renders in isolation.

---

## Step 5: Wire "运行" button into `ContentActionSplitButton`

**File:** `desktop/src/modules/content/components/content-action-split-button.tsx`

Changes:
- Import `getContentTypeDefinition` (already imported) and check `definition.capabilities.canRunAsAgent`
- When `canRunAsAgent === true`: render a "▶ 运行" `Button` before the existing primary action button
- If `config.global.projects` is empty → button disabled with title tooltip
- On click → set local state `runDialogOpen = true` and `runDialogItem = item`
- Render `<PromptRunDialog>` conditionally (lazy import if preferred)

**Verify:** TypeScript compiles. Prompt cards show "运行" button; Rule/Skill cards do not.

---

## Step 6: Handle Agent tab navigation in `AgentModule`

**File:** `desktop/src/modules/agent/index.tsx`

Subscribe to `requestOpenAgentSession` event. On receipt:
- Find or wait for the matching session by `conversationId`
- Call `selectSession` from `useChatConnection` to activate it

This is the only change needed in the Agent module — it receives a cross-module navigation request and selects the specified session.

**Verify:** End-to-end: click "运行" on a Prompt card → dialog → select project + agent → "发送并跳转" → lands on Agent tab with the new session active and prompt content sent.

---

## Dependency graph

```
Step 1 (capability flag) ─────────────────────┐
Step 2 (navigation event) ────────────────────┤
                                               ├→ Step 5 (wire button)
Step 3 (usePromptRun hook) ───→ Step 4 (dialog)┘
                                               └→ Step 6 (agent nav)
```

Steps 1, 2, 3 are independent and can be done in parallel.
Step 4 depends on Step 3.
Step 5 depends on Steps 1, 4.
Step 6 depends on Step 2.
