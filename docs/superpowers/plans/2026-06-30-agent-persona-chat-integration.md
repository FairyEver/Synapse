# Agent Persona Chat Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users keep ordinary Agent conversations by default, then choose and persist a main-thread persona from the composer for the current conversation.

**Architecture:** Existing `agent-personas` remains the configuration app. Agent conversations store only the active main-thread persona id and snapshot; runtime maps that persona to Claude SDK `agents` plus active `agent`. Running sessions use `applyFlagSettings({ agent })` when the current query already knows the target persona definitions, and close + resume only when definitions changed or the SDK cannot apply settings.

**Tech Stack:** Electron 41 main process, React 19 renderer, TypeScript 6, zod IPC schemas, DataRepository SQLite/json schemas, Claude Agent SDK TypeScript API, Vitest.

---

## File Structure

- Modify `desktop/electron/runtime/data-repo/schemas/placeholders.ts`: extend `ConversationEntryV1.agentConfig` validation for active main-thread persona fields.
- Modify `desktop/electron/services/agent-runtime/project-contributions.ts`: widen `AgentSdkAgentDefinition` to match supported Claude SDK fields.
- Create `desktop/electron/services/agent-runtime/persona-runtime.ts`: resolve persona records into SDK agent names, definitions, snapshots, and definition hashes.
- Modify `desktop/electron/services/agent-runtime/types.ts`: add live-session persona switching methods and message/session metadata types.
- Modify `desktop/electron/services/agent-runtime/claude-sdk-session.ts`: pass `agent` to SDK options and expose `applyFlagSettings({ agent })`.
- Modify `desktop/electron/services/agent-runtime/session-lifecycle.ts`, `session-repository.ts`, `session-manager.ts`, `agent-runtime-service.ts`: persist persona state and apply runtime switching.
- Modify `desktop/electron/modules/agent/ipc-sessions.ts`, `ipc-shared.ts`: add `updateSessionPersona` IPC and session summary fields.
- Modify `desktop/electron/preload.ts`, `desktop/electron/generated/ipc-channels.generated.ts`, `desktop/src/types/bridge.ts`, `desktop/src/types/agent.ts`: expose renderer bridge and types. Prefer running `pnpm --filter @synapse/desktop run generate:ipc` after changing IPC descriptors.
- Modify `desktop/src/modules/agent/hooks/use-agent-chat.ts`, `use-chat-connection.ts`, `desktop/src/modules/agent/index.tsx`, `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`, `agent-composer.tsx`: load personas, show composer menu, persist selection.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts` and `conversation-export-service.ts`: save and export persona metadata.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note after implementation.

---

### Task 1: Persist Conversation Persona State

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/services/agent-runtime/session-repository.ts`
- Modify: `desktop/electron/services/agent-runtime/session-lifecycle.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-lifecycle.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests to `desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts` for saving persona state:

```ts
it("saves active main-thread persona on an existing conversation", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const repository = new AgentSessionRepository({
    projectId: "project-1",
    conversations,
    now: fixedNow,
  })
  const conversation = await repository.createSession({
    sessionKey: "local:renderer",
    agentType: "claude-code",
  })

  const updated = await repository.saveMainThreadPersona(conversation.id, {
    id: "builtin-zh-en-translator",
    name: "中英翻译",
    source: "builtin",
    definitionHash: "hash-translator",
  })

  expect(updated.agentConfig?.activeMainThreadPersonaId).toBe("builtin-zh-en-translator")
  expect(updated.agentConfig?.activeMainThreadPersonaSnapshot).toEqual({
    id: "builtin-zh-en-translator",
    name: "中英翻译",
    source: "builtin",
    definitionHash: "hash-translator",
  })
})

it("clears active main-thread persona without dropping mode or model tier", async () => {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  const repository = new AgentSessionRepository({
    projectId: "project-1",
    conversations,
    now: fixedNow,
  })
  const conversation = await repository.createSession({
    sessionKey: "local:renderer",
    agentType: "claude-code",
    mode: "plan",
    modelTier: "sonnet",
  })
  await repository.saveMainThreadPersona(conversation.id, {
    id: "builtin-zh-en-translator",
    name: "中英翻译",
    source: "builtin",
    definitionHash: "hash-translator",
  })

  const updated = await repository.saveMainThreadPersona(conversation.id, null)

  expect(updated.agentConfig).toMatchObject({
    mode: "plan",
    modelTier: "sonnet",
  })
  expect(updated.agentConfig?.activeMainThreadPersonaId).toBeNull()
  expect(updated.agentConfig?.activeMainThreadPersonaSnapshot).toBeUndefined()
})
```

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts
```

Expected: FAIL with TypeScript/test error indicating `saveMainThreadPersona` does not exist.

- [ ] **Step 3: Extend schema types and validation**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, add a named snapshot interface near `ConversationEntryV1`:

```ts
export interface ConversationMainThreadPersonaSnapshotV1 extends Record<string, unknown> {
  id: string
  name: string
  source: "builtin" | "user"
  definitionHash: string
}
```

Extend `ConversationEntryV1.agentConfig`:

```ts
agentConfig?: {
  model?: string
  mode?: string
  modelTier?: string
  env?: Record<string, string>
  activeMainThreadPersonaId?: string | null
  activeMainThreadPersonaSnapshot?: ConversationMainThreadPersonaSnapshotV1
}
```

Add helper validation functions near other record helpers:

