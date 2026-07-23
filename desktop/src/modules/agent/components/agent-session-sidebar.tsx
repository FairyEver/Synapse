import { useState } from "react"
import {
  ModuleSidebar,
} from "@/components/module-sidebar"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAppConfig } from "@/app-shell/config"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { ArchivedGroup } from "./archived-group"
import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { ProviderModelSelection } from "@/types/provider-model"
import { AgentSessionCreateDialog } from "./agent-session-create-dialog"
import { ProjectGroup } from "./project-group"
import {
  CONVERSATION_SOURCE_OPTIONS,
  filterSessionsBySource,
  type ConversationSourceFilter,
} from "../conversation-source"
import { formatCreateSessionName } from "../create-session-name"

type ProjectOption = {
  id: string
  name: string
  path: string
}

type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  projects: ProjectOption[]
  selectedProjectId?: string
  selectedConversationId?: string
  sourceFilter: ConversationSourceFilter
  unreadByConversationId: Record<string, number>
  sendingConversationIds: ReadonlySet<string>
  personas?: readonly SynapseAgentPersona[]
  onCreateSession: (
    projectId: string,
    selection: ProviderModelSelection,
    name?: string,
    personaId?: string | null,
  ) => boolean | void | Promise<boolean | void>
  onSourceFilterChange: (sourceFilter: ConversationSourceFilter) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onDeleteOthers: (
    session: SynapseAgentSessionSummary,
    groupSessions: readonly SynapseAgentSessionSummary[],
  ) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
}

function AgentSessionSidebar({
  sessions,
  archivedSessions,
  projects,
  selectedProjectId,
  selectedConversationId,
  sourceFilter,
  unreadByConversationId,
  sendingConversationIds,
  personas = [],
  onCreateSession,
  onSourceFilterChange,
  onSelect,
  onDelete,
  onDeleteOthers,
  onRename,
}: AgentSessionSidebarProps) {
  const { config } = useAppConfig()
  const [createTarget, setCreateTarget] = useState<{
    readonly project: ProjectOption
    readonly initialName: string
  } | null>(null)
  const visibleSessions = filterSessionsBySource(sessions, sourceFilter)
  const visibleArchivedSessions = filterSessionsBySource(archivedSessions, sourceFilter)
  const sessionsByProject = groupSessionsByProject(visibleSessions)

  return (
    <ModuleSidebar variant="bare">
      <div
        className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-0.5 py-0.5"
        data-track="agent-session-list"
      >
        <div className="px-2 pb-2">
          <Select
            data-track="agent-session-source-filter"
            value={sourceFilter}
            onValueChange={(value) => onSourceFilterChange(value as ConversationSourceFilter)}
          >
            <SelectTrigger aria-label="会话来源" className="w-full min-w-0" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="w-(--radix-select-trigger-width) min-w-(--radix-select-trigger-width)"
            >
              <SelectGroup>
                {CONVERSATION_SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            sessions={sessionsByProject.get(project.id) ?? []}
            selectedProjectId={selectedProjectId}
            selectedConversationId={selectedConversationId}
            unreadByConversationId={unreadByConversationId}
            sendingConversationIds={sendingConversationIds}
            onCreateSession={() => setCreateTarget({
              project,
              initialName: formatCreateSessionName(new Date()),
            })}
            onSelect={onSelect}
            onDelete={onDelete}
            onDeleteOthers={onDeleteOthers}
            onRename={onRename}
          />
        ))}
        {visibleArchivedSessions.length > 0 ? (
          <ArchivedGroup
            sessions={visibleArchivedSessions}
            selectedProjectId={selectedProjectId}
            selectedConversationId={selectedConversationId}
            unreadByConversationId={unreadByConversationId}
            sendingConversationIds={sendingConversationIds}
            onSelect={onSelect}
            onDelete={onDelete}
            onDeleteOthers={onDeleteOthers}
            onRename={onRename}
          />
        ) : null}
      </div>
      <AgentSessionCreateDialog
        open={createTarget !== null}
        onOpenChange={(open) => { if (!open) setCreateTarget(null) }}
        defaultSelection={config.agent.defaultProviderModel ?? undefined}
        initialName={createTarget?.initialName ?? ""}
        personas={personas}
        onCreate={async ({ name, personaId, selection }) => {
          if (!createTarget) return false
          return (await onCreateSession(createTarget.project.id, selection, name, personaId)) !== false
        }}
      />
    </ModuleSidebar>
  )
}

function groupSessionsByProject(
  sessions: SynapseAgentSessionSummary[],
): Map<string, SynapseAgentSessionSummary[]> {
  const map = new Map<string, SynapseAgentSessionSummary[]>()
  for (const session of sessions) {
    const list = map.get(session.projectId)
    if (list) {
      list.push(session)
    } else {
      map.set(session.projectId, [session])
    }
  }
  return map
}

export { AgentSessionSidebar, type ProjectOption }
