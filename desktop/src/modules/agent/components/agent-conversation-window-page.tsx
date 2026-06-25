import { useEffect, useMemo, useRef, useState } from "react"

import { useAppConfig } from "@/app-shell/config"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT,
  isDefaultAgentWorkspaceProjectId,
} from "@/lib/default-agent-workspace"
import { buildAgentConversationWindowSearchParams } from "@/lib/agent-conversation-window"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentDisplayProfile, SynapseAgentPublishedCommand } from "@/types/agent"
import type { AgentConversationWindowRequest } from "@/types/agent-conversation-window"
import { AgentConversationWorkspace } from "./agent-conversation-workspace"
import { useAgentChat } from "../hooks/use-agent-chat"
import { sessionLabel } from "../utils"

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
  const [currentRequest, setCurrentRequest] = useState(request)
  const [retargetError, setRetargetError] = useState<string | null>(null)
  const { config } = useAppConfig()
  const project = isDefaultAgentWorkspaceProjectId(currentRequest.projectId)
    ? DEFAULT_AGENT_WORKSPACE_PROJECT
    : config.global.projects.find((item) => item.id === currentRequest.projectId)
  const projectScope = useMemo(() => ({
    projectIds: [currentRequest.projectId],
    defaultProjectId: currentRequest.projectId,
  }), [currentRequest.projectId])
  const chat = useAgentChat(projectScope)
  const selectedRef = useRef<string | null>(null)
  const session = [...chat.sessions, ...chat.archivedSessions].find((item) =>
    item.projectId === currentRequest.projectId
    && item.id === currentRequest.conversationId
    && item.sessionKey === currentRequest.sessionKey)

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

  const replaceDetachedTarget = async (created: typeof session): Promise<boolean> => {
    const previousSession = session
    const nextRequest: AgentConversationWindowRequest = {
      projectId: created.projectId,
      conversationId: created.id,
      sessionKey: created.sessionKey,
      title: sessionLabel(created),
    }
    setRetargetError(null)
    try {
      const result = await requireSynapseBridge().agent.replaceConversationWindowTarget({
        from: {
          projectId: currentRequest.projectId,
          conversationId: currentRequest.conversationId,
          sessionKey: currentRequest.sessionKey,
        },
        to: nextRequest,
      })
      if (!result.replaced) {
        await chat.selectSession(previousSession)
        setRetargetError("打开失败")
        return false
      }
      setCurrentRequest(nextRequest)
      const params = buildAgentConversationWindowSearchParams(nextRequest)
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}?${params.toString()}${window.location.hash}`,
      )
      return true
    } catch {
      await chat.selectSession(previousSession)
      setRetargetError("打开失败")
      return false
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {retargetError ? (
        <p className="px-3 pt-2 text-sm text-destructive">{retargetError}</p>
      ) : null}
      <div className="min-h-0 flex-1">
        <AgentConversationWorkspace
          session={session}
          project={project}
          target={target}
          chat={chat}
          commands={commands}
          providers={chat.providers}
          currentConversationModel={chat.currentConversationModel}
          displayProfile={definition?.displayProfile ?? DEFAULT_AGENT_DISPLAY_PROFILE}
          agentIcon={definition?.icon}
          mode="window"
          onReplaceDetachedTarget={replaceDetachedTarget}
          onRename={chat.renameSession}
        />
      </div>
    </div>
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
