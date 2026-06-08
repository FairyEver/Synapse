# Agent Conversation Rollover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-output Agent timeline prompt that encourages users to start a fresh conversation after the current one crosses the long-conversation cost threshold.

**Architecture:** Keep the feature renderer-only. A focused utility evaluates cost/token thresholds, a small prompt component renders the action row, `AgentTimeline` decides whether the latest completed assistant message qualifies, and `AgentModule` reuses the existing `chat.createSession` path with the selected session's project, provider, permission mode, and model tier.

**Tech Stack:** Electron renderer, React 19, TypeScript, Tailwind CSS token classes, shadcn/ui Button, lucide-react, Vitest/jsdom.

---

## File Structure

- Create `desktop/src/modules/agent/utils/conversation-rollover.ts`
  - Threshold constants and pure metadata evaluation.
  - No React, no bridge calls, no UI text.

- Create `desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts`
  - Unit coverage for cost-first and token-fallback behavior.

- Create `desktop/src/modules/agent/components/agent-conversation-rollover-prompt.tsx`
  - Small presentational component using shadcn `Button` and lucide icon.
  - Receives `disabled` and `onStartNewConversation`.

- Create `desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx`
  - Render and click behavior for the prompt.

- Modify `desktop/src/modules/agent/components/agent-message-event.tsx`
  - Accept prompt props and render the prompt after `AgentUsageCard`, before the hover toolbar.

- Modify `desktop/src/modules/agent/components/agent-timeline-item.tsx`
  - Pass prompt props through to `AgentMessageEvent` only for the qualifying assistant message.

- Modify `desktop/src/modules/agent/components/agent-timeline.tsx`
  - Compute whether the latest visible item is a completed assistant message over threshold.
  - Do not show while `sending` is true.

- Modify `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`
  - Verify render gating: latest completed assistant only, not sending, not streaming, not historical.

- Modify `desktop/src/modules/agent/index.tsx`
  - Provide the action handler that creates a new session with current project/provider/mode/model tier.
  - Pass the handler into `AgentTimeline`.

- Modify `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`
  - Add coverage that `createSession` forwards explicit `modelTier` alongside provider and mode.

- Modify `RELEASE_NOTES_PENDING.md`
  - Add the user-visible release note under `## 功能优化`.

---

### Task 1: Threshold Utility

**Files:**
- Create: `desktop/src/modules/agent/utils/conversation-rollover.ts`
- Create: `desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
  CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
  conversationRolloverTotalTokens,
  shouldShowConversationRolloverPrompt,
} from "../conversation-rollover"

describe("conversation rollover threshold", () => {
  it("shows when cumulative CNY cost reaches the threshold", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
      usage: {
        inputTokens: 1,
      },
    })).toBe(true)
  })

  it("does not show below the cumulative CNY cost threshold", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY - 0.01,
      usage: {
        inputTokens: CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD + 1,
      },
    })).toBe(false)
  })

  it("uses token fallback when cost is unavailable", () => {
    expect(shouldShowConversationRolloverPrompt({
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 3_000_000,
        cache_creation_input_tokens: 400_000,
        reasoning_output_tokens: 100_000,
      },
    })).toBe(true)
  })

  it("does not use token fallback when known cost is low", () => {
    expect(shouldShowConversationRolloverPrompt({
      totalCostCny: 1,
      usage: {
        inputTokens: CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
      },
    })).toBe(false)
  })

  it("sums known cumulative token fields and falls back to totalTokens when components are absent", () => {
    expect(conversationRolloverTotalTokens({
      inputTokens: 2,
      outputTokens: 3,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 7,
      reasoningOutputTokens: 11,
      totalTokens: 999,
    })).toBe(28)

    expect(conversationRolloverTotalTokens({
      total_tokens: 123,
    })).toBe(123)
  })

  it("does not show when neither cost nor usage is available", () => {
    expect(shouldShowConversationRolloverPrompt(undefined)).toBe(false)
    expect(shouldShowConversationRolloverPrompt({})).toBe(false)
  })
})
```

- [ ] **Step 2: Run the failing utility tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts
```

Expected: FAIL because `../conversation-rollover` does not exist.

- [ ] **Step 3: Implement the threshold utility**

Create `desktop/src/modules/agent/utils/conversation-rollover.ts`:

```ts
const CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY = 10
const CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD = 5_000_000

interface ConversationRolloverMetadata {
  readonly totalCostCny?: number
  readonly usage?: Record<string, unknown>
}