```ts
function isConversationMainThreadPersonaSnapshot(
  value: unknown,
): value is ConversationMainThreadPersonaSnapshotV1 {
  if (!isAnyRecord<ConversationMainThreadPersonaSnapshotV1>(value)) return false
  return typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && (value.source === "builtin" || value.source === "user")
    && typeof value.definitionHash === "string"
    && value.definitionHash.trim().length > 0
}
```

Update conversation validation for `agentConfig` so the new fields are allowed and type-checked:

```ts
function isConversationAgentConfig(value: unknown): value is NonNullable<ConversationEntryV1["agentConfig"]> {
  if (!isAnyRecord<NonNullable<ConversationEntryV1["agentConfig"]>>(value)) return false
  return isOptionalString(value.model)
    && isOptionalString(value.mode)
    && isOptionalString(value.modelTier)
    && (value.env === undefined || isStringRecord(value.env))
    && (value.activeMainThreadPersonaId === undefined
      || value.activeMainThreadPersonaId === null
      || typeof value.activeMainThreadPersonaId === "string")
    && (value.activeMainThreadPersonaSnapshot === undefined
      || isConversationMainThreadPersonaSnapshot(value.activeMainThreadPersonaSnapshot))
}
```

Place `isConversationMainThreadPersonaSnapshot()` and `isConversationAgentConfig()` next to the current `isStringRecord()` / record-validation helpers in this file. Replace the current inline `agentConfig` branch in `conversationsSchema.validate` with a call to `isConversationAgentConfig(value.agentConfig)`.

- [ ] **Step 4: Implement repository save method**

In `desktop/electron/services/agent-runtime/session-repository.ts`, import the snapshot type if needed and add:

```ts
async saveMainThreadPersona(
  conversationIdValue: string,
  snapshot: ConversationEntryV1["agentConfig"] extends infer Config
    ? Config extends { activeMainThreadPersonaSnapshot?: infer Snapshot }
      ? Snapshot | null
      : never
    : never,
): Promise<ConversationEntryV1> {
  const conversation = await this.requireConversation(conversationIdValue)
  const nextAgentConfig = {
    ...(conversation.agentConfig ?? {}),
    activeMainThreadPersonaId: snapshot?.id ?? null,
    ...(snapshot ? { activeMainThreadPersonaSnapshot: snapshot } : {}),
  }
  if (!snapshot) {
    delete nextAgentConfig.activeMainThreadPersonaSnapshot
  }
  const updated: ConversationEntryV1 = {
    ...conversation,
    agentConfig: nextAgentConfig,
    updatedAt: this.isoNow(),
  }
  await this.conversations.upsert(updated)
  return updated
}
```

If the conditional type is too noisy after importing `ConversationMainThreadPersonaSnapshotV1`, use the direct signature:

```ts
snapshot: ConversationMainThreadPersonaSnapshotV1 | null
```

- [ ] **Step 5: Add lifecycle passthrough**

In `desktop/electron/services/agent-runtime/session-lifecycle.ts`, add:

```ts
async saveMainThreadPersona(
  conversationIdValue: string,
  snapshot: ConversationMainThreadPersonaSnapshotV1 | null,
): Promise<ConversationEntryV1> {
  return this.deps.repository.saveMainThreadPersona(conversationIdValue, snapshot)
}
```

Export `ConversationMainThreadPersonaSnapshotV1` from the same `desktop/electron/runtime/data-repo` barrel that already exports `ConversationEntryV1`, then import both types from that barrel in `session-lifecycle.ts`.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts desktop/electron/services/agent-runtime/__tests__/session-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas/placeholders.ts desktop/electron/services/agent-runtime/session-repository.ts desktop/electron/services/agent-runtime/session-lifecycle.ts desktop/electron/services/agent-runtime/__tests__/session-repository.test.ts desktop/electron/services/agent-runtime/__tests__/session-lifecycle.test.ts
git commit -m "feat: persist agent conversation persona"
```

---

### Task 2: Build Persona Runtime Resolver

**Files:**
- Create: `desktop/electron/services/agent-runtime/persona-runtime.ts`
- Modify: `desktop/electron/services/agent-runtime/project-contributions.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  createAgentPersonaRuntimeResolver,
  sdkAgentNameForPersona,
} from "../persona-runtime"
import type { AgentPersona } from "../../../../app-capabilities/agent-personas/shared/schema"

const translator: AgentPersona = {
  id: "builtin-zh-en-translator",
  schemaVersion: 1,
  name: "中英翻译",
  description: "在中文和英文之间互译。",
  systemPrompt: "你是中英翻译智能体。",
  providerModel: null,
  source: "builtin",
  readonly: true,
}

describe("agent persona runtime resolver", () => {
  it("builds stable SDK agent names", () => {
    expect(sdkAgentNameForPersona("builtin-zh-en-translator"))
      .toBe("synapse-persona__builtin-zh-en-translator")
  })

  it("maps personas to Claude SDK agents with Agent tool disabled", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [translator],
    })

    const resolved = await resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: translator.id },
    })

    expect(resolved.activeAgentName).toBe("synapse-persona__builtin-zh-en-translator")
    expect(resolved.agents["synapse-persona__builtin-zh-en-translator"]).toEqual({
      description: "在中文和英文之间互译。",
      prompt: "你是中英翻译智能体。",
      disallowedTools: ["Agent"],
    })
    expect(resolved.snapshot).toMatchObject({
      id: translator.id,
      name: "中英翻译",
      source: "builtin",
    })
    expect(resolved.definitionsHash).toHaveLength(64)
  })

  it("returns ordinary mode when no active persona is set", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [translator],
    })

    const resolved = await resolver.resolve({ agentConfig: {} })

    expect(resolved.activeAgentName).toBeUndefined()
    expect(resolved.snapshot).toBeUndefined()
    expect(resolved.agents).toHaveProperty("synapse-persona__builtin-zh-en-translator")
  })

  it("throws when the active persona no longer exists", async () => {
    const resolver = createAgentPersonaRuntimeResolver({
      listPersonas: async () => [],
    })

    await expect(resolver.resolve({
      agentConfig: { activeMainThreadPersonaId: translator.id },
    })).rejects.toThrow("智能体不可用")
  })
})
```

- [ ] **Step 2: Run resolver test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts
```

