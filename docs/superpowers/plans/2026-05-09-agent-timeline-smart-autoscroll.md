# Agent 时间线智能滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-scroll-to-bottom behavior in the Agent timeline with a stick-to-bottom state machine plus a "↓ 新消息" pill that lets the user opt back in to following.

**Architecture:** Introduce a renderer-only hook `useStickToBottom` that owns the pinned/unread state and the programmatic scroll. Refactor `AgentTimeline` to expose a viewport ref and render an absolutely-positioned shadcn `Button` pill in the bottom-right of the scroll region. Wire it from `AgentModule`, removing the existing unconditional `scrollIntoView` effect. Special scenarios (session switch, user-sent message, first mount) call `forcePin()` to keep "follow latest" semantics.

**Tech Stack:** React 19, TypeScript (strict), shadcn/ui (Radix base, `radix-nova` preset), Tailwind tokens, vitest + `react-dom/server` for tests (no DOM env).

**Spec:** `docs/superpowers/specs/2026-05-09-agent-timeline-smart-autoscroll-design.md`

---

## File Structure

Each file has one responsibility. Tests sit next to the unit they cover.

| Path | Responsibility |
| --- | --- |
| `desktop/src/modules/agent/hooks/use-stick-to-bottom.ts` | The hook + the pure helpers `computeIsPinned` and `pickLatestEntryId`. |
| `desktop/src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts` | Unit tests for the pure helpers (no DOM needed). |
| `desktop/src/components/ui/scroll-area.tsx` | Add an optional `viewportRef` prop that forwards to the Radix viewport. |
| `desktop/src/modules/agent/components/agent-timeline.tsx` | Replace `bottomRef` prop with `viewportRef` + `showJumpToBottom` + `onJumpToBottom`; render the pill. |
| `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx` | Update existing tests to new props, add tests for pill render + click. |
| `desktop/src/modules/agent/index.tsx` | Replace `timelineBottomRef` + manual effect with `useStickToBottom`; call `forcePin()` on session switch and submit. |

No new dependencies. No changes to preload, main process, or IPC.

---

## Task 1: ScrollArea — forward an optional `viewportRef`

**Files:**
- Modify: `desktop/src/components/ui/scroll-area.tsx`

**Why:** The hook needs a stable ref to the actual scrolling element (the Radix viewport) so it can read `scrollTop` / `scrollHeight` / `clientHeight` and attach a `scroll` listener. The current `ScrollArea` does not expose this ref.

- [ ] **Step 1: Read the current file**

Run: `cat desktop/src/components/ui/scroll-area.tsx`

Note the existing signature:

```@/Users/liyang/Documents/code/github/Synapse/desktop/src/components/ui/scroll-area.tsx:9-15
function ScrollArea({
  className,
  children,
  "data-track": dataTrack,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  "data-track"?: string
}) {
```

- [ ] **Step 2: Add the `viewportRef` prop and forward it**

Replace the `ScrollArea` function definition (lines 9–74) with this version. Only the type annotation and the new `ref={viewportRef}` line are new; everything else is unchanged.

```tsx
function ScrollArea({
  className,
  children,
  viewportRef,
  "data-track": dataTrack,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  "data-track"?: string
  viewportRef?: React.Ref<HTMLDivElement>
}) {
  const lastScrollTopRef = React.useRef(0)
  const logScroll = React.useMemo(
    () => dataTrack
      ? debounce((snapshot: {
        clientHeight: number
        direction: "down" | "up"
        percent: number
        scrollHeight: number
        scrollTop: number
      }) => {
        track({
          component: "scroll-area",
          name: dataTrack,
          action: "scroll",
          value: snapshot.percent,
          metadata: snapshot,
        })
      }, 500)
      : null,
    [dataTrack],
  )

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      data-track={dataTrack}
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
        onScroll={(event) => {
          if (!dataTrack) {
            return
          }

          const target = event.currentTarget
          const scrollTop = target.scrollTop
          const scrollable = Math.max(1, target.scrollHeight - target.clientHeight)
          const direction = scrollTop >= lastScrollTopRef.current ? "down" : "up"
          lastScrollTopRef.current = scrollTop
          logScroll?.({
            clientHeight: target.clientHeight,
            direction,
            percent: Math.round((scrollTop / scrollable) * 100),
            scrollHeight: target.scrollHeight,
            scrollTop,
          })
        }}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: PASS (no new type errors).

If `typecheck` script does not exist on the package, run: `pnpm --filter @synapse/desktop exec tsc --noEmit`.

- [ ] **Step 4: Run existing scroll-area-touching tests**

Run: `pnpm --filter @synapse/desktop run test -- src/components/ui`
Expected: any pre-existing tests under `src/components/ui` still PASS. The shape of `ScrollArea` is backward compatible (new prop is optional).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/ui/scroll-area.tsx
git commit -m "feat(ui): forward optional viewportRef on ScrollArea"
```

