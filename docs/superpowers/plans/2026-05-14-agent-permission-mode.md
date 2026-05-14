# Agent Permission Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation-level Claude Code SDK permission mode selection, runtime switching, persistence, and UI confirmation for dangerous modes.

**Architecture:** The SDK remains the source of truth for runtime behavior. Synapse stores the selected mode on `ConversationEntryV1.agentConfig.mode`, forwards live switches to `query.setPermissionMode()`, exposes a narrow IPC method, and renders a compact composer selector with confirmation for `auto` and `bypassPermissions`.

**Tech Stack:** Electron main process, Claude Agent SDK, TypeScript, React, shadcn/ui, Radix, Vitest.

---

## File Structure

- Modify `desktop/electron/services/agent-runtime/claude-sdk-session.ts`: expose SDK runtime permission switching on the live session boundary.
- Modify `desktop/electron/services/agent-runtime/types.ts`: add the optional `AgentLiveSession.setPermissionMode` method and shared permission mode type.
- Modify `desktop/electron/services/agent-runtime/session-repository.ts`: persist `agentConfig.mode` on conversations.
- Modify `desktop/electron/services/agent-runtime/agent-runtime-service.ts`: add service-level `setPermissionMode`.
- Modify `desktop/electron/services/agent-runtime/command-router.ts`: make `/mode` list the current mode and switch safe modes.
- Modify `desktop/electron/modules/agent/ipc-shared.ts`: add `permissionModeSchema`, include `mode` in session summaries.
- Modify `desktop/electron/modules/agent/ipc-messages.ts`: add `setPermissionMode` IPC.
- Modify `desktop/src/types/agent.ts`: add renderer mode union and `mode` on `SynapseAgentSessionSummary`.
- Modify `desktop/src/types/bridge.ts`: expose `agent.setPermissionMode`.
- Modify `desktop/src/modules/agent/hooks/use-agent-chat.ts`: expose `setPermissionMode` from the chat hook.
- Modify `desktop/src/modules/agent/hooks/use-chat-connection.ts`: call the bridge and update session state.
- Modify `desktop/src/modules/agent/components/agent-composer.tsx`: render the mode selector and confirmation dialog.
- Modify `desktop/src/modules/agent/index.tsx`: pass selected mode and handler into the composer.
- Modify tests in the matching `__tests__` files listed below.

## Task 1: Shared Types And Session Summary Mode

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc-schema.test.ts`

- [ ] **Step 1: Write the failing schema/type test**

Add this test to `desktop/electron/modules/agent/__tests__/ipc-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { sessionSummarySchema } from "../ipc-shared"

