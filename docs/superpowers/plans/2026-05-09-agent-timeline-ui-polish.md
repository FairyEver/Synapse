# Agent 对话时间线 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the agent conversation timeline UI for better readability, information hierarchy, and copy interaction.

**Architecture:** Surgical edits on existing components — one new `AgentMessageToolbar` component, markdown rendering via existing `renderMarkdown`, code block copy via DOM injection + event delegation.

**Tech Stack:** React, Tailwind CSS, shadcn/ui, markdown-it + highlight.js (existing), Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `desktop/src/components/markdown-viewer.tsx` | Modify | Export `MARKDOWN_BODY_CLASSNAME` |
| `desktop/src/modules/agent/components/agent-message-toolbar.tsx` | Create | Shared time + copy toolbar for messages |
| `desktop/src/modules/agent/components/agent-annotation.tsx` | Modify | Remove left border |
| `desktop/src/modules/agent/components/agent-thinking-event.tsx` | Modify | Remove hover bg, add w-full |
| `desktop/src/modules/agent/components/agent-tool-event.tsx` | Modify | Remove hover bg, unify font size |
| `desktop/src/modules/agent/components/agent-message-header.tsx` | Modify | Agent icon img, remove displayName for assistant |
| `desktop/src/modules/agent/components/agent-message-event.tsx` | Modify | User: no header + toolbar; Assistant: markdown + toolbar + agentIcon |
| `desktop/src/modules/agent/components/agent-timeline-item.tsx` | Modify | Pass agentIcon prop |
| `desktop/src/modules/agent/components/agent-timeline.tsx` | Modify | Pass agentIcon, add data-allow-select |
| `desktop/src/modules/agent/index.tsx` | Modify | Pass agentIcon to AgentTimeline |
| `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx` | Modify | Update tests for new structure |
| `desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx` | Modify | Update assertions |
| `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx` | Modify | Update font-size assertions |
| `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx` | Modify | Update for new props |

---

### Task 1: Export MARKDOWN_BODY_CLASSNAME

**Files:**
- Modify: `desktop/src/components/markdown-viewer.tsx:21`

- [ ] **Step 1: Add export to the existing constant**

```tsx
// desktop/src/components/markdown-viewer.tsx
// Change line 21 from:
const MARKDOWN_BODY_CLASSNAME = cn(
// To:
export const MARKDOWN_BODY_CLASSNAME = cn(
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: PASS — no consumers broken, just newly exported.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/markdown-viewer.tsx
git commit -m "refactor: export MARKDOWN_BODY_CLASSNAME from markdown-viewer"
```

---

### Task 2: Create AgentMessageToolbar

**Files:**
- Create: `desktop/src/modules/agent/components/agent-message-toolbar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// desktop/src/modules/agent/components/agent-message-toolbar.tsx
import { useState } from "react"
import { Check, Clipboard } from "lucide-react"
import { cn } from "@/lib/utils"

interface AgentMessageToolbarProps {
  readonly timestamp?: string
  readonly content: string
  readonly className?: string
}

function AgentMessageToolbar({ timestamp, content, className }: AgentMessageToolbarProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      {timestamp ? (
        <time className="text-xs text-muted-foreground">
          {formatTime(timestamp)}
        </time>
      ) : null}
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        onClick={handleCopy}
        aria-label="复制"
      >
        {copied
          ? <Check className="size-3.5" />
          : <Clipboard className="size-3.5" />}
      </button>
    </div>
  )
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export { AgentMessageToolbar }
export type { AgentMessageToolbarProps }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-message-toolbar.tsx
git commit -m "feat(agent): add AgentMessageToolbar component"
```

---

### Task 3: Remove AgentAnnotation left border

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-annotation.tsx:11`

- [ ] **Step 1: Remove border classes**

```tsx
// desktop/src/modules/agent/components/agent-annotation.tsx line 11
// Change from:
    <div className={cn("border-l-2 border-muted ml-1 pl-3", className)}>
// To:
    <div className={cn("ml-1 pl-3", className)}>
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/agent-annotation.tsx
git commit -m "fix(agent): remove left border from annotation blocks"
```

---

### Task 4: Fix AgentThinkingEvent — hover + width

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-thinking-event.tsx:29`
- Modify: `desktop/src/modules/agent/components/agent-thinking-event.tsx:40`

- [ ] **Step 1: Update trigger button — add w-full, remove hover bg**

```tsx
// desktop/src/modules/agent/components/agent-thinking-event.tsx
// Line 29 change className from:
            className="group/agent-event-trigger h-7 justify-start gap-1.5 px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
// To:
            className="group/agent-event-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
```

