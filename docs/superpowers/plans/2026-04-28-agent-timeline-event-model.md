# Agent Timeline Event Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current role/content-only Agent conversation display with a canonical timeline event model plus Agent-specific display profiles for Codex, Claude Code, and future agents.

**Architecture:** Add shared canonical timeline and display-profile types, convert live runtime events and stored legacy history into canonical timeline items, then render those items through focused shadcn/Radix-compatible components. Agent definitions own display policy through `displayProfile`; renderer components consume profile data without hardcoding Codex or Claude Code branches.

**Tech Stack:** Electron, React, TypeScript, Vitest, Tailwind CSS, shadcn/ui, Radix primitives, lucide-react.

---

## File Structure

- Modify `desktop/src/types/agent.ts`: add canonical timeline item union and display profile types; update timeline result/session summary types.
- Modify `desktop/src/definitions/types.ts`: add `displayProfile` to `SynapseAgentBaseDefinition`.
- Modify `desktop/src/definitions/agent/codex/agent-shared.ts`: add Codex display profile.
- Modify `desktop/src/definitions/agent/claude-code/agent-shared.ts`: add Claude Code display profile.
- Create `desktop/src/lib/agent-timeline.ts`: pure conversion and append helpers shared by renderer and Electron IPC.
- Modify `desktop/src/modules/agent/utils.ts`: remove timeline conversion ownership; keep labels, transcript, local references, time formatting.
- Modify `desktop/src/modules/agent/__tests__/utils.test.ts`: update transcript test for canonical items.
- Create `desktop/src/lib/__tests__/agent-timeline.test.ts`: cover canonical conversion and legacy history adaptation.
- Modify `desktop/electron/modules/agent/ipc.ts`: return canonical timeline items from `getTimeline`; update zod schemas.
- Modify `desktop/src/modules/agent/hooks/use-agent-chat.ts`: maintain canonical timeline state.
- Create `desktop/src/modules/agent/components/agent-timeline.tsx`: timeline list.
- Create `desktop/src/modules/agent/components/agent-timeline-item.tsx`: item dispatcher.
- Create `desktop/src/modules/agent/components/agent-message-event.tsx`: message rendering.
- Create `desktop/src/modules/agent/components/agent-thinking-event.tsx`: thinking rendering.
- Create `desktop/src/modules/agent/components/agent-tool-event.tsx`: tool/result/permission rendering.
- Create `desktop/src/modules/agent/components/agent-run-status.tsx`: running indicator.
- Modify `desktop/src/modules/agent/index.tsx`: wire profile lookup and new timeline components.
- Create `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`: profile-driven collapse tests.
- Modify generated registries only if `pnpm desktop:generate:ipc` or `pnpm --filter @synapse/desktop run generate:definitions-registry` changes them.

## Task 1: Shared Timeline And Display Profile Types

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/definitions/types.ts`
- Modify: `desktop/src/definitions/agent/codex/agent-shared.ts`
- Modify: `desktop/src/definitions/agent/claude-code/agent-shared.ts`

- [ ] **Step 1: Add canonical timeline and display profile types**

In `desktop/src/types/agent.ts`, keep existing `SynapseAgentEvent` types and add these types below `SynapseAgentEvent`:

```ts
export type SynapseAgentTimelineKind =
  | "message"
  | "thinking"
  | "toolCall"
  | "toolResult"
  | "permissionRequest"
  | "error"
  | "result"

interface SynapseAgentTimelineBase {
  readonly id: string
  readonly kind: SynapseAgentTimelineKind
  readonly timestamp: string
  readonly agentType?: string
  readonly agentSessionId?: string
  readonly threadId?: string
}

export interface SynapseAgentMessageTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "message"
  readonly role: "user" | "assistant" | "system" | "tool"
  readonly content: string
  readonly legacy?: boolean
}

export interface SynapseAgentThinkingTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "thinking"
  readonly content: string
}

export interface SynapseAgentToolCallTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "toolCall"
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
}

export interface SynapseAgentToolResultTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "toolResult"
  readonly toolName: string
  readonly content?: string
  readonly status?: string
  readonly exitCode?: number
  readonly success?: boolean
}

export interface SynapseAgentPermissionRequestTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "permissionRequest"
  readonly requestId: string
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
}

export interface SynapseAgentErrorTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "error"
  readonly message: string
}

export interface SynapseAgentResultTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "result"
  readonly content: string
  readonly metadata?: {
    readonly model?: string
    readonly effort?: string
    readonly contextRemainingPercent?: number
    readonly workDir?: string
  }
}

export type SynapseAgentTimelineItem =
  | SynapseAgentMessageTimelineItem
  | SynapseAgentThinkingTimelineItem
  | SynapseAgentToolCallTimelineItem
  | SynapseAgentToolResultTimelineItem
  | SynapseAgentPermissionRequestTimelineItem
  | SynapseAgentErrorTimelineItem
  | SynapseAgentResultTimelineItem

export type SynapseAgentToolCollapseDefault = "expanded" | "collapsed" | "auto"

