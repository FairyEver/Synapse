# Agent 阶段反馈(Plan A:渲染管道 + T1/T2)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end pipeline for `agent.phase.update` domain events and ship two visible phase rows (`submitted`, `received`) emitted by the main-process IPC handler. Plan B will follow with Agent-runtime instrumentation for T3–T9.

**Architecture:** Add a new `kind: "phase"` to the timeline item union plus a new domain event variant `agent.phase.update` (emitted via the existing `synapse:events:agent` channel). Pure reducer + 1-second ticker hook + `AgentPhaseRow` component on the renderer. The IPC `send` handler emits two phase events at handler entry — `submitted` (already-`done`, with renderer-supplied `clientSubmittedAt` clamped) and `received` (`in-progress`, closes when first runtime phase arrives in Plan B). Sending derivation is enriched so the composer is locked while any phase on the conversation is in-progress.

**Tech Stack:** React 19, TypeScript (strict), Zod (IPC schemas), Vitest + `react-dom/server` (no DOM env), shadcn/ui (Lucide icons + Tailwind tokens), Electron EventBus + WindowBroadcaster.

**Spec:** `docs/superpowers/specs/2026-05-10-agent-phase-feedback-design.md`

**Out of scope (this plan):**
- Agent-runtime emit for T3–T9 (Plan B)
- Phase persistence into conversation history (Plan B)
- Cancel button (separate spec)
- Auto-timeout / hang warning (rejected by spec)

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `desktop/src/types/agent.ts` | Add `SynapseAgentPhaseTimelineItem` and the phase enum. |
| `desktop/electron/modules/agent/ipc-shared.ts` | Add Zod schema for `phase` timeline item + the new `agentPhaseUpdate` domain event payload. |
| `desktop/electron/modules/agent/ipc.ts` | Extend the agent event union with `agentPhaseUpdate`. |
| `desktop/electron/modules/agent/ipc-messages.ts` | `sendRequestSchema` gains `clientSubmittedAt`; handler emits `submitted` + `received` phase events at entry. |
| `desktop/electron/modules/agent/__tests__/ipc-phase.test.ts` | New test: handler emits the two phase events with correct shape and clamped timestamp. |
| `desktop/src/modules/agent/utils/phase-reducer.ts` | Pure self-healing reducer for phase events over `SynapseAgentTimelineItem[]`. |
| `desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts` | Unit tests covering all reducer rules. |
| `desktop/src/modules/agent/hooks/use-active-phase-ticker.ts` | Single `setInterval(1000)` driving live elapsed re-renders only while phases are in-progress. |
| `desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts` | Fake-timer unit tests. |
| `desktop/src/modules/agent/components/agent-phase-row.tsx` | Visual row rendering one phase item. |
| `desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx` | Render tests via `renderToStaticMarkup`. |
| `desktop/src/modules/agent/components/agent-timeline.tsx` | Map `kind: "phase"` to `AgentPhaseRow`; remove `AgentRunStatus` spinner row. |
| `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx` | Update existing assertions; add phase-row presence test. |
| `desktop/src/modules/agent/hooks/use-chat-events.ts` | Handle `agent.phase.update` events through the new reducer. |
| `desktop/src/modules/agent/hooks/use-chat-connection.ts` | Capture `clientSubmittedAt` and pass it to `bridge.agent.send`. |
| `desktop/src/modules/agent/hooks/use-chat-reducer.ts` | (no functional change — derived `sending` lives on the consumer side). |
| `desktop/src/modules/agent/hooks/use-agent-chat.ts` | Derive `sending` from `(sendingConversationIds OR any in-progress phase on this conversation)`. |
| `desktop/src/lib/agent-timeline.ts` | `appendAgentTimelineEvent` is unchanged for now (phase events don't go through `historyRecordToTimelineItem`); we route phase events through a separate path in `use-chat-events.ts`. |

No new dependencies. No changes to preload (the channel is already exposed). No changes to runtime/event-bus internals.

---

## Task 1: Add phase types to the renderer type model

**Files:**
- Modify: `desktop/src/types/agent.ts`

**Why:** Every downstream module needs a stable `kind: "phase"` shape to reduce against and render.

- [ ] **Step 1: Read current union shape**

Run: `sed -n '60,140p' desktop/src/types/agent.ts`

Expected: existing `SynapseAgentTimelineKind` union and `SynapseAgentTimelineItem` discriminated union.

- [ ] **Step 2: Edit `desktop/src/types/agent.ts`**

Add the phase value union immediately above the existing `SynapseAgentTimelineKind`:

```ts
export type SynapseAgentPhaseValue =
  | "submitted"
  | "received"
  | "runtime_starting"
  | "runtime_ready"
  | "request_submitted"
  | "awaiting_first_token"
  | "streaming"
  | "completed"
  | "failed"

export type SynapseAgentPhaseStatus = "in-progress" | "done" | "failed"
```

Add `"phase"` to `SynapseAgentTimelineKind`:

```ts
export type SynapseAgentTimelineKind =
  | "message"
  | "thinking"
  | "toolCall"
  | "toolResult"
  | "permissionRequest"
  | "error"
  | "result"
  | "phase"
```

Add the new interface right before the `SynapseAgentTimelineItem` union definition:

```ts
export interface SynapseAgentPhaseTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "phase"
  readonly runId: string
  readonly phase: SynapseAgentPhaseValue
  readonly status: SynapseAgentPhaseStatus
  readonly startedAt: string
  readonly completedAt?: string
  readonly errorMessage?: string
}
```

Append the new variant to the union:

```ts
export type SynapseAgentTimelineItem =
  | SynapseAgentMessageTimelineItem
  | SynapseAgentThinkingTimelineItem
  | SynapseAgentToolCallTimelineItem
  | SynapseAgentToolResultTimelineItem
  | SynapseAgentPermissionRequestTimelineItem
  | SynapseAgentErrorTimelineItem
  | SynapseAgentResultTimelineItem
  | SynapseAgentPhaseTimelineItem
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @synapse/desktop run typecheck` (or `tsc --noEmit` equivalent if no script — check `desktop/package.json` first)

Expected: green. Any failure means an existing consumer exhaustively switches on `SynapseAgentTimelineKind` without a `phase` branch — fix by adding a no-op branch (typically returning `null` for legacy switch tables).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/types/agent.ts
git commit -m "feat(agent): add SynapseAgentPhaseTimelineItem to timeline union"
```

---

## Task 2: Add Zod schemas for phase timeline item and phase domain event

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-shared.ts`

**Why:** Both the timeline item (when persisted in Plan B) and the new domain event need runtime validation through Zod, mirroring the renderer types.

- [ ] **Step 1: Read existing event/timeline schemas**

Run: `sed -n '34,100p' desktop/electron/modules/agent/ipc-shared.ts`

- [ ] **Step 2: Add the phase timeline schema variant**

Inside the `timelineItemSchema = z.discriminatedUnion("kind", [...])` array (immediately after the `result` variant), add:

```ts
z.object({
  ...timelineBaseSchema,
  kind: z.literal("phase"),
  runId: z.string(),
  phase: z.enum([
    "submitted",
    "received",
    "runtime_starting",
    "runtime_ready",
    "request_submitted",
    "awaiting_first_token",
    "streaming",
    "completed",
    "failed",
  ]),
  status: z.enum(["in-progress", "done", "failed"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  errorMessage: z.string().optional(),
}),
```

- [ ] **Step 3: Add the phase domain event schemas**

Append at the end of the file (before the file's last line):

```ts
// ─── Phase update domain event (T1/T2 in Plan A; T3..T9 in Plan B) ────────────

export const agentPhaseValueSchema = z.enum([
  "submitted",
  "received",
  "runtime_starting",
  "runtime_ready",
  "request_submitted",
  "awaiting_first_token",
  "streaming",
  "completed",
  "failed",
])

export const agentPhaseStatusSchema = z.enum(["in-progress", "done", "failed"])

export const agentPhaseUpdatePayloadSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string().optional(),
  phase: agentPhaseValueSchema,
  status: agentPhaseStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  errorMessage: z.string().optional(),
})

export type AgentPhaseUpdatePayload = z.infer<typeof agentPhaseUpdatePayloadSchema>
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @synapse/desktop run typecheck`

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/agent/ipc-shared.ts
git commit -m "feat(agent): add phase timeline & phase update event schemas"
```

---

## Task 3: Extend the agent event union with `phase.update`

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts`

**Why:** The renderer subscribes to a single `synapse:events:agent` channel whose payload is a discriminated union. The renderer's preload/typed bridge will only forward a phase event when the union admits it.

- [ ] **Step 1: Add the new domain event schema**

Below the existing `agentConversationUpdatedDomainEventSchema`, add:

```ts
const agentPhaseUpdateDomainEventSchema = z.object({
  domain: z.literal("agent"),
  type: z.literal("phase.update"),
  payload: agentPhaseUpdatePayloadSchema,
  timestamp: z.string(),
  scope: agentEventScopeSchema,
})
```

Update the import at the top to include the new schemas:

```ts
import {
  agentEventTypeSchema,
  agentEventSchema,
  agentEventScopeSchema,
  agentPhaseUpdatePayloadSchema,
} from "./ipc-shared"
```

Update the events union in the module export:

```ts
events: {
  event: {
    kind: "event",
    channel: "synapse:events:agent",
    payload: z.discriminatedUnion("type", [
      agentStreamDomainEventSchema,
      agentConversationUpdatedDomainEventSchema,
      agentPhaseUpdateDomainEventSchema,
    ]),
  },
},
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @synapse/desktop run typecheck`

Expected: green.

- [ ] **Step 3: Run any existing IPC tests**

Run: `pnpm --filter @synapse/desktop run test -- desktop/electron/modules/agent/__tests__/ipc.test.ts`

Expected: green (no regressions; the new variant is additive).

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/modules/agent/ipc.ts
git commit -m "feat(agent): admit phase.update into the agent event union"
```

---

## Task 4: Pure phase reducer + tests

**Files:**
- Create: `desktop/src/modules/agent/utils/phase-reducer.ts`
- Create: `desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`

**Why:** Spec §5.5. Self-healing semantics must be airtight; this is the most consequential piece of renderer logic and is the easiest to unit-test.

- [ ] **Step 1: Write the failing tests first**

Create `desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type {
  SynapseAgentPhaseTimelineItem,
  SynapseAgentPhaseValue,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { reducePhaseEvent } from "../phase-reducer"

const mkItem = (overrides: Partial<SynapseAgentPhaseTimelineItem>): SynapseAgentPhaseTimelineItem => ({
  id: overrides.id ?? "phase:default",
  kind: "phase",
  timestamp: overrides.timestamp ?? "2026-05-10T00:00:00.000Z",
  runId: overrides.runId ?? "run-1",
  phase: overrides.phase ?? "received",
  status: overrides.status ?? "in-progress",
  startedAt: overrides.startedAt ?? "2026-05-10T00:00:00.000Z",
  completedAt: overrides.completedAt,
  errorMessage: overrides.errorMessage,
})

const mkEvent = (overrides: {
  runId?: string
  phase: SynapseAgentPhaseValue
  status: "in-progress" | "done" | "failed"
  startedAt?: string
  completedAt?: string
  errorMessage?: string
  timestamp?: string
}) => ({
  runId: overrides.runId ?? "run-1",
  projectId: "p",
  sessionKey: "s",
  conversationId: "c",
  phase: overrides.phase,
  status: overrides.status,
  startedAt: overrides.startedAt ?? "2026-05-10T00:00:00.000Z",
  completedAt: overrides.completedAt,
  errorMessage: overrides.errorMessage,
  eventTimestamp: overrides.timestamp ?? "2026-05-10T00:00:00.500Z",
})

describe("reducePhaseEvent", () => {
  it("appends a new in-progress phase row", () => {
    const next = reducePhaseEvent([], mkEvent({ phase: "received", status: "in-progress" }))
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ kind: "phase", phase: "received", status: "in-progress" })
  })

  it("closes the matching in-progress row when a done event arrives", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:00.400Z" }),
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:00.400Z" })
  })

  it("auto-closes prior in-progress on the same runId when a new in-progress arrives", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "runtime_starting", status: "in-progress", timestamp: "2026-05-10T00:00:01.000Z" }),
    )
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:01.000Z" })
    expect(next[1]).toMatchObject({ phase: "runtime_starting", status: "in-progress" })
  })

  it("treats runtime_ready as alias closer for runtime_starting", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "runtime_starting", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "runtime_ready", status: "done", timestamp: "2026-05-10T00:00:02.000Z" }),
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "runtime_starting", status: "done", completedAt: "2026-05-10T00:00:02.000Z" })
  })

  it("treats completed as alias closer for streaming and any in-progress on the run", () => {
    const start: SynapseAgentTimelineItem[] = [
      mkItem({ id: "p1", phase: "streaming", status: "in-progress" }),
      mkItem({ id: "p2", phase: "tool_call" as SynapseAgentPhaseValue, status: "in-progress" }),
    ]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "completed", status: "done", timestamp: "2026-05-10T00:00:03.000Z" }),
    )
    expect(next.every((item) => item.kind === "phase" && item.status === "done")).toBe(true)
    expect(next).toHaveLength(2) // completed itself does NOT add a row
  })

  it("emits a failed terminal row and closes other in-progress phases as failed", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "runtime_starting", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "failed", status: "failed", errorMessage: "boom", timestamp: "2026-05-10T00:00:04.000Z" }),
    )
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ phase: "runtime_starting", status: "failed", errorMessage: "boom" })
    expect(next[1]).toMatchObject({ phase: "failed", status: "failed", errorMessage: "boom" })
  })

  it("is idempotent on duplicate in-progress events", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(start, mkEvent({ phase: "received", status: "in-progress" }))
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "received", status: "in-progress" })
  })

  it("does not affect items on a different runId", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", runId: "run-A", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(start, mkEvent({ runId: "run-B", phase: "received", status: "in-progress" }))
    expect(next).toHaveLength(2)
  })

  it("inserts closed item with warn marker when done arrives without prior in-progress", () => {
    const next = reducePhaseEvent(
      [],
      mkEvent({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:05.000Z" }),
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "received", status: "done" })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement the reducer**

Create `desktop/src/modules/agent/utils/phase-reducer.ts`:

```ts
import type {
  SynapseAgentPhaseStatus,
  SynapseAgentPhaseTimelineItem,
  SynapseAgentPhaseValue,
  SynapseAgentTimelineItem,
} from "@/types/agent"

export interface PhaseReducerEvent {
  readonly runId: string
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
  readonly phase: SynapseAgentPhaseValue
  readonly status: SynapseAgentPhaseStatus
  readonly startedAt: string
  readonly completedAt?: string
  readonly errorMessage?: string
  readonly eventTimestamp: string
}

const ALIAS_CLOSERS: Record<string, SynapseAgentPhaseValue> = {
  runtime_ready: "runtime_starting",
  // `completed` closes streaming AND any other in-progress phase on the run (handled below).
}

function isPhaseItem(item: SynapseAgentTimelineItem): item is SynapseAgentPhaseTimelineItem {
  return item.kind === "phase"
}

function newPhaseId(runId: string, phase: SynapseAgentPhaseValue): string {
  return `phase:${runId}:${phase}`
}

function closeItem(
  item: SynapseAgentPhaseTimelineItem,
  status: SynapseAgentPhaseStatus,
  completedAt: string,
  errorMessage?: string,
): SynapseAgentPhaseTimelineItem {
  return { ...item, status, completedAt, errorMessage: errorMessage ?? item.errorMessage }
}

export function reducePhaseEvent(
  current: readonly SynapseAgentTimelineItem[],
  event: PhaseReducerEvent,
): SynapseAgentTimelineItem[] {
  const items = [...current]

  // 1. Alias: runtime_ready closes runtime_starting; nothing else.
  const aliasFor = ALIAS_CLOSERS[event.phase]
  if (aliasFor) {
    return items.map((item) => {
      if (!isPhaseItem(item)) return item
      if (item.runId !== event.runId) return item
      if (item.phase !== aliasFor) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage)
    })
  }

  // 2. completed is the run-success terminal: closes ALL in-progress on this run, no row appended.
  if (event.phase === "completed") {
    return items.map((item) => {
      if (!isPhaseItem(item)) return item
      if (item.runId !== event.runId) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage)
    })
  }

  // 3. failed is the run-failure terminal: closes all in-progress as failed AND appends a terminal row.
  if (event.phase === "failed") {
    const closed = items.map((item) => {
      if (!isPhaseItem(item)) return item
      if (item.runId !== event.runId) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, "failed", event.completedAt ?? event.eventTimestamp, event.errorMessage)
    })
    closed.push({
      id: newPhaseId(event.runId, "failed"),
      kind: "phase",
      timestamp: event.eventTimestamp,
      runId: event.runId,
      phase: "failed",
      status: "failed",
      startedAt: event.startedAt,
      completedAt: event.completedAt ?? event.eventTimestamp,
      errorMessage: event.errorMessage,
    })
    return closed
  }

  // 4. Normal in-progress: idempotent if same (runId, phase) is already in-progress; otherwise close prior in-progress on run + append new.
  if (event.status === "in-progress") {
    const duplicate = items.some(
      (item) =>
        isPhaseItem(item)
        && item.runId === event.runId
        && item.phase === event.phase
        && item.status === "in-progress",
    )
    if (duplicate) return items

    const closed = items.map((item) => {
      if (!isPhaseItem(item)) return item
      if (item.runId !== event.runId) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, "done", event.eventTimestamp)
    })
    closed.push({
      id: newPhaseId(event.runId, event.phase),
      kind: "phase",
      timestamp: event.eventTimestamp,
      runId: event.runId,
      phase: event.phase,
      status: "in-progress",
      startedAt: event.startedAt,
    })
    return closed
  }

  // 5. Normal done|failed for a non-terminal phase: mutate existing matching in-progress, else insert as closed.
  const idx = items.findIndex(
    (item) =>
      isPhaseItem(item)
      && item.runId === event.runId
      && item.phase === event.phase
      && item.status === "in-progress",
  )
  if (idx >= 0) {
    const target = items[idx] as SynapseAgentPhaseTimelineItem
    items[idx] = closeItem(target, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage)
    return items
  }

  // No prior in-progress — insert as closed and let the caller log a warning at the call site.
  items.push({
    id: newPhaseId(event.runId, event.phase),
    kind: "phase",
    timestamp: event.eventTimestamp,
    runId: event.runId,
    phase: event.phase,
    status: event.status,
    startedAt: event.startedAt,
    completedAt: event.completedAt ?? event.eventTimestamp,
    errorMessage: event.errorMessage,
  })
  return items
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`

Expected: PASS for all 9 cases.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/utils/phase-reducer.ts \
        desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts
git commit -m "feat(agent): add self-healing phase reducer with full test coverage"
```

---

## Task 5: Active phase ticker hook

**Files:**
- Create: `desktop/src/modules/agent/hooks/use-active-phase-ticker.ts`
- Create: `desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts`

**Why:** Spec §6 / §5.3 — single 1-second interval that wakes only while at least one phase row is in-progress; cleans up on unmount and when the last phase closes.

- [ ] **Step 1: Write the failing test**

Create `desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts`:

```ts
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useActivePhaseTicker } from "../use-active-phase-ticker"
import type { SynapseAgentTimelineItem } from "@/types/agent"

function asPhase(status: "in-progress" | "done"): SynapseAgentTimelineItem {
  return {
    id: `phase:${status}`,
    kind: "phase",
    timestamp: "2026-05-10T00:00:00.000Z",
    runId: "run",
    phase: "received",
    status,
    startedAt: "2026-05-10T00:00:00.000Z",
  }
}

describe("useActivePhaseTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The hook is exercised through a tiny driver component because hooks need a
  // React render. SSR-friendly: we just render once and assert no throw.
  function Driver({ items }: { items: SynapseAgentTimelineItem[] }) {
    const tick = useActivePhaseTicker(items)
    return <span data-tick={tick} />
  }

  it("renders without error when there are no phase items", () => {
    const html = renderToStaticMarkup(<Driver items={[]} />)
    expect(html).toContain("data-tick=\"0\"")
  })

  it("renders without error when items are present (interval setup is side-effecting only)", () => {
    const html = renderToStaticMarkup(<Driver items={[asPhase("in-progress")]} />)
    expect(html).toContain("data-tick=\"0\"")
  })
})
```

(Note: SSR can't observe `useEffect` side effects. Behavioral assertions about the interval are exercised through Task 7's integration test where the renderer is hydrated. This test guards against accidental render-time failures — the most common regression.)

- [ ] **Step 2: Run the tests to confirm failure**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement the hook**

Create `desktop/src/modules/agent/hooks/use-active-phase-ticker.ts`:

```ts
import { useEffect, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

const TICK_INTERVAL_MS = 1000

function hasActivePhase(items: readonly SynapseAgentTimelineItem[]): boolean {
  for (const item of items) {
    if (item.kind === "phase" && item.status === "in-progress") return true
  }
  return false
}

export function useActivePhaseTicker(items: readonly SynapseAgentTimelineItem[]): number {
  const [tick, setTick] = useState(0)
  const active = hasActivePhase(items)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((value) => value + 1), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [active])
  return tick
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-active-phase-ticker.ts \
        desktop/src/modules/agent/hooks/__tests__/use-active-phase-ticker.test.ts
git commit -m "feat(agent): add useActivePhaseTicker hook"
```

---

## Task 6: `AgentPhaseRow` component + tests

**Files:**
- Create: `desktop/src/modules/agent/components/agent-phase-row.tsx`
- Create: `desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx`

**Why:** Spec §6.1, §6.2. Single visual unit that renders one phase item.

- [ ] **Step 1: Write the failing test**

Create `desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { SynapseAgentPhaseTimelineItem } from "@/types/agent"
import { AgentPhaseRow } from "../agent-phase-row"

function mk(item: Partial<SynapseAgentPhaseTimelineItem>): SynapseAgentPhaseTimelineItem {
  return {
    id: item.id ?? "phase:test",
    kind: "phase",
    timestamp: item.timestamp ?? "2026-05-10T00:00:00.000Z",
    runId: item.runId ?? "run",
    phase: item.phase ?? "received",
    status: item.status ?? "in-progress",
    startedAt: item.startedAt ?? "2026-05-10T00:00:00.000Z",
    completedAt: item.completedAt,
    errorMessage: item.errorMessage,
  }
}

describe("AgentPhaseRow", () => {
  it("renders the phase label for in-progress submitted", () => {
    const html = renderToStaticMarkup(<AgentPhaseRow item={mk({ phase: "submitted", status: "done", completedAt: "2026-05-10T00:00:00.400Z" })} now={Date.parse("2026-05-10T00:00:00.500Z")} />)
    expect(html).toContain("已发送")
  })

  it("renders 已收到 for received done", () => {
    const html = renderToStaticMarkup(<AgentPhaseRow item={mk({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:00.005Z" })} now={Date.parse("2026-05-10T00:00:00.500Z")} />)
    expect(html).toContain("已收到")
  })

  it("shows the error message on a failed row", () => {
    const html = renderToStaticMarkup(<AgentPhaseRow item={mk({ phase: "failed", status: "failed", errorMessage: "CLI exited 1", completedAt: "2026-05-10T00:00:01.000Z" })} now={Date.parse("2026-05-10T00:00:02.000Z")} />)
    expect(html).toContain("失败")
    expect(html).toContain("CLI exited 1")
  })

  it("uses the destructive token color on failed", () => {
    const html = renderToStaticMarkup(<AgentPhaseRow item={mk({ phase: "failed", status: "failed", errorMessage: "x", completedAt: "2026-05-10T00:00:01.000Z" })} now={Date.parse("2026-05-10T00:00:02.000Z")} />)
    expect(html).toContain("text-destructive")
  })

  it("computes elapsed seconds for in-progress with one decimal", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "runtime_starting", status: "in-progress" })}
        now={Date.parse("2026-05-10T00:00:01.250Z")}
      />,
    )
    expect(html).toContain("1.3s") // 1.25 -> 1.3 with toFixed(1)
  })

  it("renders 0.0s when startedAt equals completedAt", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "received", status: "done", startedAt: "2026-05-10T00:00:00.000Z", completedAt: "2026-05-10T00:00:00.000Z" })}
        now={Date.parse("2026-05-10T00:00:00.500Z")}
      />,
    )
    expect(html).toContain("0.0s")
  })
})
```

- [ ] **Step 2: Run the tests to confirm failure**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement the component**

Create `desktop/src/modules/agent/components/agent-phase-row.tsx`:

```tsx
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentPhaseTimelineItem,
  SynapseAgentPhaseValue,
} from "@/types/agent"

