# Agent SDK Timeline Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent conversation UI consume Claude Agent SDK stream events correctly: thinking is expanded by default, stream deltas are lossless, final assistant text is reconciled once, and persisted history uses the canonical final answer.

**Architecture:** Keep the Electron bridge thin but SDK-aware: `sdk-event-bridge.ts` preserves raw SDK payloads and exposes stable fields for stream block index and delta content. Renderer timeline reduction consumes those stable fields with SDK block semantics instead of legacy suffix-based text merging. `conversation-router.ts` treats SDK `assistant` as the canonical assistant message and `result` as turn metadata with a fallback body only when no assistant message was emitted.

**Tech Stack:** Electron main process, Claude Agent SDK `SDKMessage` / `BetaRawMessageStreamEvent`, React renderer, TypeScript, Vitest.

---

## File Structure

- Modify `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
  - Normalize SDK `stream_event` into stable fields: `blockIndex`, `deltaType`, `text`, `thinking`, `partialJson`.
  - Normalize SDK `assistant` into `contentBlocks` while preserving raw `message` and `payload`.
- Modify `desktop/electron/services/agent-runtime/types.ts`
  - Extend `AgentStreamEvent` and `AgentAssistantEvent` with the stable fields emitted by the bridge.
- Modify `desktop/electron/modules/agent/ipc-shared.ts`
  - Extend the IPC schema so normalized stream and assistant fields survive main-to-renderer validation.
- Modify `desktop/src/types/agent.ts`
  - Mirror the normalized event fields in renderer bridge types if the renderer type is not generated from IPC.
- Modify `desktop/src/lib/agent-timeline.ts`
  - Replace suffix-based stream merging with SDK-aware timeline reduction.
  - Append stream deltas exactly.
  - Merge thinking deltas into one thinking item per active thinking block.
  - Reconcile final `assistant` over streamed assistant drafts.
  - Merge `result` metadata into the latest assistant message without rendering a duplicate body.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Track latest canonical assistant text during a turn.
  - Use `assistant` text first, then fall back to `result.content`.
  - Persist one final assistant message per turn.
- Modify `desktop/src/definitions/agent/claude-code/agent-shared.ts`
  - Set Claude Code thinking display to expanded by default.
- Modify `desktop/src/modules/agent/index.tsx`
  - Set the local fallback display profile to expanded thinking by default.
- Test files:
  - `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`
  - `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`
  - `desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx`
  - `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`

Do not start the dev server, open the app, use browser automation, or inspect the running UI. Verify through source-level tests and typecheck.

---

### Task 1: Normalize SDK Stream Events at the Bridge

**Files:**
- Modify: `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`
- Modify: `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`
- Modify: `desktop/src/types/agent.ts`

- [ ] **Step 1: Write failing bridge tests for SDK partial stream fields**

Add these tests to `desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts`:

```ts
it("normalizes SDK text deltas without losing raw payload", () => {
  expect(bridgeSdkMessage({
    type: "stream_event",
    session_id: "sdk-1",
    uuid: "uuid-1",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "lo" },
    },
  } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
    type: "stream",
    sdkSessionId: "sdk-1",
    blockIndex: 0,
    deltaType: "text_delta",
    text: "lo",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "lo" },
    },
    ...baseEnvelope,
  })
})

it("normalizes SDK thinking deltas", () => {
  expect(bridgeSdkMessage({
    type: "stream_event",
    session_id: "sdk-1",
    uuid: "uuid-2",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "I should answer briefly." },
    },
  } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
    type: "stream",
    blockIndex: 1,
    deltaType: "thinking_delta",
    thinking: "I should answer briefly.",
    ...baseEnvelope,
  })
})