const COMPONENT_TOKEN_FIELDS = [
  ["inputTokens", "input_tokens"],
  ["outputTokens", "output_tokens"],
  ["cacheReadInputTokens", "cache_read_input_tokens"],
  ["cacheCreationInputTokens", "cache_creation_input_tokens"],
  ["reasoningOutputTokens", "reasoning_output_tokens"],
] as const

function shouldShowConversationRolloverPrompt(metadata: ConversationRolloverMetadata | undefined): boolean {
  if (!metadata) return false
  if (isFiniteNumber(metadata.totalCostCny)) {
    return metadata.totalCostCny >= CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY
  }
  return conversationRolloverTotalTokens(metadata.usage) >= CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD
}

function conversationRolloverTotalTokens(usage: Record<string, unknown> | undefined): number {
  if (!usage) return 0
  const componentTotal = COMPONENT_TOKEN_FIELDS.reduce((total, fields) => {
    return total + numericUsageField(usage, fields)
  }, 0)
  if (componentTotal > 0) return componentTotal
  return numericUsageField(usage, ["totalTokens", "total_tokens"])
}

function numericUsageField(
  usage: Record<string, unknown>,
  fields: readonly string[],
): number {
  for (const field of fields) {
    const value = usage[field]
    if (isFiniteNumber(value) && value > 0) return value
  }
  return 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export {
  CONVERSATION_ROLLOVER_COST_THRESHOLD_CNY,
  CONVERSATION_ROLLOVER_TOKEN_FALLBACK_THRESHOLD,
  conversationRolloverTotalTokens,
  shouldShowConversationRolloverPrompt,
}
export type { ConversationRolloverMetadata }
```

- [ ] **Step 4: Run the utility tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add desktop/src/modules/agent/utils/conversation-rollover.ts desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts
git commit -m "feat(agent): add conversation rollover threshold utility"
```

---

### Task 2: Rollover Prompt Component

**Files:**
- Create: `desktop/src/modules/agent/components/agent-conversation-rollover-prompt.tsx`
- Create: `desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentConversationRolloverPrompt } from "../agent-conversation-rollover-prompt"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentConversationRolloverPrompt", () => {
  it("renders concise long-conversation copy and the start action", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          disabled={false}
          onStartNewConversation={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("这个对话已经很长")
    expect(container.textContent).toContain("新对话会保留当前项目和模型。")
    expect(container.textContent).toContain("开始新对话")
    expect(container.querySelector("button")?.getAttribute("disabled")).toBeNull()
  })

  it("calls onStartNewConversation when the button is clicked", async () => {
    const onStartNewConversation = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          disabled={false}
          onStartNewConversation={onStartNewConversation}
        />,
      )
    })

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onStartNewConversation).toHaveBeenCalledTimes(1)
  })

  it("disables the action while unavailable", async () => {
    const onStartNewConversation = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          disabled
          onStartNewConversation={onStartNewConversation}
        />,
      )
    })

    const button = container.querySelector("button")
    expect(button?.getAttribute("disabled")).toBe("")
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onStartNewConversation).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the failing component tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx
```

Expected: FAIL because `../agent-conversation-rollover-prompt` does not exist.

- [ ] **Step 3: Implement the prompt component**

Create `desktop/src/modules/agent/components/agent-conversation-rollover-prompt.tsx`:

```tsx
import { MessageSquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AgentConversationRolloverPromptProps {
  readonly disabled: boolean
  readonly onStartNewConversation: () => void
}

function AgentConversationRolloverPrompt({
  disabled,
  onStartNewConversation,
}: AgentConversationRolloverPromptProps) {
  return (
    <div className="mt-2 flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">这个对话已经很长</div>
        <div className="text-xs text-muted-foreground">新对话会保留当前项目和模型。</div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={disabled}
        onClick={onStartNewConversation}
        className="shrink-0"
      >
        <MessageSquarePlus data-icon="inline-start" />
        开始新对话
      </Button>
    </div>
  )
}

export { AgentConversationRolloverPrompt }
export type { AgentConversationRolloverPromptProps }
```

- [ ] **Step 4: Run the component tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add desktop/src/modules/agent/components/agent-conversation-rollover-prompt.tsx desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx
git commit -m "feat(agent): add conversation rollover prompt component"
```

---

### Task 3: Timeline Rendering Gate

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Modify: `desktop/src/modules/agent/components/agent-timeline-item.tsx`
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Add failing timeline tests**

Append these tests inside the existing `describe("AgentTimeline", () => { ... })` block in `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`:

```tsx
  it("renders the rollover prompt after the latest completed assistant message over the cost threshold", () => {
    const html = renderTimeline({
      onStartNewConversation: vi.fn(),
      items: [
        {
          id: "assistant-expensive",
          kind: "message",
          role: "assistant",
          content: "done",
          timestamp: "2026-06-08T10:00:00.000Z",
          metadata: {
            usage: {
              inputTokens: 100,
              outputTokens: 20,
            },
            totalCostCny: 10,
          },
        },
      ],
    })

    expect(textFromMarkup(html)).toContain("这个对话已经很长")
    expect(textFromMarkup(html)).toContain("开始新对话")
  })

  it("does not render the rollover prompt while the conversation is sending", () => {
    const html = renderTimeline({
      sending: true,
      onStartNewConversation: vi.fn(),
      items: [
        {
          id: "assistant-expensive",
          kind: "message",
          role: "assistant",
          content: "done",
          timestamp: "2026-06-08T10:00:00.000Z",
          metadata: {
            usage: {
              inputTokens: 100,
            },
            totalCostCny: 10,
          },
        },
      ],
    })

    expect(textFromMarkup(html)).not.toContain("这个对话已经很长")
  })

  it("does not render the rollover prompt for a streaming assistant message", () => {
    const html = renderTimeline({
      onStartNewConversation: vi.fn(),
      items: [
        {
          id: "assistant-streaming",
          kind: "message",
          role: "assistant",
          content: "still running",
          streaming: true,
          timestamp: "2026-06-08T10:00:00.000Z",
          metadata: {
            usage: {
              inputTokens: 100,
            },
            totalCostCny: 10,
          },
        },
      ],
    })

    expect(textFromMarkup(html)).not.toContain("这个对话已经很长")
  })

  it("does not render the rollover prompt on a historical assistant message", () => {
    const html = renderTimeline({
      onStartNewConversation: vi.fn(),
      items: [
        {
          id: "assistant-expensive",
          kind: "message",
          role: "assistant",
          content: "old answer",
          timestamp: "2026-06-08T10:00:00.000Z",
          metadata: {
            usage: {
              inputTokens: 100,
            },
            totalCostCny: 10,
          },
        },
        {
          id: "user-next",
          kind: "message",
          role: "user",
          content: "next question",
          timestamp: "2026-06-08T10:01:00.000Z",
        },
      ],
    })

    expect(textFromMarkup(html)).not.toContain("这个对话已经很长")
  })
```

- [ ] **Step 2: Run the failing timeline tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
```

Expected: FAIL because `AgentTimeline` has no `onStartNewConversation` prop and does not render the prompt.

- [ ] **Step 3: Modify `AgentMessageEvent` to render an optional prompt**

In `desktop/src/modules/agent/components/agent-message-event.tsx`, add the import:

```tsx
import { AgentConversationRolloverPrompt } from "./agent-conversation-rollover-prompt"
```

Update `AgentMessageEventProps`:

```tsx
interface AgentMessageEventProps {
  readonly item: SynapseAgentMessageTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly onOpenReference: (reference: string) => void
  readonly showConversationRolloverPrompt?: boolean
  readonly conversationRolloverPromptDisabled?: boolean
  readonly onStartNewConversation?: () => void
}
```

Thread the props through `AgentMessageEvent`:

```tsx
function AgentMessageEvent({
  item,
  agentIcon,
  onOpenReference,
  showConversationRolloverPrompt = false,
  conversationRolloverPromptDisabled = false,
  onStartNewConversation,
}: AgentMessageEventProps) {
  const outgoing = item.role === "user"

  if (outgoing) {
    return (
      <article className="group/message flex min-w-0 flex-col items-end">
        <AgentMessageBubble role="user">
          <span data-allow-select="true">{item.content}</span>
        </AgentMessageBubble>
        <AgentMessageToolbar
          timestamp={item.timestamp}
          content={item.content}
          messageId={item.id}
          role={item.role}
          className="mt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
        />
      </article>
    )
  }

  return (
    <article className="flex w-full min-w-0 flex-col items-start">
      <AgentMessageHeader
        agentIcon={agentIcon}
        timestamp={item.timestamp}
        className="mb-1"
      />
      <AssistantMessageBody
        item={item}
        onOpenReference={onOpenReference}
        showConversationRolloverPrompt={showConversationRolloverPrompt}
        conversationRolloverPromptDisabled={conversationRolloverPromptDisabled}
        onStartNewConversation={onStartNewConversation}
      />
    </article>
  )
}
```

Update `AssistantMessageBody` props:

```tsx
function AssistantMessageBody({
  item,
  onOpenReference,
  showConversationRolloverPrompt,
  conversationRolloverPromptDisabled,
  onStartNewConversation,
}: {
  readonly item: SynapseAgentMessageTimelineItem
  readonly onOpenReference: (reference: string) => void
  readonly showConversationRolloverPrompt: boolean
  readonly conversationRolloverPromptDisabled: boolean
  readonly onStartNewConversation?: () => void
}) {
```

Render the prompt after `AgentUsageCard` and before `AgentMessageToolbar`:

```tsx
      {showConversationRolloverPrompt && onStartNewConversation ? (
        <AgentConversationRolloverPrompt
          disabled={conversationRolloverPromptDisabled}
          onStartNewConversation={onStartNewConversation}
        />
      ) : null}
```

- [ ] **Step 4: Modify `AgentTimelineItem` to pass prompt props**

In `desktop/src/modules/agent/components/agent-timeline-item.tsx`, update the function props:

```tsx
function AgentTimelineItem({
  item,
  profile,
  agentIcon,
  pendingPermissions,
  latestPendingItemIds,
  onOpenReference,
  onRespondPermission,
  toolResult,
  showConversationRolloverPrompt = false,
  conversationRolloverPromptDisabled = false,
  onStartNewConversation,
}: {
  readonly item: SynapseAgentTimelineItem
  readonly toolResult?: SynapseAgentToolResultTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly latestPendingItemIds?: ReadonlySet<string>
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => void | Promise<void>
  readonly showConversationRolloverPrompt?: boolean
  readonly conversationRolloverPromptDisabled?: boolean
  readonly onStartNewConversation?: () => void
}) {
```

In the `"message"` case, pass them to `AgentMessageEvent`:

```tsx
        <AgentMessageEvent
          item={item}
          profile={profile}
          agentIcon={agentIcon}
          onOpenReference={onOpenReference}
          showConversationRolloverPrompt={showConversationRolloverPrompt}
          conversationRolloverPromptDisabled={conversationRolloverPromptDisabled}
          onStartNewConversation={onStartNewConversation}
        />
```

- [ ] **Step 5: Modify `AgentTimeline` to compute the latest eligible message**

In `desktop/src/modules/agent/components/agent-timeline.tsx`, add imports:

```ts
import { shouldShowConversationRolloverPrompt } from "../utils/conversation-rollover"
```

Update the `AgentTimeline` props:

```tsx
function AgentTimeline({
  items,
  profile,
  agentIcon,
  sending,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
  onStartNewConversation,
  viewportRef,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly sending: boolean
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => void | Promise<void>
  readonly onStartNewConversation?: () => void
  readonly viewportRef: Ref<HTMLDivElement>
}) {
```

After `displayEntries` is computed, add:

```tsx
  const rolloverPromptMessageId = conversationRolloverPromptMessageId({
    displayEntries,
    sending,
    hasStartAction: Boolean(onStartNewConversation),
  })
```

Pass the prompt props into `AgentTimelineItem`:

```tsx
                showConversationRolloverPrompt={entry.item.id === rolloverPromptMessageId}
                conversationRolloverPromptDisabled={sending}
                onStartNewConversation={onStartNewConversation}
```

Add this helper near the other local helper functions:

```ts
function conversationRolloverPromptMessageId({
  displayEntries,
  sending,
  hasStartAction,
}: {
  readonly displayEntries: readonly TimelineDisplayEntry[]
  readonly sending: boolean
  readonly hasStartAction: boolean
}): string | undefined {
  if (sending || !hasStartAction) return undefined
  const lastEntry = displayEntries.at(-1)
  const item = lastEntry?.item
  if (!item || item.kind !== "message" || item.role !== "assistant") return undefined
  if (item.streaming === true) return undefined
  return shouldShowConversationRolloverPrompt(item.metadata) ? item.id : undefined
}
```

- [ ] **Step 6: Run the timeline tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add desktop/src/modules/agent/components/agent-message-event.tsx desktop/src/modules/agent/components/agent-timeline-item.tsx desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat(agent): show rollover prompt after completed output"
```

---

### Task 4: Start-New-Conversation Action

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`

- [ ] **Step 1: Add a failing hook test for model tier forwarding**

Add this test near the existing `creates an Agent session with an explicit permission mode` test in `desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx`:

```tsx
  it("creates an Agent session with provider mode and model tier", async () => {
    let chat: ReturnType<typeof useAgentChat> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe onChange={(next) => {
          chat = next
        }}
        />,
      )
    })
    await waitFor(() => chat?.selectedConversationId === session.id)

    await act(async () => {
      await chat?.createSession("project-1", "provider-1", "bypassPermissions", "opus")
    })

    expect((window as unknown as {
      synapse: {
        agent: {
          createSession: ReturnType<typeof vi.fn>
        }
      }
    }).synapse.agent.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      providerId: "provider-1",
      mode: "bypassPermissions",
      modelTier: "opus",
    }))
  })
```

- [ ] **Step 2: Run the hook test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx --testNamePattern "provider mode and model tier"
```

Expected: PASS if the existing hook already forwards model tier. If it fails, update `desktop/src/modules/agent/hooks/use-chat-connection.ts` so `createSession` includes the supplied `modelTier` in `bridge.agent.createSession`.

- [ ] **Step 3: Add the AgentModule action handler**

In `desktop/src/modules/agent/index.tsx`, add this function after `selectedPendingMessages` is defined and before the first `useEffect`:

```tsx
  const handleStartRolloverConversation = () => {
    if (!selectedSession) return
    if (sourceFilter !== "user") setSourceFilter("user")
    void chat.createSession(
      selectedSession.projectId,
      selectedSession.providerId,
      selectedSession.mode,
      selectedSession.modelTier,
    )
  }
```

Update the existing `AgentTimeline` usage:

```tsx
            <AgentTimeline
              items={chat.timeline}
              profile={selectedDisplayProfile}
              agentIcon={selectedAgentDefinition?.icon}
              sending={chat.sending}
              pendingPermissions={chat.pendingPermissions}
              onOpenReference={openReference}
              onRespondPermission={(requestId, behavior, updatedInput, message) =>
                chat.respondPermission(requestId, behavior, updatedInput, message)}
              onStartNewConversation={selectedSession ? handleStartRolloverConversation : undefined}
              viewportRef={stick.viewportRef}
            />
```

- [ ] **Step 4: Preserve model tier in permission-mode-created sessions while touching this path**

In `desktop/src/modules/agent/index.tsx`, update the existing composer permission-mode session creation:

```tsx
              onCreatePermissionModeSession={(mode) => {
                const projectId = chat.selectedProjectId ?? chat.activeProjectId
                if (!projectId) return
                if (sourceFilter !== "user") setSourceFilter("user")
                void chat.createSession(projectId, selectedSession?.providerId, mode, selectedSession?.modelTier)
              }}
```

This keeps the touched code path consistent with the new rollover behavior and avoids silently dropping the selected model tier when creating a same-context session from the composer.

- [ ] **Step 5: Run targeted hook and type checks**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx --testNamePattern "model tier|explicit permission mode"
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS for both commands.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
git commit -m "feat(agent): start rollover conversations in same context"
```

---

### Task 5: Release Note and Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add the release note**

Under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, add:

```md
- Agent 长对话达到费用阈值后，会在本轮输出结束时提示开始新对话，并保留当前项目和模型，减少继续沿用超长上下文带来的额外费用。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/agent/utils/__tests__/conversation-rollover.test.ts \
  desktop/src/modules/agent/components/__tests__/agent-conversation-rollover-prompt.test.tsx \
  desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx \
  desktop/src/modules/agent/hooks/__tests__/use-agent-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run the desktop validation suite**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 4: Check hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Inspect the diff**

Run:

```bash
git diff -- desktop/src/modules/agent desktop/src/types/agent.ts RELEASE_NOTES_PENDING.md
```

Expected:

- No custom colors, hex/rgb/hsl, Tailwind arbitrary color classes, inline `style`, or decorative gradients/glow.
- No backend billing changes.
- Prompt copy matches the approved short copy.
- `chat.createSession` receives project, provider, mode, and model tier for rollover action.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent conversation rollover prompt"
```

---

## Self-Review

- Spec coverage: The plan covers cost-first threshold, token fallback, post-output-only display, same project/provider/model/mode creation, no migration or auto-send, impeccable UI constraints, testing, and release notes.
- Placeholder scan: No unresolved placeholders or vague "add tests" steps remain. Each code-changing step includes concrete snippets or exact edits.
- Type consistency: The plan uses existing names from the codebase: `SynapseAgentSessionSummary`, `modelTier`, `providerId`, `mode`, `AgentTimeline`, `AgentTimelineItem`, `AgentMessageEvent`, and `chat.createSession(projectId, providerId, mode, modelTier)`.
