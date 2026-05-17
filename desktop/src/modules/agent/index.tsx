import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Clock, Command as CommandIcon, Copy, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "@/app-shell/config"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AgentComposer } from "./components/agent-composer"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import { getRendererPlatform } from "@/lib/runtime-platform"
import type { OpenAgentSessionPayload } from "@/app-shell/navigation"
import type { SynapseAgentDisplayProfile } from "@/types/agent"

import { AgentSessionSidebar, type ProjectOption } from "./components/agent-session-sidebar"
import { AgentTimeline } from "./components/agent-timeline"
import { useAgentChat } from "./hooks/use-agent-chat"
import { latestTimelineContentSignal, useStickToBottom } from "./hooks/use-stick-to-bottom"
import {
  enqueuePendingMessage,
  firstQueuedMessageForIdleTarget,
  markPendingMessageFailed,
  markPendingMessageSending,
  pendingMessagesForTarget,
  removePendingMessage,
  replacePendingMessage,
} from "./pending-message-queue"
import type { PendingMessage, PendingMessageTarget } from "./pending-message-queue"
import { resolveAgentProjectScope } from "./project-resolution"
import {
  agentCliLabel,
  formatAgentTranscript,
  sessionLabel,
} from "./utils"

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
  const [draft, setDraft] = useState("")
  const chat = useAgentChat(projectScope, { inputDirty: draft.trim().length > 0 })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([])
  const pendingSessionRefreshKeyRef = useRef<string | null>(null)
  const pendingMessageIdRef = useRef(0)
  const latestEntry = chat.timeline.at(-1)
  const stick = useStickToBottom({
    contentSignal: [
      chat.timeline.length,
      latestEntry?.id,
      latestEntry?.timestamp,
      latestTimelineContentSignal(latestEntry),
      chat.sending,
    ],
    latestEntryId: latestEntry?.id,
  })

  const projectOptions: ProjectOption[] = useMemo(() =>
    config.global.projects.map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
    })),
  [config.global.projects])
  const selectedSession = chat.sessions.find((session) =>
    session.projectId === chat.selectedProjectId && session.id === chat.selectedConversationId)
  const selectedTarget: PendingMessageTarget | undefined = selectedSession
    ? {
        projectId: selectedSession.projectId,
        conversationId: selectedSession.id,
        sessionKey: selectedSession.sessionKey,
      }
    : undefined
  const selectedPendingMessages = pendingMessagesForTarget(pendingMessages, selectedTarget)

  useEffect(() => {
    stick.forcePin()
    // forcePin is stable; only fire when the active session identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.selectedProjectId, chat.selectedConversationId, chat.selectedSessionKey])

  useEffect(() => {
    if (!pendingAgentSession) {
      pendingSessionRefreshKeyRef.current = null
      return
    }
    const target = chat.sessions.find(
      (s) => s.id === pendingAgentSession.conversationId
        && s.projectId === pendingAgentSession.projectId,
    )
    if (target) {
      pendingSessionRefreshKeyRef.current = null
      const prompt = pendingAgentSession.prompt
      void (async () => {
        try {
          await chat.selectSession(target)
          if (prompt) {
            await chat.sendMessage(prompt)
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
        }
      })()
      return
    }

    const pendingKey = `${pendingAgentSession.projectId}:${pendingAgentSession.conversationId}`
    if (chat.loading || pendingSessionRefreshKeyRef.current === pendingKey) {
      return
    }
    pendingSessionRefreshKeyRef.current = pendingKey
    void chat.refresh().catch((rawError) => {
      pendingSessionRefreshKeyRef.current = null
      logger.error("Agent pending session refresh failed.", {
        boundary: "renderer.agent.pending-session-refresh",
        projectId: pendingAgentSession.projectId,
        conversationId: pendingAgentSession.conversationId,
        sessionKey: chat.selectedSessionKey,
        ...errorDiagnostic(rawError),
      })
    })
  }, [
    pendingAgentSession,
    chat.loading,
    chat.refresh,
    chat.selectedSessionKey,
    chat.sessions,
    chat.selectSession,
    chat.sendMessage,
    onPendingAgentSessionConsumed,
  ])
  useEffect(() => {
    const next = firstQueuedMessageForIdleTarget(pendingMessages, chat.sendingConversationIds)
    if (!next) return
    const sendingMessage = markPendingMessageSending(next)
    setPendingMessages((current) => replacePendingMessage(current, sendingMessage))
    void chat.sendMessage(sendingMessage.content, sendingMessage.target).then((sent) => {
      setPendingMessages((current) => sent
        ? removePendingMessage(current, sendingMessage.id)
        : replacePendingMessage(current, markPendingMessageFailed(sendingMessage, "发送失败")))
    })
  }, [chat.sendMessage, chat.sendingConversationIds, pendingMessages])

  const queueMessage = (content: string, target: PendingMessageTarget) => {
    pendingMessageIdRef.current += 1
    setPendingMessages((current) => [
      ...current,
      enqueuePendingMessage({
        id: `pending:${Date.now()}:${pendingMessageIdRef.current}`,
        content,
        target,
        createdAt: new Date().toISOString(),
      }),
    ])
  }

  const submitContent = (content: string) => {
    if (!content || !selectedTarget) return
    setDraft("")
    stick.forcePin()
    if (chat.sending) {
      queueMessage(content, selectedTarget)
      return
    }
    void chat.sendMessage(content, selectedTarget)
  }

  const submitDraft = () => {
    submitContent(draft.trim())
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitDraft()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    // Skip while IME is composing (Chinese / Japanese / Korean input). The
    // first Enter that confirms an IME candidate fires keydown with
    // `isComposing=true` (or keyCode 229 on legacy paths) and must not be
    // treated as a submit, otherwise the user sees a trailing newline in the
    // sent message and a partial submission.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    submitDraft()
  }

  const handleCommandSelect = (name: string) => {
    setDraft("")
    setPaletteOpen(false)
    submitContent(`/${name}`)
  }

  const handleRemovePendingMessage = (id: string) => {
    setPendingMessages((current) => removePendingMessage(current, id))
  }

  const handleRetryPendingMessage = (id: string) => {
    setPendingMessages((current) => current.map((message) =>
      message.id === id ? enqueuePendingMessage(message) : message))
  }

  const handleCopyTranscript = async () => {
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!projectId || chat.timeline.length === 0) return
    try {
      const result = await requireSynapseBridge().agent.getTimeline({
        projectId,
        sessionKey: chat.selectedSessionKey,
        conversationId: chat.selectedConversationId,
      })
      const transcript = formatAgentTranscript(result.entries)
      if (!transcript.trim()) return
      await window.navigator.clipboard.writeText(transcript)
      toast("已复制")
    } catch (rawError) {
      logger.error("Agent transcript copy failed.", {
        boundary: "renderer.agent.transcript-copy",
        projectId,
        conversationId: chat.selectedConversationId,
        sessionKey: chat.selectedSessionKey,
        ...errorDiagnostic(rawError),
      })
      toast("复制失败")
    }
  }

  const activeProvider = chat.providers?.providers.find((provider) => provider.active)
  const selectedProvider = selectedSession?.providerId
    ? chat.providers?.providers.find((provider) => provider.id === selectedSession.providerId)
    : undefined
  const providerMissing = Boolean(selectedSession?.providerId && !selectedProvider)
  const headerProvider = selectedProvider ?? activeProvider
  const selectedAgentDefinition = agentDefinitions.find((definition) =>
    definition.id === selectedSession?.agentType)
  const selectedDisplayProfile = selectedAgentDefinition?.displayProfile
    ?? DEFAULT_AGENT_DISPLAY_PROFILE
  const selectedCliLabel = agentCliLabel(selectedSession?.agentType)
  const selectedPermissionMode = selectedSession?.mode ?? "default"
  const openReference = (reference: string) => {
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!projectId) return
    const bridge = getSynapseBridge()
    if (!bridge?.agent.openReference) {
      logger.warn("Agent reference open failed.", {
        boundary: "renderer.agent.open-reference",
        projectId,
        conversationId: chat.selectedConversationId,
        sessionKey: chat.selectedSessionKey,
        referenceLength: reference.length,
        errorName: "BridgeUnavailable",
        errorLength: 0,
      })
      toast("打开失败")
      return
    }
    void bridge.agent.openReference({ projectId, reference }).catch((rawError: unknown) => {
      logger.warn("Agent reference open failed.", {
        boundary: "renderer.agent.open-reference",
        projectId,
        conversationId: chat.selectedConversationId,
        sessionKey: chat.selectedSessionKey,
        referenceLength: reference.length,
        ...errorDiagnostic(rawError),
      })
      toast("打开失败")
    })
  }

  const sidebar = (
    <AgentSessionSidebar
      sessions={chat.sessions}
      archivedSessions={chat.archivedSessions}
      projects={projectOptions}
      selectedProjectId={chat.selectedProjectId}
      selectedConversationId={chat.selectedConversationId}
      followFeishu={chat.followFeishu}
      unreadByConversationId={chat.unreadByConversationId}
      onCreateSession={(projectId, selection) => void chat.createSession(projectId, selection.providerId, undefined, selection.modelTier)}
      onSelect={(session) => void chat.selectSession(session)}
      onDelete={(session) => void chat.deleteSession(session)}
      onDeleteOthers={(keep) => {
        const inArchived = chat.archivedSessions.some(
          (s) => s.projectId === keep.projectId && s.id === keep.id,
        )
        const source = inArchived ? chat.archivedSessions : chat.sessions
        const others = inArchived
          ? source.filter((s) => !(s.projectId === keep.projectId && s.id === keep.id))
          : source.filter((s) => s.projectId === keep.projectId && s.id !== keep.id)
        for (const session of others) void chat.deleteSession(session)
      }}
      onRename={(session, name) => void chat.renameSession(session, name)}
      onFollowFeishuChange={chat.setFollowFeishu}
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false}>
      <div className="relative flex h-full min-h-0 flex-col gap-0 bg-background">
        <TooltipProvider>
          <div className="flex items-center justify-between gap-3 px-0 py-0">
            {/* 左区：agent 类型 badge + 会话名称 */}
            <div className="flex min-w-0 items-center gap-2">
              {selectedCliLabel ? (
                <Badge variant="secondary" className="flex shrink-0 items-center gap-1">
                  {selectedCliLabel}
                  {selectedSession?.platform === "scheduled" && (
                    <Clock className="size-3 text-muted-foreground" />
                  )}
                </Badge>
              ) : null}
              <h2 className="truncate text-sm font-medium">
                {selectedSession ? sessionLabel(selectedSession) : "Agent"}
              </h2>
            </div>

            {/* 右区：模型信息 · 权限 · 复制 · 命令 */}
            <div className="flex shrink-0 items-center gap-2">
              {providerMissing ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3" />
                      供应商不可用
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>该会话的供应商已删除或归档</TooltipContent>
                </Tooltip>
              ) : chat.currentConversationModel ? (
                <span className="text-xs text-muted-foreground">
                  {chat.currentConversationModel}
                  {headerProvider ? ` · ${headerProvider.display ?? headerProvider.id}` : ""}
                </span>
              ) : headerProvider ? (
                <span className="text-xs text-muted-foreground">
                  {headerProvider.display ?? headerProvider.id}
                </span>
              ) : null}

              {chat.pendingPermissions.length > 0 ? (
                <Button type="button" variant="outline" size="sm">
                  <ShieldAlert data-icon="inline-start" />
                  权限 {chat.pendingPermissions.length}
                </Button>
              ) : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!chat.activeProjectId || chat.timeline.length === 0}
                    onClick={() => void handleCopyTranscript()}
                  >
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制对话</TooltipContent>
              </Tooltip>

              <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="icon">
                        <CommandIcon />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>命令</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" className="w-40 p-0">
                  <Command>
                    <CommandInput placeholder="搜索命令" />
                    <CommandList>
                      <CommandEmpty>无命令</CommandEmpty>
                      <CommandGroup>
                        {(selectedAgentDefinition?.commands ?? []).map((command) => (
                          <CommandItem
                            key={command.name}
                            value={`/${command.name}`}
                            onSelect={() => handleCommandSelect(command.name)}
                          >
                            <span className="truncate">/{command.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </TooltipProvider>

        {!selectedSession && !chat.loading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">请创建新的会话</p>
          </div>
        ) : (
          <>
            {chat.error ? (
              <Alert variant="destructive">
                <AlertDescription>{chat.error}</AlertDescription>
              </Alert>
            ) : null}

            <AgentTimeline
              items={chat.timeline}
              profile={selectedDisplayProfile}
              agentIcon={selectedAgentDefinition?.icon}
              sending={chat.sending}
              pendingPermissions={chat.pendingPermissions}
              onOpenReference={openReference}
              onRespondPermission={(requestId, behavior) => void chat.respondPermission(requestId, behavior)}
              viewportRef={stick.viewportRef}
              showJumpToBottom={!stick.isPinned && stick.hasUnread}
              onJumpToBottom={() => stick.scrollToBottom({ behavior: "smooth" })}
            />

            <AgentComposer
              draft={draft}
              disabled={!chat.activeProjectId}
              canSend={Boolean(draft.trim() && chat.activeProjectId)}
              sending={chat.sending}
              cancelPhase={chat.cancelPhase}
              permissionMode={selectedPermissionMode}
              onPermissionModeChange={(mode) => chat.setPermissionMode(mode)}
              onCreatePermissionModeSession={(mode) => {
                const projectId = chat.selectedProjectId ?? chat.activeProjectId
                if (!projectId) return
                void chat.createSession(projectId, selectedSession?.providerId, mode)
              }}
              onDraftChange={setDraft}
              onInputKeyDown={handleInputKeyDown}
              onSubmit={handleSubmit}
              onCancelTurn={() => void chat.cancelTurn()}
              onForceKillTurn={() => void chat.forceKillTurn()}
              pendingMessages={selectedPendingMessages}
              onRemovePendingMessage={handleRemovePendingMessage}
              onRetryPendingMessage={handleRetryPendingMessage}
            />
          </>
        )}
      </div>
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
