import { FolderOpen, Plus } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ModuleSidebarItem } from "@/components/module-sidebar"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentAvailability, SynapseAgentSessionSummary } from "@/types/agent"
import { AgentPickerPopover } from "./agent-picker-popover"
import { SessionTrailing } from "./session-trailing"
import { sessionLabel } from "../utils"
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