Expected: FAIL because `persona-runtime.ts` does not exist.

- [ ] **Step 3: Widen SDK agent definition type**

In `desktop/electron/services/agent-runtime/project-contributions.ts`, update `AgentSdkAgentDefinition`:

```ts
export type AgentSdkAgentDefinition = {
  readonly description: string
  readonly prompt: string
  readonly tools?: string[]
  readonly disallowedTools?: string[]
  readonly model?: string
  readonly mcpServers?: unknown[]
  readonly skills?: string[]
  readonly initialPrompt?: string
  readonly maxTurns?: number
  readonly background?: boolean
  readonly memory?: "user" | "project" | "local"
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max" | number
  readonly permissionMode?: string
  readonly criticalSystemReminder_EXPERIMENTAL?: string
}
```

- [ ] **Step 4: Implement resolver**

Create `desktop/electron/services/agent-runtime/persona-runtime.ts`:

```ts
import { createHash } from "node:crypto"

import type { ConversationEntryV1, ConversationMainThreadPersonaSnapshotV1 } from "../../runtime/data-repo"
import type { AgentPersona } from "../../../app-capabilities/agent-personas/shared/schema"
import type { AgentSdkAgentDefinitions } from "./project-contributions"

export const AGENT_PERSONA_UNAVAILABLE_MESSAGE = "智能体不可用"
const SDK_AGENT_PREFIX = "synapse-persona__"

export type AgentPersonaRuntimeResolverDeps = {
  readonly listPersonas: () => Promise<readonly AgentPersona[]>
}

export type ResolvedPersonaSdkConfig = {
  readonly activePersonaId: string | null
  readonly activeAgentName?: string
  readonly snapshot?: ConversationMainThreadPersonaSnapshotV1
  readonly agents: AgentSdkAgentDefinitions
  readonly definitionsHash: string
}

export function sdkAgentNameForPersona(personaId: string): string {
  return `${SDK_AGENT_PREFIX}${personaId.trim()}`
}

export function createAgentPersonaRuntimeResolver(deps: AgentPersonaRuntimeResolverDeps) {
  async function resolve(
    conversation: Pick<ConversationEntryV1, "agentConfig">,
  ): Promise<ResolvedPersonaSdkConfig> {
    const personas = await deps.listPersonas()
    const agents = toSdkAgents(personas)
    const definitionsHash = hashJson(agents)
    const activePersonaId = conversation.agentConfig?.activeMainThreadPersonaId ?? null
    if (!activePersonaId) {
      return { activePersonaId: null, agents, definitionsHash }
    }
    const persona = personas.find((item) => item.id === activePersonaId)
    if (!persona) throw new Error(AGENT_PERSONA_UNAVAILABLE_MESSAGE)
    const snapshot = snapshotForPersona(persona, agents[sdkAgentNameForPersona(persona.id)])
    return {
      activePersonaId,
      activeAgentName: sdkAgentNameForPersona(persona.id),
      snapshot,
      agents,
      definitionsHash,
    }
  }

  return { resolve }
}

function toSdkAgents(personas: readonly AgentPersona[]): AgentSdkAgentDefinitions {
  return Object.fromEntries(personas.map((persona) => [
    sdkAgentNameForPersona(persona.id),
    {
      description: persona.description,
      prompt: persona.systemPrompt,
      disallowedTools: ["Agent"],
    },
  ]))
}

function snapshotForPersona(
  persona: AgentPersona,
  definition: AgentSdkAgentDefinitions[string] | undefined,
): ConversationMainThreadPersonaSnapshotV1 {
  return {
    id: persona.id,
    name: persona.name,
    source: persona.source,
    definitionHash: hashJson(definition ?? {}),
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex")
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortJson(item)]))
}
```

- [ ] **Step 5: Run resolver tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/persona-runtime.ts desktop/electron/services/agent-runtime/project-contributions.ts desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts
git commit -m "feat: map agent personas to sdk agents"
```

---

### Task 3: Add Claude SDK Main-Thread Agent Switching

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`

- [ ] **Step 1: Write failing ClaudeSDKSession tests**

Add tests to `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`:

```ts
it("passes main-thread agent to Claude Agent SDK options", () => {
  const { factory, getOptions } = createQueryFactory()
  createSession(factory, {
    agent: "synapse-persona__builtin-zh-en-translator",
    agents: {
      "synapse-persona__builtin-zh-en-translator": {
        description: "Translates between Chinese and English.",
        prompt: "Translate only.",
        disallowedTools: ["Agent"],
      },
    },
    agentDefinitionsHash: "hash-1",
  })

  expect(getOptions()).toMatchObject({
    agent: "synapse-persona__builtin-zh-en-translator",
    agents: {
      "synapse-persona__builtin-zh-en-translator": {
        prompt: "Translate only.",
      },
    },
  })
})

it("switches main-thread agent through applyFlagSettings", async () => {
  const applyFlagSettings = vi.fn()
  const { factory } = createQueryFactory({ applyFlagSettings })
  const session = createSession(factory, {
    agent: "synapse-persona__old",
    agentDefinitionsHash: "hash-1",
  })

  await session.setMainThreadAgent?.("synapse-persona__new")

  expect(applyFlagSettings).toHaveBeenCalledWith({ agent: "synapse-persona__new" })
  expect(session.mainThreadAgentName).toBe("synapse-persona__new")
})

it("clears main-thread agent through applyFlagSettings", async () => {
  const applyFlagSettings = vi.fn()
  const { factory } = createQueryFactory({ applyFlagSettings })
  const session = createSession(factory, {
    agent: "synapse-persona__old",
    agentDefinitionsHash: "hash-1",
  })

  await session.setMainThreadAgent?.(null)

  expect(applyFlagSettings).toHaveBeenCalledWith({ agent: null })
  expect(session.mainThreadAgentName).toBeUndefined()
})
```

Update the local `createQueryFactory` helper in the same test file to accept an optional object:

```ts
function createQueryFactory(overrides: Partial<QueryLike> = {}): {
  readonly factory: QueryFactory
  readonly query: FakeQuery
  getPrompt(): AsyncIterable<SDKUserMessage>
  getOptions(): Record<string, unknown>
} {
  const query = Object.assign(new FakeQuery(), overrides)
  let prompt: AsyncIterable<SDKUserMessage> | undefined
  let options: Record<string, unknown> | undefined
  const factory: QueryFactory = (input) => {
    prompt = input.prompt
    options = input.options
    return query
  }

  return {
    factory,
    query,
    getPrompt() {
      if (!prompt) throw new Error("queryFactory was not called")
      return prompt
    },
    getOptions() {
      if (!options) throw new Error("queryFactory was not called")
      return options
    },
  }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: FAIL because `agent`, `agentDefinitionsHash`, and `setMainThreadAgent` are not implemented.

- [ ] **Step 3: Extend live session interface**

In `desktop/electron/services/agent-runtime/types.ts`, extend `AgentLiveSession`:

```ts
readonly mainThreadAgentName?: string
readonly agentDefinitionsHash?: string
setMainThreadAgent?(agentName: string | null): Promise<void>
```

- [ ] **Step 4: Extend ClaudeSDKSession options and QueryLike**

In `desktop/electron/services/agent-runtime/claude-sdk-session.ts`, update `QueryLike`:

```ts
applyFlagSettings?(settings: Record<string, unknown>): Promise<void>
```

Update `ClaudeSDKSessionOptions`:

```ts
readonly agent?: string
readonly agentDefinitionsHash?: string
```

Add class fields:

```ts
mainThreadAgentName: string | undefined
readonly agentDefinitionsHash: string | undefined
```

Set them in constructor:

```ts
this.mainThreadAgentName = options.agent
this.agentDefinitionsHash = options.agentDefinitionsHash
```

- [ ] **Step 5: Pass agent into SDK options**

In `buildQueryOptions()`:

```ts
if (options.agent) queryOptions.agent = options.agent
if (options.agents && Object.keys(options.agents).length > 0) queryOptions.agents = options.agents
```

Keep the existing `agents` assignment and add `agent` beside it; do not move `agents` under `settings`.

- [ ] **Step 6: Implement runtime switch method**

In `ClaudeSDKSession`:

```ts
async setMainThreadAgent(agentName: string | null): Promise<void> {
  if (this.closed) throw new Error(AGENT_SESSION_CLOSED_MESSAGE)
  if (!this.query.applyFlagSettings) {
    throw new Error("当前会话不支持切换智能体")
  }
  await this.query.applyFlagSettings({ agent: agentName })
  this.mainThreadAgentName = agentName ?? undefined
}
```

- [ ] **Step 7: Run ClaudeSDKSession tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/claude-sdk-session.ts desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
git commit -m "feat: support sdk main-thread agent switching"
```

---

### Task 4: Apply Persona State in SessionManager

**Files:**
- Modify: `desktop/electron/services/agent-runtime/session-lifecycle.ts`
- Modify: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`

- [ ] **Step 1: Write failing SessionManager tests**

Add tests to `desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts`:

```ts
it("creates live sessions with the active main-thread persona", async () => {
  const states = new Map<string, RuntimeSessionState>()
  const createSession = vi.fn(() => new FakeLiveSession())
  const manager = new SessionManager({
    projectId: "project-1",
    workDir: "/tmp/project",
    repository: {} as AgentSessionRepository,
    providerService: {
      buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
      getActiveProvider: vi.fn(),
    } as unknown as ProviderService,
    states,
    pendingPermissions: new Map(),
    createSession,
    sdkPersonaConfig: async () => ({
      activeAgentName: "synapse-persona__builtin-zh-en-translator",
      agents: {
        "synapse-persona__builtin-zh-en-translator": {
          description: "Translate.",
          prompt: "Translate only.",
          disallowedTools: ["Agent"],
        },
      },
      definitionsHash: "hash-1",
    }),
  })

  await manager.getOrCreateSession({
    state: manager.stateForConversation("conversation-1", baseMessage("default")),
    conversation: baseConversation({
      agentConfig: { activeMainThreadPersonaId: "builtin-zh-en-translator" },
    }),
    message: baseMessage("default"),
  })

  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
    agent: "synapse-persona__builtin-zh-en-translator",
    agentDefinitionsHash: "hash-1",
  }))
})

