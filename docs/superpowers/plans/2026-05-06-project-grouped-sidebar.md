# Project-Grouped Agent Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat session list sidebar with a project-grouped collapsible structure where each project has an inline "new chat" button that opens an Agent picker popover.

**Architecture:** Sessions are grouped by `projectId` using the existing data model. A new `ProjectGroup` component wraps each group with `Collapsible`, and a new `AgentPickerPopover` handles Agent selection inline. The `CreateSessionDialog` is removed.

**Tech Stack:** React 19, Radix Collapsible (via shadcn), Popover (existing), lucide-react icons, existing `ModuleSidebarItem`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `desktop/src/modules/agent/components/agent-picker-popover.tsx` | Popover listing available Agents for selection |
| Create | `desktop/src/modules/agent/components/session-trailing.tsx` | Shared SessionTrailing component (time + unread + delete) |
| Create | `desktop/src/modules/agent/components/project-group.tsx` | Collapsible project section with header + session list |
| Modify | `desktop/src/modules/agent/components/agent-session-sidebar.tsx` | Rewrite to group sessions by project, render ProjectGroups |
| Modify | `desktop/src/modules/agent/index.tsx` | Pass projects/agents to sidebar, load agents on mount, remove CreateSessionDialog |
| Delete | `desktop/src/modules/agent/components/create-session-dialog.tsx` | No longer needed |

---

### Task 1: Create AgentPickerPopover

**Files:**
- Create: `desktop/src/modules/agent/components/agent-picker-popover.tsx`

- [ ] **Step 1: Create the AgentPickerPopover component**

```tsx
import { useState, type ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentAvailability } from "@/types/agent"

type AgentPickerPopoverProps = {
  agents: SynapseAgentAvailability[]
  onSelect: (agentType: string) => void
  children: ReactNode
}

function AgentPickerPopover({ agents, onSelect, children }: AgentPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const available = agents.filter((agent) => agent.available)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        {available.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">无可用 Agent</p>
        ) : (
          <div className="flex flex-col">
            {available.map((agent) => {
              const def = agentDefinitions.find((d) => d.id === agent.agentType)
              return (
                <button
                  key={agent.agentType}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                  onClick={() => {
                    onSelect(agent.agentType)
                    setOpen(false)
                  }}
                >
                  {def?.icon ? (
                    <img src={def.icon} alt="" className="h-4 w-4 shrink-0" />
                  ) : null}
                  <span className="truncate">{agent.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { AgentPickerPopover }
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | grep -i "agent-picker" || echo "No errors"`

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-picker-popover.tsx
git commit -m "feat(agent): add AgentPickerPopover component"
```

---

### Task 2: Extract SessionTrailing into shared file

**Files:**
- Create: `desktop/src/modules/agent/components/session-trailing.tsx`

- [ ] **Step 1: Create session-trailing.tsx**

Extract the `SessionTrailing` component (currently in `agent-session-sidebar.tsx`) into its own file so both `ProjectGroup` and the rewritten sidebar can import it:

```tsx
import { Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { formatEntryTime } from "../utils"

function SessionTrailing({
  updatedAt,
  unread,
  canDelete,
  onDelete,
}: {
  readonly updatedAt?: string
  readonly unread: number
  readonly canDelete: boolean
  readonly onDelete: () => void
}) {
  return (
    <span className="flex items-center gap-1">
      {unread > 0 ? (
        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
          {unread}
          <span className="sr-only"> 条未读</span>
        </Badge>
      ) : null}
      {updatedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatEntryTime(updatedAt)}
        </span>
      ) : null}
      {canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              data-track="agent-session-delete-open"
              title="删除会话"
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              onClick={(event) => event.stopPropagation()}
            >
              <Trash2 className="size-3.5" />
              <span className="sr-only">删除会话</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除此会话？</AlertDialogTitle>
              <AlertDialogDescription>会话记录将被删除。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                data-track="agent-session-delete-confirm"
                onClick={onDelete}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </span>
  )
}

export { SessionTrailing }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/session-trailing.tsx
git commit -m "refactor(agent): extract SessionTrailing into shared file"
```

---

### Task 3: Create ProjectGroup

**Files:**
- Create: `desktop/src/modules/agent/components/project-group.tsx`

- [ ] **Step 1: Create the ProjectGroup component**

```tsx
import { FolderOpen, Plus } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { ModuleSidebarItem } from "@/components/module-sidebar"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentAvailability, SynapseAgentSessionSummary } from "@/types/agent"
import { AgentPickerPopover } from "./agent-picker-popover"
import { SessionTrailing } from "./session-trailing"
import { formatEntryTime, sessionLabel } from "../utils"
import { conversationUnreadKey } from "../live-sync"