- [ ] **Step 2: Verify thinking content is already text-sm leading-6**

Confirm line 40 already has `text-sm leading-6` — if so, no change needed here. Current code:
```tsx
          <pre className="whitespace-pre-wrap break-words pb-2 pt-1 text-sm leading-6 text-muted-foreground">
```
This is already correct. No change.

- [ ] **Step 3: Update test**

```tsx
// desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx
// The test "renders with full-row hover and the chevron after the label" — add w-full assertion:
// After line 38, before the closing `})`:
    expect(html).toContain("w-full")
    expect(html).toContain("hover:bg-transparent")
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @synapse/desktop run test -- --run desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-thinking-event.tsx desktop/src/modules/agent/components/__tests__/agent-thinking-event.test.tsx
git commit -m "fix(agent): remove hover bg and unify width on thinking trigger"
```

---

### Task 5: Fix AgentToolEvent — hover + font size

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-tool-event.tsx:47,69`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`

- [ ] **Step 1: Add hover:bg-transparent to trigger button**

```tsx
// desktop/src/modules/agent/components/agent-tool-event.tsx line 47
// Change className from:
            className="group/agent-event-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs hover:text-foreground"
// To:
            className="group/agent-event-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs hover:bg-transparent hover:text-foreground"
```

- [ ] **Step 2: Unify pre font size from text-xs to text-sm**

```tsx
// desktop/src/modules/agent/components/agent-tool-event.tsx line 69
// Change from:
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1.5 text-xs leading-5">
// To:
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1.5 text-sm leading-6">
```

- [ ] **Step 3: Run existing tests**

Run: `pnpm --filter @synapse/desktop run test -- --run desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`
Expected: PASS — no assertions specifically check `text-xs` or `leading-5`.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/components/agent-tool-event.tsx
git commit -m "fix(agent): remove hover bg and unify font size on tool events"
```

---

### Task 6: Modify AgentMessageHeader — agent icon

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-message-header.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the entire file content:

```tsx
// desktop/src/modules/agent/components/agent-message-header.tsx
import { cn } from "@/lib/utils"

interface AgentMessageHeaderProps {
  readonly agentIcon?: string
  readonly timestamp?: string
  readonly className?: string
}

function AgentMessageHeader({
  agentIcon,
  timestamp,
  className,
}: AgentMessageHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        className,
      )}
    >
      {agentIcon ? (
        <img
          src={agentIcon}
          alt=""
          className="size-5 rounded"
        />
      ) : null}
      {timestamp ? (
        <time className="text-xs text-muted-foreground">
          {formatTimestamp(timestamp)}
        </time>
      ) : null}
    </div>
  )
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

export { AgentMessageHeader, formatTimestamp }
export type { AgentMessageHeaderProps }
```

Key changes:
- Removed `role` prop (header is now only used for assistant messages)
- Removed `agentName` prop and `displayName` text rendering
- Removed `User`/`Bot` lucide icons and the circular bg-muted wrapper
- Added `agentIcon?: string` prop — renders as `<img>` when provided
- Kept `formatTimestamp` export for reuse

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: FAIL — `AgentMessageEvent` still passes old props. Will fix in Task 7.

- [ ] **Step 3: Commit (WIP)**

```bash
git add desktop/src/modules/agent/components/agent-message-header.tsx
git commit -m "wip(agent): simplify AgentMessageHeader to icon + time only"
```

---

### Task 7: Restructure AgentMessageEvent

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`

This is the core task. User messages get: no header, bubble with toolbar. Assistant messages get: icon+time header, markdown body, toolbar.

- [ ] **Step 1: Rewrite the component**

Replace the entire file content:

```tsx
// desktop/src/modules/agent/components/agent-message-event.tsx
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { renderMarkdown } from "@/lib/markdown"
import { MARKDOWN_BODY_CLASSNAME } from "@/components/markdown-viewer"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentMessageTimelineItem,
} from "@/types/agent"
import { AgentMessageHeader } from "./agent-message-header"
import { AgentMessageBubble } from "./agent-message-bubble"
import { AgentMessageToolbar } from "./agent-message-toolbar"

const COPY_BUTTON_HTML = `<button type="button" class="code-copy-btn" aria-label="复制代码" style="position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--muted-foreground);cursor:pointer;opacity:0;transition:opacity .15s"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>`

const LOCAL_REFERENCE_PATTERN = /(\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g

interface AgentMessageEventProps {
  readonly item: SynapseAgentMessageTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly onOpenReference: (reference: string) => void
}

function AgentMessageEvent({
  item,
  profile,
  agentIcon,
  onOpenReference,
}: AgentMessageEventProps) {
  const outgoing = item.role === "user"

  if (outgoing) {
    return (
      <article className="flex min-w-0 flex-col items-end">
        <AgentMessageBubble role="user">
          <span>{item.content}</span>
          <AgentMessageToolbar
            timestamp={item.timestamp}
            content={item.content}
            className="mt-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
          />
        </AgentMessageBubble>
      </article>
    )
  }

  return (
    <article className="flex min-w-0 flex-col items-start">
      <AgentMessageHeader
        agentIcon={agentIcon}
        timestamp={item.timestamp}
        className="mb-1"
      />
      <AssistantMessageBody
        item={item}
        profile={profile}
        onOpenReference={onOpenReference}
      />
    </article>
  )
}

function AssistantMessageBody({
  item,
  profile,
  onOpenReference,
}: {
  readonly item: SynapseAgentMessageTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly onOpenReference: (reference: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const preprocessed = wrapLocalReferences(item.content)
  const renderedHtml = renderMarkdown(preprocessed)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const preElements = container.querySelectorAll("pre")
    for (const pre of preElements) {
      if (pre.querySelector(".code-copy-btn")) continue
      pre.style.position = "relative"
      pre.insertAdjacentHTML("beforeend", COPY_BUTTON_HTML)
    }
  }, [renderedHtml])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    const copyBtn = target.closest(".code-copy-btn")
    if (copyBtn) {
      event.preventDefault()
      const pre = copyBtn.closest("pre")
      if (pre) {
        const code = pre.querySelector("code")
        void navigator.clipboard.writeText(code?.textContent ?? pre.textContent ?? "")
        copyBtn.classList.add("code-copy-btn--copied")
        setTimeout(() => copyBtn.classList.remove("code-copy-btn--copied"), 1500)
      }
      return
    }

    const link = target.closest("a")
    if (link) {
      const href = link.getAttribute("href") ?? ""
      if (href.startsWith("file://") || href.startsWith("./") || href.startsWith("../") || href.startsWith("/")) {
        event.preventDefault()
        onOpenReference(href)
      }
    }
  }

  return (
    <div className="group/message max-w-[76ch] px-1 py-2">
      <div
        ref={containerRef}
        data-allow-select="true"
        className={cn(MARKDOWN_BODY_CLASSNAME, "[&_pre]:group [&_pre:hover_.code-copy-btn]:opacity-100")}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      <AgentMessageToolbar
        timestamp={item.timestamp}
        content={item.content}
        className="mt-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
      />
    </div>
  )
}

function wrapLocalReferences(content: string): string {
  return content.replace(LOCAL_REFERENCE_PATTERN, (match) => {
    if (match.startsWith("[")) return match
    return `[${match}](${match})`
  })
}

export { AgentMessageEvent, wrapLocalReferences }
export type { AgentMessageEventProps }
```

Key changes:
- User message: no `AgentMessageHeader`, bubble wraps content + toolbar
- Assistant message: `AgentMessageHeader` with agentIcon, markdown rendered body, code block copy, toolbar
- `splitLocalReferences` replaced by `wrapLocalReferences` (pre-processes before markdown)
- Code block copy buttons injected via `useEffect` + handled via event delegation
- `agentIcon` prop added

- [ ] **Step 2: Add group/message class to user bubble**

The user bubble needs a `group/message` class for the toolbar hover reveal. Modify `AgentMessageBubble`:

```tsx
// desktop/src/modules/agent/components/agent-message-bubble.tsx
// Change the user branch className from:
        role === "user"
          ? "max-w-[72%] rounded-2xl bg-muted px-5 py-3"
// To:
        role === "user"
          ? "group/message max-w-[72%] rounded-2xl bg-muted px-5 py-3"
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: FAIL — `AgentTimelineItem` still passes old props. Will fix in Task 8.

- [ ] **Step 4: Commit (WIP)**

```bash
git add desktop/src/modules/agent/components/agent-message-event.tsx desktop/src/modules/agent/components/agent-message-bubble.tsx
git commit -m "wip(agent): restructure AgentMessageEvent with markdown + toolbar"
```

---

### Task 8: Wire agentIcon through the component tree

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-timeline-item.tsx`
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Update AgentTimelineItem to accept and pass agentIcon**

```tsx
// desktop/src/modules/agent/components/agent-timeline-item.tsx
// Add agentIcon to the props type (after line 25):
  readonly agentIcon?: string

// In the "message" case (around line 32), pass agentIcon:
      return (
        <AgentMessageEvent
          item={item}
          profile={profile}
          agentIcon={agentIcon}
          onOpenReference={onOpenReference}
        />
      )
```

- [ ] **Step 2: Update AgentTimeline to accept and pass agentIcon**