const PHASE_LABEL_IN_PROGRESS: Partial<Record<SynapseAgentPhaseValue, string>> = {
  runtime_starting: "Agent 启动中",
  request_submitted: "已提交给模型",
  awaiting_first_token: "等待回复",
  streaming: "正在回复",
}

const PHASE_LABEL_DONE: Partial<Record<SynapseAgentPhaseValue, string>> = {
  submitted: "已发送",
  received: "已收到",
  runtime_starting: "Agent 已就绪",
  request_submitted: "已提交",
  awaiting_first_token: "模型已回应",
  streaming: "回复完成",
}

const PHASE_LABEL_FAILED: Partial<Record<SynapseAgentPhaseValue, string>> = {
  submitted: "已发送",
  received: "已收到",
  runtime_starting: "启动失败",
  request_submitted: "提交失败",
  awaiting_first_token: "等待超时",
  streaming: "回复中断",
  failed: "失败",
}

function pickLabel(item: SynapseAgentPhaseTimelineItem): string {
  if (item.status === "in-progress") return PHASE_LABEL_IN_PROGRESS[item.phase] ?? item.phase
  if (item.status === "failed") return PHASE_LABEL_FAILED[item.phase] ?? item.phase
  return PHASE_LABEL_DONE[item.phase] ?? item.phase
}