it("switches persona on an alive reusable session without recreating it", async () => {
  const states = new Map<string, RuntimeSessionState>()
  const liveSession = new FakeLiveSession()
  liveSession.mainThreadAgentName = "synapse-persona__old"
  liveSession.agentDefinitionsHash = "hash-1"
  const createSession = vi.fn(() => liveSession)
  const manager = new SessionManager({
    projectId: "project-1",
    workDir: "/tmp/project",
    repository: {} as AgentSessionRepository,
    providerService: {
      buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
      getActiveProvider: vi.fn(),
    } as unknown as ProviderService,
    states,
    pendingPermissions: new Map(),
    createSession,
    sdkPersonaConfig: async () => ({
      activeAgentName: "synapse-persona__new",
      agents: {},
      definitionsHash: "hash-1",
    }),
  })
  const state = manager.stateForConversation("conversation-1", baseMessage("default"))
  state.providerId = "anthropic"
  state.modeOverride = "default"
  state.effectiveModel = undefined
  state.sdkSettings = undefined
  state.liveSession = liveSession
  state.agentDefinitionsHash = "hash-1"

  const result = await manager.getOrCreateSession({
    state,
    conversation: baseConversation(),
    message: baseMessage("default"),
  })

  expect(result.created).toBe(false)
  expect(liveSession.setMainThreadAgent).toHaveBeenCalledWith("synapse-persona__new")
  expect(createSession).not.toHaveBeenCalled()
})

it("recreates live sessions when persona definitions changed", async () => {
  const states = new Map<string, RuntimeSessionState>()
  const oldSession = new FakeLiveSession()
  oldSession.agentDefinitionsHash = "hash-old"
  const newSession = new FakeLiveSession()
  const createSession = vi.fn(() => newSession)
  const manager = new SessionManager({
    projectId: "project-1",
    workDir: "/tmp/project",
    repository: {} as AgentSessionRepository,
    providerService: {
      buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
      getActiveProvider: vi.fn(),
    } as unknown as ProviderService,
    states,
    pendingPermissions: new Map(),
    createSession,
    sdkPersonaConfig: async () => ({
      activeAgentName: "synapse-persona__builtin-zh-en-translator",
      agents: {},
      definitionsHash: "hash-new",
    }),
  })
  const state = manager.stateForConversation("conversation-1", baseMessage("default"))
  state.providerId = "anthropic"
  state.modeOverride = "default"
  state.liveSession = oldSession
  state.agentDefinitionsHash = "hash-old"

  const result = await manager.getOrCreateSession({
    state,
    conversation: baseConversation(),
    message: baseMessage("default"),
  })

  expect(result.created).toBe(true)
  expect(oldSession.close).toHaveBeenCalledOnce()
  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
    agent: "synapse-persona__builtin-zh-en-translator",
    agentDefinitionsHash: "hash-new",
  }))
})
```

Update `FakeLiveSession` in the test file:

```ts
mainThreadAgentName?: string
agentDefinitionsHash?: string
setMainThreadAgent = vi.fn(async (agentName: string | null) => {
  this.mainThreadAgentName = agentName ?? undefined
})
```

- [ ] **Step 2: Run SessionManager tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts
```

Expected: FAIL because `sdkPersonaConfig` and new session inputs do not exist.

- [ ] **Step 3: Extend session manager dependency and factory input**

In `desktop/electron/services/agent-runtime/session-manager.ts`, extend `CreateAgentLiveSessionInput`:

```ts
readonly agent?: string
readonly agentDefinitionsHash?: string
```

Extend `SessionManagerDeps`:

```ts
readonly sdkPersonaConfig?: (
  message: AgentMessage,
  conversation: ConversationEntryV1,
) => Promise<{
  readonly activeAgentName?: string
  readonly agents: AgentSdkAgentDefinitions
  readonly definitionsHash: string
}>
```

Pass new options into `new ClaudeSDKSession(...)`.

- [ ] **Step 4: Resolve persona config in getOrCreateSession**

In `getOrCreateSession()`, after SDK settings resolution:

```ts
const personaConfig = await Promise.resolve(this.deps.sdkPersonaConfig?.(
  input.message,
  input.conversation,
) ?? {
  agents: await Promise.resolve(this.deps.sdkAgents?.(input.message, input.conversation) ?? {}),
  definitionsHash: "",
})
const activeAgentName = personaConfig.activeAgentName
const agents = personaConfig.agents
const agentDefinitionsHash = personaConfig.definitionsHash
```

If project contributions still supply `sdkAgents`, merge them with persona agents:

```ts
const contributionAgents = await Promise.resolve(this.deps.sdkAgents?.(input.message, input.conversation) ?? {})
const agents = { ...contributionAgents, ...personaConfig.agents }
```

Hash only persona definitions for persona switching. Keep contribution agents in the creation input; do not use contribution-agent changes to trigger persona fallback unless a later contribution-agent resolver adds a separate hash.

- [ ] **Step 5: Apply reusable session persona switch**

Before returning an existing live session:

```ts
const personaDefinitionsMatch = input.state.agentDefinitionsHash === agentDefinitionsHash
const activeAgentMatches = input.state.mainThreadAgentName === activeAgentName

if (canReuseBaseSession && personaDefinitionsMatch) {
  if (!activeAgentMatches) {
    await input.state.liveSession.setMainThreadAgent?.(activeAgentName ?? null)
    input.state.mainThreadAgentName = activeAgentName
  }
  return { liveSession: input.state.liveSession, created: false }
}
```

