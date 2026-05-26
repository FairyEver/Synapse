# Workflow Task Agent Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable "打开对话" navigation from Workflow Runner AI nodes and Task Scheduler Agent run history to the exact Agent conversation.

**Architecture:** Persist a typed Agent conversation target on Agent-producing results, expose a single main-process `agent.openConversation` bridge method that validates the conversation and broadcasts a navigation event to the main window, then render small shadcn buttons only when a complete target exists. Workflow AI nodes emit the target as soon as Agent creates the conversation so Runner can jump while the node is still running.

**Tech Stack:** Electron IPC modules, WindowManager broadcast, React, TypeScript, shadcn/Radix UI, Vitest.

---

## File Structure

- Create `desktop/src/types/agent-navigation.ts`: shared Agent conversation target, open result, source filter, open-session payload, and navigation channel constant.
- Modify `desktop/src/app-shell/navigation.ts`: re-export the shared open-session payload and channel, and accept `sessionKey/sourceFilter`.
- Modify `desktop/src/App.tsx`: subscribe to both DOM navigation and main-process navigation broadcasts.
- Modify `desktop/src/modules/agent/conversation-source.ts`: use the shared source-filter type.
- Modify `desktop/src/modules/agent/index.tsx`: apply pending `sourceFilter` before selecting the conversation and stop stale pending handoff loops.
- Modify `desktop/src/types/agent.ts`: keep existing Agent session/event types; no navigation target definitions live here after this plan.
- Modify `desktop/src/types/bridge.ts`: add `agent.openConversation` and `agent.onOpenConversation`.
- Modify `desktop/electron/modules/agent/ipc-sessions.ts`: add `openConversation` IPC handler.
- Modify `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`: test openConversation existing and deleted paths.
- Modify `desktop/electron/preload.ts`: expose bridge method/subscription.
- Regenerate `desktop/electron/generated/ipc-channels.generated.ts` through `pnpm --filter @synapse/desktop run generate:ipc`.
- Modify `desktop/electron/services/agent-runtime/types.ts`: add `sessionKey` and creation callback to scheduled sends.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`: notify when a fresh side conversation is created.
- Modify `desktop/electron/services/agent-runtime/agent-runtime-service.ts`: return and report conversation targets.
- Modify `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`: cover sessionKey return and creation callback.
- Modify `desktop/workflow-nodes/types.ts`: thread Agent conversation target through node execution.
- Modify `desktop/workflow-nodes/prompt/executor.main.ts`: persist prompt-node Agent conversation target.
- Modify `desktop/workflow-nodes/switch/executor.main.ts`: persist switch-node Agent conversation target.
- Modify `desktop/workflow-nodes/prompt/__tests__/executor.test.ts`: cover prompt target persistence.
- Modify `desktop/workflow-nodes/switch/__tests__/executor.test.ts`: cover switch target persistence.
- Modify `desktop/electron/bootstrap/descriptors.ts`: pass workflow target callbacks through `sendToAgent`.
- Modify `desktop/electron/services/workflow/workflow-engine.ts`: emit and store `node:agent-conversation`.
- Modify `desktop/electron/services/__tests__/workflow-engine.test.ts`: cover live target event and final node result.
- Modify `desktop/src/types/workflow.ts`: add workflow event type for `node:agent-conversation`.
- Modify `desktop/electron/modules/workflow/ipc.ts`: allow the workflow event schema to carry the new event.
- Modify `desktop/src/modules/workflow/hooks/use-workflow-events.ts`: add callback for live Agent conversation targets.
- Modify `desktop/src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx`: cover live event hydration behavior.
- Create `desktop/src/lib/agent-conversation-target.ts`: validate target objects and call `window.synapse.agent.openConversation`.
- Create `desktop/src/lib/__tests__/agent-conversation-target.test.ts`: cover target extraction.
- Modify `desktop/src/modules/workflow/runner/runner-app.tsx`: pass open handler to timeline/detail.
- Modify `desktop/src/modules/workflow/runner/timeline-view.tsx`: render row action when target exists.
- Modify `desktop/src/modules/workflow/runner/node-result-panel.tsx`: render header action when target exists.
- Modify `desktop/src/modules/workflow/runner/__tests__/timeline-view.test.tsx`: cover row action visibility and click.
- Modify `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`: cover detail action visibility and click.
- Modify `desktop/action-packages/builtin/agent/executor.main.ts`: persist scheduled target fields.
- Modify `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`: cover scheduled target fields.
- Modify `desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx`: render run-history action.
- Modify `desktop/src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx`: cover action visibility, click, and not-found toast path.
- Modify `RELEASE_NOTES_PENDING.md`: add one user-facing bullet.

---

### Task 1: Shared Navigation Types And Scheduled Runtime Target

**Files:**
- Create: `desktop/src/types/agent-navigation.ts`
- Modify: `desktop/src/app-shell/navigation.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`

- [ ] **Step 1: Add failing Agent runtime tests**

Append these tests near the existing scheduled-send tests in `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`:

```ts
  it("returns scheduled agent sessionKey with the conversation id", async () => {
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

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result.status).toBe("success")
    expect(result.conversationId).toBeTruthy()
    expect(result.sessionKey).toMatch(/^scheduled:project-1:/)
    const session = await conversations.get(result.conversationId)
    expect(session?.sessionKey).toBe(result.sessionKey)
  })

  it("notifies workflow conversation targets when the conversation is created", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const onConversationCreated = vi.fn()
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

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "workflow prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
      sourcePlatform: "workflow",
      userMeta: {
        source: "workflow",
        workflowId: "wf-1",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
      },
      onConversationCreated,
    })

    expect(result.status).toBe("success")
    expect(onConversationCreated).toHaveBeenCalledTimes(1)
    expect(onConversationCreated).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: result.conversationId,
      sessionKey: result.sessionKey,
      platform: "workflow",
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: FAIL because `ScheduledAgentSendResult` has no `sessionKey` and `ScheduledAgentSendInput` has no `onConversationCreated`.

- [ ] **Step 3: Create shared navigation types**

Create `desktop/src/types/agent-navigation.ts`:

```ts
export const OPEN_AGENT_SESSION_EVENT = "synapse:open-agent-session"

export type SynapseAgentConversationPlatform = "workflow" | "scheduled"

export type SynapseAgentConversationSourceFilter =
  | "user"
  | "scheduled"
  | "workflow"
  | "webhook"
  | "relay"
  | "bridge"
  | "all"

export interface SynapseAgentConversationTarget {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey: string
  readonly platform: SynapseAgentConversationPlatform
}

export type SynapseOpenAgentConversationResult =
  | { readonly opened: true }
  | { readonly opened: false; readonly reason: "not-found" }

export interface OpenAgentSessionPayload {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey?: string
  readonly sourceFilter?: SynapseAgentConversationSourceFilter
  readonly prompt?: string
}
```

- [ ] **Step 4: Update app-shell navigation types**

In `desktop/src/app-shell/navigation.ts`, replace the local event constant and `OpenAgentSessionPayload` type with imports:

```ts
import {
  OPEN_AGENT_SESSION_EVENT,
  type OpenAgentSessionPayload,
} from "@/types/agent-navigation"
```

Remove the local `const OPEN_AGENT_SESSION_EVENT = "synapse:open-agent-session"` and the local `type OpenAgentSessionPayload = { ... }`.

Keep the existing `requestOpenAgentSession`, `subscribeOpenAgentSession`, and final `export type { OpenAgentSessionPayload, WatchNextAgentSessionPayload }`.

- [ ] **Step 5: Extend scheduled Agent types**

In `desktop/electron/services/agent-runtime/types.ts`, import the target type:

```ts
import type { SynapseAgentConversationTarget } from "../../../src/types/agent-navigation"
```

Then update `ScheduledAgentSendInput` and `ScheduledAgentSendResult`:

```ts
export type ScheduledAgentSendInput = {
  readonly projectId: string
  readonly agentType: string
  readonly mode: string
  readonly prompt: string
  readonly sessionPolicy: "fresh" | "resume"
  readonly timeoutMs: number
  readonly lastConversationId?: string
  readonly abortSignal?: AbortSignal
  readonly providerId?: string
  readonly modelTier?: string
  readonly sourcePlatform?: ScheduledAgentSourcePlatform
  readonly userMeta?: Record<string, unknown>
  readonly onConversationCreated?: (target: SynapseAgentConversationTarget) => void
}

export type ScheduledAgentSendResult = {
  readonly conversationId: string
  readonly sessionKey: string
  readonly status: "success" | "error" | "timeout"
  readonly summary?: string
  readonly error?: string
  readonly durationMs: number
  readonly usage?: Record<string, unknown>
  readonly costUsd?: number
}
```

- [ ] **Step 6: Let ConversationRouter report fresh conversation creation**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, update the `sendNewSession` options type and call the callback immediately after `createSideSession`:

```ts
  async sendNewSession(
    message: AgentMessage,
    name: string,
    options: {
      readonly abortSignal?: AbortSignal
      readonly liveEventTimeoutMs?: number
      readonly onConversationCreated?: (conversation: ConversationEntryV1) => void
    } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const providerId = await this.resolveNewConversationProviderId(message)
    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      agentType: "claude-sdk",
      providerId,
      mode: message.modeOverride,
      modelTier: message.modelTier,
      name,
      userMeta: userMetaFromMessage(message),
      resumePolicy: "fresh",
    })
    options.onConversationCreated?.(conversation)
    return this.enqueueTurn({ ...message, providerId }, conversation, options)
  }
```

- [ ] **Step 7: Return sessionKey and invoke creation callback in AgentRuntimeService**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, import the target type:

```ts
import type { SynapseAgentConversationTarget } from "../../../src/types/agent-navigation"
```

Inside `sendScheduled`, after `message` is created, add:

```ts
    let conversationTarget: SynapseAgentConversationTarget | undefined
    const captureConversationTarget = (conversation: Pick<ConversationEntryV1, "id" | "projectId" | "sessionKey" | "platform">) => {
      const target: SynapseAgentConversationTarget = {
        projectId: conversation.projectId,
        conversationId: conversation.id,
        sessionKey: conversation.sessionKey,
        platform: sourcePlatform,
      }
      conversationTarget = target
      input.onConversationCreated?.(target)
    }
```

For the early aborted result, include the generated session key:

```ts
      const result: ScheduledAgentSendResult = {
        conversationId: "",
        sessionKey,
        status: "error",
        error: "Aborted before execution",
        durationMs,
      }
```

For permission denied result, include `sessionKey`.

When calling `sendNewSession`, pass the callback:

```ts
        result = await this.conversationRouter.sendNewSession(message, name, {
          abortSignal: ac.signal,
          liveEventTimeoutMs: scheduledLiveEventTimeoutMs(input.timeoutMs),
          onConversationCreated: captureConversationTarget,
        })
```

Before the resume branch calls `sendToConversation`, load the existing conversation and capture it:

```ts
          const existingConversation = await this.repository.get(input.lastConversationId)
          if (existingConversation) {
            captureConversationTarget(existingConversation)
          }
          result = await this.conversationRouter.sendToConversation(message, input.lastConversationId, {
            abortSignal: ac.signal,
            liveEventTimeoutMs: scheduledLiveEventTimeoutMs(input.timeoutMs),
          })
```

For the resume-not-found fallback `sendNewSession`, pass the same callback.

After the send returns and before building `scheduledResult`, derive the final session key:

```ts
      const resultSessionKey = conversationTarget?.sessionKey
        ?? (result.conversationId ? (await this.repository.get(result.conversationId))?.sessionKey : undefined)
        ?? sessionKey
```

Add `sessionKey: resultSessionKey` to timeout, success/error, and catch-block `ScheduledAgentSendResult` objects.