describe("agent IPC schemas", () => {
  it("accepts a permission mode on session summaries", () => {
    expect(sessionSummarySchema.parse({
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:renderer",
      mode: "acceptEdits",
      active: true,
      historyCount: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })).toMatchObject({
      id: "conversation-1",
      mode: "acceptEdits",
    })
  })

  it("rejects unknown permission modes on session summaries", () => {
    expect(() => sessionSummarySchema.parse({
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:renderer",
      mode: "free-for-all",
      active: true,
      historyCount: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc-schema.test.ts
```

Expected: FAIL because `mode` is not part of `sessionSummarySchema`.

- [ ] **Step 3: Add the renderer permission mode type**

In `desktop/src/types/agent.ts`, add this near the top-level agent types:

```ts
export const SYNAPSE_AGENT_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const

export type SynapseAgentPermissionMode = typeof SYNAPSE_AGENT_PERMISSION_MODES[number]
```

Then add this field to `SynapseAgentSessionSummary`:

```ts
readonly mode?: SynapseAgentPermissionMode
```

- [ ] **Step 4: Add the main-process schema and summary mapping**

In `desktop/electron/modules/agent/ipc-shared.ts`, add this exported schema after shared request schemas:

```ts
export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
])
```

Add `mode` to `sessionSummarySchema`:

```ts
mode: permissionModeSchema.optional(),
```

Add `mode` to `sessionSummary(session)`:

```ts
mode: permissionModeFromConversation(session),
```

Add this helper near `sessionSourceLabel`:

```ts
function permissionModeFromConversation(
  session: ConversationEntryV1,
): z.infer<typeof permissionModeSchema> | undefined {
  const mode = session.agentConfig?.mode
  return permissionModeSchema.safeParse(mode).success
    ? mode as z.infer<typeof permissionModeSchema>
    : undefined
}
```

- [ ] **Step 5: Run the schema test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc-schema.test.ts
```

Expected: PASS.

## Task 2: SDK Session Runtime Switching

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`

- [ ] **Step 1: Write failing SDK session tests**

Add these tests inside `describe("ClaudeSDKSession", ...)`:

```ts
it("forwards permission mode switches to the SDK query", async () => {
  const { factory, query } = createQueryFactory()
  const session = createSession(factory)

  await session.setPermissionMode("acceptEdits")

  expect(query.setPermissionMode).toHaveBeenCalledWith("acceptEdits")
})

it("rejects invalid runtime permission modes", async () => {
  const { factory, query } = createQueryFactory()
  const session = createSession(factory)

  await expect(session.setPermissionMode("free-for-all")).rejects.toThrow(
    "Unsupported permission mode: free-for-all",
  )
  expect(query.setPermissionMode).not.toHaveBeenCalled()
})
```

Update `FakeQuery` in the same file:

```ts
readonly setPermissionMode = vi.fn(async (_mode: string) => {})
```

- [ ] **Step 2: Run the SDK session tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: FAIL because `ClaudeSDKSession.setPermissionMode` does not exist.

- [ ] **Step 3: Add live-session and query switching interfaces**

In `desktop/electron/services/agent-runtime/types.ts`, add this method to `AgentLiveSession`:

```ts
setPermissionMode?(mode: string): Promise<void>
```

In `desktop/electron/services/agent-runtime/claude-sdk-session.ts`, update `QueryLike`:

```ts
setPermissionMode?(mode: PermissionMode): Promise<void>
```

- [ ] **Step 4: Implement `ClaudeSDKSession.setPermissionMode`**

Add this public method to `ClaudeSDKSession`:

```ts
async setPermissionMode(mode: string): Promise<void> {
  const permissionMode = parsePermissionMode(mode)
  if (!permissionMode) {
    throw new Error(`Unsupported permission mode: ${mode}`)
  }
  if (!this.query.setPermissionMode) {
    throw new Error("当前会话不支持切换权限模式")
  }
  await this.query.setPermissionMode(permissionMode)
}
```

In `LazyQuery`, add:

```ts
async setPermissionMode(mode: PermissionMode): Promise<void> {
  await (await this.query).setPermissionMode(mode)
}
```

- [ ] **Step 5: Run the SDK session tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: PASS.

## Task 3: Runtime Service Persistence And Live Switching

**Files:**
- Modify: `desktop/electron/services/agent-runtime/session-repository.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Add these tests to `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`:

```ts
it("persists permission mode when no live session exists", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const service = new AgentRuntimeService({
    projectId: "project-1",
    workDir: "/repo",
    conversations,
    providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
    now: fixedNow,
  })
  const created = await service.createSession({
    sessionKey: "s1",
    platform: "local",
    name: "Local",
  })

  const updated = await service.setPermissionMode({
    conversationId: created.id,
    mode: "plan",
    actor: { kind: "user", id: "user-1" },
  })

  expect(updated.agentConfig?.mode).toBe("plan")
  await expect(conversations.get(created.id)).resolves.toMatchObject({
    agentConfig: { mode: "plan" },
  })
})

it("switches a live session before persisting permission mode", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const session = new ModeSwitchSession()
  const service = new AgentRuntimeService({
    projectId: "project-1",
    workDir: "/repo",
    conversations,
    providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
    createSession: () => session,
    now: fixedNow,
  })

  const turn = service.send(baseMessage("wait"))
  await waitFor(() => session.sent.length === 1)
  const id = conversationId("local", "s1", "active")

  await expect(service.setPermissionMode({
    conversationId: id,
    mode: "acceptEdits",
    actor: { kind: "user", id: "user-1" },
  })).resolves.toMatchObject({
    agentConfig: { mode: "acceptEdits" },
  })

  expect(session.modeCalls).toEqual(["acceptEdits"])
  await expect(conversations.get(id)).resolves.toMatchObject({
    agentConfig: { mode: "acceptEdits" },
  })

  await service.forceKillTurn(id)
  await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
})

it("does not persist permission mode when the live SDK switch fails", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const session = new ModeSwitchSession(new Error("sdk denied mode"))
  const service = new AgentRuntimeService({
    projectId: "project-1",
    workDir: "/repo",
    conversations,
    providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
    createSession: () => session,
    now: fixedNow,
  })

  const turn = service.send(baseMessage("wait"))
  await waitFor(() => session.sent.length === 1)
  const id = conversationId("local", "s1", "active")

  await expect(service.setPermissionMode({
    conversationId: id,
    mode: "acceptEdits",
    actor: { kind: "user", id: "user-1" },
  })).rejects.toThrow("sdk denied mode")

  await expect(conversations.get(id)).resolves.not.toMatchObject({
    agentConfig: { mode: "acceptEdits" },
  })

  await service.forceKillTurn(id)
  await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
})
```

Add this test helper class next to `HangingSession`:

```ts
class ModeSwitchSession extends HangingSession {
  readonly modeCalls: string[] = []

  constructor(private readonly failure?: Error) {
    super()
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.modeCalls.push(mode)
    if (this.failure) throw this.failure
  }
}
```

- [ ] **Step 2: Run the runtime service test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: FAIL because `setPermissionMode` and repository persistence do not exist.

- [ ] **Step 3: Add repository persistence**

In `desktop/electron/services/agent-runtime/session-repository.ts`, add:

```ts
async savePermissionMode(
  conversationIdValue: string,
  mode: string,
): Promise<ConversationEntryV1> {
  const conversation = await this.requireConversation(conversationIdValue)
  const updated: ConversationEntryV1 = {
    ...conversation,
    agentConfig: {
      ...(conversation.agentConfig ?? {}),
      mode,
    },
    updatedAt: this.isoNow(),
  }
  await this.conversations.upsert(updated)
  return updated
}
```

- [ ] **Step 4: Add runtime service switching**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, add this public method near `respondPermission`:

```ts
async setPermissionMode(input: {
  readonly conversationId: string
  readonly mode: string
  readonly actor: ActorIdentity
}): Promise<ConversationEntryV1> {
  const conversation = await this.repository.get(input.conversationId)
  if (!conversation) {
    throw new Error(`Conversation "${input.conversationId}" was not found`)
  }

  const liveSession = this.states.get(input.conversationId)?.liveSession
  if (liveSession?.alive()) {
    if (!liveSession.setPermissionMode) {
      throw new Error("当前会话不支持切换权限模式")
    }
    await liveSession.setPermissionMode(input.mode)
  }

  const updated = await this.repository.savePermissionMode(input.conversationId, input.mode)
  this.emitConversationUpdated(updated)
  this.deps.logger?.info("Agent permission mode changed.", {
    boundary: "agent-runtime.permission-mode",
    projectId: this.deps.projectId,
    conversationId: input.conversationId,
    actorKind: input.actor.kind,
    actorId: input.actor.id,
    mode: input.mode,
  })
  return updated
}
```

Add a private helper if none exists with the exact same event shape used by existing conversation updates:

```ts
private emitConversationUpdated(conversation: ConversationEntryV1): void {
  this.deps.eventBus?.emit({
    domain: "agent",
    type: "conversationUpdated",
    payload: {
      projectId: conversation.projectId,
      sessionKey: conversation.sessionKey,
      platform: conversation.platform ?? "local",
      conversationId: conversation.id,
    },
    scope: { projectId: conversation.projectId },
    timestamp: this.isoNow(),
  })
}
```

If `agent-runtime-service.ts` already has a compatible helper, reuse it instead of adding another copy.

- [ ] **Step 5: Preserve selected mode when creating a live SDK session**

In `desktop/electron/services/agent-runtime/session-manager.ts`, change:

```ts
const modeOverride = input.message.modeOverride
```

to:

```ts
const modeOverride = input.message.modeOverride ?? input.conversation.agentConfig?.mode
```

This makes persisted conversation mode apply to the next SDK query.

- [ ] **Step 6: Run the runtime service tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: PASS.

## Task 4: IPC, Bridge, And Session Summary Return

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-messages.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc.test.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc-schema.test.ts`

- [ ] **Step 1: Write failing IPC schema and handler tests**

In `desktop/electron/modules/agent/__tests__/ipc-schema.test.ts`, add:

```ts
import { messageMethods } from "../ipc-messages"

describe("agent permission mode IPC", () => {
  it("accepts valid setPermissionMode requests", () => {
    expect(messageMethods.setPermissionMode.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      mode: "dontAsk",
    })).toMatchObject({
      mode: "dontAsk",
    })
  })

  it("rejects invalid setPermissionMode requests", () => {
    expect(() => messageMethods.setPermissionMode.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      mode: "free-for-all",
    })).toThrow()
  })
})
```

In `desktop/electron/modules/agent/__tests__/ipc.test.ts`, add a handler-level test following the existing `respondPermission` test style:

```ts
it("sets conversation permission mode through IPC", async () => {
  const setPermissionMode = vi.fn(async () => ({
    projectId: "project-1",
    id: "conversation-1",
    sessionKey: "local:renderer",
    agentConfig: { mode: "plan" },
    active: true,
    historyCount: 0,
    history: [],
    schemaVersion: 1,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
  }))
  const harness = createHarness({ agent: { setPermissionMode } })

  const result = await harness.invoke("synapse:agent:set-permission-mode", {
    projectId: "project-1",
    conversationId: "conversation-1",
    mode: "plan",
  })

  expect(setPermissionMode).toHaveBeenCalledWith({
    conversationId: "conversation-1",
    mode: "plan",
    actor: { kind: "user" },
  })
  expect(result).toMatchObject({
    id: "conversation-1",
    mode: "plan",
  })
})
```

- [ ] **Step 2: Run IPC tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc-schema.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: FAIL because the IPC method is absent.

- [ ] **Step 3: Add IPC request/response schemas and handler**

In `desktop/electron/modules/agent/ipc-messages.ts`, import `permissionModeSchema` and `sessionSummary` from `./ipc-shared`.

Add schemas:

```ts
const setPermissionModeRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  mode: permissionModeSchema,
})