If `setMainThreadAgent` is missing or throws, log a warn and continue to close + recreate.

- [ ] **Step 6: Pass persona state into new live sessions**

When creating:

```ts
agent: activeAgentName,
agents,
agentDefinitionsHash,
```

After creation:

```ts
input.state.mainThreadAgentName = activeAgentName
input.state.agentDefinitionsHash = agentDefinitionsHash
```

- [ ] **Step 7: Wire resolver into agent runtime service**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, add an optional dep:

```ts
readonly sdkPersonaConfig?: SessionManagerDeps["sdkPersonaConfig"]
```

Pass it to `new SessionManager(...)`.

In `desktop/electron/services/agent-runtime/index.ts`, resolve `core.agent-personas`, create `createAgentPersonaRuntimeResolver({ listPersonas: () => personaService.list() })`, and pass:

```ts
sdkPersonaConfig: async (_message, conversation) =>
  personaResolver.resolve(conversation),
```

- [ ] **Step 8: Run SessionManager and runtime service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/services/agent-runtime/session-manager.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/index.ts desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
git commit -m "feat: apply conversation persona in agent runtime"
```

---

### Task 5: Add Persona Selection IPC

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-sessions.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Modify: `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Generate: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Write failing IPC tests**

Add tests to `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`:

```ts
it("updates a conversation persona through IPC", async () => {
  const updateSessionPersona = vi.fn().mockResolvedValue({
    ...storedConversation(),
    agentConfig: {
      activeMainThreadPersonaId: "builtin-zh-en-translator",
      activeMainThreadPersonaSnapshot: {
        id: "builtin-zh-en-translator",
        name: "中英翻译",
        source: "builtin",
        definitionHash: "hash-translator",
      },
    },
  })
  const ctx = createContext({
    agent: { updateSessionPersona },
  })

  const result = await sessionMethods.updateSessionPersona.handler(ctx, {
    projectId: "project-1",
    conversationId: "conv-1",
    personaId: "builtin-zh-en-translator",
  })

  expect(updateSessionPersona).toHaveBeenCalledWith({
    conversationId: "conv-1",
    personaId: "builtin-zh-en-translator",
  })
  expect(result.activeMainThreadPersonaId).toBe("builtin-zh-en-translator")
  expect(result.activeMainThreadPersonaName).toBe("中英翻译")
})

it("clears a conversation persona through IPC", async () => {
  const updateSessionPersona = vi.fn().mockResolvedValue(storedConversation())
  const ctx = createContext({
    agent: { updateSessionPersona },
  })

  const result = await sessionMethods.updateSessionPersona.handler(ctx, {
    projectId: "project-1",
    conversationId: "conv-1",
    personaId: null,
  })

  expect(updateSessionPersona).toHaveBeenCalledWith({
    conversationId: "conv-1",
    personaId: null,
  })
  expect(result.activeMainThreadPersonaId).toBeUndefined()
})
```

- [ ] **Step 2: Run IPC tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts
```

Expected: FAIL because `updateSessionPersona` IPC does not exist.

- [ ] **Step 3: Add session summary fields**

In `desktop/electron/modules/agent/ipc-shared.ts`, extend `sessionSummarySchema` with:

```ts
activeMainThreadPersonaId: z.string().nullable().optional(),
activeMainThreadPersonaName: z.string().optional(),
activeMainThreadPersonaSource: z.enum(["builtin", "user"]).optional(),
```

Update `sessionSummary(session)`:

```ts
const personaSnapshot = session.agentConfig?.activeMainThreadPersonaSnapshot
return {
  ...
  activeMainThreadPersonaId: session.agentConfig?.activeMainThreadPersonaId,
  activeMainThreadPersonaName: personaSnapshot?.name,
  activeMainThreadPersonaSource: personaSnapshot?.source,
}
```

- [ ] **Step 4: Add IPC method**

In `desktop/electron/modules/agent/ipc-sessions.ts`, add schema:

```ts
const updateSessionPersonaRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  personaId: z.string().min(1).nullable(),
})
```

Add method descriptor:

```ts
updateSessionPersona: {
  kind: "invoke",
  channel: "synapse:agent:session-persona:update",
  request: updateSessionPersonaRequestSchema,
  response: sessionSummarySchema,
  handler: async (ctx, request) => {
    const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
    const updated = await agent.updateSessionPersona({
      conversationId: request.conversationId,
      personaId: request.personaId,
    })
    return sessionSummary(updated)
  },
},
```

Wrap errors with the same sanitized logging pattern used by create/switch session. User-facing error: `切换智能体失败`.

- [ ] **Step 5: Add runtime service method**

In `desktop/electron/services/agent-runtime/agent-runtime-service.ts`, implement this method:

```ts
async updateSessionPersona(input: {
  readonly conversationId: string
  readonly personaId: string | null
}): Promise<ConversationEntryV1> {
  const conversation = await this.sessionLifecycle.getSession(input.conversationId)
  if (!conversation) throw new Error("找不到 Agent 会话。")
  const candidateConversation = {
    ...conversation,
    agentConfig: {
      ...(conversation.agentConfig ?? {}),
      activeMainThreadPersonaId: input.personaId,
    },
  }
  const resolved = await this.deps.sdkPersonaConfig?.({
    projectId: this.deps.projectId,
    sessionKey: conversation.sessionKey,
    platform: "local",
    content: "",
  }, candidateConversation)
  const snapshot = input.personaId ? resolved?.snapshot : null
  if (input.personaId && !snapshot) throw new Error("智能体不可用")
  return this.sessionLifecycle.saveMainThreadPersona(input.conversationId, snapshot ?? null)
}
```

- [ ] **Step 6: Update bridge types and generated channels**

In `desktop/src/types/agent.ts`, extend `SynapseAgentSessionSummary`:

```ts
readonly activeMainThreadPersonaId?: string | null
readonly activeMainThreadPersonaName?: string
readonly activeMainThreadPersonaSource?: "builtin" | "user"
```

In `desktop/src/types/bridge.ts`, add:

```ts
updateSessionPersona: (
  args: { projectId: string; conversationId: string; personaId: string | null },
) => Promise<SynapseAgentSessionSummary>
```

In `desktop/electron/preload.ts`, add bridge mapping for `synapse:agent:session-persona:update`.

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` updates.