- [ ] **Step 8: Run Agent runtime tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add desktop/src/types/agent-navigation.ts desktop/src/app-shell/navigation.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
git commit -m "feat: expose agent conversation targets"
```

---

### Task 2: Main-Window Agent Conversation Navigation Bridge

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-sessions.ts`
- Modify: `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/modules/agent/conversation-source.ts`
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`

- [ ] **Step 1: Add failing IPC tests**

In `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`, add imports if missing:

```ts
import type { DataRepository } from "../../runtime/data-repo"
import type { WindowManager } from "../../runtime/window"
```

Append these tests:

```ts
  it("opens an existing workflow conversation in the main window", async () => {
    const conversations = {
      get: vi.fn(async () => ({
        id: "conversation-1",
        schemaVersion: 1,
        projectId: "project-1",
        sessionKey: "workflow:project-1:123",
        platform: "workflow",
        active: false,
        history: [],
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      })),
    }
    const dataRepository = {
      namespace: vi.fn(() => conversations),
    } as unknown as DataRepository
    const windowManager = {
      open: vi.fn(),
      broadcast: vi.fn(() => 1),
    } as unknown as WindowManager
    const ctx = createCtx({
      "core.data-repository": dataRepository,
      "core.window-manager": windowManager,
    })

    const result = await sessionMethods.openConversation.handler(ctx, {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })

    expect(result).toEqual({ opened: true })
    expect(windowManager.open).toHaveBeenCalledWith("main")
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:open-agent-session",
      {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "workflow:project-1:123",
        sourceFilter: "workflow",
      },
      expect.any(Function),
    )
  })

  it("does not navigate when the conversation is missing", async () => {
    const conversations = { get: vi.fn(async () => null) }
    const dataRepository = {
      namespace: vi.fn(() => conversations),
    } as unknown as DataRepository
    const windowManager = {
      open: vi.fn(),
      broadcast: vi.fn(),
    } as unknown as WindowManager
    const ctx = createCtx({
      "core.data-repository": dataRepository,
      "core.window-manager": windowManager,
    })

    const result = await sessionMethods.openConversation.handler(ctx, {
      projectId: "project-1",
      conversationId: "missing-conversation",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })

    expect(result).toEqual({ opened: false, reason: "not-found" })
    expect(windowManager.open).not.toHaveBeenCalled()
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })
```

If `createCtx` in this test file accepts a different service map shape, use its existing helper style and provide the same two services.

- [ ] **Step 2: Run IPC tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc-sessions.test.ts
```

Expected: FAIL because `openConversation` is not defined.

- [ ] **Step 3: Implement openConversation IPC**

In `desktop/electron/modules/agent/ipc-sessions.ts`, add imports:

```ts
import type { WindowManager } from "../../runtime/window"
import {
  OPEN_AGENT_SESSION_EVENT,
  type SynapseAgentConversationTarget,
  type SynapseOpenAgentConversationResult,
} from "../../../src/types/agent-navigation"
```

Add schemas near request/response schemas:

```ts
const openConversationRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  sessionKey: z.string().min(1),
  platform: z.enum(["workflow", "scheduled"]),
})

const openConversationResultSchema = z.discriminatedUnion("opened", [
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), reason: z.literal("not-found") }),
])
```

Add type aliases:

```ts
type OpenConversationRequest = z.infer<typeof openConversationRequestSchema>
```

Add this method to `sessionMethods`:

```ts
  openConversation: {
    kind: "invoke",
    channel: "synapse:agent:open-conversation",
    request: openConversationRequestSchema,
    response: openConversationResultSchema,
    handler: async (ctx, request: OpenConversationRequest): Promise<SynapseOpenAgentConversationResult> => {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
      const conversation = await conversations.get(request.conversationId)
      if (
        !conversation
        || conversation.projectId !== request.projectId
        || conversation.sessionKey !== request.sessionKey
        || conversation.platform !== request.platform
      ) {
        logger.info("Agent conversation open skipped: target missing.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          platform: request.platform,
        })
        return { opened: false, reason: "not-found" }
      }

      const windowManager = ctx.resolve<WindowManager>("core.window-manager")
      windowManager.open("main")
      const payload = {
        projectId: request.projectId,
        conversationId: request.conversationId,
        sessionKey: request.sessionKey,
        sourceFilter: request.platform,
      } satisfies {
        readonly projectId: string
        readonly conversationId: string
        readonly sessionKey: string
        readonly sourceFilter: SynapseAgentConversationTarget["platform"]
      }
      const sent = windowManager.broadcast(
        OPEN_AGENT_SESSION_EVENT,
        payload,
        (window) => window.role === "main",
      )
      if (sent === 0) {
        logger.warn("Agent conversation open broadcast missed main window.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          platform: request.platform,
        })
        throw new Error("Main window is unavailable")
      }
      return { opened: true }
    },
  },
```

- [ ] **Step 4: Regenerate IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` includes `agent.openConversation`.

- [ ] **Step 5: Expose bridge method and broadcast subscription**

In `desktop/electron/preload.ts`, import shared types/constants:

```ts
import {
  OPEN_AGENT_SESSION_EVENT,
  type OpenAgentSessionPayload,
  type SynapseAgentConversationTarget,
  type SynapseOpenAgentConversationResult,
} from "../src/types/agent-navigation"
```

In the `agent` bridge object, add:

```ts
    openConversation: (target: SynapseAgentConversationTarget): Promise<SynapseOpenAgentConversationResult> =>
      invoke(IPC_CHANNELS.agent.openConversation)(target),
    onOpenConversation: createRawPayloadSubscription<OpenAgentSessionPayload>(
      subscribe,
      OPEN_AGENT_SESSION_EVENT,
    ),
```

- [ ] **Step 6: Update bridge types**

In `desktop/src/types/bridge.ts`, import:

```ts
import type {
  OpenAgentSessionPayload,
  SynapseAgentConversationTarget,
  SynapseOpenAgentConversationResult,
} from "./agent-navigation"
```

Add to the `agent` bridge interface:

```ts
    openConversation: (
      target: SynapseAgentConversationTarget,
    ) => Promise<SynapseOpenAgentConversationResult>
    onOpenConversation: (
      listener: (payload: OpenAgentSessionPayload) => void,
    ) => () => void
```

- [ ] **Step 7: Subscribe App to main-process open events**

In `desktop/src/App.tsx`, replace the current `subscribeOpenAgentSession` effect with a shared handler:

```ts
  const handleOpenAgentSession = useCallback((payload: OpenAgentSessionPayload) => {
    setActiveTab("agent", "notification")
    setPendingAgentSession(payload)
  }, [setActiveTab])

  useEffect(() => {
    return subscribeOpenAgentSession(handleOpenAgentSession)
  }, [handleOpenAgentSession])

  useEffect(() => {
    const bridge = getSynapseBridge()
    return bridge?.agent.onOpenConversation(handleOpenAgentSession)
  }, [handleOpenAgentSession])
