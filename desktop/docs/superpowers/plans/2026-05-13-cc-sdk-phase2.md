# CC SDK Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spawned Claude Code CLI adapter with Claude Agent SDK sessions, and replace the old provider-config service with a DataRepository-backed provider module.

**Architecture:** The Electron main process owns the SDK dependency and converts SDK messages into Synapse bridge events before IPC. Provider metadata stays in the existing DataRepository `providers` namespace, API keys stay in the encrypted `secrets` namespace, and existing `conversations` are extended with `providerId`, `sdkSessionId`, usage, and cost fields instead of replacing the storage layer.

**Tech Stack:** TypeScript, Electron, Claude Agent SDK, DataRepository, Zod, React, shadcn/ui, Vitest

---

## File Structure

**Create**
- `desktop/electron/services/provider/types.ts` — `CCProvider`, provider presets, secret IDs, and API request/response types.
- `desktop/electron/services/provider/provider-presets.ts` — built-in provider definitions converted from CC Switch env mappings.
- `desktop/electron/services/provider/provider-secret-store.ts` — `secrets` namespace wrapper for provider API keys.
- `desktop/electron/services/provider/provider-service.ts` — provider CRUD, active provider selection, `buildEnv(providerId)`.
- `desktop/electron/services/provider/index.ts` — project service factory and exports.
- `desktop/electron/services/provider/__tests__/provider-service.test.ts` — provider CRUD/env/secret tests.
- `desktop/electron/services/agent-runtime/sdk-event-bridge.ts` — SDK message to Synapse `AgentEvent` conversion.
- `desktop/electron/services/agent-runtime/claude-sdk-session.ts` — per-conversation SDK `Query` wrapper.
- `desktop/electron/services/agent-runtime/session-manager.ts` — conversation session lifecycle and idle reclaim.
- `desktop/electron/services/agent-runtime/conversation-router.ts` — governance, slash commands, event dispatch, history/event persistence.
- `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts` — SDK session wrapper tests with a fake query.
- `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts` — SDK bridge mapping tests.
- `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts` — routing, permission, cancel, history tests.
- `desktop/src/modules/settings/components/provider-panel.tsx` — Provider management UI.
- `desktop/src/modules/agent/components/provider-select-dialog.tsx` — new conversation provider selector.

**Modify**
- `desktop/package.json` — add `@anthropic-ai/claude-agent-sdk`.
- `desktop/electron/runtime/data-repo/schemas/placeholders.ts` — extend `ConversationEntryV1`, `ProviderEntryV1`, and add `AgentEventEntryV1`.
- `desktop/electron/runtime/data-repo/schemas/index.ts` — export/register `agent.events` schema.
- `desktop/src/definitions/main-types.ts` — remove adapter/process-runner runtime definition types.
- `desktop/src/definitions/agent/claude-code/agent-main.ts` — remove `createAdapter()` and provider env building.
- `desktop/electron/services/agent-runtime/types.ts` — replace adapter types with SDK-oriented session/event types.
- `desktop/electron/services/agent-runtime/agent-runtime-service.ts` — wire `SessionManager`, `ConversationRouter`, and `ProviderService`.
- `desktop/electron/services/agent-runtime/index.ts` — remove adapter exports, register new deps.
- Delete `desktop/electron/services/agent-runtime/adapters/`.
- Delete `desktop/electron/services/agent-runtime/message-router.ts`.
- Delete `desktop/electron/services/provider-config/`.
- `desktop/electron/modules/agent/ipc-shared.ts`, `ipc-sessions.ts`, `ipc-messages.ts`, `ipc-tools.ts` — switch to new provider service, providerId on create/send, expanded events.
- `desktop/electron/preload.ts`, `desktop/electron/generated/ipc-channels.generated.ts`, `desktop/src/types/bridge.ts`, `desktop/src/types/agent.ts` — expose provider CRUD and new event/session fields.
- `desktop/src/lib/agent-timeline.ts` — support bridge `assistant`, `stream`, `sdkEvent`, usage metadata.
- `desktop/src/modules/agent/hooks/use-chat-connection.ts` and `use-chat-events.ts` — pass providerId for new sessions and consume new events.
- `desktop/src/modules/agent/index.tsx` — show provider status and open provider selector for new sessions.
- `desktop/src/modules/settings/data.ts`, `desktop/src/modules/settings/index.tsx`, `desktop/src/modules/settings/components/tools-panel.tsx` — add Provider management entry under Tools.