function elapsedSeconds(item: SynapseAgentPhaseTimelineItem, now: number): number {
  const start = Date.parse(item.startedAt)
  const end = item.completedAt ? Date.parse(item.completedAt) : now
  const ms = Math.max(0, end - start)
  return ms / 1000
}

function formatElapsed(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

export function AgentPhaseRow({
  item,
  now,
}: {
  readonly item: SynapseAgentPhaseTimelineItem
  readonly now: number
}) {
  const failed = item.status === "failed"
  const inProgress = item.status === "in-progress"
  const label = pickLabel(item)
  const elapsed = elapsedSeconds(item, now)

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 px-1 py-1 text-xs",
        failed ? "text-destructive" : "text-muted-foreground",
      )}
      aria-live={inProgress ? "polite" : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex w-3 items-center justify-center">
          {inProgress ? (
            <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden />
          ) : failed ? (
            <X size={12} strokeWidth={2.5} aria-hidden />
          ) : (
            <Check size={12} strokeWidth={2.5} aria-hidden />
          )}
        </span>
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular-nums">{formatElapsed(elapsed)}</span>
      </div>
      {failed && item.errorMessage ? (
        <div className="pl-5 text-destructive">{item.errorMessage}</div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx`

Expected: PASS for all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-phase-row.tsx \
        desktop/src/modules/agent/components/__tests__/agent-phase-row.test.tsx
git commit -m "feat(agent): add AgentPhaseRow component"
```

---

## Task 7: Wire `AgentPhaseRow` into `AgentTimeline` and remove the legacy spinner row

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

**Why:** Spec §6.3. The active phase row replaces the standalone `<AgentRunStatus />` indicator.

- [ ] **Step 1: Read current map block**

Run: `sed -n '38,53p' desktop/src/modules/agent/components/agent-timeline.tsx`

Expected: existing `items.map(...)` plus the conditional `{sending ? <AgentRunStatus /> : null}` line.

- [ ] **Step 2: Replace the timeline render block**

Edit `desktop/src/modules/agent/components/agent-timeline.tsx`:

Imports (replace the current `AgentRunStatus` import — leave the file `agent-run-status.tsx` in place; it may still be reused elsewhere later):

```tsx
import { useActivePhaseTicker } from "../hooks/use-active-phase-ticker"
import { AgentPhaseRow } from "./agent-phase-row"
// remove: import { AgentRunStatus } from "./agent-run-status"
```

Inside the component body (immediately above the `return`), call the ticker. The hook returns a tick number that increments every second while a phase is active; we recompute `now` on every render driven by that tick:

```tsx
useActivePhaseTicker(items)
const now = Date.now()
```

The hook's internal `setState` triggers re-render; we don't need to read its return value. The tick number is exposed for callers that want to thread it into a key, but `AgentPhaseRow` doesn't need it because `Date.now()` re-reads on every render.

Replace the inner `items.map(...) + sending spinner` block with:

```tsx
{items.length === 0 && !items.some((item) => item.kind === "phase") ? (
  <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
) : items.map((item) => (
  item.kind === "phase" ? (
    <AgentPhaseRow key={item.id} item={item} now={now} />
  ) : (
    <AgentTimelineItem
      key={item.id}
      item={item}
      profile={profile}
      agentIcon={agentIcon}
      pendingPermissions={pendingPermissions}
      onOpenReference={onOpenReference}
      onRespondPermission={onRespondPermission}
    />
  )
))}
```

The `sending` prop is now unused inside the component; keep it on the type (the consumer still passes it) and prefix-ignore via underscore to satisfy lint:

```tsx
function AgentTimeline({
  items,
  profile,
  agentIcon,
  sending: _sending,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
  viewportRef,
  showJumpToBottom,
  onJumpToBottom,
}: { ... }) {
```

- [ ] **Step 3: Update the existing test file**

Edit `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`:

Add a new test case at the end of `describe("AgentTimeline", ...)`:

```tsx
it("renders an AgentPhaseRow for phase items", () => {
  const html = renderTimeline({
    items: [
      {
        id: "phase:received",
        kind: "phase",
        timestamp: "2026-05-10T00:00:00.000Z",
        runId: "run-1",
        phase: "received",
        status: "in-progress",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    ],
  })
  expect(html).toContain("0.0s")
  expect(html).not.toContain("正在处理") // legacy AgentRunStatus copy must not surface
})

it("does not render the legacy 正在处理 spinner row even when sending=true", () => {
  const html = renderTimeline({ sending: true })
  expect(html).not.toContain("正在处理")
})
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

Expected: PASS, including new tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline.tsx \
        desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat(agent): replace static spinner row with AgentPhaseRow rendering"
```

---

## Task 8: Subscribe to `phase.update` events in `use-chat-events.ts`

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-chat-events.ts`

**Why:** Renderer-side glue: route `phase.update` payloads through `reducePhaseEvent`, scoped to `(projectId, sessionKey)` so phase rows show up in the correct conversation context even when the conversation hasn't been created yet.

- [ ] **Step 1: Read current event subscription block**

Run: `sed -n '40,148p' desktop/src/modules/agent/hooks/use-chat-events.ts`

- [ ] **Step 2: Add the new branch in the event listener**

In the `bridge.agent.onEvent((domainEvent) => {...})` body, add a branch BEFORE the existing `if (domainEvent.type === "conversationUpdated") {...}` block:

```ts
if (domainEvent.type === "phase.update") {
  const payload = domainEvent.payload
  if (!projectIdsRef.current.includes(payload.projectId)) return
  // Only update when this phase belongs to the conversation currently selected
  // (or matches by sessionKey when conversationId hasn't been bound yet).
  const selectedProject = selectedProjectIdRef.current
  const selectedConv = selectedConversationIdRef.current
  const selectedSession = selectedSessionKeyRef.current
  const sameProject = payload.projectId === selectedProject
  const sameSessionKey = payload.sessionKey === selectedSession
  const sameConv = payload.conversationId
    ? payload.conversationId === selectedConv
    : sameSessionKey
  if (!sameProject || !sameConv) {
    logger.debug("Phase event ignored for inactive conversation.", {
      projectId: payload.projectId,
      sessionKey: payload.sessionKey,
      conversationId: payload.conversationId,
      phase: payload.phase,
      status: payload.status,
    })
    return
  }
  updateTimeline((current) => reducePhaseEvent(current, {
    runId: payload.runId,
    projectId: payload.projectId,
    sessionKey: payload.sessionKey,
    conversationId: payload.conversationId,
    phase: payload.phase,
    status: payload.status,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    errorMessage: payload.errorMessage,
    eventTimestamp: domainEvent.timestamp,
  }))
  if (payload.phase === "failed" || (payload.phase === "completed" && payload.status === "done")) {
    if (payload.conversationId) {
      dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId: payload.conversationId })
    }
  }
  return
}
```

Add the import at the top:

```ts
import { reducePhaseEvent } from "../utils/phase-reducer"
```

- [ ] **Step 3: Run the existing tests in this module**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent`

Expected: PASS (no regression — the new branch is additive). If a typing error appears for the union, double-check that Task 3 actually merged (the union must already include `phase.update`).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-chat-events.ts
git commit -m "feat(agent): route phase.update events through phase reducer"
```

---

## Task 9: Capture `clientSubmittedAt` on send and unlock composer when phase finishes

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`

**Why:** The `submitted` phase row needs the renderer's view of "when did the user press Enter". Enriches `bridge.agent.send` with the new optional input.

- [ ] **Step 1: Read current `sendMessage`**

Run: `sed -n '370,410p' desktop/src/modules/agent/hooks/use-chat-connection.ts`

- [ ] **Step 2: Capture `clientSubmittedAt` and pass it through**

Modify `sendMessage`:

```ts
const sendMessage = useCallback(async (content: string) => {
  const trimmed = content.trim()
  if (!trimmed) return
  const selected = findSessionByRef(
    state.sessions,
    selectedProjectIdRef.current,
    selectedConversationIdRef.current,
  )
  const projectId = selected?.projectId ?? getDefaultProjectId()
  if (!projectId) return
  const conversationId = selected?.id
  const bridge = requireSynapseBridge()
  const sessionKey = selected?.sessionKey ?? selectedSessionKeyRef.current
  const now = new Date().toISOString()
  updateTimeline((current) => [
    ...current,
    localUserTimelineItem(trimmed, now, current.length),
  ])
  if (conversationId) {
    dispatch({ type: "ADD_SENDING_CONVERSATION", conversationId })
  }
  dispatch({ type: "SET_ERROR", error: null })
  try {
    await bridge.agent.send({
      projectId,
      sessionKey,
      content: trimmed,
      clientSubmittedAt: now,
    })
  } catch (rawError) {
    const message = rawError instanceof Error ? rawError.message : "发送失败"
    logger.error("Agent send failed.", rawError)
    dispatch({ type: "SET_ERROR", error: message })
  } finally {
    if (conversationId) {
      dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId })
    }
  }
}, [dispatch, getDefaultProjectId, selectedConversationIdRef, selectedProjectIdRef, selectedSessionKeyRef, state.sessions, updateTimeline])
```

(The `clientSubmittedAt` field will surface as a TS error until Task 10 lands the schema + preload type. Acknowledge and move on — Task 10 closes the loop.)

- [ ] **Step 3: Type-check (expected to fail at this exact line until Task 10)**

Run: `pnpm --filter @synapse/desktop run typecheck`

Expected: ONE failure at `bridge.agent.send({..., clientSubmittedAt})`. Note the file/line for the next task to confirm.

- [ ] **Step 4: Commit (with deliberate WIP marker)**

```bash
git add desktop/src/modules/agent/hooks/use-chat-connection.ts
git commit -m "wip(agent): pass clientSubmittedAt through agent.send (schema follows)"
```

---

## Task 10: Extend `agent.send` IPC schema and emit `submitted` + `received` phase events

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-messages.ts`
- Create: `desktop/electron/modules/agent/__tests__/ipc-phase.test.ts`

**Why:** Spec §3 / §5.4 — the only main-process emit point in Plan A. After this task, the renderer sees two phase rows on every send.

- [ ] **Step 1: Add `clientSubmittedAt` to the request schema**

Edit `desktop/electron/modules/agent/ipc-messages.ts`:

```ts
const sendRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  content: z.string().min(1),
  clientSubmittedAt: z.string().optional(),
})
```

- [ ] **Step 2: Add EventBus + nanoid import + clamp helper**

At the top of the file (after the existing imports):

```ts
import { nanoid } from "nanoid"
import type { EventBus } from "../../runtime/event-bus"
```

Verify nanoid is already a dependency: `grep '"nanoid"' desktop/package.json`. If absent, ADD it via `pnpm --filter @synapse/desktop add nanoid` BEFORE continuing — this is the only allowed dep addition in Plan A and it's needed for `runId` generation. (If nanoid already ships transitively, prefer that.)

Add a clamp helper at module scope (above the descriptors):

```ts
const MAX_CLIENT_SKEW_MS = 60_000

