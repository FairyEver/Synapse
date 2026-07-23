import { useEffect, useState } from "react"
import { Archive } from "lucide-react"
import { ModuleSidebarGroup } from "@/components/module-sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { SessionTrailing } from "./session-trailing"
import { AgentSidebarSessionRow } from "./agent-sidebar-session-row"
import { AgentSessionRenameDialog } from "./agent-session-rename-dialog"
import { sessionLabel } from "../utils"
import { conversationUnreadKey } from "../live-sync"

type ArchivedGroupProps = {
  sessions: SynapseAgentSessionSummary[]
  selectedProjectId?: string
  selectedConversationId?: string
  unreadByConversationId: Record<string, number>
  sendingConversationIds: ReadonlySet<string>
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onDeleteOthers: (
    session: SynapseAgentSessionSummary,
    groupSessions: readonly SynapseAgentSessionSummary[],
  ) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}

function ArchivedGroup({
  sessions,
  selectedProjectId,
  selectedConversationId,
  unreadByConversationId,
  sendingConversationIds,
  onSelect,
  onDelete,
  onDeleteOthers,
  onRename,
}: ArchivedGroupProps) {
  const selectedArchived = sessions.some((session) => (
    session.projectId === selectedProjectId
      && session.id === selectedConversationId
  ))
  const [open, setOpen] = useState(selectedArchived)
  const [renameTarget, setRenameTarget] = useState<SynapseAgentSessionSummary | null>(null)

  useEffect(() => {
    if (selectedArchived) {
      setOpen(true)
    }
  }, [selectedArchived])

  function handleRenameOpen(session: SynapseAgentSessionSummary) {
    setRenameTarget(session)
  }

  return (
    <>
      <ModuleSidebarGroup
        open={open}
        onOpenChange={setOpen}
        data-track="agent-archived-group"
        title="已归档"
        openIcon={Archive}
        closedIcon={Archive}
      >
        {sessions.map((session) => {
          const unread = unreadByConversationId[conversationUnreadKey(session.projectId, session.id)] ?? 0
          const running = sendingConversationIds.has(session.id)
          const active = session.projectId === selectedProjectId
            && session.id === selectedConversationId
          const def = session.agentType
            ? agentDefinitions.find((d) => d.id === session.agentType)
            : undefined
          const label = sessionLabel(session)
          return (
            <ContextMenu key={`${session.projectId}:${session.id}`}>
              <ContextMenuTrigger asChild>
                <div className="w-full min-w-0">
                  <AgentSidebarSessionRow
                    active={active}
                    icon={def?.icon ? (
                      <img src={def.icon} alt="" className="h-3.5 w-3.5 shrink-0" />
                    ) : undefined}
                    trailing={
                      <SessionTrailing
                        updatedAt={session.updatedAt}
                        unread={unread}
                        running={running}
                        canDelete
                        onDelete={() => onDelete(session)}
                      />
                    }
                    trackValue={`archived:${session.projectId}:${session.id}`}
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
                  onClick={() => onDeleteOthers(session, sessions)}
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

export { ArchivedGroup }