it("normalizes SDK tool input JSON deltas", () => {
  expect(bridgeSdkMessage({
    type: "stream_event",
    session_id: "sdk-1",
    uuid: "uuid-3",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 2,
      delta: { type: "input_json_delta", partial_json: "{\"cmd\"" },
    },
  } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
    type: "stream",
    blockIndex: 2,
    deltaType: "input_json_delta",
    partialJson: "{\"cmd\"",
    ...baseEnvelope,
  })
})

it("exposes assistant content blocks for final reconciliation", () => {
  expect(bridgeSdkMessage({
    type: "assistant",
    session_id: "sdk-1",
    uuid: "uuid-4",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "summary", signature: "sig" },
        { type: "text", text: "final answer" },
      ],
    },
  } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
    type: "assistant",
    sdkSessionId: "sdk-1",
    contentBlocks: [
      { type: "thinking", thinking: "summary", signature: "sig" },
      { type: "text", text: "final answer" },
    ],
    ...baseEnvelope,
  })
})
```

- [ ] **Step 2: Run the bridge tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
```

Expected: tests fail because `blockIndex`, `thinking`, `partialJson`, and `contentBlocks` are not emitted or not accepted by schemas.

- [ ] **Step 3: Extend main-process event types**

Update `desktop/electron/services/agent-runtime/types.ts`:

```ts
export interface AgentAssistantEvent extends AgentEventBase {
  readonly type: "assistant"
  readonly message: Record<string, unknown>
  readonly contentBlocks?: readonly unknown[]
  readonly content?: string
  readonly payload?: Record<string, unknown>
}

export interface AgentStreamEvent extends AgentEventBase {
  readonly type: "stream"
  readonly event: Record<string, unknown>
  readonly blockIndex?: number
  readonly deltaType?: string
  readonly text?: string
  readonly thinking?: string
  readonly partialJson?: string
  readonly payload?: Record<string, unknown>
}
```

- [ ] **Step 4: Extend IPC event schema**

Update `desktop/electron/modules/agent/ipc-shared.ts` assistant and stream schema branches:

```ts
z.object({
  ...agentEventBaseSchema,
  type: z.literal("assistant"),
  contentBlocks: z.array(z.unknown()).optional(),
  content: z.string().optional(),
  message: jsonRecordSchema.optional(),
}),
z.object({
  ...agentEventBaseSchema,
  type: z.literal("stream"),
  blockIndex: z.number().optional(),
  deltaType: z.string().optional(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  partialJson: z.string().optional(),
  event: jsonRecordSchema.optional(),
}),
```

- [ ] **Step 5: Extend renderer event types**

If `desktop/src/types/agent.ts` defines `SynapseAgentStreamEvent` and `SynapseAgentAssistantEvent`, update them to match:

```ts
export interface SynapseAgentAssistantEvent extends SynapseAgentEventBase {
  readonly type: "assistant"
  readonly message?: Record<string, unknown>
  readonly contentBlocks?: readonly unknown[]
  readonly content?: string
  readonly payload?: Record<string, unknown>
}

export interface SynapseAgentStreamEvent extends SynapseAgentEventBase {
  readonly type: "stream"
  readonly event?: Record<string, unknown>
  readonly blockIndex?: number
  readonly deltaType?: string
  readonly text?: string
  readonly thinking?: string
  readonly partialJson?: string
  readonly payload?: Record<string, unknown>
}
```

- [ ] **Step 6: Implement bridge normalization**

In `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`, add helpers:

```ts
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function streamDeltaFields(event: Record<string, unknown>): {
  readonly blockIndex?: number
  readonly deltaType?: string
  readonly text?: string
  readonly thinking?: string
  readonly partialJson?: string
} {
  const delta = recordValue(event.delta)
  const deltaType = stringValue(delta?.type)
  return {
    blockIndex: numberValue(event.index),
    deltaType,
    text: deltaType === "text_delta" ? stringValue(delta?.text) : undefined,
    thinking: deltaType === "thinking_delta" ? stringValue(delta?.thinking) : undefined,
    partialJson: deltaType === "input_json_delta" ? stringValue(delta?.partial_json) : undefined,
  }
}
```