type ProjectGroupProps = {
  project: { id: string; name: string; path: string }
  sessions: SynapseAgentSessionSummary[]
  availableAgents: SynapseAgentAvailability[]
  selectedProjectId?: string
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  onCreateSession: (agentType: string) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
}

function ProjectGroup({
  project,
  sessions,
  availableAgents,
  selectedProjectId,
  selectedConversationId,
  unreadByConversationId,
  onCreateSession,
  onSelect,
  onDelete,
}: ProjectGroupProps) {
  return (
    <Collapsible defaultOpen data-track="agent-project-group">
      <div className="flex items-center justify-between px-1 py-0.5">
        <CollapsibleTrigger className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-sm font-medium hover:bg-muted/60">
          <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{project.name}</span>
        </CollapsibleTrigger>
        <AgentPickerPopover agents={availableAgents} onSelect={onCreateSession}>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title="新建会话"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus className="size-4" />
            <span className="sr-only">新建会话</span>
          </button>
        </AgentPickerPopover>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col">
          {sessions.map((session) => {
            const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
            const active = session.projectId === selectedProjectId
              && session.id === selectedConversationId
            const def = session.agentType
              ? agentDefinitions.find((d) => d.id === session.agentType)
              : undefined
            return (
              <ModuleSidebarItem
                key={`${session.projectId}:${session.id}`}
                active={active}
                trailing={
                  <SessionTrailing
                    updatedAt={session.updatedAt}
                    unread={unread}
                    canDelete
                    onDelete={() => onDelete(session)}
                  />
                }
                data-track="agent-session-select"
                trackValue={`${session.projectId}:${session.id}`}
                onClick={() => onSelect(session)}
              >
                <span className="flex items-center gap-1.5">
                  {def?.icon ? (
                    <img src={def.icon} alt="" className="h-3.5 w-3.5 shrink-0" />
                  ) : null}
                  <span className="truncate">{sessionLabel(session)}</span>
                </span>
              </ModuleSidebarItem>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { ProjectGroup }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/project-group.tsx
git commit -m "feat(agent): add ProjectGroup collapsible component"
```

---

### Task 4: Rewrite AgentSessionSidebar

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`

- [ ] **Step 1: Rewrite the sidebar to use project groups**

Replace the entire file content with:

```tsx
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  ModuleSidebar,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { SynapseAgentAvailability, SynapseAgentSessionSummary } from "@/types/agent"
import { ProjectGroup } from "./project-group"

type ProjectOption = {
  id: string
  name: string
  path: string
}

type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  projects: ProjectOption[]
  availableAgents: SynapseAgentAvailability[]
  selectedProjectId?: string
  selectedConversationId?: string
  loading: boolean
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  onRefresh: () => void
  onCreateSession: (projectId: string, agentType: string) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onFollowFeishuChange: (follow: boolean) => void
}

function AgentSessionSidebar({
  sessions,
  projects,
  availableAgents,
  selectedProjectId,
  selectedConversationId,
  loading,
  followFeishu,
  unreadByConversationId,
  onRefresh,
  onCreateSession,
  onSelect,
  onDelete,
  onFollowFeishuChange,
}: AgentSessionSidebarProps) {
  const sessionsByProject = groupSessionsByProject(sessions)

  return (
    <ModuleSidebar variant="bare">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">项目</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            disabled={loading}
            data-track="agent-session-refresh"
            onClick={onRefresh}
            title="刷新"
          >
            <RefreshCw />
            <span className="sr-only">刷新</span>
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between px-1">
        <Label htmlFor="agent-follow-feishu" className="text-xs text-muted-foreground">
          跟随飞书
        </Label>
        <Switch
          id="agent-follow-feishu"
          size="sm"
          data-track="agent-follow-feishu"
          checked={followFeishu}
          onCheckedChange={onFollowFeishuChange}
        />
      </div>
      <ModuleSidebarList data-track="agent-session-list">
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            sessions={sessionsByProject.get(project.id) ?? []}
            availableAgents={availableAgents}
            selectedProjectId={selectedProjectId}
            selectedConversationId={selectedConversationId}
            unreadByConversationId={unreadByConversationId}
            onCreateSession={(agentType) => onCreateSession(project.id, agentType)}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

function groupSessionsByProject(
  sessions: SynapseAgentSessionSummary[],
): Map<string, SynapseAgentSessionSummary[]> {
  const map = new Map<string, SynapseAgentSessionSummary[]>()
  for (const session of sessions) {
    const list = map.get(session.projectId)
    if (list) {
      list.push(session)
    } else {
      map.set(session.projectId, [session])
    }
  }
  return map
}

export { AgentSessionSidebar, type ProjectOption }
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/agent/components/agent-session-sidebar.tsx
git commit -m "feat(agent): rewrite sidebar with project-grouped layout"
```

---

### Task 5: Update AgentModule

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Remove CreateSessionDialog import and state, load agents on mount**

Changes to make in `desktop/src/modules/agent/index.tsx`:

1. Remove the `CreateSessionDialog` import and its `ProjectOption` type import
2. Remove `createDialogOpen` state
3. Remove the `useEffect` that loads agents when dialog opens — replace with one that loads on mount
4. Remove the `<CreateSessionDialog>` JSX at the bottom
5. Update the sidebar JSX to pass new props

The updated sidebar section becomes:

```tsx
const sidebar = (
  <AgentSessionSidebar
    sessions={chat.sessions}
    projects={projectOptions}
    availableAgents={availableAgents}
    selectedProjectId={chat.selectedProjectId}
    selectedConversationId={chat.selectedConversationId}
    loading={chat.loading}
    followFeishu={chat.followFeishu}
    unreadByConversationId={chat.unreadByConversationId}
    onRefresh={() => void chat.refresh()}
    onCreateSession={(projectId, agentType) => void chat.createSession(projectId, agentType)}
    onSelect={(session) => void chat.selectSession(session)}
    onDelete={(session) => void chat.deleteSession(session)}
    onFollowFeishuChange={chat.setFollowFeishu}
  />
)
```

The `useEffect` for loading agents changes from:

```tsx
useEffect(() => {
  if (!createDialogOpen) return
  const bridge = getSynapseBridge()
  if (!bridge) return
  void bridge.agent.getAvailableAgents().then(setAvailableAgents)
}, [createDialogOpen])
```

To:

```tsx
useEffect(() => {
  const bridge = getSynapseBridge()
  if (!bridge) return
  void bridge.agent.getAvailableAgents().then(setAvailableAgents)
}, [])
```

Also remove the `ProjectOption` type import from `create-session-dialog` — it's now exported from `agent-session-sidebar`. Update the import:

```tsx
import { AgentSessionSidebar, type ProjectOption } from "./components/agent-session-sidebar"
```

Remove these lines:
- `import { CreateSessionDialog, type ProjectOption } from "./components/create-session-dialog"`
- `const [createDialogOpen, setCreateDialogOpen] = useState(false)`
- The entire `<CreateSessionDialog ... />` JSX block

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 3: Verify the dev server starts without errors**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev` (check for build errors in terminal)

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): wire project-grouped sidebar into AgentModule"
```

---

### Task 6: Clean up unused CreateSessionDialog

**Files:**
- Modify: `desktop/src/modules/agent/components/create-session-dialog.tsx` (delete or keep for reference)

- [ ] **Step 1: Remove CreateSessionDialog file**

The file is no longer imported anywhere. Delete it:

```bash
rm desktop/src/modules/agent/components/create-session-dialog.tsx
```

- [ ] **Step 2: Verify no broken imports**

Run: `cd /Users/liyang/Documents/code/github/Synapse/desktop && npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add -u desktop/src/modules/agent/components/create-session-dialog.tsx
git commit -m "refactor(agent): remove unused CreateSessionDialog"
```

---

### Task 7: Visual verification

- [ ] **Step 1: Start dev server and verify the sidebar renders correctly**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

Verify in browser at `http://localhost:5173`:
1. Agent module sidebar shows "项目" title with refresh button and 跟随飞书 switch
2. Each project appears as a collapsible group with folder icon and name
3. Clicking the `+` button on a project shows the Agent picker popover
4. Selecting an Agent creates a new session under that project
5. Sessions display with agent icon, name, time, and delete button
6. Collapsing/expanding project groups works
7. Selecting a session highlights it and loads the timeline

- [ ] **Step 2: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(agent): sidebar visual polish"
```