---

### Task 1: Install SDK And Lock Current Baseline

**Files:**
- Modify: `desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install the SDK dependency**

```bash
pnpm --filter @synapse/desktop add @anthropic-ai/claude-agent-sdk
```

Expected: `desktop/package.json` includes `@anthropic-ai/claude-agent-sdk`, and `pnpm-lock.yaml` includes the SDK and platform optional dependency.

- [ ] **Step 2: Run the baseline checks before behavior changes**

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: all three commands pass on the current branch.

- [ ] **Step 3: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml
git commit -m "chore: add claude agent sdk"
```

---

### Task 2: Extend DataRepository Schemas

**Files:**
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`

- [ ] **Step 1: Add a failing schema test for provider/conversation/event fields**

Add tests covering:

```typescript
expect(conversationsSchema.validate({
  id: "conv-1",
  schemaVersion: 1,
  projectId: "project-1",
  sessionKey: "local:renderer",
  providerId: "anthropic",
  sdkSessionId: "sdk-session-1",
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  costUsd: 0.01,
  history: [],
  active: true,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
})).toBe(true)

expect(agentEventsSchema.validate({
  id: "event-1",
  schemaVersion: 1,
  projectId: "project-1",
  conversationId: "conv-1",
  turnId: "turn-1",
  eventType: "assistant",
  payload: { type: "assistant" },
  createdAt: "2026-05-13T00:00:00.000Z",
})).toBe(true)
```

- [ ] **Step 2: Run the failing schema test**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: fails because `agentEventsSchema` and new fields are not defined/exported.

- [ ] **Step 3: Extend schema types**

Add fields to `ConversationEntryV1`:

```typescript
providerId?: string
sdkSessionId?: string
usage?: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}
costUsd?: number
```

Add `AgentEventEntryV1` and `agentEventsSchema`:

```typescript
export interface AgentEventEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export const agentEventsSchema: NamespaceSchema<AgentEventEntryV1> = {
  name: "agent.events",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentEventEntryV1 =>
    isAnyRecord<AgentEventEntryV1>(v)
    && (v as AgentEventEntryV1).schemaVersion === 1
    && typeof (v as AgentEventEntryV1).id === "string"
    && typeof (v as AgentEventEntryV1).projectId === "string"
    && typeof (v as AgentEventEntryV1).conversationId === "string"
    && typeof (v as AgentEventEntryV1).turnId === "string"
    && typeof (v as AgentEventEntryV1).eventType === "string"
    && isAnyRecord((v as AgentEventEntryV1).payload)
    && typeof (v as AgentEventEntryV1).createdAt === "string",
}
```

Export/register the schema in `schemas/index.ts`.

- [ ] **Step 4: Run schema tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/runtime/data-repo/schemas desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
git commit -m "feat: extend agent conversation schemas for sdk"
```

---

### Task 3: Build The Provider Service

**Files:**
- Create: `desktop/electron/services/provider/types.ts`
- Create: `desktop/electron/services/provider/provider-presets.ts`
- Create: `desktop/electron/services/provider/provider-secret-store.ts`
- Create: `desktop/electron/services/provider/provider-service.ts`
- Create: `desktop/electron/services/provider/index.ts`
- Create: `desktop/electron/services/provider/__tests__/provider-service.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`

- [ ] **Step 1: Write failing provider tests**

Cover these behaviors:

```typescript
it("stores API keys only in the encrypted secrets namespace", async () => {
  const service = makeProviderService()
  await service.createProvider({
    id: "anthropic",
    name: "Claude Official",
    category: "official",
    apiKeyField: "ANTHROPIC_API_KEY",
    apiKey: "sk-test",
    env: {},
  })

  await expect(service.buildEnv("anthropic")).resolves.toMatchObject({
    ANTHROPIC_API_KEY: "sk-test",
  })
  await expect(providers.get("anthropic")).resolves.toMatchObject({
    secretRef: "provider:anthropic:api-key",
  })
  await expect(secrets.get("provider:anthropic:api-key")).resolves.toMatchObject({
    kind: "api-key",
    value: "sk-test",
  })
})

it("uses ANTHROPIC_AUTH_TOKEN for baseUrl providers", async () => {
  const service = makeProviderService()
  await service.createProvider({
    id: "deepseek",
    name: "DeepSeek",
    category: "cn_official",
    baseUrl: "https://api.deepseek.com/anthropic",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    apiKey: "token",
    model: "deepseek-chat",
    env: {},
  })

  await expect(service.buildEnv("deepseek")).resolves.toMatchObject({
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: "token",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: "deepseek-chat",
  })
})
```

