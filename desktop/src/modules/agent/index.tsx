import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import type { OpenAgentSessionPayload } from "@/app-shell/navigation"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT,
  isDefaultAgentWorkspaceProjectId,
} from "@/lib/default-agent-workspace"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPublishedCommand,
} from "@/types/agent"
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
import { AgentComposer } from "./components/agent-composer"
import { AgentConversationWorkspace } from "./components/agent-conversation-workspace"
import { AgentDetachedPlaceholder } from "./components/agent-detached-placeholder"
import { AgentSessionSidebar, type ProjectOption } from "./components/agent-session-sidebar"
import {
  filterSessionsBySource,
  type ConversationSourceFilter,
} from "./conversation-source"
import { useAgentChat } from "./hooks/use-agent-chat"
import {
  isDetachedAgentConversation,
  useDetachedAgentConversations,
} from "./hooks/use-detached-agent-conversations"
import { resolveAgentProjectScope } from "./project-resolution"
import { sessionLabel } from "./utils"

const logger = createRendererLogger("agent")

const DEFAULT_AGENT_DISPLAY_PROFILE: SynapseAgentDisplayProfile = {
  agentLabel: "Agent",
  thinkingDefaultCollapsed: false,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

type AgentModuleProps = {
  pendingAgentSession?: OpenAgentSessionPayload | null
  onPendingAgentSessionConsumed?: () => void
}

function AgentModule({ pendingAgentSession, onPendingAgentSessionConsumed }: AgentModuleProps) {
  const activeRepository = useActiveRepository()
  const { config } = useAppConfig()
  const platform = getRendererPlatform()
  const projectScope = useMemo(() =>
    resolveAgentProjectScope(activeRepository, config.global.projects, platform),
  [activeRepository, config.global.projects, platform])
  const [sourceFilter, setSourceFilter] = useState<ConversationSourceFilter>("user")
  const chat = useAgentChat(projectScope)
  const detachedConversations = useDetachedAgentConversations()
  const pendingSessionRefreshKeyRef = useRef<string | null>(null)
  const pendingSessionMissingKeyRef = useRef<string | null>(null)

  const projectOptions: ProjectOption[] = useMemo(() => [
    DEFAULT_AGENT_WORKSPACE_PROJECT,
    ...config.global.projects.filter((project) =>
      !isDefaultAgentWorkspaceProjectId(project.id)),
  ].map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
  })), [config.global.projects])
  const visibleSessions = useMemo(
    () => filterSessionsBySource(chat.sessions, sourceFilter),
    [chat.sessions, sourceFilter],
  )
  const selectedSession = visibleSessions.find((session) =>
    session.projectId === chat.selectedProjectId && session.id === chat.selectedConversationId)
  const selectedProjectId = chat.selectedProjectId ?? chat.activeProjectId
  const selectedProject = selectedProjectId
    ? isDefaultAgentWorkspaceProjectId(selectedProjectId)
        ? DEFAULT_AGENT_WORKSPACE_PROJECT
        : config.global.projects.find((project) => project.id === selectedProjectId)
    : undefined
  const selectedTarget: AgentConversationTarget | undefined = selectedSession
    ? {
        projectId: selectedSession.projectId,
        conversationId: selectedSession.id,
        sessionKey: selectedSession.sessionKey,
      }
    : undefined
  const selectedDetached = isDetachedAgentConversation(detachedConversations, {
    projectId: selectedSession?.projectId,
    conversationId: selectedSession?.id,
  })
  const selectedAgentDefinition = agentDefinitions.find((definition) =>
    definition.id === selectedSession?.agentType)
  const contentLayout = selectedSession && selectedTarget && !selectedDetached ? "fill" : "center"
  const mergedCommands = useMemo(() => {
    const defCommands = selectedAgentDefinition?.commands ?? []
    const runtimeCommands = chat.commands ?? []
    const seen = new Set<string>()
    const result: SynapseAgentPublishedCommand[] = []
    for (const command of [...defCommands, ...runtimeCommands]) {
      if (!seen.has(command.name)) {
        seen.add(command.name)
        result.push(command as unknown as SynapseAgentPublishedCommand)
      }
    }
    return result
  }, [selectedAgentDefinition?.commands, chat.commands])
  const selectedDisplayProfile = selectedAgentDefinition?.displayProfile
    ?? DEFAULT_AGENT_DISPLAY_PROFILE

  useEffect(() => {
    if (!pendingAgentSession) {
      pendingSessionRefreshKeyRef.current = null
      pendingSessionMissingKeyRef.current = null
      return
    }

    if (pendingAgentSession.sourceFilter && sourceFilter !== pendingAgentSession.sourceFilter) {
      pendingSessionRefreshKeyRef.current = null
      pendingSessionMissingKeyRef.current = null
      setSourceFilter(pendingAgentSession.sourceFilter)
      return
    }

    const allSessions = [...chat.sessions, ...chat.archivedSessions]
    const target = allSessions.find(
      (session) => session.id === pendingAgentSession.conversationId
        && session.projectId === pendingAgentSession.projectId
        && (!pendingAgentSession.sessionKey || session.sessionKey === pendingAgentSession.sessionKey),
    )
    if (target) {
      pendingSessionRefreshKeyRef.current = null
      pendingSessionMissingKeyRef.current = null
      const prompt = pendingAgentSession.prompt
      void (async () => {
        try {
          await chat.selectSession(target)
          if (prompt) {
            const sent = await chat.sendMessage(prompt)
            if (!sent) return
          }
          onPendingAgentSessionConsumed?.()
        } catch (rawError) {
          logger.error("Agent pending session handoff failed.", {
            boundary: "renderer.agent.pending-session-handoff",
            projectId: pendingAgentSession.projectId,
            conversationId: pendingAgentSession.conversationId,
            sessionKey: chat.selectedSessionKey,
            targetSessionKey: target.sessionKey,
            hasPrompt: Boolean(prompt),
            promptLength: prompt?.length ?? 0,
            ...errorDiagnostic(rawError),
          })
          toast.error("发送失败")
        }
      })()
      return
    }

    const pendingKey = `${pendingAgentSession.projectId}:${pendingAgentSession.conversationId}`
    if (pendingSessionMissingKeyRef.current === pendingKey) {
      pendingSessionMissingKeyRef.current = null
      toast.error("对话不存在或已删除")
      onPendingAgentSessionConsumed?.()
      return
    }
    if (chat.loading || pendingSessionRefreshKeyRef.current === pendingKey) {
      return
    }
    pendingSessionRefreshKeyRef.current = pendingKey
    void chat.refresh().then(() => {
      pendingSessionMissingKeyRef.current = pendingKey
    }).catch((rawError) => {
      logger.error("Agent pending session refresh failed.", {
        boundary: "renderer.agent.pending-session-refresh",
        projectId: pendingAgentSession.projectId,
        conversationId: pendingAgentSession.conversationId,
        sessionKey: chat.selectedSessionKey,
        ...errorDiagnostic(rawError),
      })
      pendingSessionMissingKeyRef.current = pendingKey
    }).finally(() => {
      pendingSessionRefreshKeyRef.current = null
    })
  }, [
    pendingAgentSession,
    sourceFilter,
    chat.archivedSessions,
    chat.loading,
    chat.refresh,
    chat.selectedSessionKey,
    chat.sessions,
    chat.selectSession,
    chat.sendMessage,
    onPendingAgentSessionConsumed,
  ])

  const handleOpenDetachedConversation = async (target: AgentConversationTarget) => {
    try {
      await requireSynapseBridge().agent.openConversationWindow({
        ...target,
        title: selectedSession ? sessionLabel(selectedSession) : undefined,
      })
    } catch (rawError) {
      logger.error("Agent detached conversation open failed.", {
        boundary: "renderer.agent.detached-open",
        projectId: target.projectId,
        conversationId: target.conversationId,
        sessionKey: target.sessionKey,
        ...errorDiagnostic(rawError),
      })
      toast.error("打开失败")
    }
  }

  const handleShowDetachedConversation = async () => {
    if (!selectedTarget) return
    try {
      const bridge = requireSynapseBridge()
      const result = await bridge.agent.focusConversationWindow(selectedTarget)
      if (!result.focused) {
        await bridge.agent.openConversationWindow({
          ...selectedTarget,
          title: selectedSession ? sessionLabel(selectedSession) : undefined,
        })
      }
    } catch (rawError) {
      logger.error("Agent detached conversation focus failed.", {
        boundary: "renderer.agent.focus-conversation-window",
        projectId: selectedTarget.projectId,
        conversationId: selectedTarget.conversationId,
        sessionKey: selectedTarget.sessionKey,
        ...errorDiagnostic(rawError),
      })
      toast.error("打开失败")
    }
  }

  const sidebar = (
    <AgentSessionSidebar
      sessions={chat.sessions}
      archivedSessions={chat.archivedSessions}
      projects={projectOptions}
      selectedProjectId={chat.selectedProjectId}
      selectedConversationId={chat.selectedConversationId}
      sourceFilter={sourceFilter}
      unreadByConversationId={chat.unreadByConversationId}
      sendingConversationIds={chat.sendingConversationIds}
      onCreateSession={async (projectId, selection, name) => {
        if (sourceFilter !== "user") setSourceFilter("user")
        await chat.createSession(projectId, selection.providerId, undefined, selection.modelTier, name)
      }}
      onSourceFilterChange={setSourceFilter}
      onSelect={(session) => void chat.selectSession(session)}
      onDelete={(session) => void chat.deleteSession(session)}
      onDeleteOthers={async (keep) => {
        const inArchived = chat.archivedSessions.some(
          (session) => session.projectId === keep.projectId && session.id === keep.id,
        )
        const source = inArchived ? chat.archivedSessions : chat.sessions
        const others = inArchived
          ? source.filter((session) => !(session.projectId === keep.projectId && session.id === keep.id))
          : source.filter((session) => session.projectId === keep.projectId && session.id !== keep.id)
        for (const session of others) {
          await chat.deleteSession(session)
        }
      }}
      onRename={(session, name) => chat.renameSession(session, name)}
    />
  )

  return (
    <SidebarContentLayout
      sidebar={sidebar}
      contentScrollable={false}
      contentLayout={contentLayout}
      sidebarResizable
    >
      {selectedDetached ? (
        <AgentDetachedPlaceholder onShowWindow={() => void handleShowDetachedConversation()} />
      ) : selectedSession && selectedTarget ? (
        <AgentConversationWorkspace
          session={selectedSession}
          project={selectedProject}
          target={selectedTarget}
          chat={chat}
          commands={mergedCommands}
          providers={chat.providers}
          currentConversationModel={chat.currentConversationModel}
          displayProfile={selectedDisplayProfile}
          agentIcon={selectedAgentDefinition?.icon}
          mode="embedded"
          onOpenDetached={(target) => void handleOpenDetachedConversation(target)}
          onRename={(session, name) => chat.renameSession(session, name)}
          onUserSessionRequested={() => {
            if (sourceFilter !== "user") setSourceFilter("user")
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">请创建新的会话</p>
      )}
    </SidebarContentLayout>
  )
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { AgentComposer, AgentModule }
