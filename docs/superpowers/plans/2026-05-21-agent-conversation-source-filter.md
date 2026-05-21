# Agent Conversation Source Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Agent sidebar conversations by source, and persist workflow-generated Agent conversations as `platform: "workflow"` instead of `scheduled`.

**Architecture:** Keep `ConversationEntryV1.platform` as the source discriminator. Add a small renderer utility for source bucket classification, use it in the Agent sidebar filter, and extend workflow Agent calls so they pass `sourcePlatform: "workflow"` through the existing scheduled-send path without changing scheduled task behavior.

**Tech Stack:** Electron main process, React, TypeScript, Vitest, shadcn/ui `Select`, Tailwind token/layout classes.

---

### Task 1: Source Bucket Utility

**Files:**
- Create: `desktop/src/modules/agent/conversation-source.ts`
- Test: `desktop/src/modules/agent/__tests__/conversation-source.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `desktop/src/modules/agent/__tests__/conversation-source.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  CONVERSATION_SOURCE_OPTIONS,
  conversationSourceForSession,
  filterSessionsBySource,
} from "../conversation-source"
import type { SynapseAgentSessionSummary } from "@/types/agent"

function session(platform?: string): SynapseAgentSessionSummary {
  return {
    projectId: "project-1",
    id: platform ?? "missing",
    sessionKey: "local:renderer",
    platform,
    active: false,
    historyCount: 0,
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  }
}