```

Keep the existing `OpenAgentSessionPayload` import from `@/app-shell/navigation`.

- [ ] **Step 8: Share source filter type**

In `desktop/src/modules/agent/conversation-source.ts`, import:

```ts
import type { SynapseAgentConversationSourceFilter } from "@/types/agent-navigation"
```

Replace the local union with:

```ts
type ConversationSourceFilter = SynapseAgentConversationSourceFilter
```

- [ ] **Step 9: Apply pending source filter and stop stale refresh loops**

In `desktop/src/modules/agent/index.tsx`, add a ref next to `pendingSessionRefreshKeyRef`:

```ts
  const pendingSessionMissingKeyRef = useRef<string | null>(null)
```

At the start of the `useEffect` that handles `pendingAgentSession`, update the no-pending branch:

```ts
    if (!pendingAgentSession) {
      pendingSessionRefreshKeyRef.current = null
      pendingSessionMissingKeyRef.current = null
      return
    }
```

Immediately after that branch, apply the filter:

```ts
    if (pendingAgentSession.sourceFilter && sourceFilter !== pendingAgentSession.sourceFilter) {
      pendingSessionRefreshKeyRef.current = null
      pendingSessionMissingKeyRef.current = null
      setSourceFilter(pendingAgentSession.sourceFilter)
      return
    }
```

When `target` is found, clear both pending refs before selecting:

```ts
      pendingSessionRefreshKeyRef.current = null
      pendingSessionMissingKeyRef.current = null
```

After `const pendingKey = ...`, add stale handling before refresh:

```ts
    if (pendingSessionMissingKeyRef.current === pendingKey) {
      pendingSessionMissingKeyRef.current = null
      toast.error("对话不存在或已删除")
      onPendingAgentSessionConsumed?.()
      return
    }
```

Replace the refresh call with:

```ts
    void chat.refresh().then(() => {
      pendingSessionMissingKeyRef.current = pendingKey
    }).finally(() => {
      pendingSessionRefreshKeyRef.current = null
    }).catch((rawError) => {
      logger.error("Agent pending session refresh failed.", {
        boundary: "renderer.agent.pending-session-refresh",
        projectId: pendingAgentSession.projectId,
        conversationId: pendingAgentSession.conversationId,
        sessionKey: chat.selectedSessionKey,
        ...errorDiagnostic(rawError),
      })
      pendingSessionMissingKeyRef.current = pendingKey
    })
```

Add `sourceFilter` to the effect dependency array.

- [ ] **Step 10: Add Agent module pending-navigation tests**

In `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`, add this test after `"does not render a selected session excluded by the active source filter"`:

```tsx
  it("switches source filter before selecting a pending workflow session", async () => {
    const workflowSession: SynapseAgentSessionSummary = {
      ...targetSession,
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
      name: "Workflow Run",
    }
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const onPendingAgentSessionConsumed = vi.fn()
    mocks.chat = createChatState({
      sessions: [workflowSession],
      selectSession,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            sessionKey: "workflow:project-1:123",
            sourceFilter: "workflow",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    expect(mocks.sidebarProps?.sourceFilter).toBe("workflow")
    expect(selectSession).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            sessionKey: "workflow:project-1:123",
            sourceFilter: "workflow",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
      await Promise.resolve()
    })

    expect(selectSession).toHaveBeenCalledWith(workflowSession)
    expect(onPendingAgentSessionConsumed).toHaveBeenCalledTimes(1)
  })
```

Replace the existing `"retries refresh when target session is still missing after successful refresh"` test with this stale-target behavior:

```tsx
  it("shows a stale pending conversation message after refresh cannot find the target", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const onPendingAgentSessionConsumed = vi.fn()
    const pendingAgentSession = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      sourceFilter: "workflow" as const,
    }
    mocks.chat = createChatState({ refresh, selectSession })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={pendingAgentSession}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={pendingAgentSession}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
      await Promise.resolve()
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(selectSession).not.toHaveBeenCalled()
    expect(mocks.toast.error).toHaveBeenCalledWith("对话不存在或已删除")
    expect(onPendingAgentSessionConsumed).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 11: Run navigation tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc-sessions.test.ts src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Commit Task 2**

Run:

```bash
git add desktop/electron/modules/agent/ipc-sessions.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts desktop/src/App.tsx desktop/src/modules/agent/conversation-source.ts desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx
git commit -m "feat: open agent conversations from detail windows"
```

---

### Task 3: Workflow Agent Conversation Target Propagation

**Files:**
- Modify: `desktop/workflow-nodes/types.ts`
- Modify: `desktop/workflow-nodes/prompt/executor.main.ts`
- Modify: `desktop/workflow-nodes/switch/executor.main.ts`
- Modify: `desktop/workflow-nodes/prompt/__tests__/executor.test.ts`
- Modify: `desktop/workflow-nodes/switch/__tests__/executor.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`
- Modify: `desktop/electron/services/__tests__/workflow-engine.test.ts`
- Modify: `desktop/src/types/workflow.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/src/modules/workflow/hooks/use-workflow-events.ts`
- Modify: `desktop/src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx`

- [ ] **Step 1: Add failing workflow-node executor tests**

In `desktop/workflow-nodes/prompt/__tests__/executor.test.ts`, add:

```ts
  it("returns the Agent conversation target from sendToAgent", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const sendToAgent = vi.fn().mockResolvedValue({
      status: "success" as const,
      response: "ok",
      durationMs: 5,
      agentConversation: target,
    })

    const result = await promptNodeExecutor.execute({
      config: { prompt: "Hello", providerId: "anthropic", modelTier: "sonnet" },
      resolvedVariables: {},
      context: ctx,
      agentDeps: { sendToAgent },
    })

    expect(result.agentConversation).toEqual(target)
  })
```

In `desktop/workflow-nodes/switch/__tests__/executor.test.ts`, add:

```ts
  it("returns the Agent conversation target from branch matching", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const sendToAgent = vi.fn().mockResolvedValue({
      status: "success" as const,
      response: "yes",
      durationMs: 5,
      agentConversation: target,
    })

    const result = await switchNodeExecutor.execute({
      config: {
        prompt: "Choose",
        branches: [{ id: "yes", label: "Yes" }],
        providerId: "anthropic",
        modelTier: "sonnet",
      },
      resolvedVariables: {},
      context: ctx,
      agentDeps: { sendToAgent },
    })

    expect(result.agentConversation).toEqual(target)
  })
```

