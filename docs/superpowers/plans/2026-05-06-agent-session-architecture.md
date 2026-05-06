# Agent 会话架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Agent panel sessions to use per-conversation runtime state with explicit project+agent selection at creation time.

**Architecture:** State key changes from composite `projectId:workspaceKey:sessionKey` to `conversationId`. Each conversation owns its LiveSession, queue, and busy flag independently. A new "Create Session" dialog lets users pick project and agent type before the session exists. Idle sessions are reclaimed after 10 minutes.

**Tech Stack:** Electron IPC + Vitest + React + shadcn/ui (Dialog, Select) + existing AgentRuntimeService

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | Modify | State key → conversationId, per-conversation adapter resolution, idle reclaim timer |
| `desktop/electron/services/agent-runtime/session-repository.ts` | Modify | Accept `agentType` in `createSession` |
| `desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts` | Modify | Test agentType persistence at creation |
| `desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts` | Create | Test per-conversation state isolation, idle reclaim |
| `desktop/electron/services/agent-runtime/agent-availability-service.ts` | Create | Binary detection cache for agent definitions |
| `desktop/electron/services/agent-runtime/__tests__/agent-availability-service.test.ts` | Create | Test availability detection |
| `desktop/electron/modules/agent/ipc.ts` | Modify | `createSession` accepts `agentType`, new `getAvailableAgents` handler |
| `desktop/src/modules/agent/components/create-session-dialog.tsx` | Create | Two-dropdown dialog for project + agent selection |
| `desktop/src/modules/agent/components/agent-session-sidebar.tsx` | Modify | Wire dialog open, show agent icon per session |
| `desktop/src/modules/agent/hooks/use-agent-chat.ts` | Modify | `createSession` accepts `projectId` + `agentType` |
| `desktop/src/types/agent.ts` | Modify | Add `SynapseAgentAvailability` type |

---

### Task 1: Session Repository — Accept agentType at Creation

**Files:**
- Modify: `desktop/electron/services/agent-runtime/session-repository.ts:103-126`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts`

- [ ] **Step 1: Write the failing test**

In `desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts`, add:

```typescript
it("stores agentType when provided at creation", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const repository = new AgentSessionRepository({
    projectId: "project-1",
    conversations,
    now: fixedNow,
  })

  const session = await repository.createSession({
    sessionKey: "local:renderer",
    platform: "local-renderer",
    name: "Test Session",
    agentType: "claude-code",
  })

  expect(session.agentType).toBe("claude-code")

  const retrieved = await conversations.get(session.id)
  expect(retrieved?.agentType).toBe("claude-code")
})