describe("conversation source filtering", () => {
  it("classifies known platform values", () => {
    expect(conversationSourceForSession(session(undefined))).toBe("user")
    expect(conversationSourceForSession(session("local"))).toBe("user")
    expect(conversationSourceForSession(session("local-renderer"))).toBe("user")
    expect(conversationSourceForSession(session("scheduled"))).toBe("scheduled")
    expect(conversationSourceForSession(session("workflow"))).toBe("workflow")
    expect(conversationSourceForSession(session("webhook"))).toBe("webhook")
    expect(conversationSourceForSession(session("relay"))).toBe("relay")
    expect(conversationSourceForSession(session("slack"))).toBe("bridge")
  })

  it("keeps the default option as user conversations", () => {
    expect(CONVERSATION_SOURCE_OPTIONS[0]).toMatchObject({
      value: "user",
      label: "用户对话",
    })
  })

  it("filters sessions by selected source and preserves all mode", () => {
    const sessions = [
      session("local-renderer"),
      session("scheduled"),
      session("workflow"),
      session("slack"),
    ]

    expect(filterSessionsBySource(sessions, "user").map((item) => item.platform)).toEqual(["local-renderer"])
    expect(filterSessionsBySource(sessions, "scheduled").map((item) => item.platform)).toEqual(["scheduled"])
    expect(filterSessionsBySource(sessions, "workflow").map((item) => item.platform)).toEqual(["workflow"])
    expect(filterSessionsBySource(sessions, "bridge").map((item) => item.platform)).toEqual(["slack"])
    expect(filterSessionsBySource(sessions, "all")).toEqual(sessions)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/conversation-source.test.ts
```

Expected: FAIL because `desktop/src/modules/agent/conversation-source.ts` does not exist.

- [ ] **Step 3: Implement the source utility**

Create `desktop/src/modules/agent/conversation-source.ts`:

```ts
import type { SynapseAgentSessionSummary } from "@/types/agent"

type ConversationSourceFilter =
  | "user"
  | "scheduled"
  | "workflow"
  | "webhook"
  | "relay"
  | "bridge"
  | "all"

const CONVERSATION_SOURCE_OPTIONS: Array<{ value: ConversationSourceFilter; label: string }> = [
  { value: "user", label: "用户对话" },
  { value: "scheduled", label: "定时任务" },
  { value: "workflow", label: "工作流" },
  { value: "webhook", label: "Webhook" },
  { value: "relay", label: "Relay" },
  { value: "bridge", label: "外部桥接" },
  { value: "all", label: "全部" },
]

function conversationSourceForPlatform(platform: string | undefined): Exclude<ConversationSourceFilter, "all"> {
  const normalized = platform?.trim()
  if (!normalized || normalized === "local" || normalized === "local-renderer") return "user"
  if (normalized === "scheduled") return "scheduled"
  if (normalized === "workflow") return "workflow"
  if (normalized === "webhook") return "webhook"
  if (normalized === "relay") return "relay"
  return "bridge"
}

function conversationSourceForSession(
  session: Pick<SynapseAgentSessionSummary, "platform">,
): Exclude<ConversationSourceFilter, "all"> {
  return conversationSourceForPlatform(session.platform)
}

function filterSessionsBySource<T extends Pick<SynapseAgentSessionSummary, "platform">>(
  sessions: readonly T[],
  source: ConversationSourceFilter,
): T[] {
  if (source === "all") return [...sessions]
  return sessions.filter((session) => conversationSourceForSession(session) === source)
}

export {
  CONVERSATION_SOURCE_OPTIONS,
  conversationSourceForPlatform,
  conversationSourceForSession,
  filterSessionsBySource,
  type ConversationSourceFilter,
}
```

- [ ] **Step 4: Run the test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/conversation-source.test.ts
```

Expected: PASS.

### Task 2: Sidebar Source Select

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`

- [ ] **Step 1: Add failing sidebar filter coverage**

Append this test inside `describe("AgentSessionSidebar", () => { ... })` in `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`:

```tsx
  it("defaults to user conversations and filters by source", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[
            {
              projectId: "project-1",
              id: "user-conv",
              sessionKey: "local:renderer",
              platform: "local-renderer",
              name: "User Chat",
              active: true,
              historyCount: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:01:00.000Z",
            },
            {
              projectId: "project-1",
              id: "task-conv",
              sessionKey: "scheduled:project-1:1",
              platform: "scheduled",
              name: "Scheduled Run",
              active: false,
              historyCount: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:02:00.000Z",
            },
            {
              projectId: "project-1",
              id: "workflow-conv",
              sessionKey: "workflow:run-1",
              platform: "workflow",
              name: "Workflow Run",
              active: false,
              historyCount: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:03:00.000Z",
            },
          ]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Project One", path: "/tmp/project-one" }]}
          selectedProjectId="project-1"
          selectedConversationId="workflow-conv"
          unreadByConversationId={{}}
          onCreateSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    expect(document.body.textContent).toContain("用户对话")
    expect(document.body.textContent).toContain("User Chat")
    expect(document.body.textContent).not.toContain("Scheduled Run")
    expect(document.body.textContent).not.toContain("Workflow Run")

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[role='combobox']")?.click()
    })

    const workflowOption = [...document.querySelectorAll<HTMLElement>("[role='option']")]
      .find((item) => item.textContent === "工作流")
    expect(workflowOption).toBeDefined()

    await act(async () => {
      workflowOption?.click()
    })

    expect(document.body.textContent).not.toContain("User Chat")
    expect(document.body.textContent).not.toContain("Scheduled Run")
    expect(document.body.textContent).toContain("Workflow Run")
  })
```

- [ ] **Step 2: Run the failing sidebar test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: FAIL because the filter select is not rendered.

- [ ] **Step 3: Add the source select to the sidebar**

Update `desktop/src/modules/agent/components/agent-session-sidebar.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CONVERSATION_SOURCE_OPTIONS,
  filterSessionsBySource,
  type ConversationSourceFilter,
} from "../conversation-source"
```

Inside `AgentSessionSidebar`, add state and filtered collections:

```tsx
  const [sourceFilter, setSourceFilter] = useState<ConversationSourceFilter>("user")
  const visibleSessions = filterSessionsBySource(sessions, sourceFilter)
  const visibleArchivedSessions = filterSessionsBySource(archivedSessions, sourceFilter)
  const sessionsByProject = groupSessionsByProject(visibleSessions)
