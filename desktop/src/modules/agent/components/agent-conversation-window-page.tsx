import { useEffect, useMemo, useRef } from "react"

import { useAppConfig } from "@/app-shell/config"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT,
  isDefaultAgentWorkspaceProjectId,
} from "@/lib/default-agent-workspace"
import type { SynapseAgentDisplayProfile, SynapseAgentPublishedCommand } from "@/types/agent"
import type { AgentConversationWindowRequest } from "@/types/agent-conversation-window"
import { AgentConversationWorkspace } from "./agent-conversation-workspace"
import { useAgentChat } from "../hooks/use-agent-chat"

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

function AgentConversationWindowPage({ request }: { readonly request: AgentConversationWindowRequest }) {
  const { config } = useAppConfig()
  const project = isDefaultAgentWorkspaceProjectId(request.projectId)
    ? DEFAULT_AGENT_WORKSPACE_PROJECT
    : config.global.projects.find((item) => item.id === request.projectId)
  const projectScope = useMemo(() => ({
    projectIds: [request.projectId],
    defaultProjectId: request.projectId,
  }), [request.projectId])
  const chat = useAgentChat(projectScope)
  const selectedRef = useRef<string | null>(null)
  const session = [...chat.sessions, ...chat.archivedSessions].find((item) =>
    item.projectId === request.projectId
    && item.id === request.conversationId
    && item.sessionKey === request.sessionKey)

  useEffect(() => {
    if (!session) return
    const key = `${session.projectId}:${session.id}:${session.sessionKey}`
    if (selectedRef.current === key) return
    selectedRef.current = key
    void chat.selectSession(session)
  }, [chat.selectSession, session])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">项目不存在或已删除</p>
      </div>
    )
  }

  if (!session && !chat.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">对话不存在或已删除</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">加载中</p>
      </div>
    )
  }

  const definition = agentDefinitions.find((item) => item.id === session.agentType)
  const target = {
    projectId: session.projectId,
    conversationId: session.id,
    sessionKey: session.sessionKey,
  }
  const commands = mergeCommands(definition?.commands ?? [], chat.commands ?? [])

  return (
    <AgentConversationWorkspace
      session={session}
      project={project}
      target={target}
      chat={chat}
      quickInputs={config.global.quickInputs ?? []}
      commands={commands}
      providers={chat.providers}
      currentConversationModel={chat.currentConversationModel}
      displayProfile={definition?.displayProfile ?? DEFAULT_AGENT_DISPLAY_PROFILE}
      agentIcon={definition?.icon}
      mode="window"
    />
  )
}

function mergeCommands(
  definitionCommands: readonly unknown[],
  runtimeCommands: readonly SynapseAgentPublishedCommand[],
): SynapseAgentPublishedCommand[] {
  const seen = new Set<string>()
  const result: SynapseAgentPublishedCommand[] = []
  for (const command of [...definitionCommands, ...runtimeCommands]) {
    const name = typeof command === "object" && command && "name" in command
      ? String(command.name)
      : ""
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push(command as SynapseAgentPublishedCommand)
  }
  return result
}

export { AgentConversationWindowPage }