type SetPermissionModeRequest = z.infer<typeof setPermissionModeRequestSchema>
```

Add this descriptor to `messageMethods`:

```ts
setPermissionMode: {
  kind: "invoke",
  channel: "synapse:agent:set-permission-mode",
  request: setPermissionModeRequestSchema,
  response: sessionSummarySchema,
  handler: async (ctx, request: SetPermissionModeRequest) => {
    const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
    const updated = await agent.setPermissionMode({
      conversationId: request.conversationId,
      mode: request.mode,
      actor: { kind: "user" },
    })
    return sessionSummary(updated)
  },
},
```

- [ ] **Step 4: Add the renderer bridge type**

In `desktop/src/types/bridge.ts`, add this method under `agent`:

```ts
setPermissionMode: (
  args: {
    projectId: string
    conversationId: string
    mode: SynapseAgentPermissionMode
  },
) => Promise<SynapseAgentSessionSummary>
```

Import `SynapseAgentPermissionMode` from `@/types/agent` in the same import block as other agent types.

- [ ] **Step 5: Run IPC tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc-schema.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts
```

Expected: PASS.

## Task 5: Slash Command Mode Switching

**Files:**
- Modify: `desktop/electron/services/agent-runtime/command-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/command-router.test.ts`

- [ ] **Step 1: Write failing command router tests**

