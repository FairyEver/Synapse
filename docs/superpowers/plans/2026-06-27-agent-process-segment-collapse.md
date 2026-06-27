# Agent Process Segment Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold Agent process events into Codex-like process groups while keeping every user message and assistant answer visible in the main conversation flow.

**Architecture:** Keep timeline data unchanged and implement grouping in the renderer. Move timeline display preparation into a focused pure helper, add a lightweight `AgentProcessGroup` component, and wire `AgentTimeline` to render either plain items or grouped process entries. Default open state is derived from group state and `sending`, with per-page user overrides.

**Tech Stack:** React 19, TypeScript 6, Vitest, shadcn/Radix `Collapsible`, Tailwind token utility classes.

---

## File Structure

- Create `desktop/src/modules/agent/components/agent-timeline-display.ts`
  - Owns pure display entry preparation, process grouping, group state summaries, and default-open helpers.
  - Exports functions used by tests and `AgentTimeline`.
- Create `desktop/src/modules/agent/components/agent-process-group.tsx`
  - Owns the process group trigger, title, collapsible content, and keyboard-accessible open state.
  - Contains no timeline classification logic.
- Modify `desktop/src/modules/agent/components/agent-timeline.tsx`
  - Uses `timelineDisplayEntries` and `groupTimelineDisplayEntries` from the helper.
  - Maintains process group open overrides.
  - Renders grouped entries by reusing `AgentTimelineItem`.
- Modify `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`
  - Adds pure grouping tests and rendered DOM tests for default open/closed behavior.
- No runtime, IPC, persistence, or schema files change.

## Task 1: Extract Existing Timeline Display Preparation

**Files:**
- Create: `desktop/src/modules/agent/components/agent-timeline-display.ts`
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Write failing import smoke test**

Add this import beside the existing `AgentTimeline` import:

```ts
import { timelineDisplayEntries } from "../agent-timeline-display"
```

Add this test near the existing completed-tool test block:

```ts
it("prepares completed tool calls as one display entry", () => {
  const items: SynapseAgentTimelineItem[] = [
    {
      id: "tool-call",
      kind: "toolCall",
      toolUseId: "toolu-1",
      toolName: "Read",
      toolInputRaw: { file_path: "/tmp/package.json" },
      timestamp: "2026-06-27T00:00:00.000Z",
    },
    {
      id: "tool-result",
      kind: "toolResult",
      toolUseId: "toolu-1",
      toolName: "Read",
      content: "package contents",
      success: true,
      timestamp: "2026-06-27T00:00:01.000Z",
    },
  ]

  expect(timelineDisplayEntries(items)).toEqual([
    {
      item: expect.objectContaining({ id: "tool-call" }),
      result: expect.objectContaining({ id: "tool-result" }),
    },
  ])
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: FAIL with a module resolution or missing export error for `../agent-timeline-display`.

- [ ] **Step 3: Create helper file by moving existing pure code**

Create `desktop/src/modules/agent/components/agent-timeline-display.ts` with this code:

```ts
import type {
  SynapseAgentSdkEventTimelineItem,
  SynapseAgentTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"

export type TimelineDisplayEntry = {
  readonly item: SynapseAgentTimelineItem
  readonly result?: SynapseAgentToolResultTimelineItem
}

export function timelineDisplayEntries(items: readonly SynapseAgentTimelineItem[]): readonly TimelineDisplayEntry[] {
  const resultByUseId = new Map<string, SynapseAgentToolResultTimelineItem>()
  const toolCallUseIds = new Set<string>()
  for (const item of items) {
    if (item.kind === "toolCall" && item.toolUseId) {
      toolCallUseIds.add(item.toolUseId)
    }
    if (item.kind === "toolResult" && item.toolUseId && !resultByUseId.has(item.toolUseId)) {
      resultByUseId.set(item.toolUseId, item)
    }
  }

  const entries: TimelineDisplayEntry[] = []
  for (const item of items) {
    if (isHiddenSdkStatus(item)) continue
    if (item.kind === "toolCall") {
      const result = item.toolUseId ? resultByUseId.get(item.toolUseId) : undefined
      entries.push(result ? { item, result } : { item })
      continue
    }
    if (item.kind === "toolResult") {
      if (item.toolUseId && toolCallUseIds.has(item.toolUseId)) continue
      if (!item.toolUseId && attachLegacyToolResult(entries, item)) continue
    }
    entries.push({ item })
  }
  return entries
}

function attachLegacyToolResult(
  entries: TimelineDisplayEntry[],
  result: SynapseAgentToolResultTimelineItem,
): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry || entry.result || !isUnidentifiedToolCall(entry.item)) continue
    if (entry.item.toolName !== result.toolName) continue
    entries[index] = { item: entry.item, result }
    return true
  }
  return false
}

