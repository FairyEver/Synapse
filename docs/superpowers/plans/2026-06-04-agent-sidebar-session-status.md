# Agent Sidebar Session Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Agent sidebar conversation status as running spinner, unread dot, or relative time with `running > unread > time` priority.

**Architecture:** Reuse existing renderer state. `useAgentChat` already exposes `sendingConversationIds` and `unreadByConversationId`; thread `sendingConversationIds` through the Agent sidebar component tree and keep the display priority inside `SessionTrailing`.

**Tech Stack:** React, TypeScript, Tailwind default utilities, lucide-react, Vitest, jsdom.

---

## File Structure

- Modify `desktop/src/modules/agent/components/session-trailing.tsx`
  - Own the local trailing-status priority.
  - Replace numeric unread badge with a blue dot.
  - Add a running spinner using `LoaderCircle`.
- Modify `desktop/src/modules/agent/components/project-group.tsx`
  - Accept `sendingConversationIds`.
  - Pass per-session `running` into `SessionTrailing`.
- Modify `desktop/src/modules/agent/components/archived-group.tsx`
  - Mirror `ProjectGroup` behavior for archived sessions.
- Modify `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
  - Accept `sendingConversationIds`.
  - Pass the set into project and archived groups.
- Modify `desktop/src/modules/agent/index.tsx`
  - Pass `chat.sendingConversationIds` into `AgentSessionSidebar`.
- Modify `desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx`
  - Cover running, unread, idle, and malformed timestamp cases.
- Modify `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`
  - Pass the new prop in existing renders.
  - Add coverage that running state from `sendingConversationIds` appears in the rendered sidebar.
- Modify `desktop/src/modules/agent/components/__tests__/project-group.test.tsx`
  - Pass the new prop in existing renders.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a short user-facing note about the sidebar status indicators.

## Task 1: Update `SessionTrailing` Status Rendering

**Files:**
- Modify: `desktop/src/modules/agent/components/session-trailing.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx`

- [ ] **Step 1: Write failing tests for status priority and marker shape**

Replace `desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx` with:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SessionTrailing } from "../session-trailing"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("SessionTrailing", () => {
  it("omits malformed Agent session timestamps instead of rendering NaN", () => {
    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="not-a-date"
        unread={0}
        running={false}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).not.toContain("NaN")
  })

  it("shows a running spinner before unread state or relative time", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-04T06:00:00.000Z").getTime())

    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={3}
        running
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("animate-spin")
    expect(html).toContain("正在输出")
    expect(html).not.toContain("未读")
    expect(html).not.toContain("3")
    expect(html).not.toContain("2 分")
  })

  it("shows an unread dot without a numeric badge after completion", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-04T06:00:00.000Z").getTime())

    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={3}
        running={false}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("bg-blue-500")
    expect(html).toContain("未读")
    expect(html).not.toContain(">3<")
    expect(html).not.toContain("2 分")
  })

  it("shows relative time when completed and read", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-06-04T06:00:00.000Z").getTime())

    const html = renderToStaticMarkup(
      <SessionTrailing
        updatedAt="2026-06-04T05:58:00.000Z"
        unread={0}
        running={false}
        canDelete={false}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("2 分")
    expect(html).not.toContain("animate-spin")
    expect(html).not.toContain("未读")
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx
```

Expected: FAIL because `SessionTrailing` does not accept `running` and still renders numeric unread badges.

- [ ] **Step 3: Implement minimal `SessionTrailing` rendering**

Update `desktop/src/modules/agent/components/session-trailing.tsx`:

```tsx
import { useEffect, useRef, useState } from "react"
import { Check, LoaderCircle, Trash2 } from "lucide-react"

function formatRelativeTime(timestamp: string): string | undefined {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  if (!Number.isFinite(then)) return undefined
  const diffMs = now - then
  if (diffMs < 0) return "刚刚"

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天`

  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks} 周`

  const months = Math.floor(days / 30)
  return `${months} 月`
}

function SessionTrailing({
  updatedAt,
  unread,
  running,
  canDelete,
  onDelete,
}: {
  readonly updatedAt?: string
  readonly unread: number
  readonly running: boolean
  readonly canDelete: boolean
  readonly onDelete: () => void
}) {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const relativeTime = updatedAt ? formatRelativeTime(updatedAt) : undefined

  useEffect(() => {
    if (!armed) return undefined
    timerRef.current = setTimeout(() => setArmed(false), 3000)
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setArmed(false)
      }
    }
    document.addEventListener("pointerdown", handleClickOutside, true)
    return () => {
      clearTimeout(timerRef.current)
      document.removeEventListener("pointerdown", handleClickOutside, true)
    }
  }, [armed])

  return (
    <span className="flex items-center gap-1">
      {running ? (
        <span className="text-muted-foreground group-hover/item:hidden" aria-label="正在输出">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        </span>
      ) : unread > 0 ? (
        <span
          className="size-2 rounded-full bg-blue-500 group-hover/item:hidden"
          aria-label="未读"
        />
      ) : relativeTime ? (
        <span className="text-xs text-muted-foreground group-hover/item:hidden">
          {relativeTime}
        </span>
      ) : null}
      {canDelete ? (
        <button
          ref={buttonRef}
          type="button"
          title={armed ? "确认删除" : "删除会话"}
          className={`hidden rounded p-0.5 group-hover/item:block ${armed ? "text-destructive" : "text-muted-foreground hover:text-destructive"}`}
          onClick={(event) => {
            event.stopPropagation()
            if (armed) {
              setArmed(false)
              onDelete()
            } else {
              setArmed(true)
            }
          }}
        >
          {armed ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
          <span className="sr-only">{armed ? "确认删除" : "删除会话"}</span>
        </button>
      ) : null}
    </span>
  )
}

export { SessionTrailing }
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add desktop/src/modules/agent/components/session-trailing.tsx desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx
git commit -m "feat(agent): update sidebar session trailing status"
```