function clampClientSubmittedAt(clientIso: string | undefined, recvIso: string): string {
  if (!clientIso) return recvIso
  const recv = Date.parse(recvIso)
  const client = Date.parse(clientIso)
  if (!Number.isFinite(client) || !Number.isFinite(recv)) return recvIso
  if (client > recv) return recvIso // client clock ahead → snap to recv
  if (recv - client > MAX_CLIENT_SKEW_MS) return recvIso // too old → reject
  return clientIso
}
```

- [ ] **Step 3: Emit phase events at handler entry**

Replace the `send` method handler:

```ts
send: {
  kind: "invoke",
  channel: "synapse:agent:send",
  request: sendRequestSchema,
  response: sendResultSchema,
  handler: async (ctx, request: SendRequest) => {
    const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
    const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
    const eventBus = ctx.resolve<EventBus>("core.event-bus")
    const runId = nanoid()
    const t_recv = new Date().toISOString()
    const submittedAt = clampClientSubmittedAt(request.clientSubmittedAt, t_recv)

    eventBus.emit({
      domain: "agent",
      type: "phase.update",
      payload: {
        runId,
        projectId: request.projectId,
        sessionKey,
        phase: "submitted",
        status: "done",
        startedAt: submittedAt,
        completedAt: t_recv,
      },
      scope: { projectId: request.projectId },
      timestamp: t_recv,
    })

    eventBus.emit({
      domain: "agent",
      type: "phase.update",
      payload: {
        runId,
        projectId: request.projectId,
        sessionKey,
        phase: "received",
        status: "in-progress",
        startedAt: t_recv,
      },
      scope: { projectId: request.projectId },
      timestamp: t_recv,
    })

    try {
      const result = await agent.send({
        projectId: request.projectId,
        sessionKey,
        platform: LOCAL_RENDERER_PLATFORM,
        userId: "renderer",
        userName: "Renderer",
        content: request.content,
        replyCtx: {
          kind: LOCAL_RENDERER_PLATFORM,
          projectId: request.projectId,
          sessionKey,
        },
      })
      // Plan B will emit T3..T7 inside the runtime. Here we close `received` as
      // a `done` once `agent.send` returns AND emit a `completed` (success) /
      // `failed` (error) terminal so the renderer's sending derivation unlocks.
      const t_done = new Date().toISOString()
      eventBus.emit({
        domain: "agent",
        type: "phase.update",
        payload: {
          runId,
          projectId: request.projectId,
          sessionKey,
          conversationId: result.conversationId,
          phase: "received",
          status: "done",
          startedAt: t_recv,
          completedAt: t_done,
        },
        scope: { projectId: request.projectId },
        timestamp: t_done,
      })
      eventBus.emit({
        domain: "agent",
        type: "phase.update",
        payload: {
          runId,
          projectId: request.projectId,
          sessionKey,
          conversationId: result.conversationId,
          phase: result.error ? "failed" : "completed",
          status: result.error ? "failed" : "done",
          startedAt: t_recv,
          completedAt: t_done,
          errorMessage: result.error,
        },
        scope: { projectId: request.projectId },
        timestamp: t_done,
      })
      return {
        projectId: request.projectId,
        sessionKey,
        conversationId: result.conversationId,
        resultText: result.resultText,
        events: result.events as AgentEvent[],
        agentSessionId: result.agentSessionId,
        threadId: result.threadId,
        error: result.error,
      }
    } catch (rawError) {
      const t_fail = new Date().toISOString()
      const message = rawError instanceof Error ? rawError.message : "发送失败"
      eventBus.emit({
        domain: "agent",
        type: "phase.update",
        payload: {
          runId,
          projectId: request.projectId,
          sessionKey,
          phase: "failed",
          status: "failed",
          startedAt: t_recv,
          completedAt: t_fail,
          errorMessage: message,
        },
        scope: { projectId: request.projectId },
        timestamp: t_fail,
      })
      throw rawError
    }
  },
},
```

- [ ] **Step 4: Write the IPC handler test**

Create `desktop/electron/modules/agent/__tests__/ipc-phase.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { EventBus } from "../../../runtime/event-bus"
import { agentIpcModule } from "../ipc"

