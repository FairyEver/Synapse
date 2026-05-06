# Agent 侧边栏空状态 + 已归档分组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add empty state guidance, project deletion warning, and archived sessions group to the Agent sidebar.

**Architecture:** Three independent UI improvements sharing a single new IPC method (`listAllSessions`). The archived group reuses `ProjectGroup` patterns with minor differences. Empty state uses the shared `Empty` component.

**Tech Stack:** React 19, shadcn/ui (AlertDialog, Empty, Collapsible), Electron IPC, Zod validation

---

### Task 1: Add `listAllSessions` IPC method (backend)

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Add the IPC handler in `agent/ipc.ts`**

Add a new method `listAllSessions` to the `agentIpcModule.methods` object, after the existing `listSessions` method. This method accesses the global `DataRepository` (bypassing project scoping) to return all conversation entries:

```typescript
listAllSessions: {
  kind: "invoke",
  channel: "synapse:agent:list-all-sessions",
  request: z.object({}),
  response: z.array(sessionSummarySchema),
  handler: async (ctx) => {
    const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
    const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
    const allSessions = await conversations.list()
    return allSessions
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => sessionSummary(session))
  },
},
```

Add the `DataRepository` import at the top of the file:

```typescript
import type { DataRepository } from "../../runtime/data-repo"
```

- [ ] **Step 2: Add the IPC channel constant**

In `desktop/electron/preload.ts`, add the channel to the `IPC_CHANNELS.agent` object:

```typescript
"listAllSessions": "synapse:agent:list-all-sessions",
```

- [ ] **Step 3: Add the bridge method in preload**

In the `agent` section of the bridge object in `preload.ts`, add:

```typescript
listAllSessions: () => invoke(IPC_CHANNELS.agent.listAllSessions)({}),
```

- [ ] **Step 4: Add the type to `bridge.ts`**

In `desktop/src/types/bridge.ts`, find the `agent` section of the `SynapseBridge` type and add:

```typescript
listAllSessions: () => Promise<SynapseAgentSessionSummary[]>
```

- [ ] **Step 5: Regenerate IPC channels if needed**

Run: `pnpm --filter desktop run generate:ipc-channels` (if this script exists) or manually add the channel to the generated file.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/agent/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/generated/ipc-channels.generated.ts
git commit -m "feat(agent): add listAllSessions IPC for cross-project session query"
```

---

### Task 2: Load archived sessions in `use-agent-chat`

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-agent-chat.ts`

- [ ] **Step 1: Add `archivedSessions` state**

Add a new state variable after the existing `sessions` state:

```typescript
const [archivedSessions, setArchivedSessions] = useState<SynapseAgentSessionSummary[]>([])
```

- [ ] **Step 2: Add `loadArchivedSessions` callback**

Add a new callback that loads all sessions and filters out those belonging to current projects:

```typescript
const loadArchivedSessions = useCallback(async () => {
  const bridge = getSynapseBridge()
  if (!bridge) return
  try {
    const allSessions = await bridge.agent.listAllSessions()
    const currentProjectIds = new Set(projectIdsRef.current)
    const orphans = allSessions.filter((session) => !currentProjectIds.has(session.projectId))
    setArchivedSessions(orphans)
  } catch {
    setArchivedSessions([])
  }
}, [])
```

- [ ] **Step 3: Call `loadArchivedSessions` in the `refresh` function**

Inside the existing `refresh` callback, after `loadSessionsForProjects()` resolves, add a call to load archived sessions. Place it in the `Promise.all` alongside `refreshPendingPermissions()`:

```typescript
await Promise.all([
  refreshPendingPermissions(),
  refreshProjectMeta(nextProjectId),
  loadArchivedSessions(),
])
```

- [ ] **Step 4: Also load archived sessions on mount when projectIds is empty**

In the `useEffect` that handles `projectIdsRef.current.length === 0`, instead of just clearing state, also load archived sessions so the sidebar can show them:

```typescript
if (projectIdsRef.current.length === 0) {
  selectRequestIdRef.current += 1
  setSessions([])
  clearTimeline()
  setPendingPermissions([])
  setStatus(null)
  setProviders(null)
  setCommands([])
  setUnreadByConversationId({})
  setSelectedSession(undefined)
  setError(null)
  setLoading(false)
  setSendingConversationIds(new Set())
  void loadArchivedSessions()
  return
}
```

- [ ] **Step 5: Expose `archivedSessions` in the return value**

Add `archivedSessions` to the `UseAgentChatState` type and the return object:

```typescript
type UseAgentChatState = {
  // ... existing fields
  archivedSessions: SynapseAgentSessionSummary[]
}
```

```typescript
return {
  // ... existing fields
  archivedSessions,
}
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-agent-chat.ts
git commit -m "feat(agent): load archived sessions from cross-project query"
```

---

### Task 3: Create `ArchivedGroup` component

**Files:**
- Create: `desktop/src/modules/agent/components/archived-group.tsx`

- [ ] **Step 1: Create the component**

Create `desktop/src/modules/agent/components/archived-group.tsx`. This is structurally similar to `ProjectGroup` but without the new-session button, with `Archive` icon, and `defaultOpen={false}`:

```tsx
import { useState } from "react"
import { Archive } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ModuleSidebarItem } from "@/components/module-sidebar"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { SessionTrailing } from "./session-trailing"
import { sessionLabel } from "../utils"
import { conversationUnreadKey } from "../live-sync"

type ArchivedGroupProps = {
  sessions: SynapseAgentSessionSummary[]
  selectedProjectId?: string
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void
}

function ArchivedGroup({
  sessions,
  selectedProjectId,
  selectedConversationId,
  unreadByConversationId,
  onSelect,
  onDelete,
  onRename,
}: ArchivedGroupProps) {
  const [renameTarget, setRenameTarget] = useState<SynapseAgentSessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState("")

  function handleRenameOpen(session: SynapseAgentSessionSummary) {
    setRenameTarget(session)
    setRenameValue(sessionLabel(session))
  }

  function handleRenameConfirm() {
    const trimmed = renameValue.trim()
    if (!trimmed || !renameTarget) return
    onRename(renameTarget, trimmed)
    setRenameTarget(null)
  }

  return (
    <>
      <Collapsible defaultOpen={false} data-track="agent-archived-group">
        <CollapsibleTrigger className="flex h-8 w-full items-center rounded-lg px-3 text-sm font-medium text-foreground/80 outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
          <span className="flex min-w-0 items-center gap-2 text-left">
            <Archive className="size-4 shrink-0" />
            <span className="truncate">已归档</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col pl-3">
            {sessions.map((session) => {
              const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
              const active = session.projectId === selectedProjectId
                && session.id === selectedConversationId
              const def = session.agentType
                ? agentDefinitions.find((d) => d.id === session.agentType)
                : undefined
              return (
                <ContextMenu key={`${session.projectId}:${session.id}`}>
                  <ContextMenuTrigger asChild>
                    <div>
                      <ModuleSidebarItem
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
                        trackValue={`archived:${session.projectId}:${session.id}`}
                        onClick={() => onSelect(session)}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-normal">
                          {def?.icon ? (
                            <img src={def.icon} alt="" className="h-3.5 w-3.5 shrink-0" />
                          ) : null}
                          <span className="truncate">{sessionLabel(session)}</span>
                        </span>
                      </ModuleSidebarItem>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => handleRenameOpen(session)}>
                      重命名
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => onDelete(session)}
                    >
                      删除
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm() }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button disabled={!renameValue.trim()} onClick={handleRenameConfirm}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { ArchivedGroup }
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/modules/agent/components/archived-group.tsx
git commit -m "feat(agent): add ArchivedGroup component for orphan sessions"
```

---

### Task 4: Update sidebar to show empty state and archived group

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-session-sidebar.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Update `AgentSessionSidebarProps` to accept archived sessions**

In `agent-session-sidebar.tsx`, add `archivedSessions` to the props type:

```typescript
type AgentSessionSidebarProps = {
  // ... existing props
  archivedSessions: SynapseAgentSessionSummary[]
}
```

- [ ] **Step 2: Add empty state and archived group rendering**

Update the `AgentSessionSidebar` component to import and render the empty state and archived group:

```tsx
import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { requestOpenSettingsTab } from "@/app-shell/navigation"
import { ArchivedGroup } from "./archived-group"
```

Replace the `ModuleSidebarList` content with:

```tsx
<ModuleSidebarList data-track="agent-session-list">
  {projects.length === 0 && archivedSessions.length === 0 ? (
    <Empty className="border-0 px-4 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>尚未配置项目</EmptyTitle>
        <EmptyDescription>添加项目后即可开始 Agent 对话</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={() => requestOpenSettingsTab()}>
          前往设置
        </Button>
      </EmptyContent>
    </Empty>
  ) : (
    <>
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
          onRename={onRename}
        />
      ))}
      {archivedSessions.length > 0 ? (
        <ArchivedGroup
          sessions={archivedSessions}
          selectedProjectId={selectedProjectId}
          selectedConversationId={selectedConversationId}
          unreadByConversationId={unreadByConversationId}
          onSelect={onSelect}
          onDelete={onDelete}
          onRename={onRename}
        />
      ) : null}
    </>
  )}
</ModuleSidebarList>
```

- [ ] **Step 3: Pass `archivedSessions` from `index.tsx`**

In `desktop/src/modules/agent/index.tsx`, pass the new prop to `AgentSessionSidebar`:

```tsx
const sidebar = (
  <AgentSessionSidebar
    sessions={chat.sessions}
    archivedSessions={chat.archivedSessions}
    projects={projectOptions}
    // ... rest of existing props
  />
)
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter desktop run build`

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-session-sidebar.tsx desktop/src/modules/agent/index.tsx
git commit -m "feat(agent): render empty state and archived group in sidebar"
```

---

### Task 5: Add deletion warning in project settings

**Files:**
- Modify: `desktop/src/modules/settings/components/project-list-editor.tsx`

- [ ] **Step 1: Add state and imports for the deletion dialog**

Add imports and state for the AlertDialog and session count query:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
```

Add state inside `ProjectListEditor`:

