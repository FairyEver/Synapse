# Feishu Agent Live Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Feishu-origin Agent conversations appear live in the desktop Agent page with unread state and an opt-in `跟随飞书` auto-follow control.

**Architecture:** Keep Feishu, local, and bridge conversations on the shared Agent conversation/event model. Emit an immediate `conversationUpdated` after user history is written, then let the renderer update all session summaries while only showing the selected timeline. Put follow/unread decisions in a small pure renderer helper so the hook and UI stay simple and testable.

**Tech Stack:** Electron main process, React, TypeScript, Vitest, shadcn/ui + Radix, Tailwind token utilities.

---

## File Plan

| File | Action | Responsibility |
|---|---|---|
| `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | Modify | Emit `conversationUpdated` immediately after user message history append. |
| `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts` | Modify | Lock immediate Feishu user-message update and final assistant update ordering. |
| `desktop/electron/modules/agent/ipc.ts` | Modify | Add narrow session summary metadata for readable Feishu labels. |
| `desktop/electron/modules/agent/__tests__/ipc.test.ts` | Modify | Verify Feishu session summaries expose `sourceLabel`. |
| `desktop/src/types/agent.ts` | Modify | Add optional `sourceLabel` to `SynapseAgentSessionSummary`. |
| `desktop/src/modules/agent/utils.ts` | Modify | Prefer Feishu `sourceLabel` in session labels. |
| `desktop/src/modules/agent/__tests__/utils.test.ts` | Modify | Verify Feishu labels use `sourceLabel`. |
| `desktop/src/modules/agent/live-sync.ts` | Create | Pure unread/follow decision helpers. |
| `desktop/src/modules/agent/__tests__/live-sync.test.ts` | Create | Unit tests for unread, selected, and follow decisions. |
| `desktop/src/modules/agent/hooks/use-agent-chat.ts` | Modify | Use live-sync helpers, expose follow state and unread state, accept input dirty signal. |
| `desktop/src/modules/agent/index.tsx` | Modify | Pass input dirty signal and follow/unread props to sidebar. |
| `desktop/src/modules/agent/components/agent-session-sidebar.tsx` | Modify | Render `跟随飞书` switch and unread badges using existing UI components. |
| `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx` | Create | Server-render component test for follow control and unread marker. |

## Task 0: Prepare The Implementation Branch

**Files:**
- No source files

- [ ] **Step 1: Confirm clean worktree**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Create the feature branch**

Run:

```bash
git switch -c codex/feishu-agent-live-sync
```

Expected: branch switches to `codex/feishu-agent-live-sync`.

## Task 1: Add Pure Live-Sync Decision Helpers

**Files:**
- Create: `desktop/src/modules/agent/live-sync.ts`
- Create: `desktop/src/modules/agent/__tests__/live-sync.test.ts`

- [ ] **Step 1: Write failing tests**

Create `desktop/src/modules/agent/__tests__/live-sync.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldAutoFollowConversation,
} from "../live-sync"