Update the existing `/mode` test in `desktop/electron/services/agent-runtime/__tests__/command-router.test.ts`:

```ts
it("lists modes, switches safe modes, and routes dangerous modes to the selector", async () => {
  const { providerService } = makeProviderService()
  const modeSwitches: string[] = []
  const router = new AgentCommandRouter({
    projectId: "project-1",
    agentType: "claude-code",
    providerService,
    resetSession: async () => null,
    setPermissionMode: async (_message, _conversation, mode) => {
      modeSwitches.push(mode)
      return { ...baseConversation(), agentConfig: { mode } }
    },
  })

  const list = expectRuntimeResult(await router.handle(baseMessage("/mode"), {
    ...baseConversation(),
    agentConfig: { mode: "plan" },
  }))
  expect(list.resultText).toContain("Current mode: plan")

  const switched = expectRuntimeResult(
    await router.handle(baseMessage("/mode acceptEdits"), baseConversation()),
  )
  expect(switched.resultText).toBe("Mode changed: acceptEdits")
  expect(modeSwitches).toEqual(["acceptEdits"])

  const dangerous = expectRuntimeResult(
    await router.handle(baseMessage("/mode bypassPermissions"), baseConversation()),
  )
  expect(dangerous.error).toBe("请使用权限模式选择器确认切换。")
})
```

