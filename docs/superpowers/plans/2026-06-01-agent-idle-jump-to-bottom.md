# Agent Idle Jump To Bottom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centered jump-to-bottom icon above the Agent composer when the user has manually scrolled away from the bottom, Agent output is idle, and there are no unread new messages.

**Architecture:** Reuse the existing `useStickToBottom` state machine. Keep `↓ 新消息` as the higher-priority unread indicator, and add a second composer prop for the idle-only icon button. Do not change timeline scrolling internals.

**Tech Stack:** React, TypeScript, lucide-react, shadcn/ui `Button`, Vitest, jsdom.

---

## File Structure

- Modify `desktop/src/modules/agent/components/agent-composer.tsx`: add `showIdleJumpToBottom` prop and render a centered `ChevronDown` icon button only when the unread button is not shown.
- Modify `desktop/src/modules/agent/index.tsx`: compute `showJumpToBottom` and `showIdleJumpToBottom` from `stick.isPinned`, `stick.hasUnread`, and `chat.sending`.
- Modify `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`: cover idle icon rendering, click behavior, and mutual exclusion with `↓ 新消息`.
- Modify `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`: capture `AgentComposer` props and cover AgentModule wiring for idle, unread, and active-output states.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing optimization note.

---

### Task 1: Composer Idle Icon Button

**Files:**
- Modify: `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`

- [ ] **Step 1: Write failing Composer tests**

Add these tests after the existing `renders the jump-to-bottom pill at the composer top-right` test in `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`:

```tsx
  it("renders the idle jump-to-bottom icon centered above the composer", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showIdleJumpToBottom
        onJumpToBottom={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="滚动到底部"')
    expect(html).toContain("absolute -top-11 left-1/2")
    expect(html).toContain("-translate-x-1/2")
    expect(html).not.toContain("↓ 新消息")
  })

  it("keeps the unread jump button ahead of the idle jump icon", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showJumpToBottom
        showIdleJumpToBottom
        onJumpToBottom={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("↓ 新消息")
    expect(html).toContain('aria-label="跳到最新消息"')
    expect(html).not.toContain('aria-label="滚动到底部"')
  })
```

Add this click test after `tracks the jump-to-bottom action from the composer`:

```tsx
  it("uses the same jump action for the idle jump icon", async () => {
    const onJumpToBottom = vi.fn()
    const container = document.createElement("div")
    const root = createRoot(container)
    roots.push(root)
    track.mockClear()

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          showIdleJumpToBottom
          onJumpToBottom={onJumpToBottom}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const button = container.querySelector('button[aria-label="滚动到底部"]')
    expect(button).toBeTruthy()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onJumpToBottom).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "agent-timeline-idle-jump-to-bottom",
      action: "click",
    })
  })
```

- [ ] **Step 2: Run Composer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: FAIL because `showIdleJumpToBottom` is not a prop and the `滚动到底部` button is not rendered.

- [ ] **Step 3: Implement the Composer prop and icon button**

In `desktop/src/modules/agent/components/agent-composer.tsx`, update the prop destructuring:

```tsx
  showJumpToBottom = false,
  showIdleJumpToBottom = false,
```

Update the prop type block:

```tsx
  readonly showJumpToBottom?: boolean
  readonly showIdleJumpToBottom?: boolean
```

Replace the existing jump button block with this mutually exclusive block:

```tsx
        {showJumpToBottom ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onJumpToBottom}
            aria-label="跳到最新消息"
            data-track="agent-timeline-jump-to-bottom"
            className="absolute -top-11 right-0 rounded-full shadow-md"
          >
            ↓ 新消息
          </Button>
        ) : showIdleJumpToBottom ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={onJumpToBottom}
            aria-label="滚动到底部"
            data-track="agent-timeline-idle-jump-to-bottom"
            className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          >
            <ChevronDown />
          </Button>
        ) : null}
```

- [ ] **Step 4: Run Composer tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/__tests__/agent-composer.test.tsx
git commit -m "feat: add idle jump to bottom button"
```

---

### Task 2: AgentModule State Wiring

**Files:**
- Modify: `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Write failing AgentModule wiring tests**