```typescript
const [deleteTarget, setDeleteTarget] = useState<{ project: SynapseProjectConfig; sessionCount: number } | null>(null)
```

- [ ] **Step 2: Replace the inline delete handler with a pre-check**

Replace the existing delete button's `onClick` handler (lines 267-278) with:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => {
    const bridge = window.synapse?.agent
    if (!bridge) {
      void onSave(projects.filter((item) => item.id !== project.id))
      return
    }
    void bridge.listSessions(project.id).then((sessions) => {
      if (sessions.length > 0) {
        setDeleteTarget({ project, sessionCount: sessions.length })
      } else {
        void onSave(projects.filter((item) => item.id !== project.id))
          .then(() => logger.info("Project removed.", { projectId: project.id }))
          .catch((err) => logger.error("Failed to remove project.", { projectId: project.id, error: err }))
      }
    }).catch(() => {
      void onSave(projects.filter((item) => item.id !== project.id))
    })
  }}
>
  删除
</Button>
```

- [ ] **Step 3: Add the AlertDialog at the end of the component**

Before the closing `</div>` of the component's return, add:

```tsx
<AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>删除项目</AlertDialogTitle>
      <AlertDialogDescription>
        「{deleteTarget?.project.name}」下有 {deleteTarget?.sessionCount} 条 Agent 对话，删除项目后这些对话将移入「已归档」分组，不会被删除。
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction
        variant="destructive"
        onClick={() => {
          if (!deleteTarget) return
          const targetId = deleteTarget.project.id
          setDeleteTarget(null)
          void onSave(projects.filter((item) => item.id !== targetId))
            .then(() => logger.info("Project removed.", { projectId: targetId }))
            .catch((err) => logger.error("Failed to remove project.", { projectId: targetId, error: err }))
        }}
      >
        删除项目
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter desktop run build`

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/settings/components/project-list-editor.tsx
git commit -m "feat(settings): warn about archived sessions when deleting a project"
```

---

### Task 6: Support selecting archived sessions

**Files:**
- Modify: `desktop/electron/modules/agent/ipc.ts`

- [ ] **Step 1: Update `resolveProjectAgent` to handle orphan project IDs**

The existing `resolveProjectAgent` function throws when a project is not found in config. For archived sessions, the project may no longer exist in config but the session data still has a `projectId`. The `switchSession` handler already calls `resolveProjectAgent` which will fail for orphan sessions.

Update `resolveAgentProjectConfig` to also check if the projectId matches any conversation's stored data and use the workspace path from the session itself. Add a fallback that creates a minimal project config from the conversation entry:

In the `switchSession` handler, wrap the `resolveProjectAgent` call to handle the case where the project doesn't exist. If it throws, try to access the conversation directly from the global data repo:

```typescript
switchSession: {
  kind: "invoke",
  channel: "synapse:agent:switch-session",
  request: switchSessionRequestSchema,
  response: sessionSummarySchema,
  handler: async (ctx, request: SwitchSessionRequest) => {
    try {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
      const session = await agent.switchSession(
        sessionKey,
        request.conversationId,
        LOCAL_RENDERER_PLATFORM,
      )
      return sessionSummary(session)
    } catch {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
      const session = await conversations.get(request.conversationId)
      if (!session) throw new Error("会话不存在。")
      return sessionSummary(session)
    }
  },
},
```

Similarly update `getTimeline` to handle orphan sessions:

```typescript
getTimeline: {
  kind: "invoke",
  channel: "synapse:agent:get-timeline",
  request: timelineRequestSchema,
  response: timelineResultSchema,
  handler: async (ctx, request: TimelineRequest) => {
    try {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const session = await resolveTimelineSession(agent, request)
      return {
        projectId: request.projectId,
        sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
        conversationId: session?.id,
        entries: session ? historyEntries(session, request.limit) : [],
      }
    } catch {
      if (!request.conversationId) throw new Error("找不到当前项目。")
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
      const session = await conversations.get(request.conversationId)
      if (!session) {
        return {
          projectId: request.projectId,
          sessionKey: request.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
          conversationId: request.conversationId,
          entries: [],
        }
      }
      return {
        projectId: request.projectId,
        sessionKey: session.sessionKey,
        conversationId: session.id,
        entries: historyEntries(session, request.limit),
      }
    }
  },
},
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter desktop run build`

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/modules/agent/ipc.ts
git commit -m "feat(agent): support viewing archived sessions without active project config"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full build**

Run: `pnpm --filter desktop run build`

- [ ] **Step 2: Run existing tests**

Run: `pnpm --filter desktop run test`

- [ ] **Step 3: Manual verification checklist**

1. With no projects configured: sidebar shows empty state with "前往设置" button
2. Click "前往设置": navigates to settings tab
3. With projects configured: sidebar shows project groups as before
4. Delete a project with sessions: AlertDialog appears with session count
5. After deletion: sessions appear in "已归档" group at bottom of sidebar
6. Click an archived session: timeline loads correctly (read-only history)
7. "已归档" group has no "+" button
8. "已归档" group is collapsed by default
9. Re-add a project with same ID: sessions return to normal project group
