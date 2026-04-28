# Agent Right Panel Lightweight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle only the right side of the Agent page so it has a lighter Codex-like reading surface with subtle user bubbles, unboxed assistant messages, lighter event rows, and a calmer composer.

**Architecture:** Keep the existing Agent data flow and component boundaries. Update focused renderer components and their existing Vitest coverage so behavior is preserved while class names shift from heavy bubbles/cards to token-based spacing, subtle surfaces, and lighter collapsible rows.

**Tech Stack:** Electron, React, TypeScript, Vitest, Tailwind CSS, shadcn/ui, Radix primitives, lucide-react.

---

## File Structure

- Modify `desktop/src/modules/agent/components/agent-message-event.tsx`: render user messages as subtle right-aligned bubbles and assistant messages as unboxed text.
- Modify `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx`: update message rendering expectations and preserve wrapping/whitespace coverage.
- Modify `desktop/src/modules/agent/index.tsx`: tune the right-panel header/composer spacing and keep all current actions.
- Modify `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`: update composer visual expectations while preserving behavior markers.
- Modify `desktop/src/modules/agent/components/agent-timeline.tsx`: add centered readable timeline width and consistent vertical spacing.
- Modify `desktop/src/modules/agent/components/agent-thinking-event.tsx`: make thinking blocks lightweight collapsible rows.
- Modify `desktop/src/modules/agent/components/agent-tool-event.tsx`: make tool, result, and permission timeline events lightweight collapsible rows without removing body text or actions.
- Modify `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`: preserve status/body/default-open coverage and add copy/exit-code assertions.

## Task 1: Message Rendering

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx`

- [ ] **Step 1: Update message tests for the lightweight direction**

Replace `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx` with:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentMessageTimelineItem } from "@/types/agent"
import { AgentMessageEvent } from "../components/agent-message-event"

const baseEntry = {
  id: "message-1",
  kind: "message",
  content: "你好",
  timestamp: "2026-04-27T03:15:00.000Z",
} satisfies Omit<SynapseAgentMessageTimelineItem, "role">

describe("AgentMessageEvent", () => {
  it("right-aligns user messages with a subtle outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("justify-end")
    expect(html).toContain("bg-muted")
    expect(html).toContain("text-foreground")
    expect(html).not.toContain("bg-primary")
    expect(html).not.toContain("text-primary-foreground")
  })

  it("left-aligns assistant messages without an incoming bubble surface", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("justify-start")
    expect(html).toContain("max-w-[76ch]")
    expect(html).not.toContain("bg-muted")
    expect(html).not.toContain("bg-primary")
    expect(html).not.toContain("rounded-2xl")
  })

  it("wraps long message content and preserves whitespace treatment", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "very-long-token-without-natural-breaks/very-long-token-without-natural-breaks",
        }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("min-w-0")
    expect(html).toContain("break-words")
    expect(html).toContain("whitespace-pre-wrap")
  })

  it("keeps local references clickable", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "/Users/liyang/project/file.ts:12",
        }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("<button")
    expect(html).toContain("/Users/liyang/project/file.ts:12")
  })
})
```