- [ ] **Step 2: Run the failing tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-service.test.ts
```

Expected: fails because the provider module does not exist.

- [ ] **Step 3: Implement provider types and secret store**

Define `CCProvider`, `ProviderCategory`, and `ProviderSecretStore` using `DataNamespace<SecretEntryV1>`.

```typescript
export type ProviderCategory =
  | "official"
  | "cn_official"
  | "cloud_provider"
  | "aggregator"
  | "third_party"
  | "custom"

export interface CCProvider {
  id: string
  name: string
  category: ProviderCategory
  baseUrl?: string
  apiKeyField: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY"
  active?: boolean
  model?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  env: Record<string, string>
  secretRef?: string
  archived?: boolean
  sortIndex?: number
  createdAt: string
  updatedAt: string
}
```

Secret IDs use `provider:${providerId}:api-key`.

- [ ] **Step 4: Implement ProviderService**

Implement methods:

```typescript
listProviders(): Promise<readonly CCProvider[]>
createProvider(input: CreateProviderInput): Promise<CCProvider>
updateProvider(id: string, patch: UpdateProviderInput): Promise<CCProvider>
archiveProvider(id: string): Promise<void>
setActiveProvider(id: string): Promise<void>
getActiveProvider(): Promise<CCProvider | null>
buildEnv(providerId: string): Promise<Record<string, string>>
```

`buildEnv()` must include model vars and `provider.env`, and must never return `undefined` values.

- [ ] **Step 5: Register provider project service**

Export `PROVIDER_SERVICE_ID = "provider"` and register a project scoped service in `index.ts`, then update `bootstrap/descriptors.ts` dependencies if descriptors explicitly enumerate services.

- [ ] **Step 6: Run provider tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-service.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/provider desktop/electron/bootstrap/descriptors.ts
git commit -m "feat: add sdk provider service"
```

---

### Task 4: Remove Adapter Definitions

**Files:**
- Modify: `desktop/src/definitions/main-types.ts`
- Modify: `desktop/src/definitions/agent/claude-code/agent-main.ts`
- Modify generated registry files under `desktop/electron/services/definitions/generated/` after running codegen.

- [ ] **Step 1: Write the expected type shape**

In `main-types.ts`, replace runtime adapter types with metadata:

```typescript
export type AgentRuntimeDefinition = SynapseAgentBaseDefinition & {
  runtimeKind: "claude-agent-sdk"
}
```

`AgentRuntimeProcessRunner`, `AgentRuntimeEnvInput`, `AgentRuntimeEnvResult`, `createAdapter()`, and `buildEnv()` are removed.

- [ ] **Step 2: Update Claude Code main definition**

Make `agent-main.ts`:

```typescript
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentBaseDefinition } from "./agent-shared"

export const agentRuntimeDefinition = {
  ...agentBaseDefinition,
  runtimeKind: "claude-agent-sdk",
} satisfies AgentRuntimeDefinition
```

- [ ] **Step 3: Regenerate definitions**

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
```

Expected: generated files no longer reference `AgentAdapter`, `ClaudeProcessRunner`, or `ClaudeCodeAdapter`.

- [ ] **Step 4: Run focused typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: remaining errors point to runtime/provider-config consumers, not definitions.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/definitions desktop/electron/services/definitions/generated
git commit -m "refactor: remove adapter creation from agent definitions"
```

---

### Task 5: Add SDK Event Bridge

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Create: `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- Create: `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Test at least:

```typescript
expect(bridgeSdkMessage({
  type: "result",
  subtype: "success",
  session_id: "sdk-1",
  result: "done",
  total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 2 },
}, baseEnvelope)).toMatchObject({
  type: "result",
  content: "done",
  sdkSessionId: "sdk-1",
  costUsd: 0.01,
})

expect(bridgeSdkMessage({
  type: "system",
  subtype: "init",
  session_id: "sdk-1",
  tools: ["Read"],
  mcp_servers: [],
}, baseEnvelope)).toMatchObject({
  type: "sessionInit",
  sdkSessionId: "sdk-1",
})
```

