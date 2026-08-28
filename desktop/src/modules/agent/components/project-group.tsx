import { useRef, useState } from "react"
import { EllipsisVertical, Folder, FolderOpen, LoaderCircle, Plus } from "lucide-react"
import { ModuleSidebarGroup } from "@/components/module-sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { SessionTrailing } from "./session-trailing"
import { AgentSidebarSessionRow } from "./agent-sidebar-session-row"
import { AgentSessionRenameDialog } from "./agent-session-rename-dialog"
import {
  AgentSessionDeleteDialog,
  type AgentSessionDeleteRequest,
} from "./agent-session-delete-dialog"
import { sessionLabel } from "../utils"
import { conversationUnreadKey } from "../live-sync"

type ProjectGroupProps = {
  project: { id: string; name: string; path: string }
  sourceLabel: string
  sessions: SynapseAgentSessionSummary[]
  selectedProjectId?: string
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  sendingConversationIds: ReadonlySet<string>
  createDisabled?: boolean
  creating?: boolean
  onQuickCreateSession: () => void
  onCustomizeSession: () => void
  onShowProjectInFolder?: () => void
  onOpenProjectInTerminal?: () => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void | Promise<void>
  onDeleteOthers: (
    session: SynapseAgentSessionSummary,
    groupSessions: readonly SynapseAgentSessionSummary[],
  ) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}

