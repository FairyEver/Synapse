import { useRef, useState } from "react"
import { Folder, FolderOpen, Plus } from "lucide-react"
import { ModuleSidebarGroup } from "@/components/module-sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { SessionTrailing } from "./session-trailing"
import { AgentSidebarSessionRow } from "./agent-sidebar-session-row"
import { AgentSessionRenameDialog } from "./agent-session-rename-dialog"
import { sessionLabel } from "../utils"
import { conversationUnreadKey } from "../live-sync"

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

function ProjectGroup({
  project,
  sessions,
  selectedProjectId,
  selectedConversationId,
  unreadByConversationId,
  sendingConversationIds,
  onCreateSession,
  onSelect,
  onDelete,
  onDeleteOthers,
  onRename,
}: ProjectGroupProps) {
  const isSelected = selectedProjectId === project.id
  const [open, setOpen] = useState(isSelected || sessions.length > 0)
  const [renameTarget, setRenameTarget] = useState<SynapseAgentSessionSummary | null>(null)

  const prevIsSelectedRef = useRef(isSelected)
  const prevSessionCountRef = useRef(sessions.length)
  if ((isSelected && !prevIsSelectedRef.current) || (sessions.length > 0 && prevSessionCountRef.current === 0)) {
    if (!open) setOpen(true)
  }
  prevIsSelectedRef.current = isSelected
  prevSessionCountRef.current = sessions.length

  function handleRenameOpen(session: SynapseAgentSessionSummary) {
    setRenameTarget(session)
  }

  return (
    <>
      <ModuleSidebarGroup
        open={open}
        onOpenChange={setOpen}
        data-track="agent-project-group"
        title={project.name}
        openIcon={FolderOpen}
        closedIcon={Folder}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-track="agent-project-new-session"
            title="新建会话"
            onClick={() => onCreateSession()}
          >
            <Plus className="size-3.5" />
            <span className="sr-only">新建会话</span>
          </Button>
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
                        onDelete={() => onDelete(session)}
                      />
                    }
                    trackValue={`${session.projectId}:${session.id}`}
                    onSelect={() => onSelect(session)}
                    onDoubleClick={() => handleRenameOpen(session)}
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
                  onClick={() => onDelete(session)}
                >
                  删除
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  disabled={sessions.length <= 1}
                  onClick={() => onDeleteOthers(session)}
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
      />
    </>
  )
}

export { ProjectGroup }
