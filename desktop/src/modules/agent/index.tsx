import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CircleHelp, Copy, Download, FolderOpen, LoaderCircle, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "@/app-shell/config"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { AgentComposer } from "./components/agent-composer"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import {
  DEFAULT_AGENT_WORKSPACE_PROJECT,
  isDefaultAgentWorkspaceProjectId,
} from "@/lib/default-agent-workspace"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import { getRendererPlatform } from "@/lib/runtime-platform"
import { track } from "@/lib/ui-tracking"
import type { OpenAgentSessionPayload } from "@/app-shell/navigation"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
} from "@/types/agent"
import type { SynapseProjectConfig } from "@/types/config"

import { AgentSessionSidebar, type ProjectOption } from "./components/agent-session-sidebar"
import { AgentTimeline } from "./components/agent-timeline"
import { useAgentChat } from "./hooks/use-agent-chat"
import { latestTimelineContentSignal, useStickToBottom } from "./hooks/use-stick-to-bottom"
import {
  type AgentDraftAttachment,
  formatDraftAttachmentsForMessage,
} from "./attachments"
import {
  enqueuePendingMessage,
  firstQueuedMessageForIdleTarget,
  markPendingMessageFailed,
  markPendingMessageSending,
  MAX_PENDING_QUEUE_SIZE,
  pendingMessagesForTarget,
  removePendingMessage,
  replacePendingMessage,
} from "./pending-message-queue"
import type { PendingMessage, PendingMessageTarget } from "./pending-message-queue"
import { resolveAgentProjectScope } from "./project-resolution"
import {
  filterSessionsBySource,
  type ConversationSourceFilter,
} from "./conversation-source"
import {
  formatAgentHeaderModelLabel,
  formatAgentTranscript,
  sessionLabel,
} from "./utils"
import { toAgentSlashCandidates, toQuickInputSlashCandidates } from "./slash-menu"
import {
  toKnowledgeBaseComposerActions,
  toKnowledgeBaseSlashCandidates,
} from "./knowledge-base-commands"
import {
  CONVERSATION_IDLE_ROLLOVER_PROMPT_MS,
  latestConversationActivityTimestamp,
  shouldShowConversationIdleRolloverPrompt,
} from "./utils/conversation-rollover"

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

type DirectSendTrackInput = {
  readonly name: "agent-quick-input-direct-send" | "agent-knowledge-base-command-send"
  readonly boundary: string
  readonly content: string
  readonly target: PendingMessageTarget
  readonly sending: boolean
  readonly preserveDraft?: boolean
  readonly commandName?: string
}

function trackDirectAgentSend(input: DirectSendTrackInput): void {
  track({
    component: "agent",
    name: input.name,
    action: "submit",
    metadata: {
      boundary: input.boundary,
      contentLength: input.content.length,
      ...(input.commandName ? { commandName: input.commandName } : {}),
      projectId: input.target.projectId,
      conversationId: input.target.conversationId,
      sessionKey: input.target.sessionKey,
      sending: input.sending,
      ...(input.preserveDraft === undefined ? {} : { preserveDraft: input.preserveDraft }),
    },
  })
}

function slashCommandName(content: string): string {
  const [commandName] = content.trim().split(/\s+/, 1)
  return commandName?.startsWith("/") ? commandName : "unknown"
}

