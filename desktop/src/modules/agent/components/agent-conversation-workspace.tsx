import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CircleHelp, Copy, Download, ExternalLink, LoaderCircle, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { getSynapseBridge, requireBridgeDomain, requireSynapseBridge } from "@/lib/electron-bridge"
import { track } from "@/lib/ui-tracking"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentPermissionMode,
  SynapseAgentProviderState,
  SynapseAgentPublishedCommand,
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { AgentConversationTarget as ImportedAgentConversationTarget } from "@/types/agent-conversation-window"
import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseQuickInputItem } from "@/types/quick-input"
import {
  type AgentDraftAttachment,
  formatDraftAttachmentsForMessage,
} from "../attachments"
import {
  toKnowledgeBaseComposerActions,
  toKnowledgeBaseSlashCandidates,
} from "../knowledge-base-commands"
import {
  enqueuePendingMessage,
  firstQueuedMessageForIdleTarget,
  markPendingMessageFailed,
  markPendingMessageSending,
  MAX_PENDING_QUEUE_SIZE,
  pendingMessagesForTarget,
  removePendingMessage,
  replacePendingMessage,
  type PendingMessage,
  type PendingMessageTarget,
} from "../pending-message-queue"
import {
  toAgentSlashCandidates,
  uniqueAgentSlashCandidates,
} from "../slash-menu"
import {
  formatAgentHeaderModelLabel,
  formatAgentTranscript,
  sessionLabel,
} from "../utils"
import {
  CONVERSATION_IDLE_ROLLOVER_PROMPT_MS,
  latestConversationActivityTimestamp,
  shouldShowConversationIdleRolloverPrompt,
} from "../utils/conversation-rollover"
import type { SendMessageOptions } from "../hooks/use-chat-connection"
import { latestTimelineContentSignal, useStickToBottom } from "../hooks/use-stick-to-bottom"
import { AgentComposer } from "./agent-composer"
import { AgentSessionRenameDialog } from "./agent-session-rename-dialog"
import { AgentTimeline } from "./agent-timeline"

const logger = createRendererLogger("agent")
const EMPTY_QUICK_INPUTS: readonly SynapseQuickInputItem[] = []

export type AgentConversationTarget = ImportedAgentConversationTarget

export type AgentConversationWorkspaceController = {
  readonly timeline: readonly SynapseAgentTimelineItem[]
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly sending: boolean
  readonly sendingConversationIds: ReadonlySet<string>
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly error: string | null
  readonly sendMessage: (
    content: string,
    target?: AgentConversationTarget,
    options?: SendMessageOptions,
  ) => Promise<boolean>
  readonly createSession: (
    projectId: string,
    providerId?: string,
    mode?: SynapseAgentPermissionMode,
    modelTier?: string,
  ) => Promise<SynapseAgentSessionSummary | undefined>
  readonly setPermissionMode: (
    mode: SynapseAgentPermissionMode,
    target?: AgentConversationTarget,
  ) => Promise<void>
  readonly respondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => Promise<void>
  readonly cancelTurn: (target?: AgentConversationTarget) => Promise<void>
  readonly forceKillTurn: (target?: AgentConversationTarget) => Promise<void>
  readonly refresh: () => Promise<void>
  readonly personas: readonly SynapseAgentPersona[]
  readonly updateSessionPersona: (
    session: SynapseAgentSessionSummary,
    personaId: string | null,
  ) => Promise<SynapseAgentSessionSummary | undefined>
}