```tsx
// desktop/src/modules/agent/components/agent-timeline.tsx
// Add to props type (after line 23):
  readonly agentIcon?: string

// Add agentIcon to destructured props

// In the map, pass to AgentTimelineItem:
          <AgentTimelineItem
            key={item.id}
            item={item}
            profile={profile}
            agentIcon={agentIcon}
            pendingPermissions={pendingPermissions}
            onOpenReference={onOpenReference}
            onRespondPermission={onRespondPermission}
          />
```

Also add `data-allow-select="true"` to the timeline content div for text selection:

```tsx
// Change the inner div (line 30) from:
        <div className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 pr-4 pb-34 pt-4">
// To:
        <div data-allow-select="true" className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 pr-4 pb-34 pt-4">
```

- [ ] **Step 3: Update index.tsx to pass agentIcon**

```tsx
// desktop/src/modules/agent/index.tsx
// Around line 268 where AgentTimeline is rendered, add agentIcon:
            <AgentTimeline
              items={chat.timeline}
              profile={selectedDisplayProfile}
              agentIcon={selectedAgentDefinition?.icon}
              sending={chat.sending}
              pendingPermissions={chat.pendingPermissions}
              onOpenReference={openReference}
              onRespondPermission={(requestId, behavior) => void chat.respondPermission(requestId, behavior)}
              bottomRef={timelineBottomRef}
            />
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: PASS — all props now connected.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-timeline-item.tsx desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): wire agentIcon through timeline component tree"
```

---

### Task 9: Update tests

**Files:**
- Modify: `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx`
- Modify: `desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx`

- [ ] **Step 1: Rewrite agent-message-row.test.tsx**

```tsx
// desktop/src/modules/agent/__tests__/agent-message-row.test.tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile, SynapseAgentMessageTimelineItem } from "@/types/agent"
import { AgentMessageEvent } from "../components/agent-message-event"

const baseEntry = {
  id: "message-1",
  kind: "message",
  content: "你好",
  timestamp: "2026-04-27T03:15:00.000Z",
} satisfies Omit<SynapseAgentMessageTimelineItem, "role">

const mockProfile: SynapseAgentDisplayProfile = {
  agentLabel: "Claude",
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

describe("AgentMessageEvent", () => {
  it("right-aligns user messages with a subtle outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-end")
    expect(html).toContain("bg-muted")
    expect(html).toContain("text-foreground")
    expect(html).not.toContain("bg-primary")
  })

  it("user messages do not render a header with avatar", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).not.toContain("lucide-user")
    expect(html).not.toContain("lucide-bot")
    expect(html).not.toContain(">You<")
  })

  it("user messages have a toolbar with copy button", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("复制")
    expect(html).toContain("11:15")
  })

  it("left-aligns assistant messages with markdown rendering", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant", content: "**bold text**" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-start")
    expect(html).toContain("<strong>bold text</strong>")
  })

  it("assistant messages show agent icon when provided", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        profile={mockProfile}
        agentIcon="/icons/claude.png"
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain('src="/icons/claude.png"')
    expect(html).not.toContain("lucide-bot")
    expect(html).not.toContain(">Claude<")
  })

  it("assistant messages have a toolbar with copy button", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("复制")
  })
})
```

- [ ] **Step 2: Update agent-timeline.test.tsx for new agentIcon prop**

```tsx
// desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
// Update the AgentTimeline render call to include agentIcon:
      <AgentTimeline
        items={[]}
        profile={profile}
        sending={false}
        pendingPermissions={[]}
        onOpenReference={vi.fn()}
        onRespondPermission={vi.fn()}
        bottomRef={createRef<HTMLDivElement>()}
      />,

// agentIcon is optional, so the existing test should still pass without it.
// Add an assertion for data-allow-select:
    expect(html).toContain('data-allow-select="true"')
```

- [ ] **Step 3: Run all agent tests**

Run: `pnpm --filter @synapse/desktop run test -- --run desktop/src/modules/agent/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/__tests__/agent-message-row.test.tsx desktop/src/modules/agent/components/__tests__/agent-timeline.test.tsx
git commit -m "test(agent): update tests for timeline UI polish"
```

---

### Task 10: Squash WIP commits

- [ ] **Step 1: Interactive rebase to squash the two WIP commits**

```bash
git rebase -i HEAD~8
```

Squash the two `wip(agent):` commits into their respective feature commits. Final commit history should be clean with no WIP entries.

- [ ] **Step 2: Verify all tests pass**

Run: `pnpm --filter @synapse/desktop run test -- --run desktop/src/modules/agent/`
Expected: ALL PASS

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: PASS