it("stores agentType as undefined when not provided", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const repository = new AgentSessionRepository({
    projectId: "project-1",
    conversations,
    now: fixedNow,
  })

  const session = await repository.createSession({
    sessionKey: "local:renderer",
    platform: "local-renderer",
    name: "No Agent",
  })

  expect(session.agentType).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/session-repository.test.ts --run`

Expected: FAIL — `agentType` is not written during `createSession`.

- [ ] **Step 3: Implement — add agentType to CreateAgentSessionInput and createSession**

In `desktop/electron/services/agent-runtime/session-repository.ts`:

Add `agentType` to `CreateAgentSessionInput`:

```typescript
export interface CreateAgentSessionInput {
  readonly id?: string
  readonly sessionKey: string
  readonly platform?: string
  readonly channelKey?: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly name?: string
  readonly userMeta?: ConversationEntryV1["userMeta"]
  readonly resumePolicy?: ConversationResumePolicyV1
  readonly agentType?: string
}
```

In the `createSession` method, add `agentType` to the conversation object:

```typescript
async createSession(input: CreateAgentSessionInput): Promise<ConversationEntryV1> {
  await this.deactivateActive(input.sessionKey, input.platform, undefined, input.workspaceKey)
  const now = this.isoNow()
  const conversation: ConversationEntryV1 = {
    id: input.id
      ?? conversationId(input.platform ?? "local", input.sessionKey, this.idFactory(), input.workspaceKey),
    schemaVersion: 1,
    projectId: this.projectId,
    sessionKey: input.sessionKey,
    platform: input.platform,
    channelKey: input.channelKey,
    workspaceKey: input.workspaceKey,
    workspacePath: input.workspacePath,
    agentType: input.agentType,
    history: [],
    userMeta: input.userMeta,
    active: true,
    name: input.name ?? input.sessionKey,
    resumePolicy: input.resumePolicy ?? "resume",
    createdAt: now,
    updatedAt: now,
  }
  await this.conversations.upsert(conversation)
  return conversation
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/session-repository.test.ts --run`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/agent-runtime/session-repository.ts desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts
git commit -m "feat(agent): store agentType at session creation time"
```

---

### Task 2: AgentRuntimeService — Per-Conversation State Key

**Files:**
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Create: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { AgentRuntimeService } from "../agent-runtime-service"
import type { ConversationEntryV1, DataNamespace } from "../../../runtime/data-repo"
import type { AgentAdapter, AgentLiveSession } from "../types"

function createMockNamespace(): DataNamespace<ConversationEntryV1> {
  const store = new Map<string, ConversationEntryV1>()
  return {
    get: async (id) => store.get(id) ?? null,
    upsert: async (entry) => { store.set(entry.id, entry) },
    list: async (filter) => {
      return [...store.values()].filter((item) => {
        if (filter && "projectId" in filter && item.projectId !== filter.projectId) return false
        return true
      })
    },
    remove: async (id) => { store.delete(id) },
    onChange: () => () => {},
  } as unknown as DataNamespace<ConversationEntryV1>
}

function createMockAdapter(agentType: string): AgentAdapter {
  return {
    agentType,
    compressionCommand: "/compact",
    execute: vi.fn().mockResolvedValue({ events: [], resultText: "done" }),
    startSession: undefined,
  }
}

describe("AgentRuntimeService per-conversation state", () => {
  it("uses conversationId as state key, isolating sessions", async () => {
    const conversations = createMockNamespace()
    const adapter = createMockAdapter("claude-code")
    const service = new AgentRuntimeService({
      projectId: "proj-1",
      workDir: "/tmp/project",
      conversations,
      adapter,
    })

    const session1 = await service.createSession({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "Session 1",
      agentType: "claude-code",
    })

    const session2 = await service.createSession({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "Session 2",
      agentType: "codex",
    })

    expect(session1.id).not.toBe(session2.id)
    expect(session1.agentType).toBe("claude-code")
    expect(session2.agentType).toBe("codex")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: FAIL — `createSession` does not accept/store `agentType` in the service layer yet.

- [ ] **Step 3: Implement — update createSession in AgentRuntimeService**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, modify the `createSession` method:

```typescript
async createSession(
  input: {
    readonly sessionKey: string
    readonly platform?: string
    readonly name?: string
    readonly workspaceKey?: string
    readonly workspacePath?: string
    readonly agentType?: string
  },
): Promise<ConversationEntryV1> {
  return this.repository.createSession({
    sessionKey: input.sessionKey,
    platform: input.platform,
    name: input.name,
    workspaceKey: input.workspaceKey,
    workspacePath: input.workspacePath,
    agentType: input.agentType,
    resumePolicy: "resume",
  })
}
```

Note: Remove the `closeIdleStateForSession` call — with per-conversation state, creating a new session no longer needs to close the old state (they're independent).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: PASS

- [ ] **Step 5: Implement — change stateFor to use conversationId**

In `agent-runtime-service.ts`, replace the `stateFor` method:

```typescript
private stateForConversation(conversationId: string): RuntimeSessionState {
  const existing = this.states.get(conversationId)
  if (existing) {
    existing.lastActivity = Date.now()
    return existing
  }
  const state: RuntimeSessionState = {
    key: conversationId,
    queue: [],
    busy: false,
    activeTurns: 0,
    lastActivity: Date.now(),
  }
  this.states.set(conversationId, state)
  return state
}
```

Update all call sites of `stateFor(message)` and `stateFor(message, sideSessionId)` in `send`, `sendNewSession`, `sendSideSessionWithTimeout` to use `stateForConversation(conversation.id)` instead. The conversation is already resolved before the state is needed.

In `send()`:

```typescript
const state = this.stateForConversation(conversation.id)
```

In `sendNewSession()`:

```typescript
const state = this.stateForConversation(conversation.id)
```

In `sendSideSessionWithTimeout()`:

```typescript
const state = this.stateForConversation(conversation.id)
```

- [ ] **Step 6: Update deleteSession to use conversationId state key**

In `deleteSession()`, replace:

```typescript
const key = runtimeKey(
  conversation.sessionKey,
  this.deps.projectId,
  conversation.workspaceKey,
)
await this.closeIdleStateForSession(conversation.sessionKey, conversation.workspaceKey)
this.states.delete(key)
```

With:

```typescript
const state = this.states.get(conversationIdValue)
if (state) {
  if (state.busy || state.activeTurns > 0 || state.queue.length > 0) {
    throw new Error("Session is busy.")
  }
  if (state.pending) {
    this.pendingPermissions.delete(state.pending.requestId)
    state.pending = undefined
  }
  if (state.liveSession) {
    await state.liveSession.close()
    state.liveSession = undefined
  }
  this.states.delete(conversationIdValue)
}
```

- [ ] **Step 7: Run all agent-runtime tests**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/ --run`

Expected: PASS (existing tests may need minor adjustments if they relied on the old stateFor signature)

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts
git commit -m "feat(agent): per-conversation state key using conversationId"
```

---

### Task 3: AgentRuntimeService — Per-Conversation Adapter Resolution

**Files:**
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts:1571-1589`

- [ ] **Step 1: Write the failing test**

Add to `desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts`:

```typescript
it("resolves adapter based on conversation agentType, not project default", async () => {
  const conversations = createMockNamespace()
  const claudeAdapter = createMockAdapter("claude-code")
  const codexAdapter = createMockAdapter("codex")

  const adapterFactory = vi.fn().mockImplementation(async (view) => {
    return view.agentType === "claude-code" ? claudeAdapter : codexAdapter
  })

  const service = new AgentRuntimeService({
    projectId: "proj-1",
    workDir: "/tmp/project",
    conversations,
    adapter: codexAdapter,
    agentType: "codex",
    adapterFactory,
    providerConfig: {
      getActiveAgentType: vi.fn().mockResolvedValue("codex"),
      resolveRuntimeConfig: vi.fn().mockImplementation(async (_pid, agentType) => ({
        agentType,
        providers: [],
        env: {},
        envAllowlist: [],
      })),
    } as any,
  })

  const session = await service.createSession({
    sessionKey: "local:renderer",
    platform: "local-renderer",
    name: "Claude Session",
    agentType: "claude-code",
  })

  // Send a message — adapter should be resolved for claude-code, not codex
  await service.send({
    projectId: "proj-1",
    sessionKey: "local:renderer",
    platform: "local-renderer",
    content: "hello",
  })

  expect(adapterFactory).toHaveBeenCalledWith(
    expect.objectContaining({ agentType: "claude-code" }),
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: FAIL — `resolveAdapter()` currently uses `getActiveAgentType()` from project config, ignoring conversation's agentType.

- [ ] **Step 3: Implement — resolveAdapter accepts agentType parameter**

In `agent-runtime-service.ts`, change `resolveAdapter()` to accept an optional `agentType` override:

```typescript
private async resolveAdapter(agentTypeOverride?: string): Promise<AgentAdapter> {
  if (!this.deps.providerConfig || !this.deps.adapterFactory) {
    return this.deps.adapter
  }
  const agentType = agentTypeOverride ?? await this.getActiveAgentType()
  const view = await this.deps.providerConfig.resolveRuntimeConfig(
    this.deps.projectId,
    agentType,
    { actor: { kind: "user" } },
  )
  if (view.agentType === "codex") {
    await prepareCodexRuntime(view, {
      permissionGuard: this.deps.permissionGuard,
      auditSink: this.deps.auditSink,
      actor: { kind: "user" },
    })
  }
  return this.deps.adapterFactory(view)
}
```

- [ ] **Step 4: Update processTurn to pass conversation.agentType**

In `processTurn()`, change:

```typescript
const adapter = await this.resolveAdapter()
```

To:

```typescript
const adapter = await this.resolveAdapter(conversation.agentType)
```

Do the same in `processSideSessionWithTimeout` and any other method that calls `resolveAdapter()`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts
git commit -m "feat(agent): resolve adapter from conversation agentType"
```

---

### Task 4: Idle Session Reclaim (10-minute timeout)

**Files:**
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `agent-runtime-state.test.ts`:

```typescript
import { vi, beforeEach, afterEach } from "vitest"

describe("idle session reclaim", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("closes liveSession after 10 minutes of inactivity", async () => {
    const conversations = createMockNamespace()
    const closeFn = vi.fn()
    const mockLiveSession: AgentLiveSession = {
      agentType: "claude-code",
      send: vi.fn(),
      respondPermission: vi.fn(),
      nextEvent: vi.fn().mockResolvedValue(null),
      currentSessionId: () => "sess-1",
      alive: () => true,
      close: closeFn,
    }

    const adapter: AgentAdapter = {
      agentType: "claude-code",
      compressionCommand: "/compact",
      execute: vi.fn(),
      startSession: vi.fn().mockResolvedValue(mockLiveSession),
    }

    const service = new AgentRuntimeService({
      projectId: "proj-1",
      workDir: "/tmp/project",
      conversations,
      adapter,
    })

    // Create session and simulate a live session being stored
    const session = await service.createSession({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "Test",
      agentType: "claude-code",
    })

    // Advance time by 10 minutes + 1 second
    vi.advanceTimersByTime(10 * 60 * 1000 + 1000)

    // Trigger the reclaim check (implementation detail — may need to call a method or wait for interval)
    await service.reclaimIdleSessions()

    expect(closeFn).toHaveBeenCalled()
  })

  it("does not close liveSession if activity is recent", async () => {
    const conversations = createMockNamespace()
    const closeFn = vi.fn()
    const mockLiveSession: AgentLiveSession = {
      agentType: "claude-code",
      send: vi.fn(),
      respondPermission: vi.fn(),
      nextEvent: vi.fn().mockResolvedValue(null),
      currentSessionId: () => "sess-1",
      alive: () => true,
      close: closeFn,
    }

    const service = new AgentRuntimeService({
      projectId: "proj-1",
      workDir: "/tmp/project",
      conversations,
      adapter: { agentType: "claude-code", compressionCommand: "/compact", execute: vi.fn(), startSession: vi.fn().mockResolvedValue(mockLiveSession) },
    })

    await service.createSession({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "Test",
      agentType: "claude-code",
    })

    // Only 5 minutes passed
    vi.advanceTimersByTime(5 * 60 * 1000)
    await service.reclaimIdleSessions()

    expect(closeFn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: FAIL — `reclaimIdleSessions` does not exist.

- [ ] **Step 3: Implement idle reclaim**

In `agent-runtime-service.ts`, add:

```typescript
private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000

async reclaimIdleSessions(): Promise<void> {
  const now = Date.now()
  for (const [key, state] of this.states) {
    if (state.busy || state.activeTurns > 0 || state.queue.length > 0) continue
    if (!state.liveSession) continue
    if (now - state.lastActivity < AgentRuntimeService.IDLE_TIMEOUT_MS) continue
    await state.liveSession.close()
    state.liveSession = undefined
    this.deps.logger?.info("Reclaimed idle agent session.", { conversationId: key })
  }
}
```

In the constructor or a `start()` method, set up a periodic check:

```typescript
private reclaimInterval?: ReturnType<typeof setInterval>

startIdleReclaim(): void {
  this.reclaimInterval = setInterval(() => {
    void this.reclaimIdleSessions()
  }, 60_000)
}

stopIdleReclaim(): void {
  if (this.reclaimInterval) {
    clearInterval(this.reclaimInterval)
    this.reclaimInterval = undefined
  }
}
```

Call `startIdleReclaim()` from `createAgentRuntimeProjectService` after constructing the service.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts
git commit -m "feat(agent): idle session reclaim after 10 minutes"
```

---

### Task 5: Agent Availability Service

**Files:**
- Create: `desktop/electron/services/agent-runtime/agent-availability-service.ts`
- Create: `desktop/electron/services/agent-runtime/__tests__/agent-availability-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/electron/services/agent-runtime/__tests__/agent-availability-service.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { AgentAvailabilityService, type AgentAvailability } from "../agent-availability-service"

describe("AgentAvailabilityService", () => {
  it("returns available: true when binary is found", async () => {
    const service = new AgentAvailabilityService({
      whichBin: vi.fn().mockResolvedValue("/usr/local/bin/claude"),
      definitions: [
        { id: "claude-code", label: "Claude Code", runtime: { kind: "local-cli", binaries: ["claude"] } },
      ],
    })

    const results = await service.detectAll()

    expect(results).toEqual([
      { agentType: "claude-code", label: "Claude Code", available: true, binaryPath: "/usr/local/bin/claude" },
    ])
  })

  it("returns available: false when binary is not found", async () => {
    const service = new AgentAvailabilityService({
      whichBin: vi.fn().mockResolvedValue(null),
      definitions: [
        { id: "codex", label: "Codex", runtime: { kind: "local-cli", binaries: ["codex"] } },
      ],
    })

    const results = await service.detectAll()

    expect(results).toEqual([
      { agentType: "codex", label: "Codex", available: false, binaryPath: undefined },
    ])
  })

  it("caches results after first detection", async () => {
    const whichBin = vi.fn().mockResolvedValue("/usr/local/bin/claude")
    const service = new AgentAvailabilityService({
      whichBin,
      definitions: [
        { id: "claude-code", label: "Claude Code", runtime: { kind: "local-cli", binaries: ["claude"] } },
      ],
    })

    await service.detectAll()
    await service.detectAll()

    expect(whichBin).toHaveBeenCalledTimes(1)
  })

  it("refresh bypasses cache", async () => {
    const whichBin = vi.fn().mockResolvedValue("/usr/local/bin/claude")
    const service = new AgentAvailabilityService({
      whichBin,
      definitions: [
        { id: "claude-code", label: "Claude Code", runtime: { kind: "local-cli", binaries: ["claude"] } },
      ],
    })

    await service.detectAll()
    await service.refresh()

    expect(whichBin).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-availability-service.test.ts --run`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement AgentAvailabilityService**

Create `desktop/electron/services/agent-runtime/agent-availability-service.ts`:

```typescript
export interface AgentAvailability {
  readonly agentType: string
  readonly label: string
  readonly available: boolean
  readonly binaryPath?: string
}

interface AgentDefinitionInput {
  readonly id: string
  readonly label: string
  readonly runtime: { readonly kind: string; readonly binaries: readonly string[] }
}

export interface AgentAvailabilityServiceDeps {
  readonly whichBin: (bin: string) => Promise<string | null>
  readonly definitions: readonly AgentDefinitionInput[]
}

export class AgentAvailabilityService {
  private readonly deps: AgentAvailabilityServiceDeps
  private cache: AgentAvailability[] | null = null

  constructor(deps: AgentAvailabilityServiceDeps) {
    this.deps = deps
  }

  async detectAll(): Promise<readonly AgentAvailability[]> {
    if (this.cache) return this.cache
    this.cache = await this.detect()
    return this.cache
  }

  async refresh(): Promise<readonly AgentAvailability[]> {
    this.cache = null
    return this.detectAll()
  }

  private async detect(): Promise<AgentAvailability[]> {
    const results: AgentAvailability[] = []
    for (const def of this.deps.definitions) {
      if (def.runtime.kind !== "local-cli") {
        results.push({ agentType: def.id, label: def.label, available: true })
        continue
      }
      let binaryPath: string | undefined
      for (const bin of def.runtime.binaries) {
        const path = await this.deps.whichBin(bin)
        if (path) { binaryPath = path; break }
      }
      results.push({
        agentType: def.id,
        label: def.label,
        available: binaryPath !== undefined,
        binaryPath: binaryPath ?? undefined,
      })
    }
    return results
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-availability-service.test.ts --run`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/agent-runtime/agent-availability-service.ts desktop/electron/services/agent-runtime/__tests__/agent-availability-service.test.ts
git commit -m "feat(agent): add AgentAvailabilityService for binary detection"
```

---

### Task 6: IPC — createSession Accepts agentType + New getAvailableAgents Handler

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts:37-40` (schema)
- Modify: `desktop/electron/modules/agent/ipc.ts:395-409` (handler)

- [ ] **Step 1: Update createSessionRequestSchema**

In `desktop/electron/modules/agent/ipc.ts`, change:

```typescript
const createSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  name: z.string().optional(),
})
```

To:

```typescript
const createSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  name: z.string().optional(),
  agentType: z.string().optional(),
})
```

- [ ] **Step 2: Update createSession handler to pass agentType**

Change the handler at line ~400:

```typescript
createSession: {
  kind: "invoke",
  channel: "synapse:agent:create-session",
  request: createSessionRequestSchema,
  response: sessionSummarySchema,
  handler: async (ctx, request: CreateSessionRequest) => {
    const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
    const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
    const session = await agent.createSession({
      sessionKey,
      platform: LOCAL_RENDERER_PLATFORM,
      name: request.name?.trim() || undefined,
      agentType: request.agentType?.trim() || undefined,
    })
    return sessionSummary(session)
  },
},
```

- [ ] **Step 3: Add getAvailableAgents IPC handler**

Add a new handler after `getRuntimeStatus`:

```typescript
getAvailableAgents: {
  kind: "invoke",
  channel: "synapse:agent:get-available-agents",
  request: z.object({}),
  response: z.array(z.object({
    agentType: z.string(),
    label: z.string(),
    available: z.boolean(),
    binaryPath: z.string().optional(),
  })),
  handler: async (ctx) => {
    const availabilityService = ctx.resolve<AgentAvailabilityService>("agent.availability")
    return await availabilityService.detectAll()
  },
},
```

- [ ] **Step 4: Register AgentAvailabilityService in the global registry**

In `desktop/electron/services/agent-runtime/index.ts`, add registration of the availability service in the appropriate initialization code (likely in the app bootstrap or as a global service):

```typescript
import { AgentAvailabilityService } from "./agent-availability-service"
import { whichBin } from "./binary-detect-service"
import { agentRuntimeDefinitionById } from "../definitions/generated/main-registry"

export function createAgentAvailabilityService(): AgentAvailabilityService {
  const definitions = [...agentRuntimeDefinitionById.values()].map((def) => ({
    id: def.id,
    label: def.label,
    runtime: def.runtime,
  }))
  return new AgentAvailabilityService({ whichBin, definitions })
}
```

- [ ] **Step 5: Update preload bridge to expose the new IPC channel**

Add `getAvailableAgents` to the agent bridge in the preload script so the renderer can call it.

- [ ] **Step 6: Run existing IPC tests to verify no regressions**

Run: `cd desktop && pnpm vitest run tests/ipc/ --run`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/agent/ipc.ts desktop/electron/services/agent-runtime/index.ts
git commit -m "feat(agent): IPC accepts agentType on createSession, adds getAvailableAgents"
```

---

### Task 7: Frontend — Create Session Dialog

**Files:**
- Create: `desktop/src/modules/agent/components/create-session-dialog.tsx`
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify: `desktop/src/types/agent.ts`

- [ ] **Step 1: Add SynapseAgentAvailability type**

In `desktop/src/types/agent.ts`, add:

```typescript
export interface SynapseAgentAvailability {
  readonly agentType: string
  readonly label: string
  readonly available: boolean
  readonly binaryPath?: string
}
```

- [ ] **Step 2: Create the dialog component**

Create `desktop/src/modules/agent/components/create-session-dialog.tsx`:

```tsx
import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SynapseAgentAvailability } from "@/types/agent"

type ProjectOption = {
  id: string
  name: string
  path: string
}

type CreateSessionDialogProps = {
  open: boolean
  projects: ProjectOption[]
  agents: SynapseAgentAvailability[]
  defaultProjectId?: string
  defaultAgentType?: string
  onConfirm: (projectId: string, agentType: string) => void
  onOpenChange: (open: boolean) => void
}

function CreateSessionDialog({
  open,
  projects,
  agents,
  defaultProjectId,
  defaultAgentType,
  onConfirm,
  onOpenChange,
}: CreateSessionDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("")
  const [selectedAgentType, setSelectedAgentType] = useState<string>("")

  useEffect(() => {
    if (open) {
      const projectId = defaultProjectId
        ?? (projects.length === 1 ? projects[0].id : "")
      setSelectedProjectId(projectId)
      setSelectedAgentType(defaultAgentType ?? "")
    }
  }, [open, defaultProjectId, defaultAgentType, projects])

  const availableAgents = agents.filter((agent) => agent.available)
  const canConfirm = selectedProjectId !== "" && selectedAgentType !== ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建会话</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-select">项目</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger id="project-select">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-select">Agent</Label>
            <Select
              value={selectedAgentType}
              onValueChange={setSelectedAgentType}
              disabled={selectedProjectId === ""}
            >
              <SelectTrigger id="agent-select">
                <SelectValue placeholder="选择 Agent" />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.agentType} value={agent.agentType}>
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!canConfirm}
            onClick={() => onConfirm(selectedProjectId, selectedAgentType)}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CreateSessionDialog, type ProjectOption }
```

- [ ] **Step 3: Update use-agent-chat hook**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, change `createSession` signature:

```typescript
createSession: (projectId: string, agentType: string) => Promise<void>
```

Update the implementation:

```typescript
const createSession = useCallback(async (projectId: string, agentType: string) => {
  if (!projectId || !agentType) return
  const requestId = selectRequestIdRef.current + 1
  selectRequestIdRef.current = requestId
  const bridge = requireSynapseBridge()
  setError(null)
  try {
    const created = await bridge.agent.createSession({
      projectId,
      sessionKey: DEFAULT_LOCAL_SESSION_KEY,
      name: `新会话 ${formatSessionNameTime(new Date())}`,
      agentType,
    })
    const session = normalizeSessionProject(created, projectId)
    if (requestId !== selectRequestIdRef.current) {
      setSessions((current) => current.some((item) => isSameSession(item, session))
        ? current
        : sortSessions([{ ...session, active: false }, ...current]))
      toast("新会话已创建")
      return
    }
    setSelectedSession(session)
    setSessions((current) => sortSessions([
      session,
      ...current.map((item) => ({
        ...item,
        active: item.projectId === session.projectId ? false : item.active,
      })).filter((item) => !isSameSession(item, session)),
    ]))
    setUnreadByConversationId((current) => clearConversationUnread(current, session.projectId, session.id))
    await loadTimeline({ projectId: session.projectId, conversationId: session.id })
  } catch (error) {
    setError(error instanceof Error ? error.message : "创建会话失败")
  }
}, [loadTimeline])
```

- [ ] **Step 4: Wire dialog into agent-session-sidebar**

In `desktop/src/modules/agent/components/agent-session-sidebar.tsx`:

Change `onCreate` prop from `() => void` to opening the dialog. The parent component (agent module index) should manage dialog state and pass projects/agents data.

Update `AgentSessionSidebarProps`:

```typescript
type AgentSessionSidebarProps = {
  // ... existing props
  onCreate: () => void  // now opens the dialog instead of directly creating
}
```

The dialog itself lives in the parent (`index.tsx`) or alongside the sidebar. The `onCreate` callback opens the dialog; the dialog's `onConfirm` calls `createSession(projectId, agentType)`.

- [ ] **Step 5: Run typecheck**

Run: `cd desktop && pnpm typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/create-session-dialog.tsx desktop/src/modules/agent/components/agent-session-sidebar.tsx desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/types/agent.ts
git commit -m "feat(agent): create session dialog with project + agent selection"
```

---

### Task 8: Session List — Show Agent Icon Per Session

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`

- [ ] **Step 1: Import agent definitions for icon lookup**

```typescript
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
```

- [ ] **Step 2: Add agent icon to session list items**

In the session list rendering, add the agent icon before the session label:

```tsx
const agentDef = agentDefinitions.find((def) => def.id === session.agentType)
const agentIcon = agentDef?.icon

// Inside the ModuleSidebarItem:
<ModuleSidebarItem
  active={isSelectedSession(session, selectedProjectId, selectedConversationId)
    || (!selectedConversationId && session.active)}
  className="min-w-0 flex-1"
  trailing={trailing}
  data-track="agent-session-select"
  trackValue={sessionItemKey(session)}
  onClick={() => { if (sessions.length > 0) onSelect(session) }}
>
  <span className="flex items-center gap-1.5">
    {agentIcon && <img src={agentIcon} alt="" className="h-3.5 w-3.5 shrink-0" />}
    <span className="truncate">{sessionLabel(session)}</span>
  </span>
</ModuleSidebarItem>
```

- [ ] **Step 3: Run typecheck**

Run: `cd desktop && pnpm typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/components/agent-session-sidebar.tsx
git commit -m "feat(agent): show agent icon in session list"
```

---

### Task 9: Backward Compatibility — Lazy agentType Fallback

**Files:**
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: Write the failing test**

Add to `agent-runtime-state.test.ts`:

```typescript
it("falls back to project default agentType for legacy sessions without agentType", async () => {
  const conversations = createMockNamespace()
  // Manually insert a legacy conversation without agentType
  await conversations.upsert({
    id: "legacy-conv-1",
    schemaVersion: 1,
    projectId: "proj-1",
    sessionKey: "local:renderer",
    platform: "local-renderer",
    history: [],
    active: true,
    name: "Legacy Session",
    resumePolicy: "resume",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  } as ConversationEntryV1)

  const adapter = createMockAdapter("codex")
  const service = new AgentRuntimeService({
    projectId: "proj-1",
    workDir: "/tmp/project",
    conversations,
    adapter,
    agentType: "codex",
  })

  // Send message to legacy session — should use project default "codex"
  await service.send({
    projectId: "proj-1",
    sessionKey: "local:renderer",
    platform: "local-renderer",
    content: "hello",
  })

  expect(adapter.execute).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: May pass already if `resolveAdapter(undefined)` falls through to `getActiveAgentType()`. If so, this test documents the behavior.

- [ ] **Step 3: Verify the fallback path in resolveAdapter**

In `resolveAdapter(agentTypeOverride?)`:
- If `agentTypeOverride` is `undefined` (legacy session has no agentType), it falls through to `getActiveAgentType()` which returns the project default.
- This is the correct behavior — no code change needed, just the test documenting it.

- [ ] **Step 4: Add lazy write-back of agentType after first use**

In `processTurn`, after resolving the adapter, if `conversation.agentType` is falsy, write it back:

```typescript
if (!conversation.agentType && adapter.agentType) {
  await this.repository.saveAgentSession({
    conversationId: conversation.id,
    agentType: adapter.agentType,
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd desktop && pnpm vitest run electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts --run`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-state.test.ts
git commit -m "feat(agent): lazy agentType fallback for legacy sessions"
```

---

### Task 10: Integration — Wire Everything Together + Manual Test

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/electron/services/agent-runtime/index.ts`

- [ ] **Step 1: Wire AgentAvailabilityService into app bootstrap**

In the appropriate initialization file (where global services are registered), register the availability service:

```typescript
registry.register("agent.availability", createAgentAvailabilityService())
```

- [ ] **Step 2: Wire dialog state in agent module index**

In `desktop/src/modules/agent/index.tsx`, add state for the create dialog:

```typescript
const [createDialogOpen, setCreateDialogOpen] = useState(false)
```

Pass `onCreate={() => setCreateDialogOpen(true)}` to the sidebar.

Render the `CreateSessionDialog` with:
- `projects` from config context
- `agents` fetched via `bridge.agent.getAvailableAgents()`
- `defaultProjectId` from current selection
- `defaultAgentType` from provider state
- `onConfirm` calls `createSession(projectId, agentType)` and closes dialog

- [ ] **Step 3: Start dev server and test the full flow**

Run: `pnpm dev`

Test:
1. Click "+" in Agent panel → Dialog opens with two dropdowns
2. Select a project → Agent dropdown becomes enabled, default agent pre-selected
3. Select/change agent → Confirm button enabled
4. Click "创建" → New session appears in list with correct agent icon
5. Send a message → Correct agent CLI is spawned (check process list)
6. Create another session with different agent type → Both sessions work independently
7. Wait 10+ minutes idle → LiveSession is reclaimed (check logs)
8. Send message to reclaimed session → Resumes correctly via --resume

- [ ] **Step 4: Run full test suite**

Run: `cd desktop && pnpm test --run`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/index.tsx desktop/electron/services/agent-runtime/index.ts
git commit -m "feat(agent): wire create session dialog and availability service"
```

---

### Task 11: Data Model — Add agentConfig Placeholder

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`

- [ ] **Step 1: Add agentConfig to ConversationEntryV1 type**

In the schema file, add the optional field:

```typescript
agentConfig?: {
  model?: string
  mode?: string
  env?: Record<string, string>
}
```

This is a forward-looking placeholder — no UI or runtime logic uses it yet.

- [ ] **Step 2: Run typecheck**

Run: `cd desktop && pnpm typecheck`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/placeholders.ts
git commit -m "feat(agent): add agentConfig placeholder to ConversationEntryV1"
```