export interface SynapseAgentToolDisplayRule {
  readonly label?: string
  readonly defaultCollapsed?: SynapseAgentToolCollapseDefault
  readonly previewLines?: number
  readonly previewChars?: number
}

export interface SynapseAgentDisplayProfile {
  readonly agentLabel: string
  readonly thinkingDefaultCollapsed: boolean
  readonly toolDefaultCollapsed: SynapseAgentToolCollapseDefault
  readonly toolPreviewLines: number
  readonly toolPreviewChars: number
  readonly aliases?: Record<string, string>
  readonly tools?: Record<string, SynapseAgentToolDisplayRule>
  readonly statusLabels: {
    readonly pending: string
    readonly running: string
    readonly success: string
    readonly error: string
    readonly denied: string
  }
}
```

Replace the old `SynapseAgentTimelineEntry` interface with a compatibility alias during this migration:

```ts
export type SynapseAgentTimelineEntry = SynapseAgentTimelineItem
```

Then update `SynapseAgentSessionSummary.lastMessage` and `SynapseAgentTimelineResult.entries` to use `SynapseAgentTimelineItem`.

- [ ] **Step 2: Add `displayProfile` to agent definitions**

In `desktop/src/definitions/types.ts`, import the profile type:

```ts
import type { SynapseAgentDisplayProfile } from "../types/agent"
```

Extend `SynapseAgentBaseDefinition`:

```ts
export type SynapseAgentBaseDefinition = {
  id: string
  label: string
  order: number
  relatedEditorId?: string
  runtime: SynapseAgentRuntimeRequirement
  modes: readonly SynapseAgentModeOption[]
  capabilities: SynapseAgentCapabilities
  displayProfile: SynapseAgentDisplayProfile
}
```

- [ ] **Step 3: Add Codex profile**

In `desktop/src/definitions/agent/codex/agent-shared.ts`, add a `displayProfile` field to `agentBaseDefinition`:

```ts
displayProfile: {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  aliases: {
    Bash: "Bash",
    FileChange: "File change",
    read_file: "Read file",
    apply_patch: "Apply patch",
  },
  tools: {
    Bash: { defaultCollapsed: "auto", previewLines: 8, previewChars: 1600 },
    FileChange: { defaultCollapsed: "expanded", previewLines: 12, previewChars: 2000 },
    read_file: { defaultCollapsed: "collapsed", previewLines: 6, previewChars: 1200 },
  },
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
},
```

- [ ] **Step 4: Add Claude Code profile**

In `desktop/src/definitions/agent/claude-code/agent-shared.ts`, add:

```ts
displayProfile: {
  agentLabel: "Claude Code",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  aliases: {
    Bash: "Bash",
    Read: "Read",
    Edit: "Edit",
    Write: "Write",
    Glob: "Glob",
    Grep: "Grep",
    TodoWrite: "Todo",
  },
  tools: {
    Bash: { defaultCollapsed: "auto", previewLines: 8, previewChars: 1600 },
    Read: { defaultCollapsed: "collapsed", previewLines: 6, previewChars: 1200 },
    Edit: { defaultCollapsed: "expanded", previewLines: 12, previewChars: 2000 },
    Write: { defaultCollapsed: "expanded", previewLines: 12, previewChars: 2000 },
    TodoWrite: { defaultCollapsed: "expanded", previewLines: 8, previewChars: 1600 },
  },
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
},
```

- [ ] **Step 5: Run targeted typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: FAIL with TypeScript errors in existing timeline consumers that still read `entry.role` or `entry.content` directly. Stop and fix immediately if the output contains errors in agent definition files or `displayProfile` objects.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/types/agent.ts desktop/src/definitions/types.ts desktop/src/definitions/agent/codex/agent-shared.ts desktop/src/definitions/agent/claude-code/agent-shared.ts
git commit -m "feat: add agent timeline display profiles"
```

## Task 2: Canonical Timeline Conversion Helpers

**Files:**
- Create: `desktop/src/lib/agent-timeline.ts`
- Create: `desktop/src/lib/__tests__/agent-timeline.test.ts`
- Modify: `desktop/src/modules/agent/utils.ts`
- Modify: `desktop/src/modules/agent/__tests__/utils.test.ts`

- [ ] **Step 1: Write conversion tests**