describe("agent live sync helpers", () => {
  it("matches selected conversations by conversation id first", () => {
    expect(isSelectedConversation({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "feishu-conv",
      sessionKey: "local:renderer",
    })).toBe(true)

    expect(isSelectedConversation({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "feishu:chat:user",
    })).toBe(false)
  })

  it("falls back to session key when no conversation is selected", () => {
    expect(isSelectedConversation({
      sessionKey: "feishu:chat:user",
    }, {
      sessionKey: "feishu:chat:user",
    })).toBe(true)
  })

  it("increments unread only for non-selected conversations with ids", () => {
    expect(incrementUnreadForConversation({}, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "feishu-conv": 1 })

    expect(incrementUnreadForConversation({ "feishu-conv": 1 }, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "local-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "feishu-conv": 2 })

    expect(incrementUnreadForConversation({ "feishu-conv": 2 }, {
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
    }, {
      conversationId: "feishu-conv",
      sessionKey: "local:renderer",
    })).toEqual({ "feishu-conv": 2 })
  })

  it("clears unread for a selected conversation", () => {
    expect(clearConversationUnread({
      "feishu-conv": 3,
      "other-conv": 1,
    }, "feishu-conv")).toEqual({ "other-conv": 1 })
  })

  it("auto-follows only clean Feishu updates when enabled", () => {
    expect(shouldAutoFollowConversation({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
      platform: "feishu",
    }, {
      followFeishu: true,
      inputDirty: false,
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(true)

    expect(shouldAutoFollowConversation({
      conversationId: "feishu-conv",
      sessionKey: "feishu:chat:user",
      platform: "feishu",
    }, {
      followFeishu: true,
      inputDirty: true,
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(false)

    expect(shouldAutoFollowConversation({
      conversationId: "bridge-conv",
      sessionKey: "bridge:chat:user",
      platform: "bridge",
    }, {
      followFeishu: true,
      inputDirty: false,
      selectedConversationId: "local-conv",
      selectedSessionKey: "local:renderer",
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/live-sync.test.ts
```

Expected: FAIL because `../live-sync` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `desktop/src/modules/agent/live-sync.ts`:

```ts
import type { SynapseAgentConversationUpdatedPayload } from "@/types/agent"

type SelectedConversation = {
  readonly conversationId?: string
  readonly sessionKey: string
}

type FollowDecisionInput = SynapseAgentConversationUpdatedPayload & {
  readonly conversationId: string
}

type FollowState = {
  readonly followFeishu: boolean
  readonly inputDirty: boolean
  readonly selectedConversationId?: string
  readonly selectedSessionKey: string
}

type UnreadState = Record<string, number>

function isSelectedConversation(
  target: Pick<SynapseAgentConversationUpdatedPayload, "sessionKey"> & { readonly conversationId?: string },
  selected: SelectedConversation,
): boolean {
  if (selected.conversationId) {
    return target.conversationId === selected.conversationId
  }
  return target.sessionKey === selected.sessionKey
}

function incrementUnreadForConversation(
  current: UnreadState,
  target: Pick<SynapseAgentConversationUpdatedPayload, "sessionKey"> & { readonly conversationId?: string },
  selected: SelectedConversation,
): UnreadState {
  if (!target.conversationId || isSelectedConversation(target, selected)) {
    return current
  }
  return {
    ...current,
    [target.conversationId]: (current[target.conversationId] ?? 0) + 1,
  }
}

function clearConversationUnread(
  current: UnreadState,
  conversationId: string,
): UnreadState {
  if (current[conversationId] === undefined) return current
  const next = { ...current }
  delete next[conversationId]
  return next
}

function shouldAutoFollowConversation(
  target: FollowDecisionInput,
  state: FollowState,
): boolean {
  return state.followFeishu
    && !state.inputDirty
    && target.platform === "feishu"
    && !isSelectedConversation(target, {
      conversationId: state.selectedConversationId,
      sessionKey: state.selectedSessionKey,
    })
}

export {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldAutoFollowConversation,
}
export type { UnreadState }
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/live-sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add desktop/src/modules/agent/live-sync.ts desktop/src/modules/agent/__tests__/live-sync.test.ts
git commit -m "test: add agent live sync helpers"
```

## Task 2: Emit Conversation Updates Immediately After User Messages

**Files:**
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`

- [ ] **Step 1: Write the failing backend test**

Add this test inside `describe("AgentRuntimeService", () => { ... })` in `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`:

```ts
  it("emits conversation updates after Feishu user append and final assistant save", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const events: Array<Parameters<ScopedEventBus["emit"]>[0]> = []
    const runner = new FakeRunner([
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", content: [{ type: "output_text", text: "done" }] },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      eventBus: {
        projectId: "project-1",
        emit: (event) => {
          events.push(event)
        },
        on: vi.fn(),
        underlying: {} as ScopedEventBus["underlying"],
      },
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "feishu:oc_group:ou_user",
      channelKey: "feishu:oc_group",
      platform: "feishu",
      userId: "ou_user",
      userName: "User One",
      chatName: "Feishu Group",
      content: "hello from Feishu",
    })

    const updates = events.filter((event) => event.type === "conversationUpdated")
    expect(updates).toEqual([
      expect.objectContaining({
        payload: {
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
        },
      }),
      expect.objectContaining({
        payload: {
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
        },
      }),
    ])
    expect(events.map((event) => event.type)).toEqual([
      "conversationUpdated",
      "text",
      "result",
      "conversationUpdated",
    ])
  })
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts -t "emits conversation updates after Feishu user append"
```

Expected: FAIL because only the final `conversationUpdated` is emitted.

- [ ] **Step 3: Implement immediate conversation update**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, update `processTurn()` immediately after the user append:

```ts
      conversation = await this.repository.appendHistory(conversation.id, "user", message.content)
      this.emitConversationUpdated(conversation)
```

Do not change `processExecTurn`, `processLiveTurn`, or `saveExecutionResult` in this task.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts -t "emits conversation updates after Feishu user append"
```

Expected: PASS.

- [ ] **Step 5: Run the full service test file**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
git commit -m "feat: emit agent conversation updates on user messages"
```

## Task 3: Expose Readable Feishu Session Labels

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts`
- Modify: `desktop/electron/modules/agent/__tests__/ipc.test.ts`
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/modules/agent/utils.ts`
- Modify: `desktop/src/modules/agent/__tests__/utils.test.ts`

- [ ] **Step 1: Write failing IPC summary test**

Add this test to `desktop/electron/modules/agent/__tests__/ipc.test.ts`:

```ts
  it("returns readable source labels for Feishu sessions", async () => {
    const listSessions = vi.fn().mockResolvedValue([{
      id: "feishu-conv",
      sessionKey: "feishu:oc_group:ou_user",
      platform: "feishu",
      channelKey: "feishu:oc_group",
      active: true,
      history: [],
      userMeta: {
        userName: "User One",
        chatName: "Dev Group",
      },
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    }])
    const harness = createHarness({
      agent: { listSessions },
    })

    await expect(harness.invoke("synapse:agent:list-sessions", {
      projectId: "project-1",
    })).resolves.toEqual([
      expect.objectContaining({
        id: "feishu-conv",
        platform: "feishu",
        sourceLabel: "Dev Group / User One",
      }),
    ])
  })
```

- [ ] **Step 2: Write failing renderer label test**

Update imports in `desktop/src/modules/agent/__tests__/utils.test.ts` to include `sessionLabel`, then add:

```ts
  it("uses source labels for Feishu session rows", () => {
    expect(sessionLabel({
      id: "feishu-conv",
      sessionKey: "feishu:oc_group:ou_user",
      platform: "feishu",
      sourceLabel: "Dev Group / User One",
      active: true,
      historyCount: 0,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    })).toBe("Dev Group / User One")
  })
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc.test.ts src/modules/agent/__tests__/utils.test.ts
```

Expected: FAIL because `sourceLabel` is not in the schema/type and `sessionLabel` ignores it.

- [ ] **Step 4: Update renderer type**

In `desktop/src/types/agent.ts`, add `sourceLabel` to `SynapseAgentSessionSummary`:

```ts
export interface SynapseAgentSessionSummary {
  readonly id: string
  readonly sessionKey: string
  readonly name?: string
  readonly platform?: string
  readonly sourceLabel?: string
  readonly agentType?: string
  readonly agentSessionId?: string
  readonly active: boolean
  readonly historyCount: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastMessage?: SynapseAgentTimelineEntry
}
```

- [ ] **Step 5: Update IPC schema and summary mapper**

In `desktop/electron/modules/agent/ipc.ts`, add `sourceLabel` to `sessionSummarySchema`:

```ts
const sessionSummarySchema = z.object({
  id: z.string(),
  sessionKey: z.string(),
  name: z.string().optional(),
  platform: z.string().optional(),
  sourceLabel: z.string().optional(),
  agentType: z.string().optional(),
  agentSessionId: z.string().optional(),
  active: z.boolean(),
  historyCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessage: timelineEntrySchema.optional(),
})
```

Update `sessionSummary(session)` to include `sourceLabel`:

```ts
function sessionSummary(session: ConversationEntryV1) {
  const last = session.history.at(-1)
  return {
    id: session.id,
    sessionKey: session.sessionKey,
    name: session.name,
    platform: session.platform,
    sourceLabel: sessionSourceLabel(session),
    agentType: session.agentType,
    agentSessionId: session.agentSessionId,
    active: session.active,
    historyCount: session.history.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessage: last ? historyEntry(session.id, last, session.history.length - 1) : undefined,
  }
}
```

Add these helpers near `sessionSummary`:

```ts
function sessionSourceLabel(session: ConversationEntryV1): string | undefined {
  const chatName = stringFromRecord(session.userMeta, "chatName")
  const userName = stringFromRecord(session.userMeta, "userName")
  if (chatName && userName) return `${chatName} / ${userName}`
  return chatName ?? userName ?? session.channelKey
}

function stringFromRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const item = value?.[key]
  return typeof item === "string" && item.trim() ? item.trim() : undefined
}
```

- [ ] **Step 6: Update renderer label helper**

In `desktop/src/modules/agent/utils.ts`, replace `sessionLabel`:

```ts
function sessionLabel(session: SynapseAgentSessionSummary): string {
  if (session.platform === "feishu" && session.sourceLabel) return session.sourceLabel
  return session.name || session.sourceLabel || session.sessionKey || DEFAULT_LOCAL_SESSION_KEY
}
```

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc.test.ts src/modules/agent/__tests__/utils.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add desktop/electron/modules/agent/ipc.ts desktop/electron/modules/agent/__tests__/ipc.test.ts desktop/src/types/agent.ts desktop/src/modules/agent/utils.ts desktop/src/modules/agent/__tests__/utils.test.ts
git commit -m "feat: expose readable Feishu agent session labels"
```

## Task 4: Wire Live Sync Into The Agent Hook

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Write a failing type-level expectation in the hook by usage**

In `desktop/src/modules/agent/index.tsx`, change the hook call and sidebar props to the target API:

```tsx
  const [draft, setDraft] = useState("")
  const chat = useAgentChat(projectId, { inputDirty: draft.trim().length > 0 })
```

Pass the new props to `AgentSessionSidebar`:

```tsx
    <AgentSessionSidebar
      sessions={chat.sessions}
      selectedConversationId={chat.selectedConversationId}
      loading={chat.loading || chat.sending}
      followFeishu={chat.followFeishu}
      unreadByConversationId={chat.unreadByConversationId}
      onFollowFeishuChange={chat.setFollowFeishu}
      onRefresh={() => void chat.refresh()}
      onCreate={() => void chat.createSession()}
      onSelect={(conversationId) => void chat.selectSession(conversationId)}
      onDelete={(conversationId) => void chat.deleteSession(conversationId)}
    />
```

- [ ] **Step 2: Run typecheck and verify RED**

Run:

```bash
pnpm desktop:typecheck
```

Expected: FAIL because `useAgentChat` does not accept an options object and does not return follow/unread fields.

- [ ] **Step 3: Update hook types and state**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, add imports:

```ts
import {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldAutoFollowConversation,
  type UnreadState,
} from "../live-sync"
```

Update `UseAgentChatState`:

```ts
type UseAgentChatState = {
  sessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineEntry[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  selectedConversationId?: string
  selectedSessionKey: string
  followFeishu: boolean
  unreadByConversationId: UnreadState
  loading: boolean
  sending: boolean
  error: string | null
  setFollowFeishu: (next: boolean) => void
  createSession: () => Promise<void>
  selectSession: (conversationId: string) => Promise<void>
  deleteSession: (conversationId: string) => Promise<void>
  refresh: () => Promise<void>
  sendMessage: (content: string) => Promise<void>
  respondPermission: (requestId: string, behavior: "allow" | "deny") => Promise<void>
}
```

Update function signature and state:

```ts
function useAgentChat(
  projectId: string | undefined,
  options: { readonly inputDirty?: boolean } = {},
): UseAgentChatState {
  const [sessions, setSessions] = useState<SynapseAgentSessionSummary[]>([])
  const [timeline, setTimeline] = useState<SynapseAgentTimelineEntry[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<SynapseAgentPendingPermission[]>([])
  const [status, setStatus] = useState<SynapseAgentStatus | null>(null)
  const [providers, setProviders] = useState<SynapseAgentProviderState | null>(null)
  const [commands, setCommands] = useState<SynapseAgentPublishedCommand[]>([])
  const [selectedConversationId, setSelectedConversationIdRaw] = useState<string | undefined>()
  const [selectedSessionKey, setSelectedSessionKeyRaw] = useState(DEFAULT_LOCAL_SESSION_KEY)
  const [followFeishu, setFollowFeishu] = useState(false)
  const [unreadByConversationId, setUnreadByConversationId] = useState<UnreadState>({})
```

Add refs:

```ts
  const followFeishuRef = useRef(followFeishu)
  const inputDirtyRef = useRef(Boolean(options.inputDirty))
  followFeishuRef.current = followFeishu
  inputDirtyRef.current = Boolean(options.inputDirty)
```

- [ ] **Step 4: Update session selection to clear unread**

In `selectSession`, after selected refs are updated, clear unread:

```ts
      selectedConversationIdRef.current = session.id
      selectedSessionKeyRef.current = session.sessionKey
      setUnreadByConversationId((current) => clearConversationUnread(current, session.id))
      setSelectedConversationIdRaw(session.id)
      setSelectedSessionKeyRaw(session.sessionKey)
```

In `createSession`, after selecting the created session:

```ts
      setUnreadByConversationId((current) => clearConversationUnread(current, session.id))
```

In the delete fallback where no sessions remain, reset unread:

```ts
          setUnreadByConversationId({})
```

- [ ] **Step 5: Replace conversationUpdated event handling**

Replace the current `conversationUpdated` branch in the `bridge.agent.onEvent` effect with:

```ts
      if (domainEvent.type === "conversationUpdated") {
        const payload = domainEvent.payload
        const selected = {
          conversationId: selectedConversationIdRef.current,
          sessionKey: selectedSessionKeyRef.current,
        }
        const autoFollow = shouldAutoFollowConversation(payload, {
          followFeishu: followFeishuRef.current,
          inputDirty: inputDirtyRef.current,
          selectedConversationId: selectedConversationIdRef.current,
          selectedSessionKey: selectedSessionKeyRef.current,
        })
        if (autoFollow) {
          selectedConversationIdRef.current = payload.conversationId
          selectedSessionKeyRef.current = payload.sessionKey
          setSelectedConversationIdRaw(payload.conversationId)
          setSelectedSessionKeyRaw(payload.sessionKey)
          setUnreadByConversationId((current) =>
            clearConversationUnread(current, payload.conversationId))
          void refreshConversationSnapshot(payload)
          return
        }
        if (isSelectedConversation(payload, selected)) {
          void refreshConversationSnapshot(payload)
          return
        }
        setUnreadByConversationId((current) =>
          incrementUnreadForConversation(current, payload, selected))
        void refreshConversationSnapshot(payload)
        return
      }
```

Keep the stream event branch selected-only:

```ts
      if (!matchesSelectedEvent(domainEvent, {
        conversationId: selectedConversationIdRef.current,
        sessionKey: selectedSessionKeyRef.current,
      })) return
```

- [ ] **Step 6: Return new hook state**

Add these fields to the hook return object:

```ts
    followFeishu,
    unreadByConversationId,
    setFollowFeishu,
```

- [ ] **Step 7: Run typecheck and verify hook GREEN**

Run:

```bash
pnpm desktop:typecheck
```

Expected: FAIL only because `AgentSessionSidebar` props do not exist yet. If there are other hook errors, fix the exact type mismatch before continuing.

Do not commit until Task 5 makes the sidebar props real.

## Task 5: Add Follow Control And Unread Marker To Sidebar

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Create: `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`

- [ ] **Step 1: Write failing component test**

Create `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentSessionSidebar } from "../components/agent-session-sidebar"

describe("AgentSessionSidebar", () => {
  it("renders the follow Feishu control and unread marker", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          id: "feishu-conv",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          sourceLabel: "Dev Group / User One",
          active: false,
          historyCount: 2,
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T01:00:00.000Z",
        }]}
        selectedConversationId="local-conv"
        loading={false}
        followFeishu={true}
        unreadByConversationId={{ "feishu-conv": 2 }}
        onFollowFeishuChange={vi.fn()}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("跟随飞书")
    expect(html).toContain("Dev Group / User One")
    expect(html).toContain("2")
  })
})
```

- [ ] **Step 2: Run component test and verify RED**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: FAIL because the sidebar props are not implemented.

- [ ] **Step 3: Update sidebar imports**

In `desktop/src/modules/agent/components/agent-session-sidebar.tsx`, update imports:

```tsx
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
```

Keep the existing `AlertDialog` and `ModuleSidebar` imports.

- [ ] **Step 4: Update sidebar props**

Extend `AgentSessionSidebarProps`:

```ts
type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  selectedConversationId?: string
  loading: boolean
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  onFollowFeishuChange: (next: boolean) => void
  onRefresh: () => void
  onCreate: () => void
  onSelect: (conversationId: string) => void
  onDelete: (conversationId: string) => void
}
```

Destructure the new props in the component.

- [ ] **Step 5: Render follow control**

Below the title/actions row and before `ModuleSidebarList`, add:

```tsx
      <div className="flex items-center justify-between px-1">
        <Label htmlFor="agent-follow-feishu" className="text-xs text-muted-foreground">
          跟随飞书
        </Label>
        <Switch
          id="agent-follow-feishu"
          checked={followFeishu}
          onCheckedChange={onFollowFeishuChange}
        />
      </div>
```

- [ ] **Step 6: Render unread badge in row trailing**

Inside the `items.map`, compute unread and compose trailing:

```tsx
          const unread = unreadByConversationId[session.id] ?? 0
          const trailing = (
            <SessionTrailing updatedAt={session.updatedAt} unread={unread} />
          )
```

Replace `SessionTrailing` with:

```tsx
function SessionTrailing({
  updatedAt,
  unread,
}: {
  readonly updatedAt?: string
  readonly unread: number
}) {
  return (
    <span className="flex items-center gap-1">
      {unread > 0 ? (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {unread}
        </Badge>
      ) : null}
      {updatedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatEntryTime(updatedAt)}
        </span>
      ) : null}
    </span>
  )
}
```

This uses shadcn `Badge` and token classes only.

- [ ] **Step 7: Run typecheck and component test**

Run:

```bash
pnpm desktop:typecheck
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-session-sidebar.test.tsx src/modules/agent/__tests__/live-sync.test.ts
```

Expected: both commands pass.

- [ ] **Step 8: Commit hook and sidebar work**

Run:

```bash
git add desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/agent-session-sidebar.tsx desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx
git commit -m "feat: show live Feishu sync state in Agent page"
```

## Task 6: Targeted Integration Verification

**Files:**
- Modify only files exposed by failures from the commands below

- [ ] **Step 1: Run targeted test matrix**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/modules/agent/__tests__/ipc.test.ts \
  src/modules/agent/__tests__/utils.test.ts \
  src/modules/agent/__tests__/live-sync.test.ts \
  src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Run full static validation**

Run:

```bash
pnpm desktop:typecheck
pnpm desktop:check:hard-constraints
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Run full desktop tests**

Run:

```bash
pnpm desktop:test
```

Expected: all tests pass. Existing SQLite experimental warnings can appear; test failures cannot.

- [ ] **Step 4: Commit verification fixes**

If Step 1, Step 2, or Step 3 required fixes, commit them:

```bash
git add desktop/electron desktop/src
git commit -m "fix: stabilize Feishu agent live sync"
```

If no fixes were required, do not create an empty commit.

## Task 7: Manual Validation Checklist

**Files:**
- No source files

- [ ] **Step 1: Do not start the dev server automatically**

Follow the project rule: leave runtime validation to the user unless they explicitly ask to open or run the app.

- [ ] **Step 2: Provide manual checks to the user**

Report this checklist:

```text
1. Open the Agent page and keep a local conversation selected.
2. Send a Feishu message to the bot.
3. Confirm the Feishu conversation appears or moves up in the left list immediately.
4. Confirm the current local timeline does not switch when 跟随飞书 is off.
5. Confirm the Feishu row shows unread state.
6. Click the Feishu row and confirm unread clears and the full timeline loads.
7. Enable 跟随飞书.
8. Send another Feishu message with the local input empty and confirm the Agent page switches to that Feishu conversation.
9. Type unsent text locally, keep 跟随飞书 enabled, send another Feishu message, and confirm the page does not switch.
10. Trigger a Feishu permission request and confirm existing permission handling still works.
```

## Final Verification Matrix

Run before claiming completion:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/modules/agent/__tests__/ipc.test.ts \
  src/modules/agent/__tests__/utils.test.ts \
  src/modules/agent/__tests__/live-sync.test.ts \
  src/modules/agent/__tests__/agent-session-sidebar.test.tsx
pnpm desktop:typecheck
pnpm desktop:check:hard-constraints
pnpm desktop:test
git diff --check
```

## Definition Of Done

- Feishu user messages emit an immediate `conversationUpdated`.
- Agent page refreshes sessions for every current-project conversation update.
- Selected conversation timeline updates live.
- Non-selected Feishu conversations show unread state without replacing the visible timeline.
- Selecting a conversation clears unread.
- `跟随飞书` auto-selects only Feishu updates, only when enabled, and only when local input is clean.
- Existing local Agent sending, Feishu permissions, and Agent event streaming still work.
- No custom colors, inline styles, page redesign, or Feishu-specific IPC channel are introduced.

## Self-Review

- Spec coverage: Tasks 2 through 5 cover immediate backend events, session labels, unread state, selected timeline behavior, follow mode, and input-dirty suppression. Task 6 and Task 7 cover automated and manual verification.
- Unresolved-marker scan: no incomplete implementation markers remain.
- Type consistency: `sourceLabel`, `followFeishu`, `unreadByConversationId`, and `inputDirty` are named consistently across IPC, renderer types, hook state, and sidebar props.