---

## Task 2: Pure helpers for the stick-to-bottom logic (TDD)

**Files:**
- Create: `desktop/src/modules/agent/hooks/use-stick-to-bottom.ts` (helpers only, hook added in Task 3)
- Create: `desktop/src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts`

**Why:** Test environment is `node` (no DOM). We isolate the testable math in pure functions and then the hook becomes a thin wrapper around them. This also makes the threshold and "is this really a new entry?" decisions explicit.

- [ ] **Step 1: Write the failing test**

Create `desktop/src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  PINNED_THRESHOLD_PX,
  computeIsPinned,
  isLatestEntryNew,
} from "../use-stick-to-bottom"

describe("computeIsPinned", () => {
  it("treats content shorter than the viewport as pinned", () => {
    expect(computeIsPinned({ scrollTop: 0, scrollHeight: 500, clientHeight: 800 })).toBe(true)
    expect(computeIsPinned({ scrollTop: 0, scrollHeight: 800, clientHeight: 800 })).toBe(true)
  })

  it("returns true when the user is within PINNED_THRESHOLD_PX of the bottom", () => {
    const clientHeight = 600
    const scrollHeight = 2000
    const scrollTop = scrollHeight - clientHeight - (PINNED_THRESHOLD_PX - 1)
    expect(computeIsPinned({ scrollTop, scrollHeight, clientHeight })).toBe(true)
  })

  it("returns false when the user is further than PINNED_THRESHOLD_PX from the bottom", () => {
    const clientHeight = 600
    const scrollHeight = 2000
    const scrollTop = scrollHeight - clientHeight - (PINNED_THRESHOLD_PX + 50)
    expect(computeIsPinned({ scrollTop, scrollHeight, clientHeight })).toBe(false)
  })

  it("uses the default threshold of 80px", () => {
    expect(PINNED_THRESHOLD_PX).toBe(80)
  })
})

describe("isLatestEntryNew", () => {
  it("returns false when there is no latest entry", () => {
    expect(isLatestEntryNew({ previousId: undefined, latestId: undefined })).toBe(false)
    expect(isLatestEntryNew({ previousId: "a", latestId: undefined })).toBe(false)
  })

  it("returns false when the id is unchanged (e.g. only `sending` toggled)", () => {
    expect(isLatestEntryNew({ previousId: "a", latestId: "a" })).toBe(false)
  })

  it("returns true when the latest entry id changed to a new value", () => {
    expect(isLatestEntryNew({ previousId: "a", latestId: "b" })).toBe(true)
  })

  it("returns true when the first entry appears after an empty timeline", () => {
    expect(isLatestEntryNew({ previousId: undefined, latestId: "a" })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @synapse/desktop run test -- src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts`
Expected: FAIL with "Cannot find module '../use-stick-to-bottom'".

- [ ] **Step 3: Implement the helpers**

Create `desktop/src/modules/agent/hooks/use-stick-to-bottom.ts`:

```ts
export const PINNED_THRESHOLD_PX = 80

export function computeIsPinned(metrics: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  const { scrollTop, scrollHeight, clientHeight } = metrics
  if (scrollHeight <= clientHeight) {
    return true
  }
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop
  return distanceFromBottom < PINNED_THRESHOLD_PX
}

export function isLatestEntryNew(input: {
  previousId: string | undefined
  latestId: string | undefined
}): boolean {
  if (!input.latestId) return false
  return input.previousId !== input.latestId
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @synapse/desktop run test -- src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-stick-to-bottom.ts \
        desktop/src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts
git commit -m "feat(agent): add stick-to-bottom pure helpers"
```

---

## Task 3: Implement the `useStickToBottom` hook

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-stick-to-bottom.ts`

**Why:** Wraps the pure helpers in the React lifecycle: subscribes to viewport scroll, distinguishes programmatic vs user scroll, runs auto-scroll when pinned, marks `hasUnread` when a new entry arrives off-screen, exposes `forcePin` and `scrollToBottom`.

- [ ] **Step 1: Add the hook implementation**

Append to `desktop/src/modules/agent/hooks/use-stick-to-bottom.ts` (keep the helpers from Task 2 above):

```ts
import { useCallback, useEffect, useRef, useState } from "react"