```

Remove the old direct `sessionsByProject = groupSessionsByProject(sessions)` line.

Render the select as the first child of `ModuleSidebarList`:

```tsx
        <div className="px-2 pb-2">
          <Select
            value={sourceFilter}
            onValueChange={(value) => setSourceFilter(value as ConversationSourceFilter)}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="会话来源">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONVERSATION_SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
```

Use `visibleArchivedSessions` everywhere the component currently uses `archivedSessions` for empty checks and rendering.

- [ ] **Step 4: Run sidebar tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: PASS.

### Task 3: Workflow Source Propagation

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/workflow-nodes/types.ts`
- Modify: `desktop/workflow-nodes/prompt/executor.main.ts`
- Modify: `desktop/workflow-nodes/switch/executor.main.ts`
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`
- Test: existing workflow executor tests under `desktop/workflow-nodes/**/__tests__`.

- [ ] **Step 1: Extend Agent message and scheduled input types**

In `desktop/electron/services/agent-runtime/types.ts`, add:

```ts
export type ScheduledAgentSourcePlatform = "scheduled" | "workflow"
```

Extend `AgentMessage`:

```ts
  readonly userMeta?: Record<string, unknown>
```

Extend `ScheduledAgentSendInput`:

```ts
  readonly sourcePlatform?: ScheduledAgentSourcePlatform
  readonly userMeta?: Record<string, unknown>
```

- [ ] **Step 2: Make sendScheduled write the selected platform**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, update `sendScheduled`:

```ts
    const sourcePlatform = input.sourcePlatform ?? "scheduled"
    const sessionKey = `${sourcePlatform}:${input.projectId}:${Date.now()}`
    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey,
      platform: sourcePlatform,
      content: input.prompt,
      modeOverride: input.mode,
      agentType: input.agentType,
      providerId: input.providerId,
      modelTier: input.modelTier,
      userMeta: input.userMeta,
    }
```

Remove no existing behavior: when `sourcePlatform` is omitted, `sessionKey` still starts with `scheduled:` and `platform` remains `scheduled`.

- [ ] **Step 3: Persist message-level userMeta in new conversations**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, update `userMetaFromMessage` so explicit metadata is merged with existing derived metadata:

```ts
function userMetaFromMessage(message: AgentMessage): ConversationEntryV1["userMeta"] {
  return {
    ...(message.userMeta ?? {}),
    userId: message.userId,
    userName: message.userName,
    chatName: message.chatName,
    platform: message.platform,
    channelKey: message.channelKey,
    workspaceKey: message.workspaceKey,
    workspacePath: message.workspacePath,
  }
}
```

- [ ] **Step 4: Add Agent runtime tests for source platform defaults and workflow metadata**

In `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`, add one test near the existing `sendScheduled` tests:

```ts
  it("uses scheduled platform by default and workflow platform when requested", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      now: fixedNow,
    })

    await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "scheduled",
      sessionPolicy: "fresh",
      timeoutMs: 60_000,
    })

    await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "workflow",
      sessionPolicy: "fresh",
      timeoutMs: 60_000,
      sourcePlatform: "workflow",
      userMeta: {
        source: "workflow",
        workflowId: "workflow-1",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
      },
    })

    const saved = await conversations.list()
    expect(saved.some((item) => item.platform === "scheduled" && item.sessionKey.startsWith("scheduled:"))).toBe(true)
    expect(saved.some((item) =>
      item.platform === "workflow"
      && item.sessionKey.startsWith("workflow:")
      && item.userMeta?.source === "workflow"
      && item.userMeta?.workflowRunId === "run-1"
    )).toBe(true)
  })
```

- [ ] **Step 5: Extend workflow Agent dependency input**

In `desktop/workflow-nodes/types.ts`, extend `WorkflowRuntimeContext`:

```ts
  workflowId?: string
  workflowName?: string
  nodeId?: string
  nodeName?: string
```

Extend `AgentSendDeps.sendToAgent` input:

```ts
  workflowId?: string
  workflowName?: string
  workflowRunId?: string
  workflowNodeId?: string
  workflowNodeName?: string
