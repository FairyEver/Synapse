import { useState } from "react"
import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
import { requestOpenSettingsTab } from "@/app-shell/navigation"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { ArchivedGroup } from "./archived-group"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import type { ProviderModelSelection } from "@/types/provider-model"
import { ProjectGroup } from "./project-group"
import {
  CONVERSATION_SOURCE_OPTIONS,
  filterSessionsBySource,
  type ConversationSourceFilter,
} from "../conversation-source"

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
  onCreateSession: (projectId: string, selection: ProviderModelSelection) => void
  onSourceFilterChange: (sourceFilter: ConversationSourceFilter) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onDeleteOthers: (session: SynapseAgentSessionSummary) => void
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
  onCreateSession,
  onSourceFilterChange,
  onSelect,
  onDelete,
  onDeleteOthers,
  onRename,
}: AgentSessionSidebarProps) {
  const { config } = useAppConfig()
  const [createProject, setCreateProject] = useState<ProjectOption | null>(null)
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
        {projects.length === 0 && visibleArchivedSessions.length === 0 ? (
          <Empty className="border-0 px-4 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen />
              </EmptyMedia>
              <EmptyTitle>尚未配置项目</EmptyTitle>
              <EmptyDescription>添加项目后即可开始 Agent 对话</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => requestOpenSettingsTab()}>
                前往设置
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {projects.map((project) => (
              <ProjectGroup
                key={project.id}
                project={project}
                sessions={sessionsByProject.get(project.id) ?? []}
                selectedProjectId={selectedProjectId}
                selectedConversationId={selectedConversationId}
                unreadByConversationId={unreadByConversationId}
                onCreateSession={() => setCreateProject(project)}
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
                onSelect={onSelect}
                onDelete={onDelete}
                onDeleteOthers={onDeleteOthers}
                onRename={onRename}
              />
            ) : null}
          </>
        )}
      </div>
      <ProviderModelSelectDialog
        open={createProject !== null}
        onOpenChange={(open) => { if (!open) setCreateProject(null) }}
        defaultSelection={config.agent.defaultProviderModel ?? undefined}
        onSelect={(selection) => {
          if (createProject) onCreateSession(createProject.id, selection)
          setCreateProject(null)
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