function ProjectGroup({
  project,
  sourceLabel,
  sessions,
  selectedProjectId,
  selectedConversationId,
  unreadByConversationId,
  sendingConversationIds,
  createDisabled = false,
  creating = false,
  onQuickCreateSession,
  onCustomizeSession,
  onShowProjectInFolder,
  onOpenProjectInTerminal,
  onSelect,
  onDelete,
  onDeleteOthers,
  onRename,
}: ProjectGroupProps) {
  const isSelected = selectedProjectId === project.id
  const [open, setOpen] = useState(isSelected || sessions.length > 0)
  const [renameTarget, setRenameTarget] = useState<SynapseAgentSessionSummary | null>(null)
  const [deleteRequest, setDeleteRequest] = useState<AgentSessionDeleteRequest | null>(null)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const renameReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteSuccessFocusRef = useRef<HTMLElement | null>(null)
  const sessionRowRefs = useRef(new Map<string, HTMLDivElement>())

  const prevIsSelectedRef = useRef(isSelected)
  const prevSessionCountRef = useRef(sessions.length)
  if ((isSelected && !prevIsSelectedRef.current) || (sessions.length > 0 && prevSessionCountRef.current === 0)) {
    if (!open) setOpen(true)
  }
  prevIsSelectedRef.current = isSelected
  prevSessionCountRef.current = sessions.length

  function handleRenameOpen(session: SynapseAgentSessionSummary, returnFocus?: HTMLElement) {
    renameReturnFocusRef.current = returnFocus
      ?? sessionRowRefs.current.get(`${session.projectId}:${session.id}`)
      ?? null
    setRenameTarget(session)
  }

  function handleDeleteOpen(
    session: SynapseAgentSessionSummary,
    kind: AgentSessionDeleteRequest["kind"],
  ) {
    const sessionKey = `${session.projectId}:${session.id}`
    deleteReturnFocusRef.current = sessionRowRefs.current.get(sessionKey) ?? null
    const selected = sessions.find((candidate) => (
      candidate.projectId === selectedProjectId && candidate.id === selectedConversationId
    ))
    const successTarget = kind === "others"
      ? session
      : selected && (selected.projectId !== session.projectId || selected.id !== session.id)
        ? selected
        : sessions.find((candidate) => (
            candidate.projectId !== session.projectId || candidate.id !== session.id
          ))
    deleteSuccessFocusRef.current = successTarget
      ? sessionRowRefs.current.get(`${successTarget.projectId}:${successTarget.id}`) ?? null
      : null
    setDeleteRequest({ kind, session, groupSessions: sessions })
  }

  async function handleClearSessions() {
    if (clearing || sessions.length === 0) return
    setClearing(true)
    try {
      await Promise.all(sessions.map((session) => onDelete(session)))
      setClearDialogOpen(false)
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <ModuleSidebarGroup
        open={open}
        onOpenChange={setOpen}
        data-track="agent-project-group"
        headerClassName="pl-2 pr-0.5"
        title={project.name}
        openIcon={FolderOpen}
        closedIcon={Folder}
        actions={
          <span className="flex shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-track="agent-project-new-session"
              title="新建对话"
              aria-label="新建对话"
              disabled={createDisabled}
              onClick={onQuickCreateSession}
            >
              {creating
                ? <LoaderCircle className="size-3.5 animate-spin" />
                : <Plus className="size-3.5" />}
            </Button>
            <DropdownMenu data-track="agent-project-new-session-menu">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="更多操作"
                  aria-label="更多操作"
                  disabled={createDisabled}
                >
                  <EllipsisVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max">
                <DropdownMenuItem
                  data-track="agent-project-custom-new-session"
                  onSelect={onCustomizeSession}
                >
                  创建自定义对话
                </DropdownMenuItem>
                {onShowProjectInFolder ? (
                  <DropdownMenuItem
                    data-track="agent-project-show-in-folder"
                    onSelect={onShowProjectInFolder}
                  >
                    在文件夹中显示
                  </DropdownMenuItem>
                ) : null}
                {onOpenProjectInTerminal ? (
                  <DropdownMenuItem
                    data-track="agent-project-open-terminal"
                    onSelect={onOpenProjectInTerminal}
                  >
                    在终端中打开
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  variant="destructive"
                  disabled={sessions.length === 0}
                  data-track="agent-project-clear-sessions"
                  onSelect={() => setClearDialogOpen(true)}
                >
                  清空对话
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        }
      >
        {sessions.map((session) => {
          const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
          const running = sendingConversationIds.has(session.id)
          const active = session.projectId === selectedProjectId
            && session.id === selectedConversationId
          const label = sessionLabel(session)
          return (
            <ContextMenu key={`${session.projectId}:${session.id}`}>
              <ContextMenuTrigger asChild>
                <div className="w-full min-w-0">
                  <AgentSidebarSessionRow
                    active={active}
                    trailing={
                      <SessionTrailing
                        updatedAt={session.updatedAt}
                        unread={unread}
                        running={running}
                        canDelete
                        onDelete={() => void onDelete(session)}
                      />
                    }
                    trackValue={`${session.projectId}:${session.id}`}
                    rowRef={(node) => {
                      const key = `${session.projectId}:${session.id}`
                      if (node) sessionRowRefs.current.set(key, node)
                      else sessionRowRefs.current.delete(key)
                    }}
                    onSelect={() => onSelect(session)}
                    onDoubleClick={(event) => handleRenameOpen(session, event.currentTarget)}
                  >
                    {label}
                  </AgentSidebarSessionRow>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => handleRenameOpen(session)}>
                  重命名
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => handleDeleteOpen(session, "session")}
                >
                  删除
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  disabled={sessions.length <= 1}
                  onClick={() => handleDeleteOpen(session, "others")}
                >
                  删除其他
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </ModuleSidebarGroup>

      <AgentSessionRenameDialog
        session={renameTarget}
        onOpenChange={(nextOpen) => { if (!nextOpen) setRenameTarget(null) }}
        onRename={onRename}
        returnFocusRef={renameReturnFocusRef}
      />

      <AgentSessionDeleteDialog
        request={deleteRequest}
        onOpenChange={(nextOpen) => { if (!nextOpen) setDeleteRequest(null) }}
        onDelete={onDelete}
        onDeleteOthers={onDeleteOthers}
        returnFocusRef={deleteReturnFocusRef}
        successFocusRef={deleteSuccessFocusRef}
      />

      <AlertDialog open={clearDialogOpen} onOpenChange={(nextOpen) => {
        if (!clearing) setClearDialogOpen(nextOpen)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空对话？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除“{sourceLabel}”中“{project.name}”下的 {sessions.length} 个对话。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={clearing}
              data-track="agent-project-clear-sessions-confirm"
              onClick={() => void handleClearSessions()}
            >
              {clearing ? "正在清空" : "清空对话"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { ProjectGroup }