Update the `assistant` branch:

```ts
if (raw.type === "assistant") {
  const message = recordValue(raw.message) ?? {}
  return {
    type: "assistant",
    sdkSessionId,
    message,
    contentBlocks: Array.isArray(message.content) ? message.content : undefined,
    payload,
    ...envelope,
  }
}
```

Update the `stream_event` branch:

```ts
if (raw.type === "stream_event") {
  const event = recordValue(raw.event) ?? {}
  return {
    type: "stream",
    sdkSessionId,
    event,
    ...streamDeltaFields(event),
    payload,
    ...envelope,
  }
}
```

- [ ] **Step 7: Run the bridge tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts
```

Expected: all tests in `sdk-event-bridge.test.ts` pass.

- [ ] **Step 8: Commit Task 1**

```bash
git add desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts desktop/electron/services/agent-runtime/sdk-event-bridge.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/modules/agent/ipc-shared.ts desktop/src/types/agent.ts
git commit -m "fix(agent): normalize sdk stream event fields"
```

---

### Task 2: Replace Legacy Timeline Merging with SDK-Aware Reduction

**Files:**
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`
- Modify: `desktop/src/lib/agent-timeline.ts`

- [ ] **Step 1: Write failing timeline tests for lossless text deltas**

Add this test to `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`:

```ts
it("appends SDK text deltas exactly without suffix dedupe", () => {
  const first = appendAgentTimelineEvent([], {
    type: "stream",
    blockIndex: 0,
    deltaType: "text_delta",
    text: "lo",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
  }, "2026-05-13T00:00:00.000Z", "claude")
  const second = appendAgentTimelineEvent(first, {
    type: "stream",
    blockIndex: 0,
    deltaType: "text_delta",
    text: "o",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "o" } },
  }, "2026-05-13T00:00:01.000Z", "claude")
  const third = appendAgentTimelineEvent(second, {
    type: "stream",
    blockIndex: 0,
    deltaType: "text_delta",
    text: " ",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " " } },
  }, "2026-05-13T00:00:02.000Z", "claude")

  expect(third.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
    expect.objectContaining({ content: "loo " }),
  ])
})
```

- [ ] **Step 2: Write failing timeline tests for thinking deltas**

Add:

```ts
it("appends SDK thinking deltas exactly into one thinking item", () => {
  const first = appendAgentTimelineEvent([], {
    type: "stream",
    blockIndex: 1,
    deltaType: "thinking_delta",
    thinking: "The user says ",
    event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "The user says " } },
  }, "2026-05-13T00:01:00.000Z", "claude")
  const second = appendAgentTimelineEvent(first, {
    type: "stream",
    blockIndex: 1,
    deltaType: "thinking_delta",
    thinking: "hello.",
    event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "hello." } },
  }, "2026-05-13T00:01:01.000Z", "claude")

  expect(second.filter((item) => item.kind === "thinking")).toEqual([
    expect.objectContaining({ content: "The user says hello." }),
  ])
})
```

- [ ] **Step 3: Write failing tests for assistant/result reconciliation**

Add:

```ts
it("replaces streamed assistant draft with final assistant content across thinking items", () => {
  const streamed = appendAgentTimelineEvent([], {
    type: "stream",
    blockIndex: 0,
    deltaType: "text_delta",
    text: "你好可以你的?",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好可以你的?" } },
  }, "2026-05-13T00:02:00.000Z", "claude")
  const withThinking = appendAgentTimelineEvent(streamed, {
    type: "stream",
    blockIndex: 1,
    deltaType: "thinking_delta",
    thinking: "Respond naturally.",
    event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Respond naturally." } },
  }, "2026-05-13T00:02:01.000Z", "claude")
  const final = appendAgentTimelineEvent(withThinking, {
    type: "assistant",
    contentBlocks: [
      { type: "thinking", thinking: "Respond naturally.", signature: "sig" },
      { type: "text", text: "你好！有什么可以帮助你的吗？" },
    ],
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Respond naturally.", signature: "sig" },
        { type: "text", text: "你好！有什么可以帮助你的吗？" },
      ],
    },
  }, "2026-05-13T00:02:02.000Z", "claude")

  expect(final.filter((item) => item.kind === "message" && item.role === "assistant")).toEqual([
    expect.objectContaining({ content: "你好！有什么可以帮助你的吗？" }),
  ])
})

it("treats result content as metadata when an assistant message already exists", () => {
  const withAssistant = appendAgentTimelineEvent([], {
    type: "assistant",
    contentBlocks: [{ type: "text", text: "final answer" }],
    message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
  }, "2026-05-13T00:03:00.000Z", "claude")
  const withResult = appendAgentTimelineEvent(withAssistant, {
    type: "result",
    content: "final answer",
    done: true,
    metadata: { model: "claude-sonnet-4-5" },
  }, "2026-05-13T00:03:01.000Z", "claude")

  expect(withResult.filter((item) => item.kind === "message" && item.role === "assistant")).toHaveLength(1)
  expect(withResult[0]).toEqual(expect.objectContaining({
    content: "final answer",
    metadata: expect.objectContaining({ model: "claude-sonnet-4-5" }),
  }))
})
```

- [ ] **Step 4: Run the timeline tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-timeline.test.tsx
```

Expected: tests fail because suffix dedupe drops repeated short deltas and `result` can still render duplicate visible messages.

- [ ] **Step 5: Implement SDK-aware stream extraction**

Update `desktop/src/lib/agent-timeline.ts`:

```ts
function streamText(event: Extract<SynapseAgentEvent, { type: "stream" }>): string {
  if (typeof event.text === "string") return event.text
  const rawEvent = event.event
  const delta = recordValue(rawEvent?.delta)
  if (stringValue(delta?.type) === "text_delta") return stringValue(delta?.text) ?? ""
  return ""
}

function streamThinking(event: Extract<SynapseAgentEvent, { type: "stream" }>): string {
  if (typeof event.thinking === "string") return event.thinking
  const delta = recordValue(event.event?.delta)
  if (stringValue(delta?.type) === "thinking_delta") return stringValue(delta?.thinking) ?? ""
  return ""
}

function streamKind(event: Extract<SynapseAgentEvent, { type: "stream" }>): "text" | "thinking" | "other" {
  if (event.deltaType === "text_delta" || streamText(event).length > 0) return "text"
  if (event.deltaType === "thinking_delta" || streamThinking(event).length > 0) return "thinking"
  return "other"
}
```

- [ ] **Step 6: Replace suffix-based stream merging**

In `appendAgentTimelineEvent`, replace the current stream/text merge branches with exact append branches:

```ts
if (event.type === "stream") {
  const kind = streamKind(event)
  if (kind === "text" && item.kind === "message") {
    const assistantIndex = latestAssistantDraftIndex(current)
    if (assistantIndex !== -1) {
      const assistant = current[assistantIndex]
      if (assistant.kind === "message" && assistant.role === "assistant") {
        return [
          ...current.slice(0, assistantIndex),
          { ...assistant, content: `${assistant.content}${item.content}`, timestamp },
          ...current.slice(assistantIndex + 1),
        ]
      }
    }
    return [...current, item]
  }

  if (kind === "thinking" && item.kind === "thinking") {
    const thinkingIndex = latestThinkingDraftIndex(current)
    if (thinkingIndex !== -1) {
      const thinking = current[thinkingIndex]
      if (thinking.kind === "thinking") {
        return [
          ...current.slice(0, thinkingIndex),
          { ...thinking, content: `${thinking.content}${item.content}`, timestamp },
          ...current.slice(thinkingIndex + 1),
        ]
      }
    }
    return [...current, item]
  }

  return [...current]
}

