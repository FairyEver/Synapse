import { useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { buildAgentConversationDeepLink } from "../../../../app-capabilities/agent/shared/schema"
import {
  ModuleSidebar,
} from "@/components/module-sidebar"
import { pickInitialProviderModelSelection } from "@/components/provider-model-picker"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppConfig } from "@/app-shell/config"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { ArchivedGroup } from "./archived-group"
import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { ProviderModelSelection } from "@/types/provider-model"
import { AgentSessionCreateDialog } from "./agent-session-create-dialog"
import { ProjectGroup } from "./project-group"
import { useAgentProviderCatalog } from "../hooks/use-agent-provider-catalog"
import { useAgentProjectShellActions } from "../hooks/use-agent-project-shell-actions"
import { useAgentProjectTerminalActions } from "../hooks/use-agent-project-terminal-actions"
import {
  CONVERSATION_SOURCE_OPTIONS,
  filterSessionsBySource,
  type ConversationSourceFilter,
} from "../conversation-source"
import { formatCreateSessionName } from "../create-session-name"
import { isDefaultAgentWorkspaceProjectId } from "@/lib/default-agent-workspace"

const logger = createRendererLogger("agent")

type QuickCreateTarget = "session" | "terminal"

const QUICK_CREATE_LOG: Record<QuickCreateTarget, { readonly message: string; readonly boundary: string }> = {
  session: {
    message: "Agent quick session creation failed.",
    boundary: "renderer.agent.session-quick-create",
  },
  terminal: {
    message: "Agent terminal quick creation failed.",
    boundary: "renderer.agent.terminal-quick-create",
  },
}

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
  onDelete: (session: SynapseAgentSessionSummary) => void | Promise<void>
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
  const quickCreatePendingRef = useRef(false)
  const [quickCreatingProjectId, setQuickCreatingProjectId] = useState<string | null>(null)
  const { reload: loadProviders } = useAgentProviderCatalog(false)
  const { showProjectInFolder } = useAgentProjectShellActions()
  const { openProjectInTerminal, startClaudeCodeTerminal } = useAgentProjectTerminalActions()
  const [createTarget, setCreateTarget] = useState<{
    readonly project: ProjectOption
    readonly initialName: string
  } | null>(null)
  const visibleSessions = filterSessionsBySource(sessions, sourceFilter)
  const visibleArchivedSessions = filterSessionsBySource(archivedSessions, sourceFilter)
  const sessionsByProject = groupSessionsByProject(visibleSessions)
  const sourceLabel = CONVERSATION_SOURCE_OPTIONS.find((option) => option.value === sourceFilter)?.label
    ?? "当前分类"

  const openCreateDialog = (project: ProjectOption, initialName = formatCreateSessionName(new Date())) => {
    setCreateTarget({ project, initialName })
  }

  const handleQuickCreate = async (project: ProjectOption, target: QuickCreateTarget) => {
    if (quickCreatePendingRef.current) return
    quickCreatePendingRef.current = true
    setQuickCreatingProjectId(project.id)
    const initialName = formatCreateSessionName(new Date())

    try {
      const providers = await loadProviders()
      const selection = providers
        ? pickInitialProviderModelSelection(providers, config.agent.defaultProviderModel)
        : undefined
      if (!selection) {
        openCreateDialog(project, initialName)
        return
      }

      if (target === "terminal") {
        await startClaudeCodeTerminal({ id: project.id, selection })
        return
      }

      const created = await onCreateSession(project.id, selection, initialName, null)
      if (created === false) openCreateDialog(project, initialName)
    } catch (rawError) {
      logger.warn(QUICK_CREATE_LOG[target].message, {
        boundary: QUICK_CREATE_LOG[target].boundary,
        projectId: project.id,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      openCreateDialog(project, initialName)
    } finally {
      quickCreatePendingRef.current = false
      setQuickCreatingProjectId(null)
    }
  }

  const handleCopyDeepLink = async (session: SynapseAgentSessionSummary) => {
    try {
      if (!session.conversationRef) throw new Error("Agent conversation reference is unavailable")
      await navigator.clipboard.writeText(buildAgentConversationDeepLink({
        projectId: session.projectId,
        conversationRef: session.conversationRef,
      }))
      toast("深度链接已复制")
    } catch (rawError) {
      logger.warn("Agent conversation deep link copy failed.", {
        boundary: "renderer.agent.copy-deep-link",
        projectId: session.projectId,
        conversationId: session.id,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
      })
      toast("复制失败")
    }
  }

  return (
    <ModuleSidebar variant="bare">
      <ScrollArea
        className="min-h-0 w-full min-w-0 flex-1"
        viewportClassName="overflow-x-hidden px-0.5 py-0.5"
        data-track="agent-session-list"
        trackScroll={false}
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
            sourceLabel={sourceLabel}
            sessions={sessionsByProject.get(project.id) ?? []}
            selectedProjectId={selectedProjectId}
            selectedConversationId={selectedConversationId}
            unreadByConversationId={unreadByConversationId}
            sendingConversationIds={sendingConversationIds}
            createDisabled={quickCreatingProjectId !== null}
            creating={quickCreatingProjectId === project.id}
            onQuickCreateSession={() => void handleQuickCreate(project, "session")}
            onQuickCreateTerminalSession={() => void handleQuickCreate(project, "terminal")}
            onCustomizeSession={() => openCreateDialog(project)}
            onShowProjectInFolder={isDefaultAgentWorkspaceProjectId(project.id)
              ? undefined
              : () => void showProjectInFolder(project)}
            onOpenProjectInTerminal={isDefaultAgentWorkspaceProjectId(project.id)
              ? undefined
              : () => void openProjectInTerminal(project)}
            onSelect={onSelect}
            onCopyDeepLink={handleCopyDeepLink}
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
            onCopyDeepLink={handleCopyDeepLink}
            onDelete={(session) => void onDelete(session)}
            onDeleteOthers={onDeleteOthers}
            onRename={onRename}
          />
        ) : null}
      </ScrollArea>
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
        onCreateTerminal={async ({ selection }) => {
          if (!createTarget) return false
          return startClaudeCodeTerminal({ id: createTarget.project.id, selection })
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

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { AgentSessionSidebar, type ProjectOption }