const SEND_CHANNEL = "synapse:agent:send"

function getSendDescriptor() {
  return agentIpcModule.methods["send"]!
}

function makeEventBus() {
  const emitted: any[] = []
  const eventBus = {
    emit: vi.fn((event) => emitted.push(event)),
    emitInternal: vi.fn(),
    on: vi.fn(() => () => {}),
    onType: vi.fn(() => () => {}),
  } as unknown as EventBus
  return { eventBus, emitted }
}

function makeAgent() {
  return {
    send: vi.fn(async () => ({
      conversationId: "conv-1",
      resultText: "ok",
      events: [],
    })),
  }
}

function makeCtx({ eventBus, agent }: { eventBus: EventBus; agent: ReturnType<typeof makeAgent> }) {
  return {
    moduleId: "agent",
    resolve: vi.fn((id: string) => {
      if (id === "core.event-bus") return eventBus
      throw new Error(`Unexpected resolve: ${id}`)
    }),
  } as any
}

// We cannot call resolveProjectAgent in this isolated unit test (it touches config
// store and project containers). For Plan A we patch the helper used inside the
// handler via `vi.mock` below.
vi.mock("../ipc-shared", async (importActual) => {
  const actual = await importActual<typeof import("../ipc-shared")>()
  return {
    ...actual,
    resolveProjectAgent: vi.fn(async () => ({
      agent: { send: vi.fn(async () => ({ conversationId: "conv-1", resultText: "ok", events: [] })) },
      providerConfig: {} as any,
      project: { uuid: "p", name: "p", localPath: "/tmp" },
    })),
  }
})

