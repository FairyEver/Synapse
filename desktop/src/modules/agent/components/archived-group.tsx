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