function isUnidentifiedToolCall(item: SynapseAgentTimelineItem): item is SynapseAgentToolCallTimelineItem {
  return item.kind === "toolCall" && !item.toolUseId
}

function isHiddenSdkStatus(item: SynapseAgentTimelineItem): item is SynapseAgentSdkEventTimelineItem {
  return item.kind === "sdkEvent" && item.sdkType === "status"
}
```

- [ ] **Step 4: Update AgentTimeline to import the helper**

In `desktop/src/modules/agent/components/agent-timeline.tsx`, add:

```ts
import { timelineDisplayEntries, type TimelineDisplayEntry } from "./agent-timeline-display"
```

Remove the local `TimelineDisplayEntry` type and these local functions from `agent-timeline.tsx`:

```ts
timelineDisplayEntries
attachLegacyToolResult
isUnidentifiedToolCall
isHiddenSdkStatus
```

Keep the existing `const displayEntries = timelineDisplayEntries(items)` line unchanged.

- [ ] **Step 5: Run test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: PASS for the new test and existing agent timeline tests.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline-display.ts desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "refactor: extract agent timeline display entries"
```

## Task 2: Add Pure Process Grouping

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline-display.ts`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Write failing grouping tests**

Extend the helper import:

```ts
import {
  groupTimelineDisplayEntries,
  timelineDisplayEntries,
} from "../agent-timeline-display"
```

Add these tests:

```ts
it("groups process entries before an assistant message", () => {
  const entries = timelineDisplayEntries([
    {
      id: "thinking-1",
      kind: "thinking",
      content: "inspect",
      timestamp: "2026-06-27T00:00:00.000Z",
    },
    {
      id: "tool-call-1",
      kind: "toolCall",
      toolName: "Read",
      toolInput: "package.json",
      timestamp: "2026-06-27T00:00:01.000Z",
    },
    {
      id: "answer-1",
      kind: "message",
      role: "assistant",
      content: "Answer",
      timestamp: "2026-06-27T00:00:02.000Z",
    },
  ])

  const nodes = groupTimelineDisplayEntries(entries, {
    pendingPermissionRequestIds: new Set(),
  })

  expect(nodes.map((node) => node.kind)).toEqual(["processGroup", "item"])
  expect(nodes[0]).toEqual(expect.objectContaining({
    kind: "processGroup",
    itemCount: 2,
    summary: "过程详情 · 2 项",
  }))
  expect(nodes[1]).toEqual(expect.objectContaining({
    kind: "item",
    entry: expect.objectContaining({
      item: expect.objectContaining({ id: "answer-1" }),
    }),
  }))
})

it("creates separate process groups between multiple assistant messages", () => {
  const entries = timelineDisplayEntries([
    {
      id: "answer-a",
      kind: "message",
      role: "assistant",
      content: "A",
      timestamp: "2026-06-27T00:00:00.000Z",
    },
    {
      id: "thinking-b",
      kind: "thinking",
      content: "B process",
      timestamp: "2026-06-27T00:00:01.000Z",
    },
    {
      id: "answer-b",
      kind: "message",
      role: "assistant",
      content: "B",
      timestamp: "2026-06-27T00:00:02.000Z",
    },
    {
      id: "tool-c",
      kind: "toolCall",
      toolName: "Bash",
      toolInput: "pnpm test",
      timestamp: "2026-06-27T00:00:03.000Z",
    },
    {
      id: "answer-c",
      kind: "message",
      role: "assistant",
      content: "C",
      timestamp: "2026-06-27T00:00:04.000Z",
    },
  ])

  const nodes = groupTimelineDisplayEntries(entries, {
    pendingPermissionRequestIds: new Set(),
  })

  expect(nodes.map((node) => node.kind)).toEqual([
    "item",
    "processGroup",
    "item",
    "processGroup",
    "item",
  ])
  expect(nodes.filter((node) => node.kind === "item").map((node) => node.entry.item.id)).toEqual([
    "answer-a",
    "answer-b",
    "answer-c",
  ])
})