if (event.type === "text" && item.kind === "message" && last?.kind === "message" && last.role === "assistant") {
  return [...current.slice(0, -1), { ...last, content: `${last.content}${item.content}`, timestamp }]
}
```

Add these helpers near `latestAssistantMessageIndex`:

```ts
function latestAssistantDraftIndex(items: readonly SynapseAgentTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "message" && item.role === "assistant" && isStreamedAssistantDraft(item)) return index
    if (item?.kind === "message" && item.role === "user") return -1
  }
  return -1
}

function latestThinkingDraftIndex(items: readonly SynapseAgentTimelineItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "thinking" && item.id.includes(":stream:")) return index
    if (item?.kind === "message" && item.role === "user") return -1
  }
  return -1
}
```

- [ ] **Step 7: Make assistant reconciliation authoritative**

Update the `assistant` branch in `appendAgentTimelineEvent` so final assistant content replaces any latest streamed assistant draft even when thinking or SDK event rows sit between them:

```ts
if (event.type === "assistant" && item.kind === "message") {
  const assistantIndex = latestAssistantDraftIndex(current)
  if (assistantIndex !== -1) {
    const assistant = current[assistantIndex]
    if (assistant.kind === "message" && assistant.role === "assistant") {
      return [
        ...current.slice(0, assistantIndex),
        { ...assistant, content: item.content, timestamp },
        ...current.slice(assistantIndex + 1),
      ]
    }
  }
  const latestAssistantIndex = latestAssistantMessageIndex(current)
  const latestAssistant = latestAssistantIndex === -1 ? undefined : current[latestAssistantIndex]
  if (latestAssistant?.kind === "message" && latestAssistant.role === "assistant" && latestAssistant.content === item.content) {
    return [...current]
  }
  return [...current, item]
}
```

- [ ] **Step 8: Make result metadata-only after assistant**

Update the `result` branch so it never adds a duplicate visible message when an assistant message exists after the latest user message:

```ts
if (event.type === "result") {
  const assistantIndex = latestAssistantMessageIndex(current)
  const assistant = assistantIndex === -1 ? undefined : current[assistantIndex]
  const metadata = resultMetadata(event)
  if (assistant?.kind === "message" && assistant.role === "assistant") {
    return metadata
      ? [
          ...current.slice(0, assistantIndex),
          { ...assistant, metadata, timestamp },
          ...current.slice(assistantIndex + 1),
        ]
      : [...current]
  }
}
```

Keep the existing standalone `result` fallback after this branch so background relays and legacy records still show a message when no assistant event exists.

- [ ] **Step 9: Run timeline tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-timeline.test.tsx src/lib/__tests__/agent-timeline.test.ts
```

Expected: all timeline tests pass.

- [ ] **Step 10: Commit Task 2**

```bash
git add desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx desktop/src/lib/agent-timeline.ts
git commit -m "fix(agent): reduce sdk stream events losslessly"
```

---

### Task 3: Persist the Canonical SDK Assistant Result Once

**Files:**
- Modify: `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`

- [ ] **Step 1: Write failing runtime test for assistant-first canonical text**

In `desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts`, add a test using the existing fake live session pattern in that file. The fake session must emit:

```ts
[
  {
    type: "assistant",
    contentBlocks: [{ type: "text", text: "你好！有什么可以帮助你的吗？" }],
    message: {
      role: "assistant",
      content: [{ type: "text", text: "你好！有什么可以帮助你的吗？" }],
    },
    sdkSessionId: "sdk-1",
  },
  {
    type: "result",
    content: "你好可以你的?",
    done: true,
    metadata: { model: "claude-sonnet-4-5" },
    sdkSessionId: "sdk-1",
  },
]
```

Assert:

```ts
expect(result.resultText).toBe("你好！有什么可以帮助你的吗？")
expect(savedConversation.history.filter((entry) => entry.role === "assistant")).toEqual([
  expect.objectContaining({ content: "你好！有什么可以帮助你的吗？" }),
])
```

- [ ] **Step 2: Write failing runtime test for result fallback**

Add another test where the fake live session emits only:

```ts
[
  {
    type: "result",
    content: "fallback answer",
    done: true,
    sdkSessionId: "sdk-1",
  },
]
```

Assert:

```ts
expect(result.resultText).toBe("fallback answer")
expect(savedConversation.history.filter((entry) => entry.role === "assistant")).toEqual([
  expect.objectContaining({ content: "fallback answer" }),
])
```

- [ ] **Step 3: Run conversation-router tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: the assistant-first test fails because `processLiveTurn` currently sets `resultText` from `result.content`.

- [ ] **Step 4: Add assistant text extraction helpers**

In `desktop/electron/services/agent-runtime/conversation-router.ts`, add these helpers near `appendRelayText`:

```ts
function assistantEventText(event: AgentEvent): string | undefined {
  if (event.type !== "assistant") return undefined
  const blocks = Array.isArray(event.contentBlocks)
    ? event.contentBlocks
    : Array.isArray(event.message.content)
      ? event.message.content
      : undefined
  const text = textFromBlocks(blocks)
  return text.trim().length > 0 ? text : undefined
}

function textFromBlocks(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return ""
  return blocks.map((block) => {
    if (typeof block === "string") return block
    if (!isRecord(block)) return ""
    return typeof block.text === "string" ? block.text : ""
  }).join("")
}
```

- [ ] **Step 5: Track latest assistant text in `processLiveTurn`**

Update `processLiveTurn`:

```ts
let resultText = ""
let latestAssistantText = ""
let error: string | undefined
```

Inside the event loop before the `permissionRequest` branch:

```ts
const assistantText = assistantEventText(event)
if (assistantText) latestAssistantText = assistantText
```

Update the result branch:

```ts
if (event.type === "result") {
  resultText = latestAssistantText || event.content
  await this.repository.saveUsage({
    conversationId: conversation.id,
    usage: event.usage as ConversationEntryV1["usage"] | undefined,
    costUsd: event.costUsd,
  })
  break
}
```

- [ ] **Step 6: Track latest assistant text in side sessions**

Update `processSideSessionWithTimeout` the same way:

```ts
let latestAssistantText = ""
```

Inside its event loop:

```ts
const assistantText = assistantEventText(event)
if (assistantText) latestAssistantText = assistantText
```

Update its result branch:

```ts
if (event.type === "result") {
  resultText = latestAssistantText || event.content
  partialText = resultText || partialText
  break
}
```

- [ ] **Step 7: Update relay text extraction**

Update `appendRelayText`:

```ts
function appendRelayText(current: string, event: AgentEvent): string {
  if (event.type === "assistant") return assistantEventText(event) ?? current
  if (event.type === "text") return `${current}${event.content}`
  if (event.type === "result") return current || event.content
  if (event.type === "error" && !current) return event.message
  return current
}
```

- [ ] **Step 8: Run conversation-router tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/conversation-router.test.ts
```

Expected: all conversation router tests pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts desktop/electron/services/agent-runtime/conversation-router.ts
git commit -m "fix(agent): persist canonical sdk assistant text"
```

---

### Task 4: Expand Claude Code Thinking by Default

**Files:**
- Modify: `desktop/src/definitions/agent/claude-code/agent-shared.ts`
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx`

- [ ] **Step 1: Add a test that Claude Code thinking is expanded**

Add to `desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx`:

```ts
it("renders thinking content when the profile defaults to expanded", () => {
  const html = renderToStaticMarkup(<AgentThinkingEvent
    item={{
      id: "thinking-expanded",
      kind: "thinking",
      timestamp: "2026-05-13T00:00:00.000Z",
      content: "visible thinking",
    }}
    profile={{ ...profile, thinkingDefaultCollapsed: false }}
  />)

  expect(html).toContain("visible thinking")
})
```

- [ ] **Step 2: Run the thinking event test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-thinking-event.test.tsx
```