```

- [ ] **Step 6: Pass workflow context from the engine to node executors**

In `desktop/electron/services/workflow/workflow-engine.ts`, change the executor context object:

```ts
            context: {
              projectId: effectiveProjectId,
              runId,
              workflowId: def.id,
              workflowName: def.name,
              nodeId,
              nodeName: node.name,
              abortSignal: effectiveAbortSignal,
              actor,
            },
```

- [ ] **Step 7: Pass workflow context from prompt and switch nodes to sendToAgent**

In `desktop/workflow-nodes/prompt/executor.main.ts`, change the `sendToAgent` call:

```ts
    const result = await input.agentDeps.sendToAgent({
      providerId: input.config.providerId ?? "",
      modelTier: input.config.modelTier ?? "default",
      prompt,
      projectId: input.context.projectId ?? "",
      abortSignal: input.context.abortSignal,
      timeoutMins: resolveAgentTimeoutMins(input.config.timeoutMins),
      workflowId: input.context.workflowId,
      workflowName: input.context.workflowName,
      workflowRunId: input.context.runId,
      workflowNodeId: input.context.nodeId,
      workflowNodeName: input.context.nodeName,
    })
```

In `desktop/workflow-nodes/switch/executor.main.ts`, make the same shape change for `agentDeps.sendToAgent`.

- [ ] **Step 8: Pass workflow source into Agent runtime**

In `desktop/electron/bootstrap/descriptors.ts`, update the workflow engine `sendToAgent` signature:

```ts
    const sendToAgent: import("../../workflow-nodes/types").AgentSendDeps["sendToAgent"] = async ({
      providerId,
      modelTier,
      prompt,
      projectId,
      abortSignal,
      timeoutMins,
      workflowId,
      workflowName,
      workflowRunId,
      workflowNodeId,
      workflowNodeName,
    }) => {
```

Update the `agentRuntime.sendScheduled` call:

```ts
        const result = await agentRuntime.sendScheduled({
          projectId: effectiveProjectId,
          agentType: "claude-code",
          mode: "bypassPermissions",
          prompt,
          providerId,
          modelTier,
          sessionPolicy: "fresh",
          timeoutMs: agentTimeoutMinsToMs(timeoutMins ?? DEFAULT_AGENT_TIMEOUT_MINS),
          abortSignal,
          sourcePlatform: "workflow",
          userMeta: {
            source: "workflow",
            workflowId,
            workflowName,
            workflowRunId,
            workflowNodeId,
            workflowNodeName,
          },
        })
```

- [ ] **Step 9: Add focused workflow source tests**

Update prompt and switch executor tests to assert `sendToAgent` receives:

```ts
expect(sendToAgent).toHaveBeenCalledWith(expect.objectContaining({
  workflowId: "workflow-1",
  workflowName: "Workflow One",
  workflowRunId: "run-1",
  workflowNodeId: "node-1",
  workflowNodeName: "Prompt Node",
}))
```

Add or update workflow engine/bootstrap tests so the mocked `agentRuntime.sendScheduled` receives:

```ts
expect(sendScheduled).toHaveBeenCalledWith(expect.objectContaining({
  sourcePlatform: "workflow",
  userMeta: expect.objectContaining({
    source: "workflow",
    workflowRunId: "run-1",
  }),
}))
```

- [ ] **Step 10: Run workflow and Agent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/prompt/__tests__/executor.test.ts workflow-nodes/switch/__tests__/executor.test.ts electron/services/__tests__/workflow-engine.test.ts
```

Expected: PASS.

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused Agent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/conversation-source.test.ts src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run workflow tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/prompt/__tests__/executor.test.ts workflow-nodes/switch/__tests__/executor.test.ts electron/services/__tests__/workflow-engine.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff --stat
git diff -- desktop/src/modules/agent desktop/electron/services/agent-runtime desktop/workflow-nodes desktop/electron/bootstrap/descriptors.ts desktop/electron/services/workflow/workflow-engine.ts
```

Expected: only source filtering and workflow source propagation changes are present.