- [ ] **Step 2: Run failing bridge tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
```

Expected: fails because the bridge file/types do not exist.

- [ ] **Step 3: Define the expanded AgentEvent union**

Keep legacy core events and add SDK bridge events:

```typescript
export type AgentEvent =
  | AgentTextEvent
  | AgentThinkingEvent
  | AgentToolUseEvent
  | AgentToolResultEvent
  | AgentPermissionRequestEvent
  | AgentResultEvent
  | AgentErrorEvent
  | AgentSessionInitEvent
  | AgentAssistantEvent
  | AgentStreamEvent
  | AgentStatusEvent
  | AgentCompactBoundaryEvent
  | AgentSdkEvent
```

All event variants must be plain objects and may include `conversationId`, `turnId`, `providerId`, `sdkSessionId`, `timestamp`.

- [ ] **Step 4: Implement bridge mapping**

`bridgeSdkMessage(message, envelope)` returns one or more `AgentEvent`s. Unknown SDK messages return:

```typescript
{
  type: "sdkEvent",
  sdkType: message.type,
  payload: toPlainJson(message),
  ...envelope,
}
```

- [ ] **Step 5: Run bridge tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/sdk-event-bridge.ts desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
git commit -m "feat: add claude sdk event bridge"
```

---

### Task 6: Implement ClaudeSDKSession

**Files:**
- Create: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Create: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`

- [ ] **Step 1: Write failing session tests with fake SDK query**

Test:
- `send()` yields user messages into the async stream.
- `nextEvent()` returns bridged SDK messages.
- `cancelCurrentTurn()` calls `query.interrupt()`.
- `close()` calls `query.close()`.
- `canUseTool` produces a pending permission and resolves after `respondPermission()`.

Use dependency injection:

```typescript
type QueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
}) => QueryLike
```

- [ ] **Step 2: Run failing session tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: fails because `ClaudeSDKSession` does not exist.

- [ ] **Step 3: Implement the session wrapper**

Constructor input:

```typescript
interface ClaudeSDKSessionOptions {
  projectId: string
  conversationId: string
  providerId: string
  cwd: string
  sdkSessionId?: string
  env: Record<string, string>
  mode?: string
  model?: string
  maxTurns?: number
  abortSignal?: AbortSignal
  queryFactory?: QueryFactory
  now?: () => Date
}
```

The default `queryFactory` imports `query` from `@anthropic-ai/claude-agent-sdk`.

- [ ] **Step 4: Implement async input queue and permission waiters**

The async input generator yields:

```typescript
{
  type: "user",
  message: {
    role: "user",
    content: message.content,
  },
}
```

`canUseTool` creates a `permissionRequest` event and awaits `respondPermission()`.

- [ ] **Step 5: Run session tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/claude-sdk-session.ts desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts desktop/electron/services/agent-runtime/types.ts
git commit -m "feat: wrap claude agent sdk session"
```

---

### Task 7: Rewrite Runtime Routing

**Files:**
- Create: `desktop/electron/services/agent-runtime/session-manager.ts`
- Create: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Modify: `desktop/electron/services/agent-runtime/session-repository.ts`
- Modify: `desktop/electron/services/agent-runtime/session-lifecycle.ts`
- Delete: `desktop/electron/services/agent-runtime/message-router.ts`
- Delete: `desktop/electron/services/agent-runtime/adapters/`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

- [ ] **Step 1: Write routing tests**

Cover:
- new conversation binds active provider id.
- existing conversation keeps its original provider id.
- `ProviderService.buildEnv(providerId)` is passed to `ClaudeSDKSession`.
- governance block returns an error event.
- slash command routes before SDK send.
- `cancelTurn()` calls session interrupt first, then hard closes on force kill.

- [ ] **Step 2: Run failing routing tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: fails because old adapter/message-router paths are still active.

- [ ] **Step 3: Extend AgentSessionRepository**

Add provider/session fields to create/save paths:

```typescript
readonly providerId?: string
readonly sdkSessionId?: string
readonly usage?: ConversationEntryV1["usage"]
readonly costUsd?: number
```

Add methods:

```typescript
saveSdkSession(input: { conversationId: string; sdkSessionId: string }): Promise<ConversationEntryV1>
saveUsage(input: { conversationId: string; usage?: ConversationEntryV1["usage"]; costUsd?: number }): Promise<ConversationEntryV1>
```