- [ ] **Step 2: Run command router tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/command-router.test.ts
```

Expected: FAIL because `AgentCommandRouterDeps.setPermissionMode` does not exist and `/mode` still rejects switching.

- [ ] **Step 3: Add the command router dependency**

In `desktop/electron/services/agent-runtime/command-router.ts`, extend `AgentCommandRouterDeps`:

```ts
setPermissionMode?(
  message: AgentMessage,
  conversation: ConversationEntryV1,
  mode: string,
): Promise<ConversationEntryV1>
```

Add this helper:

```ts
function requiresModeConfirmation(mode: string): boolean {
  return mode === "auto" || mode === "bypassPermissions"
}
```

Update `formatModeList` calls to pass `conversation.agentConfig?.mode`.

- [ ] **Step 4: Implement `/mode <mode>` switching**

Replace the final rejection in `handleMode` with:

```ts
if (requiresModeConfirmation(target)) {
  return commandResult(conversation.id, "请使用权限模式选择器确认切换。", true)
}
if (!this.deps.setPermissionMode) {
  return commandResult(conversation.id, "当前会话不支持切换权限模式", true)
}
const updated = await this.deps.setPermissionMode(message, conversation, target)
return commandResult(
  updated.id,
  `Mode changed: ${target}`,
  false,
  updated.agentSessionId,
)
```

- [ ] **Step 5: Wire the command router dependency**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, pass the dependency in the `new AgentCommandRouter` block:

```ts
setPermissionMode: (_message, conversation, mode) =>
  this.setPermissionMode({
    conversationId: conversation.id,
    mode,
    actor: { kind: "user" },
  }),
```

- [ ] **Step 6: Run command router tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/command-router.test.ts
```

Expected: PASS.

## Task 6: Renderer Hook And Bridge State Update

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-reducer.ts`
- Test: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`

- [ ] **Step 1: Write failing hook test**

In `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`, add `setPermissionMode` to the mocked bridge:

```ts
setPermissionMode: vi.fn(async () => ({ ...session, mode: "plan" })),
```

Add this test:

```tsx
it("updates selected session mode after a permission mode switch", async () => {
  let chat: ReturnType<typeof useAgentChat> | undefined
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<HookProbe onChange={(next) => { chat = next }} />)
  })
  await waitFor(() => chat?.selectedConversationId === session.id)

  await act(async () => {
    await chat?.setPermissionMode("plan")
  })

  expect(chat?.sessions.find((item) => item.id === session.id)?.mode).toBe("plan")
  expect((window as unknown as { synapse: { agent: { setPermissionMode: ReturnType<typeof vi.fn> } } }).synapse.agent.setPermissionMode)
    .toHaveBeenCalledWith({
      projectId: session.projectId,
      conversationId: session.id,
      mode: "plan",
    })
})
```

