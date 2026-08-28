import { useEffect, useRef, useState } from "react"
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
import {
  AgentSessionDeleteDialog,
  type AgentSessionDeleteRequest,
} from "./agent-session-delete-dialog"
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
  const [deleteRequest, setDeleteRequest] = useState<AgentSessionDeleteRequest | null>(null)
  const renameReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteSuccessFocusRef = useRef<HTMLElement | null>(null)
  const sessionRowRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (selectedArchived) {
      setOpen(true)
    }
  }, [selectedArchived])

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
    </>
  )
}

export { ArchivedGroup }