- [ ] **Step 2: Run node tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/prompt/__tests__/executor.test.ts workflow-nodes/switch/__tests__/executor.test.ts
```

Expected: FAIL because `NodeExecutionResult` has no `agentConversation`.

- [ ] **Step 3: Extend workflow node interfaces**

In `desktop/workflow-nodes/types.ts`, import:

```ts
import type { SynapseAgentConversationTarget } from "../src/types/agent-navigation"
```

Update `AgentSendDeps["sendToAgent"]` input and result:

```ts
    onConversationCreated?: (target: SynapseAgentConversationTarget) => void
  }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
    usage?: Record<string, unknown>
    costUsd?: number
    agentConversation?: SynapseAgentConversationTarget
  }>
```

Update `NodeExecutionInput`:

```ts
  onAgentConversation?: (target: SynapseAgentConversationTarget) => void
```

Update `NodeExecutionResult`:

```ts
  agentConversation?: SynapseAgentConversationTarget
```

- [ ] **Step 4: Thread target through prompt executor**

In `desktop/workflow-nodes/prompt/executor.main.ts`, before `sendToAgent`, add:

```ts
    let agentConversation: NodeExecutionResult["agentConversation"]
```

Add these fields to the `sendToAgent` call:

```ts
      onConversationCreated: (target) => {
        agentConversation = target
        input.onAgentConversation?.(target)
      },
```

In every return path that includes `usage` and `costUsd`, add:

```ts
agentConversation: agentConversation ?? result.agentConversation
```

For the success return:

```ts
    return {
      status: "success",
      output: result.response,
      durationMs,
      usage: result.usage,
      costUsd: result.costUsd,
      agentConversation: agentConversation ?? result.agentConversation,
    }
```

- [ ] **Step 5: Thread target through switch executor**

In `desktop/workflow-nodes/switch/executor.main.ts`, before `sendToAgent`, add:

```ts
    let agentConversation: NodeExecutionResult["agentConversation"]
```

Add these fields to the `sendToAgent` call:

```ts
      onConversationCreated: (target) => {
        agentConversation = target
        input.onAgentConversation?.(target)
      },
```

In the failed, matched, default-branch, and no-match returns, add:

```ts
agentConversation: agentConversation ?? agentResult.agentConversation
```

- [ ] **Step 6: Run node tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/prompt/__tests__/executor.test.ts workflow-nodes/switch/__tests__/executor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Add failing workflow engine test**

In `desktop/electron/services/__tests__/workflow-engine.test.ts`, add this test near the existing `preserves prompt node usage and cost in node results and completed events` test:

```ts
  it("emits and stores Agent conversation targets for AI nodes", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const agent = {
      sendToAgent: vi.fn(async (input: { onConversationCreated?: (target: typeof target) => void }) => {
        input.onConversationCreated?.(target)
        return {
          status: "success" as const,
          response: "ok",
          durationMs: 5,
          agentConversation: target,
        }
      }),
    }
    const def: WorkflowDefinition = {
      id: "wf-agent-target",
      name: "WF",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const engine = new WorkflowEngine(agent)
    const events: WorkflowEvent[] = []

    const result = await engine.run(
      def,
      {},
      "run-1",
      (event) => events.push(event),
      undefined,
      "project-1",
      "manual",
    )

    expect(events).toContainEqual({
      type: "node:agent-conversation",
      runId: "run-1",
      nodeId: "a",
      target,
    })
    expect(result.nodeResults.a.outputs?.agentConversation).toEqual(target)
  })
```

- [ ] **Step 8: Extend workflow shared types**

In `desktop/src/types/workflow.ts`, import:

```ts
import type { SynapseAgentConversationTarget } from "./agent-navigation"
```

Change `NodeRunResult.outputs` to:

```ts
  output?: string
  outputs?: Record<string, unknown> & {
    readonly agentConversation?: SynapseAgentConversationTarget
  }
```

Add this union member to `WorkflowEvent`:

```ts
  | { type: "node:agent-conversation"; runId: string; nodeId: string; target: SynapseAgentConversationTarget }
```

- [ ] **Step 9: Store and emit target in WorkflowEngine**

In `desktop/electron/services/workflow/workflow-engine.ts`, inside `taskFactory.execute`, pass `onAgentConversation` to `executor.execute`:

```ts
            onAgentConversation: (target) => {
              const existing = nodeResults[nodeId]
              if (!existing) return
              existing.outputs = {
                ...(existing.outputs ?? {}),
                agentConversation: target,
              }
              emit({ type: "node:agent-conversation", runId, nodeId, target })
            },
```

When returning the `NodeExecOutcome`, merge `agentConversation` into outputs:

```ts
          const outputs = execResult.agentConversation
            ? { ...(execResult.outputs ?? {}), agentConversation: execResult.agentConversation }
            : execResult.outputs

          return {
            nodeId,
            status: execResult.status,
            output: execResult.output,
            outputs,
            activeBranch: execResult.activeBranch,
            error: execResult.error,
            durationMs: execResult.durationMs,
            usage: execResult.usage,
            costUsd: execResult.costUsd,
          }
```

- [ ] **Step 10: Allow workflow IPC event schema**

In `desktop/electron/modules/workflow/ipc.ts`, add an import for the platform enum if there is no shared schema:

```ts
const agentConversationTargetSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  sessionKey: z.string(),
  platform: z.enum(["workflow", "scheduled"]),
})
```

Add the event schema member wherever `WorkflowEvent` zod union is declared:

```ts
z.object({
  type: z.literal("node:agent-conversation"),
  runId: z.string(),
  nodeId: z.string(),
  target: agentConversationTargetSchema,
})
```

- [ ] **Step 11: Add useWorkflowEvents callback**

In `desktop/src/modules/workflow/hooks/use-workflow-events.ts`, add to `WorkflowEventCallbacks`:

```ts
  onNodeAgentConversation?: (nodeId: string, target: NonNullable<NodeRunResult["outputs"]>["agentConversation"]) => void