In `desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx`, add `composerProps` and configurable stick state to the hoisted mocks:

```tsx
    stickState: {
      isPinned: true,
      hasUnread: false,
    },
    scrollToBottom: vi.fn(),
    composerProps: null as {
      showJumpToBottom?: boolean
      showIdleJumpToBottom?: boolean
      onJumpToBottom?: () => void
    } | null,
```

Update the `useStickToBottom` mock:

```tsx
  useStickToBottom: () => ({
    forcePin: mocks.forcePin,
    viewportRef: { current: null },
    isPinned: mocks.stickState.isPinned,
    hasUnread: mocks.stickState.hasUnread,
    scrollToBottom: mocks.scrollToBottom,
  }),
```

Update the `AgentComposer` mock:

```tsx
vi.mock("../components/agent-composer", () => ({
  AgentComposer: (props: {
    showJumpToBottom?: boolean
    showIdleJumpToBottom?: boolean
    onJumpToBottom?: () => void
  }) => {
    mocks.composerProps = props
    return <form />
  },
}))
```

Reset the new mutable mocks in `afterEach`:

```tsx
  mocks.stickState = {
    isPinned: true,
    hasUnread: false,
  }
  mocks.scrollToBottom.mockClear()
  mocks.composerProps = null
```

Add these tests before the final `})` of the `describe("AgentModule pending prompt sessions", ...)` block:

```tsx
  it("shows the idle jump button only when the selected conversation is off bottom and idle", async () => {
    mocks.stickState = {
      isPinned: false,
      hasUnread: false,
    }
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "Older answer",
        timestamp: "2026-06-01T00:00:00.000Z",
      }],
      sending: false,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.showJumpToBottom).toBe(false)
    expect(mocks.composerProps?.showIdleJumpToBottom).toBe(true)
  })

  it("keeps the unread jump button when off-bottom unread content exists after output stops", async () => {
    mocks.stickState = {
      isPinned: false,
      hasUnread: true,
    }
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "New answer",
        timestamp: "2026-06-01T00:00:00.000Z",
      }],
      sending: false,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.showJumpToBottom).toBe(true)
    expect(mocks.composerProps?.showIdleJumpToBottom).toBe(false)
  })

  it("does not show the idle jump button while Agent output is active", async () => {
    mocks.stickState = {
      isPinned: false,
      hasUnread: false,
    }
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "Streaming answer",
        timestamp: "2026-06-01T00:00:00.000Z",
      }],
      sending: true,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.showJumpToBottom).toBe(false)
    expect(mocks.composerProps?.showIdleJumpToBottom).toBe(false)
  })
```

- [ ] **Step 2: Run AgentModule tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: FAIL because `showIdleJumpToBottom` is not yet passed by `AgentModule`.

- [ ] **Step 3: Implement AgentModule wiring**

In `desktop/src/modules/agent/index.tsx`, add the local state expressions after the `useStickToBottom` call:

```tsx
  const showJumpToBottom = !stick.isPinned && stick.hasUnread
  const showIdleJumpToBottom = !stick.isPinned && !stick.hasUnread && !chat.sending
```

Update the `AgentComposer` props near the bottom of the file:

```tsx
              showJumpToBottom={showJumpToBottom}
              showIdleJumpToBottom={showIdleJumpToBottom}
              onJumpToBottom={() => stick.scrollToBottom({ behavior: "smooth" })}
```

- [ ] **Step 4: Run AgentModule tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add desktop/src/modules/agent/index.tsx desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx
git commit -m "feat: wire idle jump state"
```

---

### Task 3: Release Notes and Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Under `## 功能优化` in `RELEASE_NOTES_PENDING.md`, add:

```md
- Agent 对话在空闲状态下手动上滚后，会在输入框上方提供居中的回到底部按钮；如果期间有新输出，仍优先显示“新消息”入口。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/agent/__tests__/agent-composer.test.tsx src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff --check
git diff --stat
```

Expected: `git diff --check` has no output. `git diff --stat` shows only the Agent files and `RELEASE_NOTES_PENDING.md` from this implementation.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent jump button"
```