Create `desktop/src/lib/__tests__/agent-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  agentEventToTimelineItem,
  appendAgentTimelineEvent,
  historyRecordToTimelineItem,
} from "../agent-timeline"

describe("agent timeline conversion", () => {
  it("converts live tool events into canonical items", () => {
    expect(agentEventToTimelineItem({
      type: "toolUse",
      toolName: "Bash",
      toolInput: "pnpm test",
      toolInputRaw: { cmd: "pnpm test" },
      agentSessionId: "thread-1",
      threadId: "thread-1",
    }, {
      id: "live:1",
      timestamp: "2026-04-28T00:00:00.000Z",
      agentType: "codex",
    })).toEqual({
      id: "live:1",
      kind: "toolCall",
      timestamp: "2026-04-28T00:00:00.000Z",
      agentType: "codex",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      toolName: "Bash",
      toolInput: "pnpm test",
      toolInputRaw: { cmd: "pnpm test" },
    })
  })

  it("adapts stored tool result metadata into canonical items", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "ok",
      timestamp: "2026-04-28T00:01:00.000Z",
      metadata: {
        agentEventType: "toolResult",
        toolName: "Bash",
        status: "completed",
        exitCode: 0,
        success: true,
        agentSessionId: "thread-1",
        threadId: "thread-1",
      },
    }, 2, "codex")).toEqual({
      id: "session-1:history:2",
      kind: "toolResult",
      timestamp: "2026-04-28T00:01:00.000Z",
      agentType: "codex",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      toolName: "Bash",
      content: "ok",
      status: "completed",
      exitCode: 0,
      success: true,
    })
  })

  it("falls back to legacy message items when metadata is missing", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "Bash\npwd",
      timestamp: "2026-04-28T00:02:00.000Z",
    }, 3, "codex")).toEqual({
      id: "session-1:history:3",
      kind: "message",
      role: "tool",
      content: "Bash\npwd",
      timestamp: "2026-04-28T00:02:00.000Z",
      agentType: "codex",
      legacy: true,
    })
  })

  it("merges assistant text deltas but keeps tool events separate", () => {
    const first = appendAgentTimelineEvent([], {
      type: "text",
      content: "hello",
    }, "2026-04-28T00:03:00.000Z", "codex")
    const second = appendAgentTimelineEvent(first, {
      type: "text",
      content: " world",
    }, "2026-04-28T00:03:01.000Z", "codex")
    const third = appendAgentTimelineEvent(second, {
      type: "toolUse",
      toolName: "Bash",
      toolInput: "pwd",
    }, "2026-04-28T00:03:02.000Z", "codex")

    expect(second).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        content: "hello world",
      }),
    ])
    expect(third).toHaveLength(2)
    expect(third[1]).toEqual(expect.objectContaining({ kind: "toolCall", toolName: "Bash" }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-timeline.test.ts
```

Expected: FAIL because `desktop/src/lib/agent-timeline.ts` does not exist.

- [ ] **Step 3: Implement conversion helpers**

Create `desktop/src/lib/agent-timeline.ts`:

```ts
import type {
  SynapseAgentEvent,
  SynapseAgentTimelineItem,
} from "@/types/agent"

type TimelineRecordRole = "user" | "assistant" | "system" | "tool"

export type AgentHistoryRecord = {
  readonly role: TimelineRecordRole
  readonly content: string
  readonly timestamp: string
  readonly metadata?: Record<string, unknown>
}

type TimelineItemContext = {
  readonly id: string
  readonly timestamp: string
  readonly agentType?: string
}

export function agentEventToTimelineItem(
  event: SynapseAgentEvent,
  context: TimelineItemContext,
): SynapseAgentTimelineItem {
  const base = {
    id: context.id,
    timestamp: context.timestamp,
    agentType: context.agentType,
    agentSessionId: event.agentSessionId,
    threadId: event.threadId,
  }
  switch (event.type) {
    case "text":
      return { ...base, kind: "message", role: "assistant", content: event.content }
    case "thinking":
      return { ...base, kind: "thinking", content: event.content }
    case "toolUse":
      return {
        ...base,
        kind: "toolCall",
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
      }
    case "toolResult":
      return {
        ...base,
        kind: "toolResult",
        toolName: event.toolName,
        content: event.content,
        status: event.status,
        exitCode: event.exitCode,
        success: event.success,
      }
    case "permissionRequest":
      return {
        ...base,
        kind: "permissionRequest",
        requestId: event.requestId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
      }
    case "result":
      return {
        ...base,
        kind: "result",
        content: event.content,
        metadata: event.metadata,
      }
    case "error":
      return { ...base, kind: "error", message: event.message }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export function historyRecordToTimelineItem(
  sessionId: string,
  entry: AgentHistoryRecord,
  index: number,
  agentType?: string,
): SynapseAgentTimelineItem {
  const metadata = entry.metadata
  const base = {
    id: `${sessionId}:history:${index}`,
    timestamp: entry.timestamp,
    agentType,
    agentSessionId: stringMetadata(metadata, "agentSessionId"),
    threadId: stringMetadata(metadata, "threadId"),
  }
  switch (stringMetadata(metadata, "agentEventType")) {
    case "toolUse":
      return {
        ...base,
        kind: "toolCall",
        toolName: stringMetadata(metadata, "toolName") ?? firstLine(entry.content),
        toolInput: entry.content.includes("\n") ? entry.content.slice(entry.content.indexOf("\n") + 1) : undefined,
        toolInputRaw: recordMetadata(metadata, "toolInputRaw"),
      }
    case "toolResult":
      return {
        ...base,
        kind: "toolResult",
        toolName: stringMetadata(metadata, "toolName") ?? "tool",
        content: entry.content,
        status: stringMetadata(metadata, "status"),
        exitCode: numberMetadata(metadata, "exitCode"),
        success: booleanMetadata(metadata, "success"),
      }
    case "thinking":
      return { ...base, kind: "thinking", content: entry.content }
    case "permissionRequest":
      return {
        ...base,
        kind: "permissionRequest",
        requestId: stringMetadata(metadata, "requestId") ?? `${sessionId}:permission:${index}`,
        toolName: stringMetadata(metadata, "toolName") ?? firstLine(entry.content),
        toolInput: entry.content.includes("\n") ? entry.content.slice(entry.content.indexOf("\n") + 1) : undefined,
        toolInputRaw: recordMetadata(metadata, "toolInputRaw"),
      }
    case "error":
      return { ...base, kind: "error", message: entry.content }
    default:
      return {
        ...base,
        kind: "message",
        role: entry.role,
        content: entry.content,
        legacy: entry.role === "tool" || entry.role === "system",
      }
  }
}

export function appendAgentTimelineEvent(
  current: readonly SynapseAgentTimelineItem[],
  event: SynapseAgentEvent,
  timestamp: string,
  agentType?: string,
): SynapseAgentTimelineItem[] {
  const item = agentEventToTimelineItem(event, {
    id: `event:${timestamp}:${event.type}:${current.length}`,
    timestamp,
    agentType,
  })
  if (isEmptyTimelineItem(item)) return [...current]
  const last = current.at(-1)
  if (event.type === "text" && last?.kind === "message" && last.role === "assistant") {
    if (last.content === event.content || last.content.endsWith(event.content)) return [...current]
    return [...current.slice(0, -1), { ...last, content: `${last.content}${event.content}`, timestamp }]
  }
  if (event.type === "result" && last?.kind === "message" && last.role === "assistant") {
    if (last.content === event.content) return [...current]
    return [...current.slice(0, -1), { ...last, content: event.content, timestamp }]
  }
  if (item.kind === "result" && item.content.trim().length === 0) return [...current]
  return [...current, item]
}

export function localUserTimelineItem(
  content: string,
  timestamp: string,
  index: number,
): SynapseAgentTimelineItem {
  return {
    id: `local:${timestamp}:user:${index}`,
    kind: "message",
    role: "user",
    content,
    timestamp,
  }
}

function isEmptyTimelineItem(item: SynapseAgentTimelineItem): boolean {
  if (item.kind === "message") return item.content.trim().length === 0
  if (item.kind === "thinking") return item.content.trim().length === 0
  if (item.kind === "error") return item.message.trim().length === 0
  return false
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0]?.trim() || "tool"
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function numberMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === "number" ? value : undefined
}

function booleanMetadata(metadata: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = metadata?.[key]
  return typeof value === "boolean" ? value : undefined
}

function recordMetadata(metadata: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = metadata?.[key]
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
```

- [ ] **Step 4: Move local timeline entry import sites later**

In `desktop/src/modules/agent/utils.ts`, remove `agentEventToTimelineEntry` and `localUserTimelineEntry` after `use-agent-chat.ts` imports their replacements from `@/lib/agent-timeline` in Task 4. Keep `formatAgentTranscript` in this file for now.

- [ ] **Step 5: Update transcript utility**

Change `formatAgentTranscript` in `desktop/src/modules/agent/utils.ts` so it accepts canonical items:

```ts
function formatAgentTranscript(entries: readonly SynapseAgentTimelineItem[]): string {
  return entries.map((entry) => [
    `${labelForTimelineItem(entry)} ${formatEntryTime(entry.timestamp)}`,
    timelineItemText(entry).trimEnd(),
  ].join("\n")).join("\n\n")
}

function labelForTimelineItem(entry: SynapseAgentTimelineItem): string {
  switch (entry.kind) {
    case "message":
      return labelForRole(entry.role)
    case "thinking":
      return "Thinking"
    case "toolCall":
    case "toolResult":
      return "工具"
    case "permissionRequest":
      return "权限"
    case "error":
      return "错误"
    case "result":
      return "结果"
    default: {
      const exhaustive: never = entry
      return exhaustive
    }
  }
}

function timelineItemText(entry: SynapseAgentTimelineItem): string {
  switch (entry.kind) {
    case "message":
    case "thinking":
    case "result":
      return entry.content
    case "toolCall":
      return entry.toolInput ? `${entry.toolName}\n${entry.toolInput}` : entry.toolName
    case "toolResult":
      return entry.content?.trim() || entry.toolName
    case "permissionRequest":
      return entry.toolInput ? `${entry.toolName}\n${entry.toolInput}` : entry.toolName
    case "error":
      return entry.message
    default: {
      const exhaustive: never = entry
      return exhaustive
    }
  }
}
```

Also import `SynapseAgentTimelineItem` from `@/types/agent`.

- [ ] **Step 6: Update existing utils test data**