## Task 2: Thread Running State Through the Sidebar

**Files:**
- Modify: `desktop/src/modules/agent/components/project-group.tsx`
- Modify: `desktop/src/modules/agent/components/archived-group.tsx`
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`
- Test: `desktop/src/modules/agent/components/__tests__/project-group.test.tsx`
- Test: `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`

- [ ] **Step 1: Write failing sidebar wiring coverage**

In `desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx`, add this test inside `describe("AgentSessionSidebar", () => { ... })`:

```tsx
  it("renders running status from sending conversation ids", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          projectId: "project-1",
          id: "running-conv",
          sessionKey: "local:renderer",
          platform: "local-renderer",
          name: "Active Session",
          active: true,
          historyCount: 1,
          createdAt: "2026-06-04T05:00:00.000Z",
          updatedAt: "2026-06-04T05:58:00.000Z",
        }]}
        archivedSessions={[]}
        projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
        selectedProjectId="project-other"
        selectedConversationId="other-conv"
        sourceFilter="user"
        unreadByConversationId={{ "project-1:running-conv": 4 }}
        sendingConversationIds={new Set(["running-conv"])}
        onCreateSession={vi.fn()}
        onSourceFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain("Active Session")
    expect(html).toContain("animate-spin")
    expect(html).toContain("正在输出")
    expect(html).not.toContain(">4<")
    expect(html).not.toContain("未读")
  })
```

Update every existing `AgentSessionSidebar` render in that file to include:

```tsx
sendingConversationIds={new Set()}
```

In `desktop/src/modules/agent/components/__tests__/project-group.test.tsx`, add this prop to the existing `ProjectGroup` render:

```tsx
sendingConversationIds={new Set()}
```

- [ ] **Step 2: Run the sidebar tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx desktop/src/modules/agent/components/__tests__/project-group.test.tsx
```

Expected: FAIL because sidebar/group props do not accept `sendingConversationIds` and `SessionTrailing` call sites do not pass `running`.

- [ ] **Step 3: Add `sendingConversationIds` to `ProjectGroup`**

In `desktop/src/modules/agent/components/project-group.tsx`, update `ProjectGroupProps`:

```tsx
type ProjectGroupProps = {
  project: { id: string; name: string; path: string }
  sessions: SynapseAgentSessionSummary[]
  selectedProjectId?: string
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  sendingConversationIds: ReadonlySet<string>
  onCreateSession: () => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onDeleteOthers: (session: SynapseAgentSessionSummary) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}
```

Destructure the new prop:

```tsx
  unreadByConversationId,
  sendingConversationIds,
  onCreateSession,
```

Inside `sessions.map`, compute running:

```tsx
const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
const running = sendingConversationIds.has(session.id)
const active = session.projectId === selectedProjectId
  && session.id === selectedConversationId
```

Pass it to `SessionTrailing`:

```tsx
<SessionTrailing
  updatedAt={session.updatedAt}
  unread={unread}
  running={running}
  canDelete
  onDelete={() => onDelete(session)}
/>
```

- [ ] **Step 4: Add `sendingConversationIds` to `ArchivedGroup`**

In `desktop/src/modules/agent/components/archived-group.tsx`, update `ArchivedGroupProps`:

```tsx
type ArchivedGroupProps = {
  sessions: SynapseAgentSessionSummary[]
  selectedProjectId?: string
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  sendingConversationIds: ReadonlySet<string>
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onDeleteOthers: (session: SynapseAgentSessionSummary) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}
```

Destructure the new prop:

```tsx
  unreadByConversationId,
  sendingConversationIds,
  onSelect,
```

Inside `sessions.map`, compute running:

```tsx
const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
const running = sendingConversationIds.has(session.id)
const active = session.projectId === selectedProjectId
  && session.id === selectedConversationId
```

Pass it to `SessionTrailing`:

```tsx
<SessionTrailing
  updatedAt={session.updatedAt}
  unread={unread}
  running={running}
  canDelete
  onDelete={() => onDelete(session)}
/>
```

- [ ] **Step 5: Add `sendingConversationIds` to `AgentSessionSidebar`**

In `desktop/src/modules/agent/components/agent-session-sidebar.tsx`, update `AgentSessionSidebarProps`:

```tsx
type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  projects: ProjectOption[]
  selectedProjectId?: string
  selectedConversationId?: string
  sourceFilter: ConversationSourceFilter
  unreadByConversationId: Record<string, number>
  sendingConversationIds: ReadonlySet<string>
  onCreateSession: (projectId: string, selection: ProviderModelSelection) => void | Promise<void>
  onSourceFilterChange: (sourceFilter: ConversationSourceFilter) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onDeleteOthers: (session: SynapseAgentSessionSummary) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}
```

Destructure the prop:

```tsx
  unreadByConversationId,
  sendingConversationIds,
  onCreateSession,
```

Pass it to `ProjectGroup`:

```tsx
<ProjectGroup
  key={project.id}
  project={project}
  sessions={sessionsByProject.get(project.id) ?? []}
  selectedProjectId={selectedProjectId}
  selectedConversationId={selectedConversationId}
  unreadByConversationId={unreadByConversationId}
  sendingConversationIds={sendingConversationIds}
  onCreateSession={() => setCreateProject(project)}
  onSelect={onSelect}
  onDelete={onDelete}
  onDeleteOthers={onDeleteOthers}
  onRename={onRename}
/>
```

Pass it to `ArchivedGroup`:

```tsx
<ArchivedGroup
  sessions={visibleArchivedSessions}
  selectedProjectId={selectedProjectId}
  selectedConversationId={selectedConversationId}
  unreadByConversationId={unreadByConversationId}
  sendingConversationIds={sendingConversationIds}
  onSelect={onSelect}
  onDelete={onDelete}
  onDeleteOthers={onDeleteOthers}
  onRename={onRename}
/>
```

- [ ] **Step 6: Pass state from `AgentModule`**

In `desktop/src/modules/agent/index.tsx`, update the `AgentSessionSidebar` call:

```tsx
<AgentSessionSidebar
  sessions={chat.sessions}
  archivedSessions={chat.archivedSessions}
  projects={projectOptions}
  selectedProjectId={chat.selectedProjectId}
  selectedConversationId={chat.selectedConversationId}
  sourceFilter={sourceFilter}
  unreadByConversationId={chat.unreadByConversationId}
  sendingConversationIds={chat.sendingConversationIds}
  onCreateSession={async (projectId, selection) => {
    if (sourceFilter !== "user") setSourceFilter("user")
    await chat.createSession(projectId, selection.providerId, undefined, selection.modelTier)
  }}
  onSourceFilterChange={setSourceFilter}
  onSelect={(session) => void chat.selectSession(session)}
  onDelete={(session) => void chat.deleteSession(session)}
  onDeleteOthers={async (keep) => {
```

Only insert the new `sendingConversationIds` prop; keep the rest of the existing JSX unchanged.

- [ ] **Step 7: Run the sidebar tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx desktop/src/modules/agent/components/__tests__/project-group.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add desktop/src/modules/agent/components/project-group.tsx desktop/src/modules/agent/components/archived-group.tsx desktop/src/modules/agent/components/agent-session-sidebar.tsx desktop/src/modules/agent/index.tsx desktop/src/modules/agent/components/__tests__/project-group.test.tsx desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx
git commit -m "feat(agent): show running sidebar sessions"
```

## Task 3: Release Note and Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add the release note**

Add one bullet under the appropriate pending-release section in `RELEASE_NOTES_PENDING.md`:

```md
- Agent 会话侧栏现在会优先显示正在输出的转圈状态；已完成但未读的会话改为蓝色小圆点，不再显示未读数字。
```

- [ ] **Step 2: Run focused Agent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/agent/components/__tests__/session-trailing.test.tsx desktop/src/modules/agent/__tests__/agent-session-sidebar.test.tsx desktop/src/modules/agent/components/__tests__/project-group.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints if available**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 5: Review git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. `git status --short` shows only the files changed for this implementation if commits have not already been made.

- [ ] **Step 6: Commit Task 3**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent sidebar status indicators"
```

## Self-Review

- Spec coverage: Task 1 implements spinner, unread dot, numeric badge removal, priority, malformed timestamp behavior, and idle relative time. Task 2 wires `sendingConversationIds` through user and archived groups. Task 3 updates release notes and runs focused verification.
- Placeholder scan: The plan contains no deferred implementation markers. Code snippets name concrete files, props, commands, and expected results.
- Type consistency: `running: boolean` is added to `SessionTrailing`; `sendingConversationIds: ReadonlySet<string>` is added consistently to `AgentSessionSidebar`, `ProjectGroup`, and `ArchivedGroup`.