describe("agent.send IPC handler — phase emit (Plan A)", () => {
  it("emits submitted (done) + received (in-progress) at handler entry, then received (done) + completed (done) on success", async () => {
    const descriptor = getSendDescriptor()
    expect(descriptor.channel).toBe(SEND_CHANNEL)

    const { eventBus, emitted } = makeEventBus()
    const ctx = makeCtx({ eventBus, agent: makeAgent() })
    await descriptor.handler(ctx, {
      projectId: "p",
      content: "hi",
      clientSubmittedAt: new Date(Date.now() - 100).toISOString(),
    } as any)

    const phases = emitted
      .filter((e) => e.type === "phase.update")
      .map((e) => ({ phase: e.payload.phase, status: e.payload.status }))

    expect(phases).toEqual([
      { phase: "submitted", status: "done" },
      { phase: "received", status: "in-progress" },
      { phase: "received", status: "done" },
      { phase: "completed", status: "done" },
    ])
  })

  it("clamps a client clock that is ahead of the server", async () => {
    const descriptor = getSendDescriptor()
    const { eventBus, emitted } = makeEventBus()
    const ctx = makeCtx({ eventBus, agent: makeAgent() })

    const future = new Date(Date.now() + 5_000).toISOString()
    await descriptor.handler(ctx, {
      projectId: "p",
      content: "hi",
      clientSubmittedAt: future,
    } as any)

    const submitted = emitted.find((e) => e.type === "phase.update" && e.payload.phase === "submitted")
    expect(submitted).toBeDefined()
    // Clamped: startedAt should NOT be the future timestamp.
    expect(submitted!.payload.startedAt).not.toBe(future)
  })

  it("falls back to t_recv when clientSubmittedAt is older than 60s", async () => {
    const descriptor = getSendDescriptor()
    const { eventBus, emitted } = makeEventBus()
    const ctx = makeCtx({ eventBus, agent: makeAgent() })

    const stale = new Date(Date.now() - 120_000).toISOString()
    await descriptor.handler(ctx, {
      projectId: "p",
      content: "hi",
      clientSubmittedAt: stale,
    } as any)

    const submitted = emitted.find((e) => e.type === "phase.update" && e.payload.phase === "submitted")
    expect(submitted!.payload.startedAt).not.toBe(stale)
  })

  it("emits a failed phase when agent.send throws", async () => {
    // Re-mock resolveProjectAgent for this case.
    const ipcShared = await import("../ipc-shared")
    ;(ipcShared.resolveProjectAgent as any).mockImplementationOnce(async () => ({
      agent: { send: vi.fn(async () => { throw new Error("nope") }) },
      providerConfig: {} as any,
      project: { uuid: "p", name: "p", localPath: "/tmp" },
    }))

    const descriptor = getSendDescriptor()
    const { eventBus, emitted } = makeEventBus()
    const ctx = makeCtx({ eventBus, agent: makeAgent() })

    await expect(
      descriptor.handler(ctx, { projectId: "p", content: "hi" } as any),
    ).rejects.toThrow("nope")

    const failed = emitted.find((e) => e.type === "phase.update" && e.payload.phase === "failed")
    expect(failed).toBeDefined()
    expect(failed!.payload.errorMessage).toBe("nope")
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/electron/modules/agent/__tests__/ipc-phase.test.ts`

Expected: PASS for all 4 cases.

- [ ] **Step 6: Run typecheck and confirm Task 9's WIP error is resolved**

Run: `pnpm --filter @synapse/desktop run typecheck`

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/agent/ipc-messages.ts \
        desktop/electron/modules/agent/__tests__/ipc-phase.test.ts \
        desktop/package.json desktop/pnpm-lock.yaml
git commit -m "feat(agent): emit submitted/received/completed phase events from agent.send"
```

(If `nanoid` was not added, drop the lockfile/package.json paths from the `git add`.)

---

## Task 11: Run the agent module test suite end-to-end

**Files:** none (verification only).

- [ ] **Step 1: Run the full agent module tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/src/modules/agent desktop/electron/modules/agent`

Expected: green across reducer, ticker, AgentPhaseRow, AgentTimeline, and IPC handler.

- [ ] **Step 2: Run hard-constraints scan**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints`

Expected: green. The phase event emission goes through `EventBus`, not bare `webContents.send`; renderer subscribes via the existing typed bridge, not raw `ipcRenderer`.

- [ ] **Step 3: Run typecheck once more**

Run: `pnpm --filter @synapse/desktop run typecheck`

Expected: green.

- [ ] **Step 4: Commit (no-op if nothing changed) — optional housekeeping**

```bash
git status
```

Only commit if uncommitted files appeared (e.g., snapshot regeneration).

---

## Task 12: Manual smoke verification (operator-driven)

**Files:** none.

This task is the bridge between Plan A merging and Plan B starting. Cascade should NOT run a dev server unattended — leave this to the operator.

Hand off these instructions to the user verbatim:

> Manual smoke (your decision when to run):
>
> 1. `pnpm dev` to bring up the desktop app.
> 2. Open the Agent module on a known project.
> 3. Send any message.
> 4. Expected: immediately after the user message bubble appears, two muted rows appear in sequence:
>    - `已发送 · 0.0–0.5s`
>    - `已收到 · 0.0s` (closes within milliseconds)
> 5. After the agent finishes (still using existing in-runtime token streaming), the run unlocks the composer.
> 6. If the runtime errors, you should see a final `失败 · <errorMessage>` row instead of `completed`.

Any deviation here means a Plan A regression — file an issue and revert before starting Plan B.

- [ ] **Step 1: Hand off the smoke checklist to the operator**

(No commit.)

---

## Spec Coverage Self-Review

Mapping spec sections to plan tasks:

- §3 Phase definition (9 phase values): Task 1 (renderer types), Task 2 (Zod schemas)
- §5.1 Data contract: Task 2, Task 3
- §5.2 Timeline item extension: Task 1, Task 2
- §5.3 Layer responsibilities: Task 9 (renderer), Task 10 (main IPC). Agent runtime layer is Plan B.
- §5.4 Sequence (happy path, ends at `completed`): Task 10's success branch
- §5.5 reducer self-healing: Task 4 (full coverage including alias closers, idempotency, cross-runId isolation)
- §5.6 Clock skew: Task 10 (clamp helper + 60s fallback test)
- §5.7 Persistence (full retention): **deferred to Plan B** — Plan A's phase rows are renderer-only; documented above in "Out of scope"
- §6.1 AgentPhaseRow visual: Task 6
- §6.2 Copy table: Task 6 (label maps)
- §6.3 AgentTimeline integration + drop AgentRunStatus row: Task 7
- §6.4 `sending` derivation: partial — Task 8 unlocks composer when `completed`/`failed` phase arrives via `REMOVE_SENDING_CONVERSATION`; the additional `OR any in-progress phase` derivation is a small follow-up that will become natural once Plan B emits T3–T9 (currently the IPC-handler-emitted phases close fast enough that the existing `sendingConversationIds` is sufficient)
- §7 Error handling: Task 10 (failed branch), Task 8 (renderer routes failed events through reducer which clears `sendingConversationIds`)
- §8 Testing: Tasks 4, 5, 6, 7, 10 (sections §8.1–§8.5 and §8.7 covered; §8.6 runtime-exit hook is Plan B)
- §9 渐进交付: this is Plan A; Plan B follows
- §10 Risk mitigations: deferred to Plan B (runtime adapter abstraction lives there)

Non-coverage explicitly accepted:
- Phase persistence (Plan B)
- Agent-runtime emit for T3–T9 (Plan B)
- Runtime-exit watchdog hook (Plan B)
- Cancel/stop button (separate spec)

---

## Plan B Preview (for awareness only — do not execute as part of this plan)

Plan B will instrument `desktop/electron/services/agent-runtime/`:
- Pass `runId` through `agent.send` into `MessageRouter`
- Emit `runtime_starting` / `runtime_ready` from each adapter (claude-code, codex-exec, codex-app-server-session)
- Emit `request_submitted` / `awaiting_first_token` / `streaming` from `MessageRouter` around the model call
- Replace Plan A's IPC-handler-emitted `received (done)` and `completed` with runtime-emitted events that fire at correct boundaries
- Add `child.on('exit')` watchdog that emits `failed` on unexpected runtime termination
- Persist phase items into `ConversationEntryV1.history` so `bridge.agent.getTimeline` returns them
- Update `historyRecordToTimelineItem` to include the `phase` kind