```

In the event handler, add:

```ts
      } else if (event.type === "node:agent-conversation") {
        cbRef.current.onNodeAgentConversation?.(event.nodeId, event.target)
```

- [ ] **Step 12: Add hook test**

In `desktop/src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx`, add `onNodeAgentConversation` to `HookProbe`:

```tsx
function HookProbe({
  onFailed,
  onNodeAgentConversation,
}: {
  readonly onFailed: (error: string, nodeResults?: Record<string, NodeRunResult>) => void
  readonly onNodeAgentConversation?: (
    nodeId: string,
    target: NonNullable<NodeRunResult["outputs"]>["agentConversation"],
  ) => void
}): ReactNode {
  const callbacks = useMemo(() => ({ onFailed, onNodeAgentConversation }), [
    onFailed,
    onNodeAgentConversation,
  ])
  useWorkflowEvents("run-1", callbacks)
  return null
}
```

Add this test inside the `describe("useWorkflowEvents", ...)` block:

```tsx
  it("notifies live Agent conversation targets", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const onNodeAgentConversation = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          onFailed={vi.fn()}
          onNodeAgentConversation={onNodeAgentConversation}
        />,
      )
    })

    await act(async () => {
      workflowListener?.({
        type: "node:agent-conversation",
        runId: "run-1",
        nodeId: "node-1",
        target,
      })
      await Promise.resolve()
    })

    expect(onNodeAgentConversation).toHaveBeenCalledWith("node-1", target)
  })
```

- [ ] **Step 13: Run workflow propagation tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx
```

Expected: PASS.

- [ ] **Step 14: Commit Task 3**

Run:

```bash
git add desktop/workflow-nodes/types.ts desktop/workflow-nodes/prompt/executor.main.ts desktop/workflow-nodes/switch/executor.main.ts desktop/workflow-nodes/prompt/__tests__/executor.test.ts desktop/workflow-nodes/switch/__tests__/executor.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/services/workflow/workflow-engine.ts desktop/electron/services/__tests__/workflow-engine.test.ts desktop/src/types/workflow.ts desktop/electron/modules/workflow/ipc.ts desktop/src/modules/workflow/hooks/use-workflow-events.ts desktop/src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx
git commit -m "feat: attach agent targets to workflow nodes"
```

---

### Task 4: Workflow Runner Open Conversation Actions

**Files:**
- Create: `desktop/src/lib/agent-conversation-target.ts`
- Create: `desktop/src/lib/__tests__/agent-conversation-target.test.ts`
- Modify: `desktop/src/modules/workflow/runner/runner-app.tsx`
- Modify: `desktop/src/modules/workflow/runner/timeline-view.tsx`
- Modify: `desktop/src/modules/workflow/runner/node-result-panel.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/timeline-view.test.tsx`
- Modify: `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`

- [ ] **Step 1: Add failing target helper test**

Create `desktop/src/lib/__tests__/agent-conversation-target.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  agentConversationTargetFromOutputs,
  openAgentConversationTarget,
} from "../agent-conversation-target"

describe("agent conversation target helpers", () => {
  it("extracts a complete Agent conversation target", () => {
    const target = agentConversationTargetFromOutputs({
      agentConversation: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "workflow:project-1:123",
        platform: "workflow",
      },
    })

    expect(target).toEqual({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })
  })

  it("rejects incomplete Agent conversation targets", () => {
    expect(agentConversationTargetFromOutputs({
      agentConversation: {
        projectId: "project-1",
        conversationId: "conversation-1",
        platform: "workflow",
      },
    })).toBeNull()
  })

  it("calls the bridge openConversation method", async () => {
    const openConversation = vi.fn(async () => ({ opened: true as const }))
    vi.stubGlobal("window", {
      synapse: {
        agent: { openConversation },
      },
    })

    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }

    await expect(openAgentConversationTarget(target)).resolves.toEqual({ opened: true })
    expect(openConversation).toHaveBeenCalledWith(target)
  })
})
```

- [ ] **Step 2: Run helper test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-conversation-target.test.ts
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Implement target helper**

Create `desktop/src/lib/agent-conversation-target.ts`:

```ts
import type {
  SynapseAgentConversationTarget,
  SynapseOpenAgentConversationResult,
} from "@/types/agent-navigation"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isAgentConversationPlatform(value: unknown): value is SynapseAgentConversationTarget["platform"] {
  return value === "workflow" || value === "scheduled"
}

export function agentConversationTargetFromOutputs(
  outputs: Record<string, unknown> | undefined,
): SynapseAgentConversationTarget | null {
  const raw = outputs?.agentConversation
  if (!isRecord(raw)) return null
  const { projectId, conversationId, sessionKey, platform } = raw
  if (
    typeof projectId !== "string"
    || projectId.length === 0
    || typeof conversationId !== "string"
    || conversationId.length === 0
    || typeof sessionKey !== "string"
    || sessionKey.length === 0
    || !isAgentConversationPlatform(platform)
  ) {
    return null
  }
  return { projectId, conversationId, sessionKey, platform }
}

export async function openAgentConversationTarget(
  target: SynapseAgentConversationTarget,
): Promise<SynapseOpenAgentConversationResult> {
  const bridge = window.synapse?.agent.openConversation
  if (!bridge) throw new Error("Agent conversation bridge is unavailable")
  return bridge(target)
}
```

- [ ] **Step 4: Run helper test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-conversation-target.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing Workflow Runner UI tests**

In `desktop/src/modules/workflow/runner/__tests__/timeline-view.test.tsx`, add this test:

```tsx
  it("opens the Agent conversation attached to a node result", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenAgentConversation = vi.fn()

    await act(async () => {
      root.render(
        <TimelineView
          definition={definition()}
          nodeResults={{
            "node-1": {
              ...nodeResult(),
              outputs: { agentConversation: target },
            },
          }}
          selectedNodeId={null}
          onNodeSelect={vi.fn()}
          onOpenAgentConversation={onOpenAgentConversation}
        />,
      )
    })

    const openButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开对话"))
    expect(openButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenAgentConversation).toHaveBeenCalledWith(target)

    await act(async () => {
      root.unmount()
    })
  })
```

In `desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx`, add this test:

```tsx
  it("opens the Agent conversation attached to the selected node result", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenAgentConversation = vi.fn()

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{
            ...nodeResult(),
            outputs: { agentConversation: target },
          }}
          nodeName="Prompt node"
          onClose={vi.fn()}
          onOpenAgentConversation={onOpenAgentConversation}
        />,
      )
    })

    const openButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开对话"))
    expect(openButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      openButton?.click()
    })

    expect(onOpenAgentConversation).toHaveBeenCalledWith(target)

    await act(async () => {
      root.unmount()
    })
  })
```

- [ ] **Step 6: Run Workflow Runner UI tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/runner/__tests__/timeline-view.test.tsx src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: FAIL because the components do not accept or render open-conversation actions.

- [ ] **Step 7: Add action to TimelineView**

In `desktop/src/modules/workflow/runner/timeline-view.tsx`, import:

```ts
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"
```

Extend props:

```ts
  onOpenAgentConversation?: (target: SynapseAgentConversationTarget) => void
```

In the row render, compute the target:

```ts
          const agentConversation = agentConversationTargetFromOutputs(r.outputs)
```

Add the button inside the right side of the row:

```tsx
            {agentConversation ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-track="workflow-runner-open-agent-conversation"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenAgentConversation?.(agentConversation)
                }}
              >
                <MessageSquare data-icon="inline-start" />
                打开对话
              </Button>
            ) : null}
```

Keep the button in the same flex row and avoid adding custom colors.

- [ ] **Step 8: Add action to NodeResultPanel**

In `desktop/src/modules/workflow/runner/node-result-panel.tsx`, import:

```ts
import { MessageSquare } from "lucide-react"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"
```

Extend props:

```ts
  onOpenAgentConversation?: (target: SynapseAgentConversationTarget) => void
```

At the start of the component, compute:

```ts
  const agentConversation = agentConversationTargetFromOutputs(result.outputs)
```

Add this header button before the copy button:

```tsx
        {agentConversation ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            data-track="workflow-runner-node-open-agent-conversation"
            onClick={() => onOpenAgentConversation?.(agentConversation)}
          >
            <MessageSquare data-icon="inline-start" />
            打开对话
          </Button>
        ) : null}
```

- [ ] **Step 9: Wire RunnerApp handler**

In `desktop/src/modules/workflow/runner/runner-app.tsx`, import:

```ts
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { openAgentConversationTarget } from "@/lib/agent-conversation-target"
```

Add a handler before render:

```ts
  const handleOpenAgentConversation = useCallback(async (target: SynapseAgentConversationTarget) => {
    try {
      const result = await openAgentConversationTarget(target)
      if (!result.opened) {
        toast.error("对话不存在或已删除")
      }
    } catch (err) {
      logger.warn("open workflow agent conversation failed", {
        runId,
        workflowId,
        conversationId: target.conversationId,
        platform: target.platform,
        boundary: "renderer.workflow.runner.open-agent-conversation",
        ...errorDiagnostic(err),
      })
      toast.error("打开失败")
    }
  }, [runId, workflowId])
```

In `useWorkflowEvents`, add:

```ts
    onNodeAgentConversation: (nodeId, target) => {
      if (!target) return
      setNodeResults((current) => {
        const existing = current[nodeId] ?? { nodeId, status: "running" as const, input: { variables: {} } }
        return {
          ...current,
          [nodeId]: {
            ...existing,
            outputs: {
              ...(existing.outputs ?? {}),
              agentConversation: target,
            },
          },
        }
      })
    },
```

Pass the handler:

```tsx
            <TimelineView
              definition={definition}
              nodeResults={nodeResults}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              onOpenAgentConversation={handleOpenAgentConversation}
            />
```

And:

```tsx
              <NodeResultPanel
                result={selectedResult}
                nodeName={definition.nodes.find((n) => n.id === selectedNodeId)?.name ?? selectedNodeId ?? ""}
                definition={definition}
                onClose={() => setSelectedNodeId(null)}
                onCopyNodeReport={handleCopyNodeReport}
                onOpenAgentConversation={handleOpenAgentConversation}
              />
```

- [ ] **Step 10: Run Workflow Runner tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-conversation-target.test.ts src/modules/workflow/runner/__tests__/timeline-view.test.tsx src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

Run:

```bash
git add desktop/src/lib/agent-conversation-target.ts desktop/src/lib/__tests__/agent-conversation-target.test.ts desktop/src/modules/workflow/runner/runner-app.tsx desktop/src/modules/workflow/runner/timeline-view.tsx desktop/src/modules/workflow/runner/node-result-panel.tsx desktop/src/modules/workflow/runner/__tests__/timeline-view.test.tsx desktop/src/modules/workflow/runner/__tests__/node-result-panel.test.tsx
git commit -m "feat: open agent conversations from workflow runner"
```

---

### Task 5: Task Scheduler Run History Action

**Files:**
- Modify: `desktop/action-packages/builtin/agent/executor.main.ts`
- Modify: `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`
- Modify: `desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx`
- Modify: `desktop/src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx`

- [ ] **Step 1: Add failing Agent action executor test**

In `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`, update the first timeout test expectation from:

```ts
outputs: { conversationId: "conversation-1" },
```

to:

```ts
outputs: {
  conversationId: "conversation-1",
  sessionKey: "scheduled:project-1:123",
  projectId: "project-1",
  platform: "scheduled",
},
```

Update the runtime mock in that test to return:

```ts
sessionKey: "scheduled:project-1:123",
```

Add the same `sessionKey` to success mocks that assert outputs.

- [ ] **Step 2: Run Agent action test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/agent/__tests__/executor.main.test.ts
```

Expected: FAIL because action outputs only contain `conversationId` and `configVersion`.

- [ ] **Step 3: Persist scheduled target fields**

In `desktop/action-packages/builtin/agent/executor.main.ts`, change the action result outputs to:

```ts
          outputs: {
            conversationId: result.conversationId,
            sessionKey: result.sessionKey,
            projectId: input.config.projectId,
            platform: "scheduled",
            configVersion: currentConfigVersion,
          },
```

Keep `configVersion` because resume policy depends on it.

- [ ] **Step 4: Run Agent action test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/agent/__tests__/executor.main.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing TaskRunsDialog tests**

In `desktop/src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx`, extend the hoisted mocks:

```ts
const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() })
  return {
    listRuns: vi.fn(),
    openConversation: vi.fn(),
    toast,
    track: vi.fn(),
    warn: vi.fn(),
  }
})
```

Add the toast mock after the existing logging mock:

```ts
vi.mock("sonner", () => ({
  toast: mocks.toast,
}))
```

Add cleanup in `afterEach`:

```ts
  delete (window as unknown as { synapse?: unknown }).synapse