- [ ] **Step 7: Run IPC and type generation checks**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/electron/modules/agent/__tests__/ipc-schema.test.ts
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/modules/agent/ipc-sessions.ts desktop/electron/modules/agent/ipc-shared.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts desktop/src/types/agent.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts
git commit -m "feat: add agent session persona ipc"
```

---

### Task 6: Add Composer Persona Menu

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`
- Test: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`

- [ ] **Step 1: Write failing composer UI test**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, add a render-to-static-markup test beside the existing composer markup tests:

```tsx
it("renders the persona selector in ordinary mode", () => {
  const html = renderToStaticMarkup(
    <AgentComposer
      draft=""
      disabled={false}
      canSend={false}
      sending={false}
      cancelPhase="idle"
      personaItems={[{
        id: "builtin-zh-en-translator",
        schemaVersion: 1,
        name: "中英翻译",
        description: "在中文和英文之间互译。",
        systemPrompt: "你是中英翻译智能体。",
        providerModel: null,
        source: "builtin",
        readonly: true,
      }]}
      activePersonaId={null}
      onPersonaChange={vi.fn()}
      onDraftChange={vi.fn()}
      onInputKeyDown={vi.fn()}
      onSubmit={vi.fn()}
      onCancelTurn={vi.fn()}
      onForceKillTurn={vi.fn()}
    />,
  )

  expect(html).toContain('aria-label="智能体"')
  expect(html).toContain("普通")
  expect(html).toContain("中英翻译")
})
```

- [ ] **Step 2: Run composer test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because persona props/menu do not exist.

- [ ] **Step 3: Add persona loading to chat hook**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, include:

```ts
personas: SynapseAgentPersona[]
refreshPersonas: () => Promise<void>
updateSessionPersona: (
  session: SynapseAgentSessionSummary,
  personaId: string | null,
) => Promise<SynapseAgentSessionSummary | undefined>
```

In `use-chat-connection.ts`, add state loading:

```ts
const loadPersonas = useCallback(async () => {
  const bridge = requireSynapseBridge()
  const items = await bridge.agentPersonas.list()
  dispatch({ type: "SET_PERSONAS", personas: items })
}, [dispatch])
```

Extend the chat reducer state with `personas: SynapseAgentPersona[]` and add a `SET_PERSONAS` action in the same reducer file that currently owns session/message state.

Subscribe to `bridge.agentPersonas.onChanged((event) => dispatch({ type: "SET_PERSONAS", personas: event.items }))`.

- [ ] **Step 4: Add updateSessionPersona renderer action**

In `use-chat-connection.ts`, implement:

```ts
const updateSessionPersona = useCallback(async (
  session: SynapseAgentSessionSummary,
  personaId: string | null,
) => {
  const bridge = requireSynapseBridge()
  const updated = await bridge.agent.updateSessionPersona({
    projectId: session.projectId,
    conversationId: session.id,
    personaId,
  })
  const normalized = normalizeSessionProject(updated, session.projectId)
  dispatch({ type: "UPDATE_SESSIONS", updater: (current) => current.map((item) =>
    isSameSession(item, normalized) ? normalized : item) })
  if (selectedConversationIdRef.current === normalized.id) {
    setSelectedSession(normalized)
  }
  return normalized
}, [dispatch, selectedConversationIdRef, setSelectedSession])
```

- [ ] **Step 5: Thread persona props to AgentComposer**

In `desktop/src/modules/agent/index.tsx`, pass `chat.personas` and `chat.updateSessionPersona` to `AgentConversationWorkspace`.

In `agent-conversation-workspace.tsx`, pass:

```tsx
personaItems={chat.personas}
activePersonaId={session.activeMainThreadPersonaId ?? null}
onPersonaChange={(personaId) => {
  void chat.updateSessionPersona(session, personaId)
}}
```

to `AgentComposer`.

- [ ] **Step 6: Implement the menu in AgentComposer**

Import the same shadcn dropdown menu primitives used elsewhere in `desktop/src` (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`). Add a small button in the composer footer:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="智能体"
    >
      <Bot data-icon="inline-start" />
      {activePersona?.name ?? "普通"}
      <ChevronDown />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <DropdownMenuItem onSelect={() => onPersonaChange(null)}>
      普通
    </DropdownMenuItem>
    {personaItems.map((item) => (
      <DropdownMenuItem key={item.id} onSelect={() => onPersonaChange(item.id)}>
        {item.name}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

Use lucide icons already available in the project. Do not add custom colors, inline styles, explanatory text, or card wrappers.

- [ ] **Step 7: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/agent-composer.test.tsx desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/modules/agent/hooks/use-chat-connection.ts desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/agent-conversation-workspace.tsx desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
git commit -m "feat: add agent composer persona menu"
```

---

### Task 7: Save Persona Metadata and Export It

**Files:**
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-export-service.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts`

- [ ] **Step 1: Write failing export test**

In `desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts`, add this test after `"exports every stored assistant message when rebuilding transcript from history"`:

```ts
it("includes main-thread persona labels in exported transcript", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-export-persona-test-"))
  tempRoots.push(tempRoot)
  const outputPath = path.join(tempRoot, "conversation.zip")
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  await conversations.upsert({
    ...createConversation(),
    history: [
      {
        role: "user",
        content: "Translate this",
        timestamp: "2026-06-30T00:00:00.000Z",
        metadata: {
          mainThreadPersona: {
            id: "builtin-zh-en-translator",
            name: "中英翻译",
            source: "builtin",
            definitionHash: "hash-translator",
          },
        },
      },
      {
        role: "assistant",
        content: "Hello",
        timestamp: "2026-06-30T00:00:01.000Z",
        metadata: {
          agentEventType: "assistant",
          mainThreadPersona: {
            id: "builtin-zh-en-translator",
            name: "中英翻译",
            source: "builtin",
            definitionHash: "hash-translator",
          },
        },
      },
    ],
  })
  const createZipArchive = vi.fn(async (sourceDirectoryPath: string) => {
    const transcript = await readFile(path.join(sourceDirectoryPath, "transcript.md"), "utf8")
    expect(transcript).toContain("[中英翻译]")
    expect(transcript).toContain("Hello")
  })

  const service = new AgentConversationExportService({
    conversations,
    agentEvents: new MemoryNamespace<AgentEventEntryV1>("agent.events"),
    agentUsage: new MemoryNamespace<AgentUsageEntryV1>("agent.usage"),
    chooseSavePath: vi.fn().mockResolvedValue(outputPath),
    createZipArchive,
    makeTempDir: async () => {
      const staging = await mkdtemp(path.join(tempRoot, "staging-"))
      tempRoots.push(staging)
      return staging
    },
    now: () => new Date("2026-06-30T00:01:00.000Z"),
    removePath: (targetPath) => rm(targetPath, { recursive: true, force: true }),
  })

  await expect(service.exportBundle({
    projectId: "project-1",
    conversationId: "conv-1",
    sessionKey: TEST_SESSION_KEY,
  })).resolves.toMatchObject({
    success: true,
    filePath: outputPath,
  })
  expect(createZipArchive).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run export test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
```

Expected: FAIL because transcript does not include persona labels.

- [ ] **Step 3: Save metadata on user and assistant history**

In `conversation-router.ts`, where user history is appended, pass:

```ts
const personaMetadata = conversation.agentConfig?.activeMainThreadPersonaSnapshot
  ? { mainThreadPersona: conversation.agentConfig.activeMainThreadPersonaSnapshot }
  : undefined
await this.repository.appendHistory(conversation.id, "user", message.content, personaMetadata)
```

Where assistant result metadata is saved, merge:

```ts
const resultMetadata = {
  ...existingResultMetadata,
  ...(conversation.agentConfig?.activeMainThreadPersonaSnapshot
    ? { mainThreadPersona: conversation.agentConfig.activeMainThreadPersonaSnapshot }
    : {}),
}
```

Find the current assistant result metadata object in `conversation-router.ts`, add the `mainThreadPersona` property through object spread, and keep every existing metadata property already present in that object.

- [ ] **Step 4: Convert metadata to timeline item**

In `desktop/electron/modules/agent/ipc-shared.ts` or the helper that maps history to timeline items, include persona metadata in `SynapseAgentMessageTimelineItem.metadata` without changing ordinary messages:

```ts
metadata: {
  ...entry.metadata,
  mainThreadPersona: entry.metadata?.mainThreadPersona,
}
```

Update `desktop/src/types/agent.ts` metadata type:

```ts
readonly mainThreadPersona?: {
  readonly id: string
  readonly name: string
  readonly source: "builtin" | "user"
  readonly definitionHash: string
}
```

- [ ] **Step 5: Add export label**

In `conversation-export-service.ts`, when formatting assistant history entries:

```ts
const persona = entry.metadata?.mainThreadPersona
const prefix = isPersonaMetadata(persona) ? `[${persona.name}]\n` : ""
return `${prefix}${entry.content}`
```

Add a local guard:

```ts
function isPersonaMetadata(value: unknown): value is { name: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { name?: unknown }).name === "string"
}
```

- [ ] **Step 6: Run metadata/export tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/conversation-export-service.ts desktop/electron/modules/agent/ipc-shared.ts desktop/src/types/agent.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
git commit -m "feat: record agent persona in conversation history"
```

---

### Task 8: Final Verification and Release Note

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Append a user-facing bullet under the appropriate pending release section in `RELEASE_NOTES_PENDING.md`:

```md
- Agent 对话现在可以在输入框选择智能体人格，并在同一会话中保持或切换；普通对话仍是默认模式。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/agent-runtime/__tests__/persona-runtime.test.ts \
  desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts \
  desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts \
  desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts \
  desktop/electron/services/agent-runtime/__tests__/conversation-export-service.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. If it flags UI style violations, remove custom colors, inline styles, nested cards, or verbose UI copy instead of suppressing the check.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: `git diff --check` prints nothing. Diff only includes persona chat integration files and release notes.

- [ ] **Step 6: Commit final verification changes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent persona chat integration"
```
