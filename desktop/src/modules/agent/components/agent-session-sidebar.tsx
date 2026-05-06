import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  ModuleSidebar,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import type { SynapseAgentAvailability, SynapseAgentSessionSummary } from "@/types/agent"
import { ProjectGroup } from "./project-group"

type ProjectOption = {
  id: string
  name: string
  path: string
}

type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  projects: ProjectOption[]
  availableAgents: SynapseAgentAvailability[]
  selectedProjectId?: string
  selectedConversationId?: string
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  onCreateSession: (projectId: string, agentType: string) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onFollowFeishuChange: (follow: boolean) => void
}

function AgentSessionSidebar({
  sessions,
  projects,
  availableAgents,
  selectedProjectId,
  selectedConversationId,
  followFeishu,
  unreadByConversationId,
  onCreateSession,
  onSelect,
  onDelete,
  onFollowFeishuChange,
}: AgentSessionSidebarProps) {
  const sessionsByProject = groupSessionsByProject(sessions)

  return (
    <ModuleSidebar variant="bare">
      <div className="flex items-center justify-between px-3">
        <Label htmlFor="agent-follow-feishu" className="text-xs text-muted-foreground">
          跟随飞书
        </Label>
        <Switch
          id="agent-follow-feishu"
          size="sm"
          data-track="agent-follow-feishu"
          checked={followFeishu}
          onCheckedChange={onFollowFeishuChange}
        />
      </div>
      <ModuleSidebarList data-track="agent-session-list">
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            sessions={sessionsByProject.get(project.id) ?? []}
            availableAgents={availableAgents}
            selectedProjectId={selectedProjectId}
            selectedConversationId={selectedConversationId}
            unreadByConversationId={unreadByConversationId}
            onCreateSession={(agentType) => onCreateSession(project.id, agentType)}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </ModuleSidebarList>
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
