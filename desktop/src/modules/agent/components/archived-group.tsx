import { useEffect, useState } from "react"
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

  useEffect(() => {
    if (selectedArchived) {
      setOpen(true)
    }
  }, [selectedArchived])

  function handleRenameOpen(session: SynapseAgentSessionSummary) {
    setRenameTarget(session)
    setRenameValue(sessionLabel(session))
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
      <Collapsible open={open} onOpenChange={setOpen} data-track="agent-archived-group">
        <CollapsibleTrigger className="flex h-8 w-full items-center rounded-lg px-3 text-sm font-medium text-foreground/80 outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
          <span className="flex min-w-0 items-center gap-2 text-left">
            <Archive className="size-4 shrink-0" />
            <span className="truncate">已归档</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex w-full min-w-0 flex-col gap-0 pl-3">
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
