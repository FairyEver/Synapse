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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  ModuleSidebar,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import { requestOpenSettingsTab } from "@/app-shell/navigation"
import type { SynapseAgentAvailability, SynapseAgentSessionSummary } from "@/types/agent"
import { ArchivedGroup } from "./archived-group"
import { ProjectGroup } from "./project-group"

type ProjectOption = {
  id: string
  name: string
  path: string
}

type AgentSessionSidebarProps = {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  projects: ProjectOption[]
  availableAgents: SynapseAgentAvailability[]
  selectedProjectId?: string
  selectedConversationId?: string
  followFeishu: boolean
  unreadByConversationId: Record<string, number>
  onCreateSession: (projectId: string, agentType: string) => void
  onSelect: (session: SynapseAgentSessionSummary) => void
  onDelete: (session: SynapseAgentSessionSummary) => void
  onRename: (session: SynapseAgentSessionSummary, name: string) => void
  onFollowFeishuChange: (follow: boolean) => void
}

function AgentSessionSidebar({
  sessions,
  archivedSessions,
  projects,
  availableAgents,
  selectedProjectId,
  selectedConversationId,
  followFeishu,
  unreadByConversationId,
  onCreateSession,
  onSelect,
  onDelete,
  onRename,
  onFollowFeishuChange,
}: AgentSessionSidebarProps) {
  const sessionsByProject = groupSessionsByProject(sessions)

  return (
    <ModuleSidebar variant="bare">
      {/* TODO: 跟随飞书功能未完成，暂时隐藏 */}
      <div className="hidden items-center justify-between px-3">
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
        {projects.length === 0 && archivedSessions.length === 0 ? (
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
                availableAgents={availableAgents}
                selectedProjectId={selectedProjectId}
                selectedConversationId={selectedConversationId}
                unreadByConversationId={unreadByConversationId}
                onCreateSession={(agentType) => onCreateSession(project.id, agentType)}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
            {archivedSessions.length > 0 ? (
              <ArchivedGroup
                sessions={archivedSessions}
                selectedProjectId={selectedProjectId}
                selectedConversationId={selectedConversationId}
                unreadByConversationId={unreadByConversationId}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ) : null}
          </>
        )}
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