- [ ] **Step 4: Implement SessionManager**

Responsibilities:
- create/reuse `ClaudeSDKSession` by conversation id.
- close idle sessions.
- close/delete state on session delete.
- provide `interrupt()` and `forceClose()`.

- [ ] **Step 5: Implement ConversationRouter**

Responsibilities:
- project mismatch guard.
- get/create conversation.
- provider binding.
- governance.
- slash command handling.
- send message to session.
- event dispatch to EventBus/outbox/replyTargets.
- history and `agent.events` persistence.
- scheduled/relay timeout handling with AbortController.

- [ ] **Step 6: Replace AgentRuntimeService wiring**

`AgentRuntimeService` should depend on `ProviderService`, `SessionManager`, and `ConversationRouter`; it should no longer accept or resolve `AgentAdapter`.

- [ ] **Step 7: Delete old adapter/message-router files**

```bash
rm -rf desktop/electron/services/agent-runtime/adapters
rm desktop/electron/services/agent-runtime/message-router.ts
rm desktop/electron/services/agent-runtime/__tests__/claude-code.test.ts
```

- [ ] **Step 8: Run routing tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add -A desktop/electron/services/agent-runtime
git commit -m "feat: route agent runtime through claude sdk sessions"
```

---

### Task 8: Replace Provider IPC And Runtime Status

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Modify: `desktop/electron/modules/agent/ipc-tools.ts`
- Modify: `desktop/electron/modules/agent/ipc-sessions.ts`
- Modify: `desktop/electron/modules/agent/ipc-messages.ts`
- Modify: `desktop/electron/modules/agent/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Regenerate: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write failing IPC tests**

Cover:
- `getProviders` returns provider summaries without secrets.
- `createSession` accepts optional `providerId`.
- `send` preserves conversation provider binding.
- `getRuntimeStatus` no longer reports `cli-not-installed` for missing system `claude`.

- [ ] **Step 2: Run failing IPC tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc.test.ts
```

Expected: fails while IPC still depends on `ProviderConfigService`.

- [ ] **Step 3: Replace `ProviderConfigService` resolution**

`resolveProjectAgent()` should return:

```typescript
{
  agent: AgentRuntimeService
  providerService: ProviderService
  project: { uuid: string; name: string; localPath: string }
}
```

- [ ] **Step 4: Add provider CRUD channels**

Add invoke channels for:

```typescript
listProviders
createProvider
updateProvider
archiveProvider
setActiveProvider
```

Do not return API key values.

- [ ] **Step 5: Regenerate IPC**

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

- [ ] **Step 6: Run IPC tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/agent/__tests__/ipc.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/agent desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts
git commit -m "feat: expose sdk provider ipc"
```

---

### Task 9: Update Renderer Event Types And Timeline

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/lib/agent-timeline.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-events.ts`
- Modify: `desktop/src/modules/agent/components/agent-timeline-item.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Write failing timeline tests**

Cover:
- `stream` text appends to the current assistant message.
- `assistant` content blocks render text.
- `sdkEvent` renders a compact generic row.
- `result.metadata.model`, usage, and cost update current model metadata.

- [ ] **Step 2: Run failing renderer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-timeline.test.tsx
```

Expected: fails because new event types are unknown.

- [ ] **Step 3: Extend renderer event and timeline types**

Add:

```typescript
type SynapseAgentEvent =
  | { type: "text"; content: string; agentSessionId?: string; threadId?: string }
  | { type: "thinking"; content: string; agentSessionId?: string; threadId?: string }
  | { type: "toolUse"; toolName: string; toolInput?: string; toolInputRaw?: Record<string, unknown>; agentSessionId?: string; threadId?: string }
  | { type: "toolResult"; toolName: string; content?: string; status?: string; exitCode?: number; success?: boolean; agentSessionId?: string; threadId?: string }
  | { type: "permissionRequest"; requestId: string; toolName: string; toolInput?: string; toolInputRaw?: Record<string, unknown>; agentSessionId?: string; threadId?: string }
  | { type: "result"; content: string; done: true; metadata?: Record<string, unknown>; agentSessionId?: string; threadId?: string }
  | { type: "error"; message: string; agentSessionId?: string; threadId?: string }
  | { type: "assistant"; contentBlocks: unknown[]; content?: string; sdkSessionId?: string }
  | { type: "stream"; deltaType: string; text?: string; sdkSessionId?: string }
  | { type: "sessionInit"; sdkSessionId: string; tools?: string[] }
  | { type: "status"; status: string; message?: string }
  | { type: "compactBoundary"; sdkSessionId?: string }
  | { type: "sdkEvent"; sdkType: string; payload: Record<string, unknown> }