In `desktop/src/modules/agent/__tests__/utils.test.ts`, change transcript entries to canonical items:

```ts
const entries = [
  {
    id: "one",
    kind: "message",
    role: "user",
    content: "你好",
    timestamp: "2026-04-27T03:15:00.000Z",
  },
  {
    id: "two",
    kind: "message",
    role: "assistant",
    content: "第一行\n第二行",
    timestamp: "2026-04-27T03:16:00.000Z",
  },
  {
    id: "three",
    kind: "toolCall",
    toolName: "read_file",
    timestamp: "2026-04-27T03:17:00.000Z",
  },
] as const
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-timeline.test.ts src/modules/agent/__tests__/utils.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/lib/agent-timeline.ts desktop/src/lib/__tests__/agent-timeline.test.ts desktop/src/modules/agent/utils.ts desktop/src/modules/agent/__tests__/utils.test.ts
git commit -m "feat: add canonical agent timeline conversion"
```

## Task 3: IPC Timeline Schema And History Adapter

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts`

- [ ] **Step 1: Update IPC zod schema for canonical timeline items**

In `desktop/electron/modules/agent/ipc.ts`, replace `timelineEntrySchema` with:

```ts
const timelineBaseSchema = {
  id: z.string(),
  timestamp: z.string(),
  agentType: z.string().optional(),
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
}

const timelineItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("message"),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
    legacy: z.boolean().optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("thinking"),
    content: z.string(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("toolCall"),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("toolResult"),
    toolName: z.string(),
    content: z.string().optional(),
    status: z.string().optional(),
    exitCode: z.number().optional(),
    success: z.boolean().optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("permissionRequest"),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("error"),
    message: z.string(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("result"),
    content: z.string(),
    metadata: z.object({
      model: z.string().optional(),
      effort: z.string().optional(),
      contextRemainingPercent: z.number().optional(),
      workDir: z.string().optional(),
    }).optional(),
  }),
])
```

Update references:

```ts
lastMessage: timelineItemSchema.optional(),
entries: z.array(timelineItemSchema),
```

- [ ] **Step 2: Import history adapter**

At the top of `desktop/electron/modules/agent/ipc.ts`, add:

```ts
import { historyRecordToTimelineItem } from "../../../src/lib/agent-timeline"
```

- [ ] **Step 3: Convert `historyEntry`**

Replace `historyEntry()` with:

```ts
function historyEntry(
  sessionId: string,
  entry: ConversationEntryV1["history"][number],
  index: number,
  agentType?: string,
) {
  return historyRecordToTimelineItem(sessionId, entry, index, agentType)
}
```

Update `historyEntries()`:

```ts
return session.history.slice(start).map((entry, index) =>
  historyEntry(session.id, entry, start + index, session.agentType))
```

Update `sessionSummary()` last message conversion:

```ts
lastMessage: last ? historyEntry(session.id, last, session.history.length - 1, session.agentType) : undefined,
```

- [ ] **Step 4: Run targeted typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: FAIL only in renderer timeline consumers that Task 4 and Task 6 update. The command output must not include errors in `desktop/electron/modules/agent/ipc.ts`.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/agent/ipc.ts
git commit -m "feat: return canonical agent timeline from ipc"
```