- [ ] **Step 2: Run hook test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: FAIL because the hook does not expose `setPermissionMode`.

- [ ] **Step 3: Add chat state action for one updated session**

In `desktop/src/modules/agent/hooks/use-chat-reducer.ts`, the existing `UPDATE_SESSIONS` action is enough. No new reducer action is needed.

- [ ] **Step 4: Add connection method**

In `desktop/src/modules/agent/hooks/use-chat-connection.ts`, add:

```ts
const setPermissionMode = useCallback(async (mode: SynapseAgentPermissionMode) => {
  const projectId = selectedProjectIdRef.current ?? getDefaultProjectId()
  const conversationId = selectedConversationIdRef.current
  if (!projectId || !conversationId) return
  const bridge = requireSynapseBridge()
  dispatch({ type: "SET_ERROR", error: null })
  try {
    const updated = await bridge.agent.setPermissionMode({ projectId, conversationId, mode })
    dispatch({ type: "UPDATE_SESSIONS", updater: (current) =>
      current.map((session) => session.id === updated.id ? updated : session) })
  } catch (rawError) {
    const message = rawError instanceof Error ? rawError.message : "切换失败"
    logger.error("Agent permission mode switch failed.", {
      projectId,
      conversationId,
      mode,
      boundary: "renderer.agent.permission-mode",
      errorName: rawError instanceof Error ? rawError.name : typeof rawError,
      errorLength: errorMessage(rawError).length,
    })
    dispatch({ type: "SET_ERROR", error: message })
    throw rawError
  }
}, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef])
```

Import `SynapseAgentPermissionMode` from `@/types/agent`.

Return `setPermissionMode` from `useChatConnection`.

- [ ] **Step 5: Expose the hook method**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, add this to `UseAgentChatState`:

```ts
setPermissionMode: (mode: SynapseAgentPermissionMode) => Promise<void>
```

Return:

```ts
setPermissionMode: connection.setPermissionMode,
```

Import `SynapseAgentPermissionMode` from `@/types/agent`.

- [ ] **Step 6: Run hook test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

## Task 7: Composer Permission Mode Selector

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Write failing composer tests**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, add:

```tsx
it("renders all permission modes in the selector", () => {
  const html = renderToStaticMarkup(
    <AgentComposer
      draft=""
      disabled={false}
      canSend={false}
      sending={false}
      cancelPhase="idle"
      permissionMode="default"
      onPermissionModeChange={vi.fn()}
      onDraftChange={vi.fn()}
      onInputKeyDown={vi.fn()}
      onSubmit={vi.fn()}
      onCancelTurn={vi.fn()}
      onForceKillTurn={vi.fn()}
    />,
  )

  expect(html).toContain("权限模式")
  expect(html).toContain("default")
  expect(html).toContain("acceptEdits")
  expect(html).toContain("plan")
  expect(html).toContain("auto")
  expect(html).toContain("dontAsk")
  expect(html).toContain("bypassPermissions")
})
```

Add this interaction test:

```tsx
it("requires confirmation before changing to bypassPermissions", async () => {
  const onPermissionModeChange = vi.fn(async () => {})
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        permissionMode="default"
        onPermissionModeChange={onPermissionModeChange}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )
  })

  const trigger = container.querySelector('[data-track="agent-permission-mode-select"]') as HTMLButtonElement
  await act(async () => {
    trigger.click()
  })
  const dangerousItem = document.querySelector('[data-mode="bypassPermissions"]') as HTMLElement
  await act(async () => {
    dangerousItem.click()
  })

  expect(onPermissionModeChange).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("将跳过工具权限确认。")

  const confirm = Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent === "继续切换") as HTMLButtonElement
  await act(async () => {
    confirm.click()
  })

  expect(onPermissionModeChange).toHaveBeenCalledWith("bypassPermissions")
})
```