function AgentModule({ pendingAgentSession, onPendingAgentSessionConsumed }: AgentModuleProps) {
  const activeRepository = useActiveRepository()
  const { config } = useAppConfig()
  const platform = getRendererPlatform()
  const projectScope = useMemo(() =>
    resolveAgentProjectScope(activeRepository, config.global.projects, platform),
  [activeRepository, config.global.projects, platform])
  const [draft, setDraft] = useState("")
  const [sourceFilter, setSourceFilter] = useState<ConversationSourceFilter>("user")
  const chat = useAgentChat(projectScope, { inputDirty: draft.trim().length > 0 })
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([])
  const [isExportingConversation, setIsExportingConversation] = useState(false)
  const pendingSessionRefreshKeyRef = useRef<string | null>(null)
  const pendingSessionMissingKeyRef = useRef<string | null>(null)
  const pendingMessageIdRef = useRef(0)
  const pinnedSelectionKeyRef = useRef<string | null>(null)
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
  const showJumpToBottom = !stick.isPinned && stick.hasUnread
  const showIdleJumpToBottom = !stick.isPinned && !stick.hasUnread && !chat.sending

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
  const canManageKnowledgeSources = canUseManagedKnowledgeBase(selectedProject)
  const selectedTarget: PendingMessageTarget | undefined = selectedSession
    ? {
        projectId: selectedSession.projectId,
        conversationId: selectedSession.id,
        sessionKey: selectedSession.sessionKey,
      }
    : undefined
  const selectedPendingMessages = pendingMessagesForTarget(pendingMessages, selectedTarget)
  const latestActivityTimestamp = useMemo(
    () => latestConversationActivityTimestamp(chat.timeline),
    [chat.timeline],
  )
  const [conversationRolloverPromptNow, setConversationRolloverPromptNow] = useState(() => Date.now())
  useEffect(() => {
    setConversationRolloverPromptNow(Date.now())
    if (!latestActivityTimestamp) return undefined
    const latestActivityTime = Date.parse(latestActivityTimestamp)
    if (!Number.isFinite(latestActivityTime)) return undefined
    const delay = Math.max(0, latestActivityTime + CONVERSATION_IDLE_ROLLOVER_PROMPT_MS - Date.now())
    const timer = window.setTimeout(() => {
      setConversationRolloverPromptNow(Date.now())
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [latestActivityTimestamp])
  const showConversationRolloverPrompt = shouldShowConversationIdleRolloverPrompt({
    latestActivityTimestamp,
    now: conversationRolloverPromptNow,
    sending: chat.sending,
    hasStartAction: Boolean(selectedSession),
  })

  const handleStartRolloverConversation = () => {
    if (!selectedSession) return
    if (sourceFilter !== "user") setSourceFilter("user")
    void chat.createSession(
      selectedSession.projectId,
      selectedSession.providerId,
      selectedSession.mode,
      selectedSession.modelTier,
    )
  }

  useEffect(() => {
    const selectionKey = `${chat.selectedProjectId ?? ""}:${chat.selectedConversationId ?? ""}`
    if (selectionKey === pinnedSelectionKeyRef.current) return
    pinnedSelectionKeyRef.current = selectionKey
    stick.forcePin()
    // forcePin is stable; only fire when the visible conversation changes.
  }, [chat.selectedProjectId, chat.selectedConversationId])

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
      (s) => s.id === pendingAgentSession.conversationId
        && s.projectId === pendingAgentSession.projectId
        && (!pendingAgentSession.sessionKey || s.sessionKey === pendingAgentSession.sessionKey),
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
  useEffect(() => {
    const next = firstQueuedMessageForIdleTarget(pendingMessages, chat.sendingConversationIds)
    if (!next) return
    const sendingMessage = markPendingMessageSending(next)
    setPendingMessages((current) => replacePendingMessage(current, sendingMessage))
    void chat.sendMessage(sendingMessage.content, sendingMessage.target, {
      attachments: sendingMessage.attachments,
    }).then((sent) => {
      setPendingMessages((current) => sent
        ? removePendingMessage(current, sendingMessage.id)
        : replacePendingMessage(current, markPendingMessageFailed(sendingMessage, "发送失败")))
    })
  }, [chat.sendMessage, chat.sendingConversationIds, pendingMessages])

  const queueMessage = (
    content: string,
    target: PendingMessageTarget,
    attachments: readonly AgentDraftAttachment[] = [],
  ): boolean => {
    if (pendingMessages.length >= MAX_PENDING_QUEUE_SIZE) {
      toast("待发送队列已满，请等待当前消息发送完成")
      return false
    }
    pendingMessageIdRef.current += 1
    setPendingMessages((current) => [
      ...current,
      enqueuePendingMessage({
        id: `pending:${Date.now()}:${pendingMessageIdRef.current}`,
        content,
        attachments,
        target,
        createdAt: new Date().toISOString(),
      }),
    ])
    return true
  }

  const submitContent = async (
    content: string,
    options: {
      preserveDraft?: boolean
      trackSource?: "quick-input-direct"
      attachments?: readonly AgentDraftAttachment[]
    } = {},
  ): Promise<boolean> => {
    const attachments = options.attachments ?? []
    if (!formatDraftAttachmentsForMessage(content, attachments).trim() || !selectedTarget) return false
    const preserveDraft = options.preserveDraft === true
    if (options.trackSource === "quick-input-direct") {
      trackDirectAgentSend({
        name: "agent-quick-input-direct-send",
        boundary: "renderer.agent.quick-input-direct-send",
        content,
        target: selectedTarget,
        sending: chat.sending,
        preserveDraft,
      })
    }
    if (!preserveDraft) {
      setDraft("")
    }
    stick.forcePin()
    if (chat.sending) {
      return queueMessage(content, selectedTarget, attachments)
    }
    const sent = attachments.length > 0
      ? await chat.sendMessage(content, selectedTarget, { attachments })
      : await chat.sendMessage(content, selectedTarget)
    if (!sent && preserveDraft) {
      toast.error("发送失败")
      return false
    }
    if (!sent) {
      setDraft(content)
      return false
    }
    return true
  }

  const submitDraft = (attachments: readonly AgentDraftAttachment[] = []): Promise<boolean> => {
    return submitContent(draft.trim(), { attachments })
  }

  const handleSubmit = (
    event: FormEvent,
    attachments: readonly AgentDraftAttachment[],
    acceptAttachments: () => () => void,
  ) => {
    event.preventDefault()
    const restoreAttachments = acceptAttachments()
    void submitDraft(attachments).then((accepted) => {
      if (!accepted) restoreAttachments()
    })
  }

  const handleInputKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    attachments: readonly AgentDraftAttachment[] = [],
    acceptAttachments: () => () => void = () => () => undefined,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return
    // Skip while IME is composing (Chinese / Japanese / Korean input). The
    // first Enter that confirms an IME candidate fires keydown with
    // `isComposing=true` (or keyCode 229 on legacy paths) and must not be
    // treated as a submit, otherwise the user sees a trailing newline in the
    // sent message and a partial submission.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    const restoreAttachments = acceptAttachments()
    void submitDraft(attachments).then((accepted) => {
      if (!accepted) restoreAttachments()
    })
  }

  const handleRemovePendingMessage = (id: string) => {
    setPendingMessages((current) => removePendingMessage(current, id))
  }

  const handleRetryPendingMessage = (id: string) => {
    setPendingMessages((current) => current.map((message) =>
      message.id === id ? enqueuePendingMessage(message) : message))
  }

  const handleCopyTranscript = async () => {
    if (!selectedSession) return
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

  const handleExportConversation = async () => {
    if (!selectedSession || isExportingConversation) return
    const projectId = chat.selectedProjectId ?? chat.activeProjectId
    if (!projectId || chat.timeline.length === 0) return
    setIsExportingConversation(true)
    try {
      const bridge = requireSynapseBridge()
      const result = await bridge.agent.exportConversationBundle({
        projectId,
        sessionKey: chat.selectedSessionKey,
        conversationId: selectedSession.id,
      })
      if (result.success) {
        if (result.filePath) {
          void bridge.shell.showItemInFolder(result.filePath).catch((rawError: unknown) => {
            logger.warn("Agent conversation export location open failed.", {
              boundary: "renderer.agent.conversation-export.open-location",
              projectId,
              conversationId: selectedSession.id,
              sessionKey: chat.selectedSessionKey,
              ...errorDiagnostic(rawError),
            })
          })
        }
        toast("对话调试包已导出")
      }
    } catch (rawError) {
      logger.error("Agent conversation export failed.", {
        boundary: "renderer.agent.conversation-export",
        projectId,
        conversationId: selectedSession.id,
        sessionKey: chat.selectedSessionKey,
        ...errorDiagnostic(rawError),
      })
      toast("导出失败")
    } finally {
      setIsExportingConversation(false)
    }
  }

  const handlePendingPermissionsClick = () => {
    const requestId = chat.pendingPermissions.find(isToolPermission)?.requestId
    scrollToPendingRequest(requestId)
  }

  const handlePendingQuestionsClick = () => {
    const requestId = chat.pendingPermissions.find(isUserQuestionPending)?.requestId
    scrollToPendingRequest(requestId)
  }

  const scrollToPendingRequest = (requestId: string | undefined) => {
    if (!requestId) return
    const targets = document.querySelectorAll(`[data-agent-permission-request-id="${CSS.escape(requestId)}"]`)
    targets[targets.length - 1]?.scrollIntoView({ block: "center", behavior: "smooth" })
  }

  const handleOpenSourceManager = async () => {
    if (!selectedProject) return
    try {
      await requireSynapseBridge().knowledgeBase.openSourceManager({
        projectId: selectedProject.id,
        projectName: selectedProject.name,
      })
    } catch (rawError) {
      logger.error("Knowledge base source manager open failed.", {
        boundary: "renderer.agent.open-source-manager",
        projectId: selectedProject.id,
        ...errorDiagnostic(rawError),
      })
      toast("打开失败")
    }
  }

  const activeProvider = chat.providers?.providers.find((provider) => provider.active)
  const selectedProvider = selectedSession?.providerId
    ? chat.providers?.providers.find((provider) => provider.id === selectedSession.providerId)
    : undefined
  const providerMissing = Boolean(selectedSession?.providerId && !selectedProvider)
  const headerProvider = selectedProvider ?? activeProvider
  const headerModelLabel = formatAgentHeaderModelLabel({
    currentConversationModel: chat.currentConversationModel,
    provider: headerProvider,
    modelTier: selectedSession?.modelTier,
  })
  const selectedAgentDefinition = agentDefinitions.find((definition) =>
    definition.id === selectedSession?.agentType)
  const mergedCommands = useMemo(() => {
    const defCommands = selectedAgentDefinition?.commands ?? []
    const runtimeCommands = chat.commands ?? []
    const seen = new Set<string>()
    const result: SynapseAgentPublishedCommand[] = []
    for (const cmd of [...defCommands, ...runtimeCommands]) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name)
        result.push(cmd as unknown as SynapseAgentPublishedCommand)
      }
    }
    return result
  }, [selectedAgentDefinition?.commands, chat.commands])
  const knowledgeBaseSlashCandidates = useMemo(
    () => canManageKnowledgeSources ? toKnowledgeBaseSlashCandidates() : [],
    [canManageKnowledgeSources],
  )
  const slashCandidates = useMemo(
    () => [
      ...toQuickInputSlashCandidates(config.global.quickInputs ?? []),
      ...knowledgeBaseSlashCandidates,
      ...toAgentSlashCandidates(mergedCommands),
    ],
    [config.global.quickInputs, knowledgeBaseSlashCandidates, mergedCommands],
  )
  const knowledgeBaseActions = useMemo(
    () => canManageKnowledgeSources ? toKnowledgeBaseComposerActions() : [],
    [canManageKnowledgeSources],
  )
  const selectedDisplayProfile = selectedAgentDefinition?.displayProfile
    ?? DEFAULT_AGENT_DISPLAY_PROFILE
  const selectedPermissionMode = selectedSession?.mode ?? "default"
  const pendingPermissionCount = chat.pendingPermissions.filter(isToolPermission).length
  const pendingQuestionCount = chat.pendingPermissions.filter(isUserQuestionPending).length
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

  const sendComposerCommand = async (commandText: string) => {
    const content = commandText.trim()
    if (!content || !selectedTarget) return
    trackDirectAgentSend({
      name: "agent-knowledge-base-command-send",
      boundary: "renderer.agent.knowledge-base-command-send",
      content,
      commandName: slashCommandName(content),
      target: selectedTarget,
      sending: chat.sending,
    })
    stick.forcePin()
    if (chat.sending) {
      queueMessage(content, selectedTarget)
      return
    }
    const sent = await chat.sendMessage(content, selectedTarget)
    if (!sent) {
      toast.error("发送失败")
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
      onCreateSession={async (projectId, selection) => {
        if (sourceFilter !== "user") setSourceFilter("user")
        await chat.createSession(projectId, selection.providerId, undefined, selection.modelTier)
      }}
      onSourceFilterChange={setSourceFilter}
      onSelect={(session) => void chat.selectSession(session)}
      onDelete={(session) => void chat.deleteSession(session)}
      onDeleteOthers={async (keep) => {
        const inArchived = chat.archivedSessions.some(
          (s) => s.projectId === keep.projectId && s.id === keep.id,
        )
        const source = inArchived ? chat.archivedSessions : chat.sessions
        const others = inArchived
          ? source.filter((s) => !(s.projectId === keep.projectId && s.id === keep.id))
          : source.filter((s) => s.projectId === keep.projectId && s.id !== keep.id)
        for (const session of others) {
          await chat.deleteSession(session)
        }
      }}
      onRename={(session, name) => chat.renameSession(session, name)}
    />
  )

  return (
    <SidebarContentLayout sidebar={sidebar} contentScrollable={false} sidebarResizable>
      <div className="relative flex h-full min-h-0 flex-col gap-0 bg-background px-2 py-2.5">
        <TooltipProvider>
          <div className="flex items-center justify-between gap-2 px-0 py-0">
            {/* 左区：会话名称 */}
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-sm font-medium">
                {selectedSession ? sessionLabel(selectedSession) : "Agent"}
              </h2>
            </div>

            {/* 右区：模型信息 · 权限 · 复制 */}
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
              ) : headerModelLabel ? (
                <span className="text-xs text-muted-foreground">
                  {headerModelLabel}
                </span>
              ) : null}

              {pendingQuestionCount > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-track="agent-pending-questions-focus"
                  onClick={handlePendingQuestionsClick}
                >
                  <CircleHelp data-icon="inline-start" />
                  待回答 {pendingQuestionCount}
                </Button>
              ) : null}

              {pendingPermissionCount > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-track="agent-pending-permissions-focus"
                  onClick={handlePendingPermissionsClick}
                >
                  <ShieldAlert data-icon="inline-start" />
                  权限 {pendingPermissionCount}
                </Button>
              ) : null}

              {canManageKnowledgeSources ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleOpenSourceManager()}
                >
                  <FolderOpen data-icon="inline-start" />
                  资料管理
                </Button>
              ) : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!selectedSession || !selectedProjectId || chat.timeline.length === 0}
                    onClick={() => void handleCopyTranscript()}
                    aria-label="复制对话"
                  >
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制对话</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!selectedSession || !selectedProjectId || chat.timeline.length === 0 || isExportingConversation}
                    onClick={() => void handleExportConversation()}
                    aria-label="导出对话"
                  >
                    {isExportingConversation ? <LoaderCircle className="animate-spin" /> : <Download />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>导出对话</TooltipContent>
              </Tooltip>

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
              onRespondPermission={(requestId, behavior, updatedInput, message) =>
                chat.respondPermission(requestId, behavior, updatedInput, message)}
              viewportRef={stick.viewportRef}
            />

            <AgentComposer
              draft={draft}
              disabled={!chat.activeProjectId}
              canSend={Boolean(draft.trim() && chat.activeProjectId)}
              sending={chat.sending}
              cancelPhase={chat.cancelPhase}
              permissionMode={selectedPermissionMode}
              quickInputs={config.global.quickInputs}
              onPermissionModeChange={(mode) => chat.setPermissionMode(mode)}
              onCreatePermissionModeSession={(mode) => {
                const projectId = chat.selectedProjectId ?? chat.activeProjectId
                if (!projectId) return
                if (sourceFilter !== "user") setSourceFilter("user")
                void chat.createSession(projectId, selectedSession?.providerId, mode, selectedSession?.modelTier)
              }}
              onDraftChange={setDraft}
              onQuickInputDirectSend={(content) =>
                void submitContent(content, { preserveDraft: true, trackSource: "quick-input-direct" })}
              slashCandidates={slashCandidates}
              knowledgeBaseActions={knowledgeBaseActions}
              onKnowledgeBaseCommand={sendComposerCommand}
              onInputKeyDown={handleInputKeyDown}
              onSubmit={handleSubmit}
              onCancelTurn={() => void chat.cancelTurn()}
              onForceKillTurn={() => void chat.forceKillTurn()}
              showJumpToBottom={showJumpToBottom}
              showIdleJumpToBottom={showIdleJumpToBottom}
              showConversationRolloverPrompt={showConversationRolloverPrompt}
              onStartNewConversation={selectedSession ? handleStartRolloverConversation : undefined}
              onJumpToBottom={() => stick.scrollToBottom({ behavior: "smooth" })}
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

function canUseManagedKnowledgeBase(project: SynapseProjectConfig | undefined): boolean {
  const knowledgeBase = project?.capabilities?.knowledgeBase
  return knowledgeBase?.enabled === true
    && knowledgeBase.managed === true
    && typeof knowledgeBase.runtimeId === "string"
}

function isUserQuestionPending(item: SynapseAgentPendingPermission): boolean {
  return item.toolName === "AskUserQuestion"
}

function isToolPermission(item: SynapseAgentPendingPermission): boolean {
  return !isUserQuestionPending(item)
}

export { AgentComposer, AgentModule }