## Task 4: Hook State Uses Canonical Timeline Items

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`
- Modify: `desktop/src/modules/agent/utils.ts`

- [ ] **Step 1: Replace hook timeline types**

In `desktop/src/modules/agent/hooks/use-agent-chat.ts`, replace `SynapseAgentTimelineEntry` imports and state with `SynapseAgentTimelineItem`.

Change imports:

```ts
import type {
  SynapseAgentDomainEvent,
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import {
  appendAgentTimelineEvent,
  localUserTimelineItem,
} from "@/lib/agent-timeline"
```

Remove imports of `agentEventToTimelineEntry` and `localUserTimelineEntry` from `../utils`.

- [ ] **Step 2: Update state signatures**

Update state and updater signatures:

```ts
timeline: SynapseAgentTimelineItem[]
```

```ts
const [timeline, setTimeline] = useState<SynapseAgentTimelineItem[]>([])
```

```ts
const replaceTimeline = useCallback((entries: SynapseAgentTimelineItem[]) => {
  timelineVersionRef.current += 1
  setTimeline(entries)
}, [])
```

```ts
updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[],
```

- [ ] **Step 3: Pass active agent type when appending live events**

Add a helper near `activeProjectId` calculation:

```ts
const selectedAgentType = sessions.find((session) =>
  session.projectId === selectedProjectId && session.id === selectedConversationId)?.agentType
  ?? status?.agentType
```

In the event listener, replace:

```ts
updateTimeline((current) => appendAgentEvent(current, domainEvent.payload.event, domainEvent.timestamp))
```

with:

```ts
updateTimeline((current) =>
  appendAgentTimelineEvent(current, domainEvent.payload.event, domainEvent.timestamp, selectedAgentType))
```

Use the ref-safe lookup inside the event listener:

```ts
const agentType = sessions.find((session) =>
  session.projectId === selectedProjectIdRef.current
  && session.id === selectedConversationIdRef.current)?.agentType
  ?? status?.agentType
```

Add `sessions` and `status?.agentType` to the effect dependency list.

- [ ] **Step 4: Delete obsolete local append function**

Remove `appendAgentEvent()` from the bottom of `use-agent-chat.ts`.

In `desktop/src/modules/agent/utils.ts`, remove the now-unused `agentEventToTimelineEntry` export and related `contentForEvent` / `roleForEvent` helpers if no imports remain.

- [ ] **Step 5: Run hook-adjacent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/live-sync.test.ts src/modules/agent/__tests__/utils.test.ts src/lib/__tests__/agent-timeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-agent-chat.ts desktop/src/modules/agent/utils.ts
git commit -m "feat: use canonical timeline in agent chat hook"
```

## Task 5: Timeline Rendering Components

**Files:**
- Create: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Create: `desktop/src/modules/agent/components/agent-timeline-item.tsx`
- Create: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Create: `desktop/src/modules/agent/components/agent-thinking-event.tsx`
- Create: `desktop/src/modules/agent/components/agent-tool-event.tsx`
- Create: `desktop/src/modules/agent/components/agent-run-status.tsx`

- [ ] **Step 1: Add run status component**

Create `desktop/src/modules/agent/components/agent-run-status.tsx`:

```tsx
import { Loader2 } from "lucide-react"

function AgentRunStatus({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground" aria-live="polite">
      <Loader2 className="size-4 animate-spin" />
      <span>{label}</span>
    </div>
  )
}

export { AgentRunStatus }
```

- [ ] **Step 2: Add message component**

Create `desktop/src/modules/agent/components/agent-message-event.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"

type MessageSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "reference"; readonly value: string }

const LOCAL_REFERENCE_PATTERN = /(\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g

function AgentMessageEvent({
  item,
  onOpenReference,
}: {
  readonly item: SynapseAgentMessageTimelineItem
  readonly onOpenReference: (reference: string) => void
}) {
  const outgoing = item.role === "user"
  const segments = splitLocalReferences(item.content)
  return (
    <article className={cn("flex min-w-0", outgoing ? "justify-end" : "justify-start")}>
      <div className={cn(
        "min-w-0 max-w-[78%] whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm leading-relaxed",
        outgoing ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground",
      )}>
        {segments.map((segment, index) => segment.kind === "text" ? (
          <span key={`${item.id}:text:${String(index)}`}>{segment.value}</span>
        ) : (
          <Button
            key={`${item.id}:ref:${String(index)}`}
            type="button"
            variant="link"
            size="sm"
            className={cn(
              "h-auto min-w-0 max-w-full whitespace-normal break-all px-1 py-0 text-left align-baseline",
              outgoing ? "text-inherit hover:text-inherit" : null,
            )}
            onClick={() => onOpenReference(segment.value)}
          >
            {segment.value}
          </Button>
        ))}
      </div>
    </article>
  )
}

function splitLocalReferences(content: string): readonly MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0
  for (const match of content.matchAll(LOCAL_REFERENCE_PATTERN)) {
    const value = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, index) })
    }
    segments.push({ kind: "reference", value })
    lastIndex = index + value.length
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ kind: "text", value: content }]
}

export { AgentMessageEvent }
```

- [ ] **Step 3: Add thinking component**

Create `desktop/src/modules/agent/components/agent-thinking-event.tsx`:

```tsx
import { ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentThinkingTimelineItem,
} from "@/types/agent"

function AgentThinkingEvent({
  item,
  profile,
}: {
  readonly item: SynapseAgentThinkingTimelineItem
  readonly profile: SynapseAgentDisplayProfile
}) {
  return (
    <Collapsible defaultOpen={!profile.thinkingDefaultCollapsed} className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-full justify-start">
          <ChevronDown data-icon="inline-start" />
          Thinking
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="whitespace-pre-wrap break-words px-3 pb-3 text-sm text-muted-foreground">
          {item.content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { AgentThinkingEvent }
```

- [ ] **Step 4: Add tool event component**

Create `desktop/src/modules/agent/components/agent-tool-event.tsx`:

```tsx
import { ChevronDown, Clipboard, Terminal } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"

type AgentToolEventItem =
  | SynapseAgentToolCallTimelineItem
  | SynapseAgentToolResultTimelineItem
  | SynapseAgentPermissionRequestTimelineItem

function AgentToolEvent({
  item,
  profile,
}: {
  readonly item: AgentToolEventItem
  readonly profile: SynapseAgentDisplayProfile
}) {
  const rule = profile.tools?.[item.toolName]
  const label = rule?.label ?? profile.aliases?.[item.toolName] ?? item.toolName
  const body = toolBody(item)
  const failed = item.kind === "toolResult" && item.success === false
  const permission = item.kind === "permissionRequest"
  const defaultOpen = permission || failed || shouldDefaultOpen(body, rule?.defaultCollapsed ?? profile.toolDefaultCollapsed)
  const status = statusLabel(item, profile)
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start px-0">
            <ChevronDown data-icon="inline-start" />
            <Terminal data-icon="inline-start" />
            <span className="truncate">{label}</span>
          </Button>
        </CollapsibleTrigger>
        <Badge variant={failed ? "destructive" : "secondary"}>{status}</Badge>
      </div>
      <CollapsibleContent>
        <Separator />
        <div className="flex flex-col gap-2 p-3">
          {body ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
              {previewText(body, rule?.previewChars ?? profile.toolPreviewChars)}
            </pre>
          ) : null}
          {item.kind === "toolResult" && typeof item.exitCode === "number" ? (
            <span className="text-xs text-muted-foreground">exit {item.exitCode}</span>
          ) : null}
          {body ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void navigator.clipboard.writeText(body)}
            >
              <Clipboard data-icon="inline-start" />
              复制
            </Button>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function toolBody(item: AgentToolEventItem): string {
  if (item.kind === "toolResult") return item.content ?? ""
  return item.toolInput ?? formatRawInput(item.toolInputRaw)
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ""
}

function statusLabel(item: AgentToolEventItem, profile: SynapseAgentDisplayProfile): string {
  if (item.kind === "permissionRequest") return profile.statusLabels.pending
  if (item.kind === "toolCall") return profile.statusLabels.running
  if (item.success === false) return profile.statusLabels.error
  return profile.statusLabels.success
}

function shouldDefaultOpen(body: string, mode: "expanded" | "collapsed" | "auto"): boolean {
  if (mode === "expanded") return true
  if (mode === "collapsed") return false
  return body.trim().length > 0 && body.length <= 400
}

function previewText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit).trimEnd()}\n...`
}