type ScrollOptions = { behavior?: ScrollBehavior }

export type UseStickToBottomReturn = {
  viewportRef: React.RefObject<HTMLDivElement | null>
  isPinned: boolean
  hasUnread: boolean
  scrollToBottom: (options?: ScrollOptions) => void
  forcePin: () => void
}

/**
 * Stick-to-bottom state machine for chat-style timelines.
 *
 * - `isPinned` reflects whether the viewport is within `PINNED_THRESHOLD_PX` of the bottom.
 * - When pinned and `contentSignal` changes, the viewport auto-scrolls to the bottom.
 * - When unpinned and a *new* entry (via `latestEntryId`) appears, `hasUnread` becomes true.
 * - User scroll back into the threshold clears `hasUnread`.
 * - `forcePin()` is for "scenarios where the user expects to see the latest"
 *   (session switch, user-sent message, first mount).
 */
export function useStickToBottom(input: {
  contentSignal: ReadonlyArray<unknown>
  latestEntryId: string | undefined
}): UseStickToBottomReturn {
  const { contentSignal, latestEntryId } = input

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const isPinnedRef = useRef(true)
  const previousLatestIdRef = useRef<string | undefined>(undefined)
  const programmaticScrollUntilRef = useRef(0)

  const [isPinned, setIsPinned] = useState(true)
  const [hasUnread, setHasUnread] = useState(false)

  const performScrollToBottom = useCallback((options?: ScrollOptions) => {
    const viewport = viewportRef.current
    if (!viewport) return
    // Mark the next ~150ms of scroll events as programmatic so the listener
    // does not flip isPinned off mid-animation.
    programmaticScrollUntilRef.current = Date.now() + 150
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: options?.behavior ?? "auto",
    })
  }, [])

  const scrollToBottom = useCallback((options?: ScrollOptions) => {
    performScrollToBottom(options)
  }, [performScrollToBottom])

  const forcePin = useCallback(() => {
    isPinnedRef.current = true
    setIsPinned(true)
    setHasUnread(false)
    performScrollToBottom({ behavior: "auto" })
  }, [performScrollToBottom])

  // Subscribe to viewport scroll.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined

    let frame: number | null = null
    const onScroll = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (Date.now() < programmaticScrollUntilRef.current) {
          return
        }
        const next = computeIsPinned({
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        })
        if (next !== isPinnedRef.current) {
          isPinnedRef.current = next
          setIsPinned(next)
          if (next) {
            // User reached the bottom on their own → clear unread.
            setHasUnread(false)
          }
        }
      })
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", onScroll)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  // React to content changes: either auto-scroll (pinned) or mark unread (unpinned + new entry).
  useEffect(() => {
    const previousId = previousLatestIdRef.current
    previousLatestIdRef.current = latestEntryId
    const newEntryArrived = isLatestEntryNew({ previousId, latestId: latestEntryId })

    if (isPinnedRef.current) {
      // Defer to the next frame so the new content is laid out before we measure.
      const handle = window.requestAnimationFrame(() => {
        performScrollToBottom({ behavior: "auto" })
      })
      return () => window.cancelAnimationFrame(handle)
    }

    if (newEntryArrived) {
      setHasUnread(true)
    }
    return undefined
    // contentSignal members trigger this effect; latestEntryId is already inside contentSignal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, contentSignal)

  return { viewportRef, isPinned, hasUnread, scrollToBottom, forcePin }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Re-run helper tests to confirm nothing regressed**

Run: `pnpm --filter @synapse/desktop run test -- src/modules/agent/hooks/__tests__/use-stick-to-bottom.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-stick-to-bottom.ts
git commit -m "feat(agent): add useStickToBottom hook"
```

---

## Task 4: Update `AgentTimeline` props and tests (TDD)

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

**Why:** The component needs to (a) hand the viewport ref to `ScrollArea`, (b) render a "↓ 新消息" pill when `showJumpToBottom` is true, and (c) call `onJumpToBottom` when the pill is clicked. Tests assert HTML structure (the test env is node + `react-dom/server`).

- [ ] **Step 1: Update the existing tests + add new failing tests**

Replace the contents of `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx` with:

```tsx
import { createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentTimeline } from "../agent-timeline"

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "collapsed",
  toolPreviewLines: 6,
  toolPreviewChars: 20,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

function renderTimeline(overrides: Partial<React.ComponentProps<typeof AgentTimeline>> = {}) {
  return renderToStaticMarkup(
    <AgentTimeline
      items={[]}
      profile={profile}
      sending={false}
      pendingPermissions={[]}
      onOpenReference={vi.fn()}
      onRespondPermission={vi.fn()}
      viewportRef={createRef<HTMLDivElement>()}
      showJumpToBottom={false}
      onJumpToBottom={vi.fn()}
      {...overrides}
    />,
  )
}

describe("AgentTimeline", () => {
  it("uses compact vertical spacing between timeline items", () => {
    const html = renderTimeline()
    expect(html).toContain("gap-6")
    expect(html).not.toContain("gap-5")
  })

  it("enables text selection on the content area", () => {
    const html = renderTimeline()
    expect(html).toContain('data-allow-select="true"')
  })

  it("does not render the jump-to-bottom pill when showJumpToBottom is false", () => {
    const html = renderTimeline({ showJumpToBottom: false })
    expect(html).not.toContain("↓ 新消息")
    expect(html).not.toContain("跳到最新消息")
  })

  it("renders the jump-to-bottom pill when showJumpToBottom is true", () => {
    const html = renderTimeline({ showJumpToBottom: true })
    expect(html).toContain("↓ 新消息")
    expect(html).toContain('aria-label="跳到最新消息"')
  })
})
```

- [ ] **Step 2: Run the test and watch the new ones fail**

Run: `pnpm --filter @synapse/desktop run test -- src/modules/agent/components/__tests__/agent-timeline.test.tsx`
Expected: the two pill tests FAIL ("Type … is missing the following properties from type … `viewportRef` …" or runtime "Unknown prop"). Older tests may also fail because they no longer pass `bottomRef`.

> Note: the pre-existing `gap-6` assertion has been carried over verbatim; do not "fix" it as part of this task even if it is failing on `main`. Scope discipline.

- [ ] **Step 3: Update `AgentTimeline`**

Replace the entire contents of `desktop/src/modules/agent/components/agent-timeline.tsx` with:

```tsx
import type { Ref } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentRunStatus } from "./agent-run-status"
import { AgentTimelineItem } from "./agent-timeline-item"

function AgentTimeline({
  items,
  profile,
  agentIcon,
  sending,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
  viewportRef,
  showJumpToBottom,
  onJumpToBottom,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly sending: boolean
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (requestId: string, behavior: "allow" | "deny") => void
  readonly viewportRef: Ref<HTMLDivElement>
  readonly showJumpToBottom: boolean
  readonly onJumpToBottom: () => void
}) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <ScrollArea className="min-h-0 min-w-0 flex-1" viewportRef={viewportRef}>
        <div data-allow-select="true" className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 pr-4 pb-24 pt-4">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
          ) : items.map((item) => (
            <AgentTimelineItem
              key={item.id}
              item={item}
              profile={profile}
              agentIcon={agentIcon}
              pendingPermissions={pendingPermissions}
              onOpenReference={onOpenReference}
              onRespondPermission={onRespondPermission}
            />
          ))}
          {sending ? <AgentRunStatus label={`${profile.agentLabel} 正在处理`} /> : null}
        </div>
      </ScrollArea>
      {showJumpToBottom ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onJumpToBottom}
          aria-label="跳到最新消息"
          className="absolute bottom-4 right-4 rounded-full shadow-md"
        >
          ↓ 新消息
        </Button>
      ) : null}
    </div>
  )
}

export { AgentTimeline }
```

Notes for the implementer:
- `Button` is the shadcn primitive at `desktop/src/components/ui/button.tsx`. Do not introduce a custom button.
- The pill is a sibling of `ScrollArea`, both inside a `relative` wrapper. It naturally sits inside the timeline panel and above the `AgentComposer`, which is rendered as a sibling of `AgentTimeline` upstream.
- Do not add custom colors or shadows beyond what shadcn defaults provide. `shadow-md` and `rounded-full` are standard Tailwind/shadcn utilities.

- [ ] **Step 4: Verify the import for `Button` exists**

Run: `cat desktop/src/components/ui/button.tsx | head -5`
Expected: file exists and exports `Button`.

If for some reason it does not exist in this checkout, stop and surface this — the rest of the codebase relies on it and re-creating it is out of scope.

- [ ] **Step 5: Run the timeline tests**

Run: `pnpm --filter @synapse/desktop run test -- src/modules/agent/components/__tests__/agent-timeline.test.tsx`
Expected: 4 tests PASS (the two pre-existing assertions plus the two new pill assertions). If the legacy `gap-6` assertion fails because of the unrelated `gap-2` discrepancy on `main`, do not change it as part of this task; report it back so it can be tracked separately.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline.tsx \
        desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "feat(agent): add jump-to-bottom pill and viewportRef to AgentTimeline"
```

---

## Task 5: Wire `AgentModule` to `useStickToBottom`

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`

**Why:** Replace the unconditional `scrollIntoView` effect with the new hook, and call `forcePin()` when the user expects to see the latest (session switch, user-sent message).

- [ ] **Step 1: Read the existing wiring**

Run: `sed -n '1,40p;60,115p;255,295p' desktop/src/modules/agent/index.tsx`

Note the spots that change:
- Imports (top of file).
- `timelineBottomRef` declaration around line 69.
- `useEffect` block around lines 87–102.
- `submitDraft` around lines 104–109.
- The `<AgentTimeline … bottomRef={timelineBottomRef} />` JSX around lines 268–277.

- [ ] **Step 2: Add the hook import**

Near the other module-local imports at the top of `desktop/src/modules/agent/index.tsx`, add:

```ts
import { useStickToBottom } from "./hooks/use-stick-to-bottom"
```

- [ ] **Step 3: Replace `timelineBottomRef` and the auto-scroll effect**

Locate the block that currently reads:

```@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/index.tsx:69
  const timelineBottomRef = useRef<HTMLDivElement | null>(null)
```

```@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/index.tsx:87-102
  useEffect(() => {
    const bottom = timelineBottomRef.current
    if (!bottom) return undefined
    const frame = window.requestAnimationFrame(() => {
      bottom.scrollIntoView({ block: "end" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    chat.selectedProjectId,
    chat.selectedConversationId,
    chat.selectedSessionKey,
    chat.timeline.length,
    latestEntry?.id,
    latestEntry?.timestamp,
    chat.sending,
  ])
```

Delete the `timelineBottomRef` declaration entirely. Replace the `useEffect` block with the hook + a `forcePin` effect tied to session identity:

```tsx
  const stick = useStickToBottom({
    contentSignal: [
      chat.timeline.length,
      latestEntry?.id,
      latestEntry?.timestamp,
      chat.sending,
    ],
    latestEntryId: latestEntry?.id,
  })

  useEffect(() => {
    stick.forcePin()
    // forcePin is stable; we only want to fire when the active session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.selectedProjectId, chat.selectedConversationId, chat.selectedSessionKey])
```

Also remove the `useRef` import if it becomes unused. Verify by checking the imports section.

- [ ] **Step 4: Force-pin when the user submits a draft**

Locate `submitDraft`:

```@/Users/liyang/Documents/code/github/Synapse/desktop/src/modules/agent/index.tsx:104-109
  const submitDraft = () => {
    const content = draft.trim()
    if (!content || !chat.activeProjectId) return
    setDraft("")
    void chat.sendMessage(content)
  }
```

Replace with:

```tsx
  const submitDraft = () => {
    const content = draft.trim()
    if (!content || !chat.activeProjectId) return
    setDraft("")
    stick.forcePin()
    void chat.sendMessage(content)
  }
```

- [ ] **Step 5: Update the `AgentTimeline` JSX to pass the new props**

Replace the existing `<AgentTimeline … bottomRef={timelineBottomRef} />` (around lines 268–277) with:

```tsx
            <AgentTimeline
              items={chat.timeline}
              profile={selectedDisplayProfile}
              agentIcon={selectedAgentDefinition?.icon}
              sending={chat.sending}
              pendingPermissions={chat.pendingPermissions}
              onOpenReference={openReference}
              onRespondPermission={(requestId, behavior) => void chat.respondPermission(requestId, behavior)}
              viewportRef={stick.viewportRef}
              showJumpToBottom={!stick.isPinned && stick.hasUnread}
              onJumpToBottom={() => stick.scrollToBottom({ behavior: "smooth" })}
            />
```

- [ ] **Step 6: Type-check the renderer package**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit`
Expected: PASS.

If the typechecker complains that `useRef` or `timelineBottomRef` is unused, remove them. If it complains that `bottomRef` no longer exists on `AgentTimeline`, you missed a call site — search and update.

- [ ] **Step 7: Run the agent module test suite**

Run: `pnpm --filter @synapse/desktop run test -- src/modules/agent`
Expected: all tests PASS, including the new `use-stick-to-bottom` and `agent-timeline` tests.

- [ ] **Step 8: Run hard-constraints check**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints`
Expected: PASS. (No singleton, IPC, broadcaster, or fs changes were made.)

- [ ] **Step 9: Run the full renderer test suite**

Run: `pnpm --filter @synapse/desktop run test`
Expected: PASS overall. Investigate any regression that mentions `agent`, `scroll-area`, or `timeline`.

- [ ] **Step 10: Commit**

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): wire AgentModule to useStickToBottom"
```

---

## Task 6: Manual smoke checklist (no code, no commit)

Hand off to the user with this checklist. Do **not** start the dev server yourself — per repository rules, runtime validation is the user's call.

- [ ] **Smoke 1:** Open an Agent session at the bottom. Submit a message. The timeline auto-scrolls to follow the agent's reply. No "↓ 新消息" pill is shown.
- [ ] **Smoke 2:** While Agent is streaming, scroll up by more than ~80px. The viewport stops auto-following. After the next streamed token (a *new* timeline entry, not just `sending` toggling), the "↓ 新消息" pill appears at the bottom-right of the timeline panel, above the composer, not overlapping it.
- [ ] **Smoke 3:** Click the pill. Viewport smoothly scrolls to the bottom. Pill disappears. Subsequent streamed tokens auto-follow again.
- [ ] **Smoke 4:** Scroll up so the pill appears. Manually scroll back to the bottom. Pill disappears without a click. Subsequent streamed tokens auto-follow again.
- [ ] **Smoke 5:** Scroll up so the pill appears, then submit a new message via the composer. Viewport jumps to the bottom and pill disappears.
- [ ] **Smoke 6:** Scroll up so the pill appears, then switch to another session in the sidebar. The new session opens at the bottom; pill is hidden.
- [ ] **Smoke 7:** Open a session whose total content is shorter than the viewport (no scrollbar). Send a message. No pill ever appears.
- [ ] **Smoke 8:** With `sending` flipping (the "正在处理" placeholder appearing/disappearing) but no new timeline entry, the pill must NOT appear when the user is unpinned.

If any smoke step fails, file it back to the implementer with the failing step number.

---

## Self-Review

**1. Spec coverage**
- §4 state machine → Task 3 (`useStickToBottom`).
- §5.1 hook API and threshold → Task 2 + Task 3.
- §5.2 `AgentTimeline` props + pill placement + a11y → Task 4.
- §5.3 `AgentModule` rewiring + `forcePin` on session/submit → Task 5.
- §5.4 `ScrollArea` viewport ref → Task 1.
- §6 behavior matrix → smoke checklist (Task 6) covers each row; pinned/unpinned auto-scroll is also unit-covered via `computeIsPinned` and `isLatestEntryNew`.
- §7 edge cases: `viewport null` (`performScrollToBottom` returns early), short content (helper returns true), rapid scroll (rAF throttled), `sending`-only toggles (filtered via `isLatestEntryNew`), session switch (Task 5 effect). `ResizeObserver` was mentioned in the spec but is **not** implemented in this plan — it is unnecessary for v1 because the next `scroll` event after a resize will reconcile state, and the auto-scroll on `contentSignal` already covers the common "new content increases scrollHeight" case. If user feedback later shows a regression around viewport-resize-only scenarios, add a `ResizeObserver` in a follow-up. This is the only conscious deviation from the spec.
- §8 tests → covered by Task 2 (helpers) and Task 4 (component). The hook's effect-driven behaviors are validated through smoke checks rather than unit tests because the test env is node-only.
- §9 unaffected areas → confirmed (no preload/IPC/main/dependency changes).

**2. Placeholder scan**
- No "TBD"/"TODO"/"implement later" present. All code blocks are runnable as written.

**3. Type consistency**
- Hook return: `{ viewportRef, isPinned, hasUnread, scrollToBottom, forcePin }` — used identically in Task 5.
- `viewportRef` type `RefObject<HTMLDivElement | null>` matches the prop type `Ref<HTMLDivElement>` accepted by `AgentTimeline` and the `viewportRef` prop on `ScrollArea` (`React.Ref<HTMLDivElement>`).
- `latestEntryId` typed `string | undefined` consistently across Task 2 and Task 3.
- Pill copy `↓ 新消息` and aria-label `跳到最新消息` match in component, test, and spec.

**4. Conscious deferral**
- `ResizeObserver` (spec §7) is intentionally deferred; documented above.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-agent-timeline-smart-autoscroll.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