- [ ] **Step 2: Run the message test to verify it fails against current styling**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-message-row.test.tsx
```

Expected: FAIL because current user messages use `bg-primary` and assistant messages use `bg-muted/50`.

- [ ] **Step 3: Restyle message rendering**

In `desktop/src/modules/agent/components/agent-message-event.tsx`, replace the `return` block inside `AgentMessageEvent` with:

```tsx
  return (
    <article className={cn("flex min-w-0", outgoing ? "justify-end" : "justify-start")}>
      <div className={cn(
        "min-w-0 whitespace-pre-wrap break-words text-sm leading-7",
        outgoing
          ? "max-w-[72%] rounded-xl bg-muted px-4 py-2 text-foreground"
          : "max-w-[76ch] px-1 py-2 text-foreground",
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
```

- [ ] **Step 4: Run the message test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-message-row.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit message rendering**

Run:

```bash
git add desktop/src/modules/agent/components/agent-message-event.tsx desktop/src/modules/agent/__tests__/agent-message-row.test.tsx
git commit -m "style: lighten agent message rendering"
```

## Task 2: Right Panel Layout, Timeline Spacing, And Composer

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`

- [ ] **Step 1: Update composer test expectations**

Replace `desktop/src/modules/agent/__tests__/agent-composer.test.tsx` with:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../index"

describe("AgentComposer", () => {
  it("renders a light input dock with an icon-only send button", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft="你好"
        disabled={false}
        canSend={true}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    expect(html).toContain("rounded-2xl border border-border bg-background")
    expect(html).toContain("px-3 py-2")
    expect(html).toContain("border-0")
    expect(html).toContain("bg-transparent")
    expect(html).toContain("focus-visible:ring-0")
    expect(html).toContain("aria-label=\"发送\"")
    expect(html).toContain("data-size=\"icon\"")
    expect(html).toContain("rounded-full")
    expect(html).toContain("lucide-arrow-up")
    expect(html).not.toContain("gap-2 rounded-md border border-border bg-background px-2 py-1.5")
    expect(html).not.toContain(">发送</button>")
  })
})
```

- [ ] **Step 2: Run the composer test to verify it fails against current styling**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because the current composer uses `rounded-md` and tighter padding.

- [ ] **Step 3: Tune the right-panel shell and header**

In `desktop/src/modules/agent/index.tsx`, change the first right-panel wrapper from:

```tsx
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
```

to:

```tsx
      <div className="flex h-full min-h-0 flex-col gap-0 bg-background">
        <div className="flex items-center justify-between gap-3 px-0 py-0">
```

Keep all existing header children and actions intact.

- [ ] **Step 4: Tune timeline spacing**

In `desktop/src/modules/agent/components/agent-timeline.tsx`, replace the inner `<div>` class with:

```tsx
      <div className="mx-auto flex min-w-0 max-w-4xl flex-col gap-5 px-2 py-4">
```

Keep the empty state, item mapping, running status, and bottom ref unchanged.

- [ ] **Step 5: Restyle the composer dock**

In `desktop/src/modules/agent/index.tsx`, replace the `AgentComposer` form with:

```tsx
    <form
      className="mx-auto flex w-full max-w-4xl shrink-0 items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2"
      onSubmit={onSubmit}
    >
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="输入消息"
        disabled={disabled}
        rows={1}
        className="h-9 min-h-9 flex-1 resize-none overflow-hidden border-0 bg-transparent px-1.5 py-2 shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent"
      />
      <Button
        type="submit"
        size="icon"
        className="shrink-0 rounded-full"
        disabled={!canSend}
        aria-label="发送"
      >
        <ArrowUp data-icon="inline-start" />
      </Button>
    </form>
```

- [ ] **Step 6: Run the composer test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit layout and composer changes**

Run:

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "style: lighten agent composer layout"
```

## Task 3: Tool And Thinking Event Rows

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-thinking-event.tsx`
- Modify: `desktop/src/modules/agent/components/agent-tool-event.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`

- [ ] **Step 1: Expand tool event test coverage for preserved details**

In `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`, add this test after the failed-result test:

```tsx
  it("keeps exit code and copy action for expanded tool results", () => {
    const html = renderToStaticMarkup(<AgentToolEvent
      item={{
        id: "tool-3",
        kind: "toolResult",
        timestamp: "2026-04-28T00:00:00.000Z",
        toolName: "Bash",
        content: "command output",
        exitCode: 2,
        success: false,
      }}
      profile={profile}
    />)

    expect(html).toContain("command output")
    expect(html).toContain("exit 2")
    expect(html).toContain("复制")
    expect(html).toContain("lucide-clipboard")
  })
```

Also add this assertion to the first test:

```tsx
    expect(html).toContain("border-y border-border")
```

- [ ] **Step 2: Run the tool event test to verify it fails against current styling**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: FAIL because current tool events use `rounded-md border border-border`, not the lighter row class.

- [ ] **Step 3: Restyle thinking events as lightweight rows**

In `desktop/src/modules/agent/components/agent-thinking-event.tsx`, replace the component return with:

```tsx
  return (
    <Collapsible defaultOpen={!profile.thinkingDefaultCollapsed} className="border-y border-border py-1">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-full justify-start px-1">
          <ChevronDown data-icon="inline-start" />
          Thinking
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="whitespace-pre-wrap break-words px-1 pb-3 pt-1 text-sm leading-7 text-muted-foreground">
          {item.content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
```

- [ ] **Step 4: Restyle tool events as lightweight rows**

In `desktop/src/modules/agent/components/agent-tool-event.tsx`, replace the component return with:

```tsx
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-y border-border py-1">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start px-1">
            <ChevronDown data-icon="inline-start" />
            <Terminal data-icon="inline-start" />
            <span className="truncate">{label}</span>
          </Button>
        </CollapsibleTrigger>
        <Badge variant={failed ? "destructive" : "secondary"}>{status}</Badge>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 px-1 pb-3 pt-2">
          {body ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm leading-7">
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
```

Remove the unused `Separator` import and the `Separator` JSX from this file.

- [ ] **Step 5: Run the tool event test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit tool and thinking styling**

Run:

```bash
git add desktop/src/modules/agent/components/agent-thinking-event.tsx desktop/src/modules/agent/components/agent-tool-event.tsx desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx
git commit -m "style: lighten agent timeline events"
```

## Task 4: Final Regression Verification

**Files:**
- Verify: `desktop/src/modules/agent/components/agent-message-event.tsx`
- Verify: `desktop/src/modules/agent/index.tsx`
- Verify: `desktop/src/modules/agent/components/agent-timeline.tsx`
- Verify: `desktop/src/modules/agent/components/agent-thinking-event.tsx`
- Verify: `desktop/src/modules/agent/components/agent-tool-event.tsx`
- Verify: `desktop/src/modules/agent/__tests__/agent-message-row.test.tsx`
- Verify: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`
- Verify: `desktop/src/modules/agent/components/__tests__/agent-tool-event.test.tsx`

- [ ] **Step 1: Run all targeted agent UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/agent/__tests__/agent-message-row.test.tsx \
  src/modules/agent/__tests__/agent-composer.test.tsx \
  src/modules/agent/components/__tests__/agent-tool-event.test.tsx
```

Expected: PASS for all targeted files.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm desktop:typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm desktop:check:hard-constraints
```

Expected: exit code 0. This should stay clean because the plan touches renderer UI only.

- [ ] **Step 4: Inspect the final diff for scope**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff --name-only HEAD~3..HEAD
```

Expected changed files only under:

```text
desktop/src/modules/agent/
```

- [ ] **Step 5: Confirm visual and copy acceptance criteria from source**

Run:

```bash
rg -n "bg-primary|text-primary-foreground|bg-muted/50|rounded-md border border-border|Separator" desktop/src/modules/agent/components/agent-message-event.tsx desktop/src/modules/agent/components/agent-tool-event.tsx desktop/src/modules/agent/components/agent-thinking-event.tsx
rg -n "暂无消息|正在处理|输入消息|复制|命令|权限" desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/agent-timeline.tsx desktop/src/modules/agent/components/agent-run-status.tsx desktop/src/modules/agent/components/agent-tool-event.tsx
```

Expected: first command returns no stale heavy styling matches for the changed components. Second command returns the preserved UI text locations.

- [ ] **Step 6: Commit final verification note only if a follow-up test-only change was needed**

If Step 1-5 require no edits, do not create an empty commit. If a test-only adjustment was made, run:

```bash
git add desktop/src/modules/agent
git commit -m "test: cover lightweight agent right panel"
```

## Plan Self-Review

- Spec coverage: Task 1 covers user and assistant message behavior; Task 2 covers right-panel spacing, header preservation, timeline width, and composer; Task 3 covers tool/thinking event visual weight while preserving status, body, copy, and exit code; Task 4 covers final verification, text preservation, and scope.
- Placeholder scan: no red-flag placeholders, incomplete file paths, or unspecified commands.
- Type consistency: the plan uses existing component names and props only; it does not introduce new types or change data flow.