export { AgentToolEvent }
```

- [ ] **Step 5: Add item dispatcher**

Create `desktop/src/modules/agent/components/agent-timeline-item.tsx`:

```tsx
import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentThinkingEvent } from "./agent-thinking-event"
import { AgentToolEvent } from "./agent-tool-event"

function AgentTimelineItem({
  item,
  profile,
  onOpenReference,
}: {
  readonly item: SynapseAgentTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly onOpenReference: (reference: string) => void
}) {
  switch (item.kind) {
    case "message":
      return <AgentMessageEvent item={item} onOpenReference={onOpenReference} />
    case "thinking":
      return <AgentThinkingEvent item={item} profile={profile} />
    case "toolCall":
    case "toolResult":
    case "permissionRequest":
      return <AgentToolEvent item={item} profile={profile} />
    case "error":
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription>{item.message}</AlertDescription>
        </Alert>
      )
    case "result":
      return null
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

export { AgentTimelineItem }
```

- [ ] **Step 6: Add timeline list**

Create `desktop/src/modules/agent/components/agent-timeline.tsx`:

```tsx
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentRunStatus } from "./agent-run-status"
import { AgentTimelineItem } from "./agent-timeline-item"

function AgentTimeline({
  items,
  profile,
  sending,
  onOpenReference,
  bottomRef,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly sending: boolean
  readonly onOpenReference: (reference: string) => void
  readonly bottomRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-col gap-2 py-1 pr-2">
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
        ) : items.map((item) => (
          <AgentTimelineItem
            key={item.id}
            item={item}
            profile={profile}
            onOpenReference={onOpenReference}
          />
        ))}
        {sending ? <AgentRunStatus label={`${profile.agentLabel} 正在处理`} /> : null}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </ScrollArea>
  )
}

export { AgentTimeline }
```

- [ ] **Step 7: Run component typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: failures may remain in `desktop/src/modules/agent/index.tsx` until Task 6 wires the new components. No errors should point to the new component files.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/components/agent-timeline-item.tsx desktop/src/modules/agent/components/agent-message-event.tsx desktop/src/modules/agent/components/agent-thinking-event.tsx desktop/src/modules/agent/components/agent-tool-event.tsx desktop/src/modules/agent/components/agent-run-status.tsx
git commit -m "feat: add agent timeline event components"
```

## Task 6: Wire Timeline Components Into Agent Module

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Replace old timeline rendering imports**

In `desktop/src/modules/agent/index.tsx`, remove unused imports:

```ts
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SynapseAgentTimelineEntry } from "@/types/agent"
import {
  thinkingIndicatorText,
} from "./utils"
```

Add:

```ts
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentTimeline } from "./components/agent-timeline"
```

- [ ] **Step 2: Add default display profile**

Near `const logger = createRendererLogger("agent")`, add:

```ts
const DEFAULT_AGENT_DISPLAY_PROFILE: SynapseAgentDisplayProfile = {
  agentLabel: "Agent",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}
```

- [ ] **Step 3: Resolve selected profile**

Inside `AgentModule`, after `selectedSession`:

