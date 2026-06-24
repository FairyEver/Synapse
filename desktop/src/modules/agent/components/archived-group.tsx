import { useEffect, useRef, useState } from "react"
import { Archive } from "lucide-react"
import { ModuleSidebarGroup } from "@/components/module-sidebar"
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
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { SessionTrailing } from "./session-trailing"
import { AgentSidebarSessionRow } from "./agent-sidebar-session-row"
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
  onDeleteOthers: (session: SynapseAgentSessionSummary) => void
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
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectedArchived) {
      setOpen(true)
    }
  }, [selectedArchived])

  function handleRenameOpen(session: SynapseAgentSessionSummary) {
    setRenameTarget(session)
    setRenameValue(sessionLabel(session))
  }

  function handleRenameOpenAutoFocus(event: Event) {
    event.preventDefault()
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }

  async function handleRenameConfirm() {
    const trimmed = renameValue.trim()
    if (!trimmed || !renameTarget) return
    try {
      await onRename(renameTarget, trimmed)
      setRenameTarget(null)
    } catch {
      // Dialog stays open on failure for retry
    }
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
                  onClick={() => onDeleteOthers(session)}
                >
                  删除其他
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </ModuleSidebarGroup>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent
          className="sm:max-w-sm"
          aria-describedby={undefined}
          onOpenAutoFocus={handleRenameOpenAutoFocus}
        >
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm() }}
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