```

- [ ] **Step 4: Update `appendAgentTimelineEvent`**

Map core SDK events to timeline items and map Meta events to a generic `sdkEvent`/system row.

- [ ] **Step 5: Run renderer tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-timeline.test.tsx src/modules/agent/__tests__/utils.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/agent.ts desktop/src/lib/agent-timeline.ts desktop/src/modules/agent
git commit -m "feat: render claude sdk agent events"
```

---

### Task 10: Add Provider UI

**Files:**
- Create: `desktop/src/modules/settings/components/provider-panel.tsx`
- Create: `desktop/src/modules/agent/components/provider-select-dialog.tsx`
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Modify: `desktop/src/modules/settings/components/tools-panel.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/settings/components/__tests__/tools-panel.test.tsx`
- Modify: `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Cover:
- Tools settings renders Provider management.
- Provider list does not show API key values.
- New conversation flow passes `providerId` to `bridge.agent.createSession`.
- Conversation header shows bound provider name/status.

- [ ] **Step 2: Run failing UI tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/components/__tests__/tools-panel.test.tsx src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: fails because UI does not exist.

- [ ] **Step 3: Implement ProviderPanel with existing shadcn components**

Use existing `Button`, `Input`, `Select`, `Dialog`, `Table` or existing list patterns. Use token classes only. Do not add custom colors, inline styles, nested cards, or explanatory copy.

Actions:
- list providers.
- create provider from preset/custom.
- edit name/baseUrl/model/env/key.
- archive provider.
- set active provider.

- [ ] **Step 4: Implement provider selection for new sessions**

When creating a session, default to active provider and allow choosing another provider before creation. Existing conversations have no provider switch.

- [ ] **Step 5: Run UI tests**

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/settings/components/__tests__/tools-panel.test.tsx src/modules/agent/__tests__/agent-session-sidebar.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/settings desktop/src/modules/agent desktop/src/types/bridge.ts
git commit -m "feat: add provider management ui"
```

---

### Task 11: Remove Old Provider Config

**Files:**
- Delete: `desktop/electron/services/provider-config/`
- Modify: all imports found by `rg "provider-config|ProviderConfigService|PROVIDER_CONFIG_SERVICE_ID" desktop`
- Modify: tests that still construct `ProviderConfigService`

- [ ] **Step 1: Delete old provider-config directory**

```bash
rm -rf desktop/electron/services/provider-config
```

- [ ] **Step 2: Find all remaining references**

```bash
rg -n "provider-config|ProviderConfigService|PROVIDER_CONFIG_SERVICE_ID|ProviderRuntimeView|ProviderConfigView" desktop
```

Expected: references remain only in this plan/spec or are gone.

- [ ] **Step 3: Replace test fixtures**

Tests that previously used `ProviderConfigService` should use `ProviderService` with memory namespaces for `providers` and `secrets`.

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A desktop
git commit -m "refactor: remove legacy provider config service"
```

---

### Task 12: Final Verification

**Files:**
- No new files unless previous tasks reveal test-only updates.

- [ ] **Step 1: Run hard constraints**

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: pass. In particular, no new bare `ipcMain.handle/on`, no runtime importing business services, no empty `catch {}`.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: pass.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @synapse/desktop run test
```

Expected: pass.

- [ ] **Step 4: Run build**

```bash
pnpm --filter @synapse/desktop run build
```

Expected: pass.

- [ ] **Step 5: Inspect deletion and dependency residue**

```bash
rg -n "ClaudeCodeAdapter|AgentAdapter|ClaudeProcessRunner|ProviderConfigService|provider-config|which claude|cli-not-installed" desktop/electron desktop/src
```

Expected: no production references to deleted adapter/provider-config/CLI checks. Test names or plan docs may mention them only if intentionally checking removal.

- [ ] **Step 6: Commit final cleanup if needed**

```bash
git add -A
git commit -m "test: verify claude sdk phase 2 migration"
```

Expected: create this commit only if Step 5 or final verification required changes.