it("keeps pending permissions outside process groups", () => {
  const entries = timelineDisplayEntries([
    {
      id: "permission-live",
      kind: "permissionRequest",
      requestId: "request-1",
      toolName: "Bash",
      toolInput: "rm file",
      timestamp: "2026-06-27T00:00:00.000Z",
    },
    {
      id: "answer",
      kind: "message",
      role: "assistant",
      content: "Waiting",
      timestamp: "2026-06-27T00:00:01.000Z",
    },
  ])

  const nodes = groupTimelineDisplayEntries(entries, {
    pendingPermissionRequestIds: new Set(["request-1"]),
  })

  expect(nodes.map((node) => node.kind)).toEqual(["item", "item"])
  expect(nodes[0]).toEqual(expect.objectContaining({
    kind: "item",
    entry: expect.objectContaining({
      item: expect.objectContaining({ id: "permission-live" }),
    }),
  }))
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: FAIL because `groupTimelineDisplayEntries` is not exported.

- [ ] **Step 3: Add grouping types and helper**

Append this code to `desktop/src/modules/agent/components/agent-timeline-display.ts`:

```ts
export type AgentTimelineDisplayNode =
  | { readonly kind: "item"; readonly entry: TimelineDisplayEntry }
  | {
      readonly kind: "processGroup"
      readonly id: string
      readonly entries: readonly TimelineDisplayEntry[]
      readonly itemCount: number
      readonly summary: string
      readonly state: ProcessGroupState
    }

export type ProcessGroupState = {
  readonly active: boolean
  readonly failed: boolean
  readonly denied: boolean
  readonly pendingPermission: boolean
}

export type GroupTimelineDisplayContext = {
  readonly pendingPermissionRequestIds: ReadonlySet<string>
}

export function groupTimelineDisplayEntries(
  entries: readonly TimelineDisplayEntry[],
  context: GroupTimelineDisplayContext,
): readonly AgentTimelineDisplayNode[] {
  const nodes: AgentTimelineDisplayNode[] = []
  let pendingProcessEntries: TimelineDisplayEntry[] = []

  const flushProcessEntries = () => {
    if (pendingProcessEntries.length === 0) return
    nodes.push(createProcessGroup(pendingProcessEntries))
    pendingProcessEntries = []
  }

  for (const entry of entries) {
    if (isMainlineEntry(entry, context)) {
      flushProcessEntries()
      nodes.push({ kind: "item", entry })
      continue
    }
    pendingProcessEntries.push(entry)
  }

  flushProcessEntries()
  return nodes
}

function isMainlineEntry(
  entry: TimelineDisplayEntry,
  context: GroupTimelineDisplayContext,
): boolean {
  const item = entry.item
  if (item.kind === "message" && (item.role === "user" || item.role === "assistant")) return true
  if (item.kind === "permissionRequest" && context.pendingPermissionRequestIds.has(item.requestId)) return true
  if (item.kind === "error" && !item.recoverable) return true
  if (item.kind === "result") {
    const status = item.metadata?.turnOutcome?.status
    return status === "cancelled" || status === "failed" || status === "timed_out"
  }
  return false
}

function createProcessGroup(entries: readonly TimelineDisplayEntry[]): AgentTimelineDisplayNode {
  const state = processGroupState(entries)
  return {
    kind: "processGroup",
    id: processGroupId(entries),
    entries,
    itemCount: entries.length,
    summary: processGroupSummary(entries.length, state),
    state,
  }
}

function processGroupId(entries: readonly TimelineDisplayEntry[]): string {
  const first = entries[0]?.item.id ?? "empty"
  const last = entries[entries.length - 1]?.item.id ?? first
  return `process:${first}:${last}`
}

function processGroupSummary(itemCount: number, state: ProcessGroupState): string {
  if (state.pendingPermission) return "过程详情 · 等待权限"
  if (state.failed || state.denied) return "过程详情 · 1 个工具失败"
  if (state.active) return "过程详情 · 正在执行"
  return itemCount > 0 ? `过程详情 · ${itemCount} 项` : "过程详情"
}

function processGroupState(entries: readonly TimelineDisplayEntry[]): ProcessGroupState {
  let active = false
  let failed = false
  let denied = false
  let pendingPermission = false

  for (const entry of entries) {
    const item = entry.item
    const result = entry.result ?? (item.kind === "toolResult" ? item : undefined)
    if (item.kind === "toolCall" && !result) active = true
    if (item.kind === "toolProgress" && item.status === "preparing") active = true
    if (item.kind === "phase" && item.status === "in-progress") active = true
    if (item.kind === "permissionRequest") pendingPermission = true
    if (result) {
      if (isDeniedToolResult(result)) denied = true
      if (isFailedToolResult(result)) failed = true
    }
    if (item.kind === "phase" && item.status === "failed" && !item.recoverable) failed = true
    if (item.kind === "error") failed = true
  }

  return { active, failed, denied, pendingPermission }
}

function isDeniedToolResult(item: SynapseAgentToolResultTimelineItem): boolean {
  return item.status?.toLowerCase() === "denied"
}

function isFailedToolResult(item: SynapseAgentToolResultTimelineItem): boolean {
  if (item.success === false) return true
  if (typeof item.exitCode === "number" && item.exitCode !== 0) return true
  const status = item.status?.toLowerCase()
  return status === "failed" || status === "error" || status === "denied"
}
```

- [ ] **Step 4: Run test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline-display.ts desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat: group agent timeline process entries"
```

## Task 3: Add Default Open State Logic

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline-display.ts`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Write failing default-open tests**

Extend the import:

```ts
import {
  defaultProcessGroupOpen,
  groupTimelineDisplayEntries,
  timelineDisplayEntries,
} from "../agent-timeline-display"
```

Add these tests:

```ts
it("collapses successful completed process groups by default", () => {
  const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
    {
      id: "tool-call",
      kind: "toolCall",
      toolUseId: "toolu-ok",
      toolName: "Read",
      toolInput: "package.json",
      timestamp: "2026-06-27T00:00:00.000Z",
    },
    {
      id: "tool-result",
      kind: "toolResult",
      toolUseId: "toolu-ok",
      toolName: "Read",
      content: "ok",
      success: true,
      timestamp: "2026-06-27T00:00:01.000Z",
    },
  ]), { pendingPermissionRequestIds: new Set() })

  const group = nodes.find((node) => node.kind === "processGroup")
  expect(group?.kind).toBe("processGroup")
  expect(group?.kind === "processGroup" ? defaultProcessGroupOpen(group, { sending: false }) : true).toBe(false)
})

it("opens active and failed process groups by default", () => {
  const nodes = groupTimelineDisplayEntries(timelineDisplayEntries([
    {
      id: "tool-call",
      kind: "toolCall",
      toolUseId: "toolu-failed",
      toolName: "Bash",
      toolInput: "pnpm test",
      timestamp: "2026-06-27T00:00:00.000Z",
    },
    {
      id: "tool-result",
      kind: "toolResult",
      toolUseId: "toolu-failed",
      toolName: "Bash",
      content: "failed",
      success: false,
      timestamp: "2026-06-27T00:00:01.000Z",
    },
  ]), { pendingPermissionRequestIds: new Set() })
  const failedGroup = nodes.find((node) => node.kind === "processGroup")

  const activeNodes = groupTimelineDisplayEntries(timelineDisplayEntries([
    {
      id: "tool-running",
      kind: "toolCall",
      toolName: "Bash",
      toolInput: "pnpm test",
      timestamp: "2026-06-27T00:00:02.000Z",
    },
  ]), { pendingPermissionRequestIds: new Set() })
  const activeGroup = activeNodes.find((node) => node.kind === "processGroup")

  expect(failedGroup?.kind === "processGroup" ? defaultProcessGroupOpen(failedGroup, { sending: false }) : false).toBe(true)
  expect(activeGroup?.kind === "processGroup" ? defaultProcessGroupOpen(activeGroup, { sending: false }) : false).toBe(true)
  expect(activeGroup?.kind === "processGroup" ? defaultProcessGroupOpen(activeGroup, { sending: true }) : false).toBe(true)
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: FAIL because `defaultProcessGroupOpen` is not exported.

- [ ] **Step 3: Add default-open helper**

Append this function to `agent-timeline-display.ts`:

```ts
export function defaultProcessGroupOpen(
  group: Extract<AgentTimelineDisplayNode, { kind: "processGroup" }>,
  context: { readonly sending: boolean },
): boolean {
  if (group.state.pendingPermission) return true
  if (group.state.failed || group.state.denied) return true
  if (group.state.active) return true
  if (context.sending && group.state.active) return true
  return false
}
```

- [ ] **Step 4: Run test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline-display.ts desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat: define agent process group open state"
```

## Task 4: Add AgentProcessGroup Component

**Files:**
- Create: `desktop/src/modules/agent/components/agent-process-group.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Write failing render test**

Add this test:

```ts
it("renders successful process groups collapsed with a compact title", () => {
  const html = renderTimeline({
    items: [
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-ok",
        toolName: "Read",
        toolInput: "package.json",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-ok",
        toolName: "Read",
        content: "package contents",
        success: true,
        timestamp: "2026-06-27T00:00:01.000Z",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        content: "Done",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
    ],
  })
  const text = textFromMarkup(html)

  expect(html).toContain("过程详情")
  expect(html).toContain('data-state="closed"')
  expect(text).toContain("Done")
  expect(text).not.toContain("package contents")
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: FAIL because `AgentTimeline` still renders the tool directly or because `过程详情` is absent.

- [ ] **Step 3: Create process group component**

Create `desktop/src/modules/agent/components/agent-process-group.tsx`:

```tsx
import { ChevronDown, ListTree } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { AgentAnnotation } from "./agent-annotation"

type AgentProcessGroupProps = {
  readonly summary: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: React.ReactNode
}

function AgentProcessGroup({
  summary,
  open,
  onOpenChange,
  children,
}: AgentProcessGroupProps) {
  return (
    <AgentAnnotation>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/agent-process-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          >
            <ListTree className="size-3.5" />
            <span className="truncate">{summary}</span>
            <ChevronDown
              data-icon="inline-end"
              className="size-3.5 transition-transform group-data-[state=closed]/agent-process-trigger:-rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-2 pb-2 pt-1">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

export { AgentProcessGroup }
export type { AgentProcessGroupProps }
```

- [ ] **Step 4: Run test and verify it still fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: FAIL because `AgentTimeline` has not wired the new component yet.

- [ ] **Step 5: Commit component scaffold**

```bash
git add desktop/src/modules/agent/components/agent-process-group.tsx desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat: add agent process group component"
```

## Task 5: Wire Process Groups Into AgentTimeline

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Add failed/pending render tests before implementation**

Add these tests:

```ts
it("opens failed process groups by default", () => {
  const html = renderTimeline({
    items: [
      {
        id: "tool-call",
        kind: "toolCall",
        toolUseId: "toolu-fail",
        toolName: "Bash",
        toolInput: "pnpm test",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "tool-result",
        kind: "toolResult",
        toolUseId: "toolu-fail",
        toolName: "Bash",
        content: "failed",
        success: false,
        timestamp: "2026-06-27T00:00:01.000Z",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        content: "I found a failure.",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
    ],
  })
  const text = textFromMarkup(html)

  expect(html).toContain('data-state="open"')
  expect(text).toContain("failed")
  expect(text).toContain("I found a failure.")
})

it("keeps pending permission requests visible outside process groups", () => {
  const html = renderTimeline({
    items: [
      {
        id: "permission",
        kind: "permissionRequest",
        requestId: "request-1",
        toolName: "Bash",
        toolInput: "rm file",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        content: "Waiting for permission.",
        timestamp: "2026-06-27T00:00:01.000Z",
      },
    ],
    pendingPermissions: [{
      requestId: "request-1",
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      toolName: "Bash",
      toolInput: "rm file",
      createdAt: "2026-06-27T00:00:00.000Z",
    }],
  })
  const text = textFromMarkup(html)

  expect(text).toContain("rm file")
  expect(text).toContain("Waiting for permission.")
  expect(text).not.toContain("过程详情")
})
```
- [ ] **Step 2: Run tests and verify failures**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: FAIL for process group render tests until wiring is complete.

- [ ] **Step 3: Wire display nodes in AgentTimeline**

In `agent-timeline.tsx`, update imports:

```ts
import { useState } from "react"
import {
  defaultProcessGroupOpen,
  groupTimelineDisplayEntries,
  timelineDisplayEntries,
} from "./agent-timeline-display"
import { AgentProcessGroup } from "./agent-process-group"
```

If `Ref` is currently imported from React in the same import, keep it:

```ts
import { useState, type Ref } from "react"
```

Inside `AgentTimeline`, before `return`, replace the current display entries calculation with:

```ts
const pendingPermissionRequestIds = new Set(pendingPermissions.map((permission) => permission.requestId))
const displayEntries = timelineDisplayEntries(items)
const displayNodes = groupTimelineDisplayEntries(displayEntries, { pendingPermissionRequestIds })
const [processGroupOpenOverrides, setProcessGroupOpenOverrides] = useState<Record<string, boolean>>({})
```

Replace the `displayEntries.map(...)` render block with:

```tsx
{displayNodes.map((node) => {
  if (node.kind === "processGroup") {
    const defaultOpen = defaultProcessGroupOpen(node, { sending })
    const open = processGroupOpenOverrides[node.id] ?? defaultOpen
    return (
      <AgentProcessGroup
        key={node.id}
        summary={node.summary}
        open={open}
        onOpenChange={(nextOpen) =>
          setProcessGroupOpenOverrides((current) => ({
            ...current,
            [node.id]: nextOpen,
          }))}
      >
        {node.entries.map((entry) => (
          entry.item.kind === "phase" ? (
            <AgentPhaseRow key={entry.item.id} item={entry.item} now={now} />
          ) : (
            <AgentTimelineItem
              key={entry.item.id}
              item={entry.item}
              {...(entry.result ? { toolResult: entry.result } : {})}
              profile={profile}
              agentIcon={agentIcon}
              pendingPermissions={pendingPermissions}
              latestPendingItemIds={latestPendingItemIds}
              onOpenReference={onOpenReference}
              onRespondPermission={onRespondPermission}
            />
          )
        ))}
      </AgentProcessGroup>
    )
  }
  const entry = node.entry
  return entry.item.kind === "phase" ? (
    <AgentPhaseRow key={entry.item.id} item={entry.item} now={now} />
  ) : (
    <AgentTimelineItem
      key={entry.item.id}
      item={entry.item}
      {...(entry.result ? { toolResult: entry.result } : {})}
      profile={profile}
      agentIcon={agentIcon}
      pendingPermissions={pendingPermissions}
      latestPendingItemIds={latestPendingItemIds}
      onOpenReference={onOpenReference}
      onRespondPermission={onRespondPermission}
    />
  )
})}
```

Update the empty-state condition from `displayEntries.length === 0` to:

```tsx
{displayNodes.length === 0 ? (
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat: render agent process groups"
```

## Task 6: Add Multi-Answer Regression Coverage

**Files:**
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Add regression tests**

Add these tests:

```ts
it("keeps multiple assistant answers visible between process groups", () => {
  const html = renderTimeline({
    items: [
      {
        id: "answer-a",
        kind: "message",
        role: "assistant",
        content: "First answer.",
        timestamp: "2026-06-27T00:00:00.000Z",
      },
      {
        id: "thinking-b",
        kind: "thinking",
        content: "Inspecting.",
        timestamp: "2026-06-27T00:00:01.000Z",
      },
      {
        id: "tool-b",
        kind: "toolCall",
        toolUseId: "toolu-b",
        toolName: "Read",
        toolInput: "package.json",
        timestamp: "2026-06-27T00:00:02.000Z",
      },
      {
        id: "tool-b-result",
        kind: "toolResult",
        toolUseId: "toolu-b",
        toolName: "Read",
        content: "package contents",
        success: true,
        timestamp: "2026-06-27T00:00:03.000Z",
      },
      {
        id: "answer-b",
        kind: "message",
        role: "assistant",
        content: "Second answer.",
        timestamp: "2026-06-27T00:00:04.000Z",
      },
      {
        id: "thinking-c",
        kind: "thinking",
        content: "Checking tests.",
        timestamp: "2026-06-27T00:00:05.000Z",
      },
      {
        id: "answer-c",
        kind: "message",
        role: "assistant",
        content: "Third answer.",
        timestamp: "2026-06-27T00:00:06.000Z",
      },
    ],
  })
  const text = textFromMarkup(html)

  expect(text).toContain("First answer.")
  expect(text).toContain("Second answer.")
  expect(text).toContain("Third answer.")
  expect(text.indexOf("First answer.")).toBeLessThan(text.indexOf("过程详情"))
  expect(text.indexOf("过程详情")).toBeLessThan(text.indexOf("Second answer."))
  expect(html.match(/过程详情/g)).toHaveLength(2)
  expect(text).not.toContain("package contents")
})

it("keeps result text visible after a tool boundary while grouping the tool", () => {
  const streamed = appendAgentTimelineEvent([], {
    type: "stream",
    deltaType: "text_delta",
    text: "I will inspect it.",
  }, "2026-06-27T00:00:00.000Z", "claude")
  const withTool = appendAgentTimelineEvent(streamed, {
    type: "toolResult",
    toolName: "Read",
    content: "package contents",
    success: true,
  }, "2026-06-27T00:00:01.000Z", "claude")
  const items = appendAgentTimelineEvent(withTool, {
    type: "result",
    content: "Final answer.",
    done: true,
  }, "2026-06-27T00:00:02.000Z", "claude")

  const html = renderTimeline({ items })
  const text = textFromMarkup(html)

  expect(text).toContain("I will inspect it.")
  expect(text).toContain("Final answer.")
  expect(text.indexOf("I will inspect it.")).toBeLessThan(text.indexOf("过程详情"))
  expect(text.indexOf("过程详情")).toBeLessThan(text.indexOf("Final answer."))
  expect(text).not.toContain("package contents")
})
```

- [ ] **Step 2: Run tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "test: cover agent process grouping answers"
```

## Task 7: Run Focused Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused component tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- agent-timeline agent-tool-event agent-thinking-event agent-timeline-item
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff --stat HEAD~6..HEAD
git status --short
```

Expected: only these implementation/test files changed since the first implementation commit:

```text
desktop/src/modules/agent/components/agent-process-group.tsx
desktop/src/modules/agent/components/agent-timeline-display.ts
desktop/src/modules/agent/components/agent-timeline.tsx
desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
```

Working tree should be clean.

## Self-Review Checklist

- Spec coverage:
  - Renderer-only grouping is covered by Tasks 1, 2, and 5.
  - Multi-answer preservation is covered by Task 6.
  - Pending permission visibility is covered by Tasks 2 and 5.
  - Failed process groups default open is covered by Tasks 3 and 5.
  - Tool result matching is preserved by Task 1.
- Placeholder scan: this plan contains no placeholder markers or unspecified implementation work.
- Type consistency:
  - `TimelineDisplayEntry` is exported from `agent-timeline-display.ts`.
  - `AgentTimelineDisplayNode` uses `entry` for plain nodes and `entries` for process groups.
  - `defaultProcessGroupOpen` accepts a process group node and `{ sending }`.