```

Then add these two tests inside `describe("TaskRunsDialog", ...)`:

```tsx
  it("opens the scheduled Agent conversation from a run history item", async () => {
    mocks.openConversation.mockResolvedValue({ opened: true })
    ;(window as unknown as { synapse?: unknown }).synapse = {
      agent: { openConversation: mocks.openConversation },
    }
    mocks.listRuns.mockResolvedValue([{
      ...createRun(),
      result: {
        status: "success",
        summary: "done",
        outputs: {
          conversationId: "conversation-1",
          sessionKey: "scheduled:project-1:123",
          projectId: "project-1",
          platform: "scheduled",
        },
      },
    }])

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskRunsDialog
          open
          busy={false}
          task={createTask()}
          onOpenChange={vi.fn()}
          onStopRun={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const openButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开对话"))
    expect(openButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.openConversation).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "scheduled:project-1:123",
      platform: "scheduled",
    })
  })

  it("shows a message when the scheduled Agent conversation was deleted", async () => {
    mocks.openConversation.mockResolvedValue({ opened: false, reason: "not-found" })
    ;(window as unknown as { synapse?: unknown }).synapse = {
      agent: { openConversation: mocks.openConversation },
    }
    mocks.listRuns.mockResolvedValue([{
      ...createRun(),
      result: {
        status: "success",
        summary: "done",
        outputs: {
          conversationId: "conversation-1",
          sessionKey: "scheduled:project-1:123",
          projectId: "project-1",
          platform: "scheduled",
        },
      },
    }])

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskRunsDialog
          open
          busy={false}
          task={createTask()}
          onOpenChange={vi.fn()}
          onStopRun={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const openButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开对话"))
    expect(openButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith("对话不存在或已删除")
  })
```

- [ ] **Step 6: Run TaskRunsDialog tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx
```

Expected: FAIL because the dialog does not render the action.

- [ ] **Step 7: Render task history action**

In `desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx`, import:

```ts
import { MessageSquare } from "lucide-react"
import { toast } from "sonner"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { openAgentConversationTarget } from "@/lib/agent-conversation-target"
```

Add helper functions near the bottom:

```ts
function scheduledAgentTargetFromRun(
  task: ScheduledTask | null,
  run: ScheduledTaskRun,
): SynapseAgentConversationTarget | null {
  if (task?.action.type !== "builtin.agent") return null
  const outputs = run.result?.outputs
  if (!outputs) return null
  const { projectId, conversationId, sessionKey, platform } = outputs
  if (
    typeof projectId !== "string"
    || typeof conversationId !== "string"
    || typeof sessionKey !== "string"
    || platform !== "scheduled"
  ) {
    return null
  }
  return { projectId, conversationId, sessionKey, platform }
}

async function openScheduledAgentConversation(target: SynapseAgentConversationTarget): Promise<void> {
  const result = await openAgentConversationTarget(target)
  if (!result.opened) {
    toast.error("对话不存在或已删除")
  }
}
```

In `RunItem`, compute:

```ts
  const agentConversation = scheduledAgentTargetFromRun(task, run)
```

Add button next to the stop button:

```tsx
          {agentConversation ? (
            <Button
              data-track="task-run-open-agent-conversation"
              size="sm"
              variant="ghost"
              onClick={() => {
                void openScheduledAgentConversation(agentConversation).catch((openError) => {
                  logger.warn("Task run Agent conversation open failed.", {
                    taskId: task?.id,
                    runId: run.id,
                    actionType: task?.action.type,
                    boundary: "renderer.task-scheduler.runs.open-agent-conversation",
                    ...errorDiagnostic(openError),
                  })
                  toast.error("打开失败")
                })
              }}
            >
              <MessageSquare data-icon="inline-start" />
              打开对话
            </Button>
          ) : null}
```

- [ ] **Step 8: Run Task Scheduler tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/agent/__tests__/executor.main.test.ts src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

Run:

```bash
git add desktop/action-packages/builtin/agent/executor.main.ts desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts desktop/src/modules/task-scheduler/components/task-runs-dialog.tsx desktop/src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx
git commit -m "feat: open scheduled agent run conversations"
```

---

### Task 6: Release Notes And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update pending release notes**

Add this bullet to `RELEASE_NOTES_PENDING.md` under the current unreleased section:

```md
- 工作流运行器和定时任务运行历史现在可以直接打开对应的 Agent 对话；如果对话已被删除，会提示而不是跳到空页面。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/modules/agent/__tests__/ipc-sessions.test.ts \
  action-packages/builtin/agent/__tests__/executor.main.test.ts \
  workflow-nodes/prompt/__tests__/executor.test.ts \
  workflow-nodes/switch/__tests__/executor.test.ts \
  electron/services/__tests__/workflow-engine.test.ts \
  src/lib/__tests__/agent-conversation-target.test.ts \
  src/modules/agent/__tests__/pending-agent-session.test.tsx \
  src/modules/workflow/hooks/__tests__/use-workflow-events.test.tsx \
  src/modules/workflow/runner/__tests__/timeline-view.test.tsx \
  src/modules/workflow/runner/__tests__/node-result-panel.test.tsx \
  src/modules/task-scheduler/components/__tests__/task-runs-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run IPC codegen check**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript checks**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If `typecheck` reports pre-existing unrelated failures, record the exact failing files and rerun the focused tests plus `check:hard-constraints` and `check:ipc-codegen`.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan are modified.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent conversation navigation"
```

---

## Self-Review

- Spec coverage: data target persistence is covered by Tasks 1, 3, and 5; cross-window navigation is covered by Task 2; Agent source filter behavior is covered by Task 2; Workflow Runner UI is covered by Task 4; Task Scheduler UI is covered by Task 5; deleted conversation behavior is covered by Tasks 2, 4, and 5.
- Deferred-marker scan: no delayed-implementation markers are used.
- Type consistency: `SynapseAgentConversationTarget`, `SynapseOpenAgentConversationResult`, `OpenAgentSessionPayload`, `node:agent-conversation`, and `outputs.agentConversation` are consistently named across tasks.
