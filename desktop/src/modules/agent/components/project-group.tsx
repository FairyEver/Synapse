import { useRef, useState } from "react"
import { Folder, FolderOpen, Plus } from "lucide-react"
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
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { SessionTrailing } from "./session-trailing"
import { AgentSidebarSessionRow } from "./agent-sidebar-session-row"
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
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  const prevIsSelectedRef = useRef(isSelected)
  const prevSessionCountRef = useRef(sessions.length)
  if ((isSelected && !prevIsSelectedRef.current) || (sessions.length > 0 && prevSessionCountRef.current === 0)) {
    if (!open) setOpen(true)
  }
  prevIsSelectedRef.current = isSelected
  prevSessionCountRef.current = sessions.length

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

export { ProjectGroup }