type AgentConversationWorkspaceProps = {
  readonly session: SynapseAgentSessionSummary
  readonly project?: SynapseProjectConfig
  readonly target: AgentConversationTarget
  readonly chat: AgentConversationWorkspaceController
  readonly quickInputs?: readonly SynapseQuickInputItem[]
  readonly commands: readonly SynapseAgentPublishedCommand[]
  readonly providers: SynapseAgentProviderState | null
  readonly currentConversationModel?: string
  readonly displayProfile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly mode: "embedded" | "window"
  readonly onOpenDetached?: (target: AgentConversationTarget) => void
  readonly onReplaceDetachedTarget?: (session: SynapseAgentSessionSummary) => Promise<boolean> | boolean
  readonly onRename?: (session: SynapseAgentSessionSummary, name: string) => void | Promise<void>
  readonly onUserSessionRequested?: () => void
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

type MainThreadPersonaSendSnapshot = {
  readonly mainThreadPersonaId: string | null
  readonly mainThreadPersonaName: string
  readonly mainThreadPersonaSource?: "builtin" | "user"
}

function AgentConversationWorkspace({
  session,
  project,
  target,
  chat,
  quickInputs,
  commands,
  providers,
  currentConversationModel,
  displayProfile,
  agentIcon,
  mode,
  onOpenDetached,
  onReplaceDetachedTarget,
  onRename,
  onUserSessionRequested,
}: AgentConversationWorkspaceProps) {
  const [draft, setDraft] = useState("")
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([])
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [isExportingConversation, setIsExportingConversation] = useState(false)
  const [renameTarget, setRenameTarget] = useState<SynapseAgentSessionSummary | null>(null)
  const [composerPersonaId, setComposerPersonaId] = useState<string | null>(
    session.activeMainThreadPersonaId ?? null,
  )
  const pendingMessageIdRef = useRef(0)
  const pinnedSelectionKeyRef = useRef<string | null>(null)
  const personaChangeSeqRef = useRef(0)
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
  const selectedPendingMessages = pendingMessagesForTarget(pendingMessages, target)
  const latestActivityTimestamp = useMemo(
    () => latestConversationActivityTimestamp(chat.timeline),
    [chat.timeline],
  )
  const [conversationRolloverPromptNow, setConversationRolloverPromptNow] = useState(() => Date.now())
  const canManageKnowledgeSources = canUseManagedKnowledgeBase(project)
  const quickInputItems = useQuickInputItems(quickInputs)
  const personas = chat.personas ?? []
  const composerPersona = personas.find((item) => item.id === composerPersonaId)
  const composerPersonaName = composerPersona?.name ?? "普通"

  useEffect(() => {
    setComposerPersonaId(session.activeMainThreadPersonaId ?? null)
  }, [session.activeMainThreadPersonaId, session.id])

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
    hasStartAction: Boolean(session),
  })

  useEffect(() => {
    const selectionKey = `${target.projectId}:${target.conversationId}`
    if (selectionKey === pinnedSelectionKeyRef.current) return
    pinnedSelectionKeyRef.current = selectionKey
    stick.forcePin()
  }, [target.conversationId, target.projectId])

  useEffect(() => {
    const next = firstQueuedMessageForIdleTarget(pendingMessages, chat.sendingConversationIds)
    if (!next) return
    const sendingMessage = markPendingMessageSending(next)
    setPendingMessages((current) => replacePendingMessage(current, sendingMessage))
    void chat.sendMessage(sendingMessage.content, sendingMessage.target, {
      attachments: sendingMessage.attachments,
      mainThreadPersonaId: sendingMessage.mainThreadPersonaId,
      mainThreadPersonaName: sendingMessage.mainThreadPersonaName,
      mainThreadPersonaSource: sendingMessage.mainThreadPersonaSource,
    }).then((sent) => {
      setPendingMessages((current) => sent
        ? removePendingMessage(current, sendingMessage.id)
        : replacePendingMessage(current, markPendingMessageFailed(sendingMessage, "发送失败")))
    })
  }, [chat.sendMessage, chat.sendingConversationIds, pendingMessages])

  const queueMessage = (
    content: string,
    messageTarget: PendingMessageTarget,
    attachments: readonly AgentDraftAttachment[] = [],
    personaSnapshot: MainThreadPersonaSendSnapshot,
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
        target: messageTarget,
        createdAt: new Date().toISOString(),
        mainThreadPersonaId: personaSnapshot.mainThreadPersonaId,
        mainThreadPersonaName: personaSnapshot.mainThreadPersonaName,
        mainThreadPersonaSource: personaSnapshot.mainThreadPersonaSource,
      }),
    ])
    return true
  }

  const currentPersonaSnapshot = (): MainThreadPersonaSendSnapshot => ({
    mainThreadPersonaId: composerPersonaId,
    mainThreadPersonaName: composerPersonaName,
    mainThreadPersonaSource: composerPersonaId
      ? (composerPersona?.source ?? session.activeMainThreadPersonaSource ?? "user")
      : undefined,
  })

  const submitContent = async (
    content: string,
    options: {
      preserveDraft?: boolean
      trackSource?: "quick-input-direct"
      attachments?: readonly AgentDraftAttachment[]
    } = {},
  ): Promise<boolean> => {
    const attachments = options.attachments ?? []
    if (!formatDraftAttachmentsForMessage(content, attachments).trim()) return false
    const preserveDraft = options.preserveDraft === true
    if (options.trackSource === "quick-input-direct") {
      trackDirectAgentSend({
        name: "agent-quick-input-direct-send",
        boundary: "renderer.agent.quick-input-direct-send",
        content,
        target,
        sending: chat.sending,
        preserveDraft,
      })
    }
    if (!preserveDraft) {
      setDraft("")
    }
    stick.forcePin()
    const personaSnapshot = currentPersonaSnapshot()
    if (chat.sending) {
      return queueMessage(content, target, attachments, personaSnapshot)
    }
    const sent = attachments.length > 0
      ? await chat.sendMessage(content, target, { attachments, ...personaSnapshot })
      : await chat.sendMessage(content, target, personaSnapshot)
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
    if (chat.timeline.length === 0) return
    try {
      const result = await requireSynapseBridge().agent.getTimeline({
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        conversationId: target.conversationId,
      })
      const transcript = formatAgentTranscript(result.entries)
      if (!transcript.trim()) return
      await window.navigator.clipboard.writeText(transcript)
      toast("已复制")
    } catch (rawError) {
      logger.error("Agent transcript copy failed.", {
        boundary: "renderer.agent.transcript-copy",
        projectId: target.projectId,
        conversationId: target.conversationId,
        sessionKey: target.sessionKey,
        ...errorDiagnostic(rawError),
      })
      toast("复制失败")
    }
  }

  const handleExportConversation = async () => {
    if (isExportingConversation || chat.timeline.length === 0) return
    setIsExportingConversation(true)
    try {
      const bridge = requireSynapseBridge()
      const result = await bridge.agent.exportConversationBundle({
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        conversationId: target.conversationId,
      })
      if (result.success) {
        if (result.filePath) {
          void bridge.shell.showItemInFolder(result.filePath).catch((rawError: unknown) => {
            logger.warn("Agent conversation export location open failed.", {
              boundary: "renderer.agent.conversation-export.open-location",
              projectId: target.projectId,
              conversationId: target.conversationId,
              sessionKey: target.sessionKey,
              ...errorDiagnostic(rawError),
            })
          })
        }
        toast("对话调试包已导出")
      }
    } catch (rawError) {
      logger.error("Agent conversation export failed.", {
        boundary: "renderer.agent.conversation-export",
        projectId: target.projectId,
        conversationId: target.conversationId,
        sessionKey: target.sessionKey,
        ...errorDiagnostic(rawError),
      })
      toast("导出失败")
    } finally {
      setIsExportingConversation(false)
    }
  }

  const currentPendingPermissions = chat.pendingPermissions.filter((item) =>
    item.projectId === target.projectId
    && item.conversationId === target.conversationId
    && item.sessionKey === target.sessionKey)

  const handlePendingPermissionsClick = () => {
    const requestId = currentPendingPermissions.find(isToolPermission)?.requestId
    scrollToPendingRequest(requestId)
  }

  const handlePendingQuestionsClick = () => {
    const requestId = currentPendingPermissions.find(isUserQuestionPending)?.requestId
    scrollToPendingRequest(requestId)
  }

  const scrollToPendingRequest = (requestId: string | undefined) => {
    if (!requestId) return
    const targets = document.querySelectorAll(`[data-agent-permission-request-id="${CSS.escape(requestId)}"]`)
    targets[targets.length - 1]?.scrollIntoView({ block: "center", behavior: "smooth" })
  }

  const handleOpenSourceManager = async () => {
    if (!project) return
    try {
      await requireSynapseBridge().knowledgeBase.openSourceManager({
        projectId: project.id,
        projectName: project.name,
      })
    } catch (rawError) {
      logger.error("Knowledge base source manager open failed.", {
        boundary: "renderer.agent.open-source-manager",
        projectId: project.id,
        ...errorDiagnostic(rawError),
      })
      toast("打开失败")
    }
  }

  const activeProvider = providers?.providers.find((provider) => provider.active)
  const selectedProvider = session.providerId
    ? providers?.providers.find((provider) => provider.id === session.providerId)
    : undefined
  const providerMissing = Boolean(session.providerId && !selectedProvider)
  const headerProvider = selectedProvider ?? activeProvider
  const headerModelLabel = formatAgentHeaderModelLabel({
    currentConversationModel,
    provider: headerProvider,
    modelTier: session.modelTier,
  })
  const knowledgeBaseSlashCandidates = useMemo(
    () => canManageKnowledgeSources ? toKnowledgeBaseSlashCandidates() : [],
    [canManageKnowledgeSources],
  )
  const slashCandidates = useMemo(
    () => uniqueAgentSlashCandidates([
      ...knowledgeBaseSlashCandidates,
      ...toAgentSlashCandidates(commands),
    ]),
    [commands, knowledgeBaseSlashCandidates],
  )
  const knowledgeBaseActions = useMemo(
    () => canManageKnowledgeSources ? toKnowledgeBaseComposerActions() : [],
    [canManageKnowledgeSources],
  )
  const selectedPermissionMode = session.mode ?? "default"
  const pendingPermissionCount = currentPendingPermissions.filter(isToolPermission).length
  const pendingQuestionCount = currentPendingPermissions.filter(isUserQuestionPending).length

  const openReference = (reference: string) => {
    const bridge = getSynapseBridge()
    if (!bridge?.agent.openReference) {
      logger.warn("Agent reference open failed.", {
        boundary: "renderer.agent.open-reference",
        projectId: target.projectId,
        conversationId: target.conversationId,
        sessionKey: target.sessionKey,
        referenceLength: reference.length,
        errorName: "BridgeUnavailable",
        errorLength: 0,
      })
      toast("打开失败")
      return
    }
    void bridge.agent.openReference({ projectId: target.projectId, reference }).catch((rawError: unknown) => {
      logger.warn("Agent reference open failed.", {
        boundary: "renderer.agent.open-reference",
        projectId: target.projectId,
        conversationId: target.conversationId,
        sessionKey: target.sessionKey,
        referenceLength: reference.length,
        ...errorDiagnostic(rawError),
      })
      toast("打开失败")
    })
  }

  const sendComposerCommand = async (commandText: string) => {
    const content = commandText.trim()
    if (!content) return
    trackDirectAgentSend({
      name: "agent-knowledge-base-command-send",
      boundary: "renderer.agent.knowledge-base-command-send",
      content,
      commandName: slashCommandName(content),
      target,
      sending: chat.sending,
    })
    stick.forcePin()
    const personaSnapshot = currentPersonaSnapshot()
    if (chat.sending) {
      queueMessage(content, target, [], personaSnapshot)
      return
    }
    const sent = await chat.sendMessage(content, target, personaSnapshot)
    if (!sent) {
      toast.error("发送失败")
    }
  }

  const createConversationFromCurrent = async (nextMode?: SynapseAgentPermissionMode) => {
    if (creatingConversation) return
    onUserSessionRequested?.()
    setCreatingConversation(true)
    try {
      const created = await chat.createSession(
        session.projectId,
        session.providerId,
        nextMode ?? session.mode,
        session.modelTier,
      )
      if (created && mode === "window") {
        await onReplaceDetachedTarget?.(created)
      }
    } finally {
      setCreatingConversation(false)
    }
  }

  const handleStartRolloverConversation = () => {
    void createConversationFromCurrent()
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-0 bg-background px-2 py-2.5">
      <TooltipProvider>
        <div className="flex items-center justify-between gap-2 px-0 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              className="truncate text-sm font-medium"
              onDoubleClick={onRename ? () => setRenameTarget(session) : undefined}
            >
              {sessionLabel(session)}
            </h2>
          </div>

          <div className="flex shrink-0 items-center gap-0">
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

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={chat.timeline.length === 0}
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
                  disabled={chat.timeline.length === 0 || isExportingConversation}
                  onClick={() => void handleExportConversation()}
                  aria-label="导出对话"
                >
                  {isExportingConversation ? <LoaderCircle className="animate-spin" /> : <Download />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>导出对话</TooltipContent>
            </Tooltip>

            {mode === "embedded" && onOpenDetached ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onOpenDetached(target)}
                    aria-label="新窗口打开"
                  >
                    <ExternalLink />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>新窗口打开</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </TooltipProvider>

      {onRename ? (
        <AgentSessionRenameDialog
          session={renameTarget}
          onOpenChange={(nextOpen) => { if (!nextOpen) setRenameTarget(null) }}
          onRename={onRename}
        />
      ) : null}

      {chat.error ? (
        <Alert variant="destructive">
          <AlertDescription>{chat.error}</AlertDescription>
        </Alert>
      ) : null}

      <AgentTimeline
        items={chat.timeline}
        profile={displayProfile}
        agentIcon={agentIcon}
        sending={chat.sending}
        pendingPermissions={currentPendingPermissions}
        onOpenReference={openReference}
        onRespondPermission={(requestId, behavior, updatedInput, message) =>
          chat.respondPermission(requestId, behavior, updatedInput, message)}
        viewportRef={stick.viewportRef}
      />

      <AgentComposer
        draft={draft}
        disabled={!target.projectId}
        canSend={Boolean(draft.trim() && target.projectId)}
        sending={chat.sending}
        creatingConversation={creatingConversation}
        cancelPhase={chat.cancelPhase}
        permissionMode={selectedPermissionMode}
        quickInputs={quickInputItems}
        personaItems={personas}
        activePersonaId={composerPersonaId}
        onPersonaChange={(personaId) => {
          const previousPersonaId = composerPersonaId
          personaChangeSeqRef.current += 1
          const changeSeq = personaChangeSeqRef.current
          setComposerPersonaId(personaId)
          void chat.updateSessionPersona(session, personaId).then((updated) => {
            if (changeSeq !== personaChangeSeqRef.current) return
            if (!updated) setComposerPersonaId(previousPersonaId)
          })
        }}
        onPermissionModeChange={(nextMode) => chat.setPermissionMode(nextMode, target)}
        onCreatePermissionModeSession={(nextMode) => {
          void createConversationFromCurrent(nextMode)
        }}
        onDraftChange={setDraft}
        onQuickInputDirectSend={(content) =>
          void submitContent(content, { preserveDraft: true, trackSource: "quick-input-direct" })}
        slashCandidates={slashCandidates}
        knowledgeBaseActions={knowledgeBaseActions}
        onKnowledgeBaseCommand={sendComposerCommand}
        onOpenKnowledgeBaseSourceManager={canManageKnowledgeSources
          ? () => void handleOpenSourceManager()
          : undefined}
        onInputKeyDown={handleInputKeyDown}
        onSubmit={handleSubmit}
        onCancelTurn={() => void chat.cancelTurn(target)}
        onForceKillTurn={() => void chat.forceKillTurn(target)}
        showJumpToBottom={showJumpToBottom}
        showIdleJumpToBottom={showIdleJumpToBottom}
        showConversationRolloverPrompt={showConversationRolloverPrompt}
        onStartNewConversation={handleStartRolloverConversation}
        onJumpToBottom={() => stick.scrollToBottom({ behavior: "smooth" })}
        pendingMessages={selectedPendingMessages}
        onRemovePendingMessage={handleRemovePendingMessage}
        onRetryPendingMessage={handleRetryPendingMessage}
      />
    </div>
  )
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

function useQuickInputItems(initialItems: readonly SynapseQuickInputItem[] = EMPTY_QUICK_INPUTS): readonly SynapseQuickInputItem[] {
  const [items, setItems] = useState<SynapseQuickInputItem[]>(() => [...initialItems])

  useEffect(() => {
    setItems([...initialItems])
  }, [initialItems])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    try {
      const bridge = requireBridgeDomain("quickInput")
      void bridge.list().then((nextItems) => {
        if (!disposed) setItems(nextItems)
      }).catch((rawError: unknown) => {
        logger.warn("Agent quick input load failed.", {
          boundary: "renderer.agent.quick-input.load",
          ...errorDiagnostic(rawError),
        })
      })
      unsubscribe = bridge.onChanged((event) => {
        setItems(event.items)
      })
    } catch (rawError) {
      logger.warn("Agent quick input bridge unavailable.", {
        boundary: "renderer.agent.quick-input.bridge",
        ...errorDiagnostic(rawError),
      })
    }
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return items
}

function slashCommandName(content: string): string {
  const [commandName] = content.trim().split(/\s+/, 1)
  return commandName?.startsWith("/") ? commandName : "unknown"
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

export { AgentConversationWorkspace }