- [ ] **Step 2: Run composer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because composer has no permission mode props or selector.

- [ ] **Step 3: Add composer props**

In `desktop/src/modules/agent/components/agent-composer.tsx`, import:

```ts
import { ShieldCheck } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SynapseAgentPermissionMode } from "@/types/agent"
```

Add props:

```ts
readonly permissionMode: SynapseAgentPermissionMode
readonly onPermissionModeChange: (mode: SynapseAgentPermissionMode) => Promise<void> | void
```

Add local state:

```ts
const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
```

- [ ] **Step 4: Add selector helpers**

Add these constants and helpers above `AgentComposer`:

```ts
const permissionModes: readonly SynapseAgentPermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]

function requiresModeConfirmation(mode: SynapseAgentPermissionMode): boolean {
  return mode === "auto" || mode === "bypassPermissions"
}

function confirmationText(mode: SynapseAgentPermissionMode | null): string {
  if (mode === "auto") return "将由模型自动判断工具权限。"
  if (mode === "bypassPermissions") return "将跳过工具权限确认。"
  return ""
}
```

- [ ] **Step 5: Render selector before send or stop**

Inside the composer control row, before the send/stop button, render:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="权限模式"
      data-track="agent-permission-mode-select"
      disabled={disabled}
    >
      <ShieldCheck size={14} />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    {permissionModes.map((mode) => (
      <DropdownMenuItem
        key={mode}
        data-mode={mode}
        onSelect={(event) => {
          event.preventDefault()
          if (requiresModeConfirmation(mode)) {
            setPendingMode(mode)
            return
          }
          void onPermissionModeChange(mode)
        }}
      >
        <span className="min-w-0 flex-1 truncate">{mode}</span>
        {mode === permissionMode ? <span className="text-xs text-muted-foreground">当前</span> : null}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

Add the confirmation dialog after the composer container:

```tsx
<Dialog open={pendingMode !== null} onOpenChange={(open) => {
  if (!open) setPendingMode(null)
}}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>切换权限模式</DialogTitle>
      <DialogDescription>{confirmationText(pendingMode)}</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={() => setPendingMode(null)}>
        取消
      </Button>
      <Button
        type="button"
        variant={pendingMode === "bypassPermissions" ? "destructive" : "default"}
        onClick={() => {
          const mode = pendingMode
          if (!mode) return
          setPendingMode(null)
          void onPermissionModeChange(mode)
        }}
      >
        继续切换
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: Wire composer from the agent page**

In `desktop/src/modules/agent/index.tsx`, compute selected mode near `selectedSession`:

```ts
const selectedPermissionMode = selectedSession?.mode ?? "default"
```

Pass props to `AgentComposer`:

```tsx
permissionMode={selectedPermissionMode}
onPermissionModeChange={(mode) => chat.setPermissionMode(mode)}
```

- [ ] **Step 7: Run composer tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

## Task 8: Integration Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused agent runtime tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts desktop/electron/services/agent-runtime/__tests__/command-router.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused IPC and renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc-schema.test.ts desktop/electron/modules/agent/__tests__/ipc.test.ts desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run typecheck or the package test gate**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff --stat
git diff -- desktop/electron/services/agent-runtime desktop/electron/modules/agent desktop/src/modules/agent desktop/src/types
```

Expected: only files listed in this plan contain behavior changes. No custom colors, inline styles, CSS modules, or unrelated refactors appear.

## Self-Review

- Spec coverage: SDK runtime switching is covered by Task 2; conversation persistence and no-live-session behavior by Task 3; IPC and narrow schemas by Task 4; slash command behavior by Task 5; renderer selector and dangerous confirmation by Task 7; verification by Task 8.
- Placeholder scan: passed.
- Type consistency: the mode union is named `SynapseAgentPermissionMode` in renderer code, `permissionModeSchema` in IPC schemas, and SDK-facing values pass through `parsePermissionMode` before reaching `PermissionMode`.