```ts
const selectedAgentDefinition = agentDefinitions.find((definition) =>
  definition.id === selectedSession?.agentType)
const selectedDisplayProfile = selectedAgentDefinition?.displayProfile
  ?? DEFAULT_AGENT_DISPLAY_PROFILE
```

- [ ] **Step 4: Replace timeline JSX**

Replace the old `<ScrollArea>...</ScrollArea>` timeline block with:

```tsx
<AgentTimeline
  items={chat.timeline}
  profile={selectedDisplayProfile}
  sending={chat.sending}
  onOpenReference={openReference}
  bottomRef={timelineBottomRef}
/>
```

- [ ] **Step 5: Delete old local timeline components from index**

Remove these functions and related local types/constants from `index.tsx`:

```ts
AgentWaitingIndicator
AgentMessageItem
MessageContent
labelForRole
splitLocalReferences
MessageSegment
LOCAL_REFERENCE_PATTERN
```

- [ ] **Step 6: Keep composer unchanged except invalid custom styling**

Review `AgentComposer` class names. Replace custom outgoing gradient usage already removed with token classes only. Keep composer existing `rounded-full bg-muted/50` if accepted by current style, or change to:

```tsx
<form className="flex shrink-0 items-end gap-2 rounded-md border border-border bg-background px-2 py-1.5" onSubmit={onSubmit}>
```

Use only token classes.

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS or only generated IPC registry drift if Task 3 changed generated channel types.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "feat: render agent canonical timeline"
```

## Task 7: Component Tests For Collapse Behavior

**Files:**
- Create: `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`

- [ ] **Step 1: Write tool component tests**

Create `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentToolEvent } from "../agent-tool-event"

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "collapsed",
  toolPreviewLines: 6,
  toolPreviewChars: 20,
  aliases: {
    Bash: "Bash",
  },
  tools: {
    Bash: { defaultCollapsed: "expanded", previewChars: 20 },
  },
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

describe("AgentToolEvent", () => {
  it("uses profile aliases and opens tools configured as expanded", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-1",
        kind: "toolCall",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        toolInput: "pnpm test",
      }}
      profile={profile}
    />)

    expect(html).toContain("Bash")
    expect(html).toContain("Running")
    expect(html).toContain("pnpm test")
  })

  it("opens failed tool results even when profile default is collapsed", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-2",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "UnknownTool",
        content: "boom",
        success: false,
      }}
      profile={profile}
    />)

    expect(html).toContain("UnknownTool")
    expect(html).toContain("Failed")
    expect(html).toContain("boom")
  })

  it("opens permission requests by default", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "permission-1",
        kind: "permissionRequest",
        timestamp: "2026-04-28T00:00:00.000Z",
        requestId: "request-1",
        toolName: "Bash",
        toolInput: "rm file",
      }}
      profile={profile}
    />)

    expect(html).toContain("Pending")
    expect(html).toContain("rm file")
  })
})
```

- [ ] **Step 2: Run test to verify tooling**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx
git commit -m "test: cover agent tool timeline display"
```

## Task 8: Generated Files, Full Verification, And Cleanup

**Files:**
- Modify generated IPC or definition registry files produced by the commands in this task.

- [ ] **Step 1: Regenerate IPC definitions**

Run:

```bash
pnpm desktop:generate:ipc
```

Expected: command succeeds. Run `git status --short desktop/electron/generated` after the command and keep any generated diffs.

- [ ] **Step 2: Regenerate definitions registry**

Run:

```bash
pnpm --filter @synapse/desktop run generate:definitions-registry
```

Expected: command succeeds. Run `git status --short desktop/src/definitions/generated` after the command and keep any generated diffs.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/agent-timeline.test.ts src/modules/agent/__tests__/utils.test.ts src/modules/agent/__tests__/live-sync.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full desktop test suite**

Run:

```bash
pnpm desktop:test
```

Expected: PASS.

- [ ] **Step 5: Run hard constraints**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: PASS. This verifies no forbidden IPC, fs, server, or runtime boundary changes were introduced.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: PASS.

- [ ] **Step 7: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan changed. No unrelated formatting or generated churn.

- [ ] **Step 8: Commit generated-file cleanup**

Run:

```bash
git add desktop/electron/generated desktop/src/definitions/generated
git diff --cached --quiet || git commit -m "chore: update generated agent timeline files"
```

Expected: generated changes are committed when present; no commit is created when the generator outputs match the repository.

## Implementation Notes

- Do not start the dev server or browser preview for verification unless explicitly requested.
- Keep UI text brief. Avoid explanatory product copy inside the interface.
- Do not add dependencies.
- Do not add custom colors, inline styles, gradients, nested cards, or styled components.
- Keep Electron privileged boundaries unchanged. Renderer uses only `window.synapse.*`.
- Do not migrate stored conversation data. Adapt old history during reads.

## Final Verification Checklist

- `pnpm desktop:typecheck`
- `pnpm desktop:test`
- `pnpm desktop:check:hard-constraints`
- `pnpm desktop:check:ipc-codegen` if IPC generated files changed
- Review `git diff --stat` for scope control