Expected: test passes already if the component supports expanded profiles. This test locks the intended behavior before changing the default profile.

- [ ] **Step 3: Update Claude Code display profile**

In `desktop/src/definitions/agent/claude-code/agent-shared.ts`:

```ts
displayProfile: {
  agentLabel: "Claude Code",
  thinkingDefaultCollapsed: false,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
```

- [ ] **Step 4: Update fallback display profile**

In `desktop/src/modules/agent/index.tsx`:

```ts
const DEFAULT_AGENT_DISPLAY_PROFILE: SynapseAgentDisplayProfile = {
  agentLabel: "Agent",
  thinkingDefaultCollapsed: false,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
```

- [ ] **Step 5: Run profile-related tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-thinking-event.test.tsx src/modules/agent/components/__tests__/agent-timeline.test.tsx src/modules/agent/__tests__/agent-message-row.test.tsx
```

Expected: all tests pass. If a test constructs a mock profile with `thinkingDefaultCollapsed: true`, leave it as-is when it is testing the collapsed path explicitly.

- [ ] **Step 6: Commit Task 4**

```bash
git add desktop/src/definitions/agent/claude-code/agent-shared.ts desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx
git commit -m "fix(agent): expand claude code thinking by default"
```

---

### Task 5: Final Verification

**Files:**
- Review: `desktop/electron/services/agent-runtime/sdk-event-bridge.ts`
- Review: `desktop/src/lib/agent-timeline.ts`
- Review: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Review: `desktop/src/definitions/agent/claude-code/agent-shared.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts electron/services/agent-runtime/__tests__/conversation-router.test.ts src/modules/agent/components/__tests__/agent-timeline.test.tsx src/lib/__tests__/agent-timeline.test.ts src/modules/agent/components/__tests__/agent-thinking-event.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: `tsc` completes with no errors.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: hard-constraint script completes with no violations.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff -- desktop/electron/services/agent-runtime/sdk-event-bridge.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/modules/agent/ipc-shared.ts desktop/src/types/agent.ts desktop/src/lib/agent-timeline.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/src/definitions/agent/claude-code/agent-shared.ts desktop/src/modules/agent/index.tsx
```

Expected:
- Stream deltas append exactly.
- No suffix-based dedupe applies to SDK stream deltas.
- `assistant` is canonical for final text.
- `result` only supplies metadata when an assistant message exists.
- Claude Code thinking defaults to expanded.

- [ ] **Step 5: Commit final verification**

If Tasks 1-4 were not committed separately, commit the complete focused diff:

```bash
git add desktop/electron/services/agent-runtime/__tests__/sdk-event-bridge.test.ts desktop/electron/services/agent-runtime/sdk-event-bridge.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/modules/agent/ipc-shared.ts desktop/src/types/agent.ts desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx desktop/src/lib/agent-timeline.ts desktop/electron/services/agent-runtime/__tests__/conversation-router.test.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/src/definitions/agent/claude-code/agent-shared.ts desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx
git commit -m "fix(agent): align timeline rendering with claude sdk events"
```

---

## Self-Review

**Spec coverage:** The plan covers default-expanded thinking, lossless SDK stream deltas, final assistant reconciliation, duplicate result prevention, canonical history persistence, IPC/schema typing, and source-level verification.

**Placeholder scan:** No steps depend on unspecified behavior. Each task names exact files, test commands, and concrete implementation snippets.

**Type consistency:** Normalized fields are named consistently across bridge, main event types, IPC schema, renderer event types, and timeline reducer: `blockIndex`, `deltaType`, `text`, `thinking`, `partialJson`, `contentBlocks`.

