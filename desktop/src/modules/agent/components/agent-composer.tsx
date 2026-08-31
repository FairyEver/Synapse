import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useState,
} from "react"
import { ArrowUp, ChevronDown, CornerDownRight, RotateCcw, Square, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { track } from "@/lib/ui-tracking"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import type { SynapseQuickInputItem } from "@/types/quick-input"
import { insertTextAtComposerSelection } from "../composer-insert"
import { getPermissionModeCapability } from "../permission-mode-capability"
import { permissionModeConfirmationText, permissionModeLabels } from "../permission-mode-options"
import type { PendingMessage } from "../pending-message-queue"
import { formatDraftAttachmentsForMessage, type AgentDraftAttachment } from "../attachments"
import { AgentComposerInputBox } from "./agent-composer-input-box"
import { AgentAttachmentMenu } from "./agent-attachment-menu"
import { AgentComposerAttachmentStrip } from "./agent-composer-attachment-strip"
import { AgentConversationRolloverPrompt } from "./agent-conversation-rollover-prompt"
import {
  KnowledgeBaseActionMenu,
  type KnowledgeBaseComposerAction,
} from "./knowledge-base-action-menu"
import { QuickInputMenu } from "./quick-input-menu"
import { AgentPermissionModeMenu } from "./permission-mode-menu"
import { AgentSlashMenu } from "./agent-slash-menu"
import { AgentGitActionMenu } from "./agent-git-action-menu"
import type { AgentGitAction } from "../hooks/use-project-git-actions"
import { useAgentAttachmentActions, type DraftAttachmentResult } from "../hooks/use-agent-attachment-actions"
import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  orderAgentSlashCandidates,
  replaceAgentSlashFragment,
  type AgentSlashCandidate,
  type AgentSlashFragment,
} from "../slash-menu"

const SINGLE_LINE_HEIGHT = 36
const MAX_TEXTAREA_HEIGHT = 160
const logger = createRendererLogger("agent")
type RestoreAttachments = (() => void) & { complete?: () => void }
type AcceptAttachments = () => RestoreAttachments

function AgentComposer({
  draft,
  disabled,
  canSend,
  sending,
  cancelPhase,
  creatingConversation = false,
  permissionMode = "default",
  onDraftChange,
  onInputKeyDown,
  onSubmit,
  onCancelTurn,
  onForceKillTurn,
  onPermissionModeChange = () => undefined,
  onCreatePermissionModeSession,
  pendingMessages = [],
  showJumpToBottom = false,
  showIdleJumpToBottom = false,
  showConversationRolloverPrompt = false,
  onRemovePendingMessage,
  onRetryPendingMessage,
  onStartNewConversation,
  onJumpToBottom,
  slashCandidates = [],
  recentSlashSkills = [],
  quickInputs = [],
  knowledgeBaseActions = [],
  onKnowledgeBaseCommand,
  onOpenKnowledgeBaseSourceManager,
  gitRepositoryAvailable = false,
  gitBusyAction = null,
  gitPreparing = false,
  onPrepareGitCommit,
  onRunGitRemote,
  onCancelGitOperation,
  onOpenGit,
  dropTargetRef,
  focusInputKey,
  projectId,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly creatingConversation?: boolean
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly permissionMode?: SynapseAgentPermissionMode
  readonly pendingMessages?: readonly PendingMessage[]
  readonly showJumpToBottom?: boolean
  readonly showIdleJumpToBottom?: boolean
  readonly showConversationRolloverPrompt?: boolean
  readonly slashCandidates?: readonly AgentSlashCandidate[]
  readonly recentSlashSkills?: readonly string[]
  readonly quickInputs?: readonly SynapseQuickInputItem[]
  readonly knowledgeBaseActions?: readonly KnowledgeBaseComposerAction[]
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (
    event: KeyboardEvent<HTMLTextAreaElement>,
    attachments: readonly AgentDraftAttachment[],
    acceptAttachments: AcceptAttachments,
  ) => void
  readonly onSubmit: (
    event: FormEvent,
    attachments: readonly AgentDraftAttachment[],
    acceptAttachments: AcceptAttachments,
  ) => void
  readonly onCancelTurn: () => void
  readonly onForceKillTurn: () => void
  readonly onJumpToBottom?: () => void
  readonly onStartNewConversation?: () => void
  readonly onPermissionModeChange?: (mode: SynapseAgentPermissionMode) => Promise<void> | void
  readonly onCreatePermissionModeSession?: (mode: SynapseAgentPermissionMode) => void
  readonly onRemovePendingMessage?: (id: string) => void
  readonly onRetryPendingMessage?: (id: string) => void
  readonly onKnowledgeBaseCommand?: (commandText: string) => void
  readonly onOpenKnowledgeBaseSourceManager?: () => void
  readonly gitRepositoryAvailable?: boolean
  readonly gitBusyAction?: AgentGitAction | null
  readonly gitPreparing?: boolean
  readonly onPrepareGitCommit?: (action: "commit" | "commit-and-push") => void
  readonly onRunGitRemote?: (action: "pull" | "push" | "sync") => void
  readonly onCancelGitOperation?: () => void
  readonly onOpenGit?: () => void
  readonly dropTargetRef?: RefObject<HTMLElement | null>
  readonly focusInputKey?: string
  readonly projectId?: string
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const [pendingModeAction, setPendingModeAction] = useState<"switch" | "new-session">("switch")
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
  const [highlightedSlashIndex, setHighlightedSlashIndex] = useState(0)
  const [selectionStart, setSelectionStart] = useState(0)
  const [attachments, setAttachments] = useState<AgentDraftAttachment[]>([])
  const [dropActive, setDropActive] = useState(false)
  const [choosingAttachments, setChoosingAttachments] = useState(false)
  const [attachmentSubmissionPending, setAttachmentSubmissionPending] = useState(false)
  const attachmentSubmissionPendingRef = useRef(false)
  const draftScopeIdRef = useRef(createDraftScopeId())
  const attachmentActions = useAgentAttachmentActions(projectId)
  const attachmentsRef = useRef<readonly AgentDraftAttachment[]>([])
  attachmentsRef.current = attachments

  useEffect(() => () => {
    void attachmentActions.release(
      draftScopeIdRef.current,
      attachmentsRef.current.map((attachment) => attachment.attachmentId),
    )
  }, [attachmentActions])
  const activeSlashFragment = useMemo(
    () => findAgentSlashFragment(draft, selectionStart),
    [draft, selectionStart],
  )
  const visibleSlashCandidates = useMemo(
    () => activeSlashFragment
      ? orderAgentSlashCandidates(
          filterAgentSlashCandidates(slashCandidates, activeSlashFragment.query),
          recentSlashSkills,
        )
      : [],
    [activeSlashFragment, recentSlashSkills, slashCandidates],
  )
  const slashMenuOpen = Boolean(activeSlashFragment && !slashMenuDismissed && slashCandidates.length > 0)
  const visiblePendingMessages = pendingMessages.filter((message) => message.status !== "sending")
  const isNewSessionMode = pendingModeAction === "new-session"
  const attachmentAwareCanSend = canSend || attachments.length > 0

  useEffect(() => {
    if (!focusInputKey || disabled) return undefined
    const timeoutId = window.setTimeout(() => textareaRef.current?.focus(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [disabled, focusInputKey])

  const addAttachments = useCallback((next: readonly AgentDraftAttachment[]) => {
    if (next.length === 0) return
    const seen = new Set(attachmentsRef.current.map(attachmentDuplicateKey).filter(Boolean))
    const seenIds = new Set(attachmentsRef.current.map((attachment) => attachment.attachmentId))
    const accepted: AgentDraftAttachment[] = []
    const duplicateIds: string[] = []
    let duplicateCount = 0
    for (const attachment of next) {
      const key = attachmentDuplicateKey(attachment)
      if (key && seen.has(key)) {
        duplicateCount += 1
        if (!seenIds.has(attachment.attachmentId)) duplicateIds.push(attachment.attachmentId)
        continue
      }
      accepted.push(attachment)
      seenIds.add(attachment.attachmentId)
      if (key) seen.add(key)
    }
    if (accepted.length > 0) {
      const merged = [...attachmentsRef.current, ...accepted]
      attachmentsRef.current = merged
      setAttachments(merged)
    }
    if (duplicateIds.length > 0) {
      void attachmentActions.release(draftScopeIdRef.current, duplicateIds)
    }
    if (duplicateCount > 0) toast("已忽略重复附件")
  }, [attachmentActions])

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.attachmentId !== id))
    void attachmentActions.release(draftScopeIdRef.current, [id])
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const acceptSubmittedAttachments = (submittedAttachments: readonly AgentDraftAttachment[]) => {
    if (submittedAttachments.length === 0) {
      const restore = (() => undefined) as RestoreAttachments
      restore.complete = () => undefined
      return restore
    }
    const submittedDraftScopeId = draftScopeIdRef.current
    draftScopeIdRef.current = createDraftScopeId()
    attachmentSubmissionPendingRef.current = true
    setAttachmentSubmissionPending(true)
    const submittedIds = new Set(submittedAttachments.map((attachment) => attachment.attachmentId))
    setAttachments((current) => current.filter((attachment) => !submittedIds.has(attachment.attachmentId)))
    let completed = false
    const finish = () => {
      attachmentSubmissionPendingRef.current = false
      setAttachmentSubmissionPending(false)
    }
    const restore = (() => {
      if (completed) return
      completed = true
      draftScopeIdRef.current = submittedDraftScopeId
      setAttachments((current) => {
        const currentIds = new Set(current.map((attachment) => attachment.attachmentId))
        const missing = submittedAttachments.filter((attachment) => !currentIds.has(attachment.attachmentId))
        return missing.length === 0 ? current : [...current, ...missing]
      })
      finish()
    }) as RestoreAttachments
    restore.complete = () => {
      if (completed) return
      completed = true
      finish()
    }
    return restore
  }

  const selectPermissionMode = (mode: SynapseAgentPermissionMode) => {
    const capability = getPermissionModeCapability({
      currentMode: permissionMode,
      targetMode: mode,
    })
    if (capability === "current") {
      return
    }
    if (capability === "requiresNewSession") {
      setPendingMode(mode)
      setPendingModeAction("new-session")
      return
    }
    if (capability === "confirmable") {
      setPendingMode(mode)
      setPendingModeAction("switch")
      return
    }
    void onPermissionModeChange(mode)
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const scrollHeight = Math.max(
      SINGLE_LINE_HEIGHT,
      Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT),
    )
    el.style.height = `${scrollHeight}px`
    setMultiline(scrollHeight > SINGLE_LINE_HEIGHT)
  }, [draft])

  useEffect(() => {
    setHighlightedSlashIndex(0)
  }, [activeSlashFragment?.query, visibleSlashCandidates.length])

  useEffect(() => {
    if (!slashMenuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && formRef.current?.contains(target)) return
      setSlashMenuDismissed(true)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [slashMenuOpen])

  useEffect(() => {
    const target = dropTargetRef?.current ?? formRef.current
    if (!target) return undefined

    const attachFiles = (files: readonly File[]) => {
      void attachmentActions.stageFiles(files, draftScopeIdRef.current).then((result) => {
        addAttachments(result.attachments)
        showAttachmentRejections(result)
      }).catch((error) => {
        logger.warn("Agent attachment drop failed.", errorDiagnostic(error))
        toast("添加附件失败")
      })
    }
    const handleDragOver = (event: globalThis.DragEvent) => {
      if (disabled || attachmentSubmissionPendingRef.current || !hasFileTransfer(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer!.dropEffect = "copy"
      setDropActive(true)
    }
    const handleDragLeave = (event: globalThis.DragEvent) => {
      const relatedTarget = event.relatedTarget
      if (relatedTarget instanceof Node && target.contains(relatedTarget)) return
      setDropActive(false)
    }
    const handleDrop = (event: globalThis.DragEvent) => {
      if (disabled || attachmentSubmissionPendingRef.current || !hasFileTransfer(event.dataTransfer)) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      setDropActive(false)
      attachFiles(files)
    }

    target.addEventListener("dragover", handleDragOver)
    target.addEventListener("dragleave", handleDragLeave)
    target.addEventListener("drop", handleDrop)
    return () => {
      target.removeEventListener("dragover", handleDragOver)
      target.removeEventListener("dragleave", handleDragLeave)
      target.removeEventListener("drop", handleDrop)
    }
  }, [addAttachments, attachmentActions, disabled, dropTargetRef])

  const chooseAttachments = async (kind: "file" | "directory") => {
    if (choosingAttachments || attachmentSubmissionPendingRef.current) return
    setChoosingAttachments(true)
    try {
      const result = await attachmentActions.choose(draftScopeIdRef.current, kind)
      addAttachments(result.attachments)
      showAttachmentRejections(result)
    } catch (error) {
      logger.warn("Agent attachment selection failed.", errorDiagnostic(error))
      toast("添加附件失败")
    } finally {
      setChoosingAttachments(false)
      window.setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    track({
      component: "agent",
      name: "agent-message-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.agent.composer-submit",
        draftLength: draft.trim().length,
        attachmentCount: attachments.length,
        canSend: attachmentAwareCanSend,
        sending,
        pendingCount: pendingMessages.length,
        permissionMode,
      },
    })
    onSubmit(event, attachments, () => acceptSubmittedAttachments(attachments))
  }

  const updateSelectionStart = () => {
    const el = textareaRef.current
    if (!el) return
    setSelectionStart(el.selectionStart)
    setSlashMenuDismissed(false)
  }

  const selectSlashCandidate = (candidate: AgentSlashCandidate) => {
    if (!activeSlashFragment) return
    insertSlashCandidate(candidate, activeSlashFragment)
  }

  const insertSlashCandidate = (
    candidate: AgentSlashCandidate,
    fragment: AgentSlashFragment,
  ) => {
    const next = replaceAgentSlashFragment(draft, fragment, candidate.name, candidate.insertText)
    onDraftChange(next.value)
    setSlashMenuDismissed(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.cursor, next.cursor)
      setSelectionStart(next.cursor)
    })
  }

  const insertComposerText = (text: string, placement: "selection" | "end" = "selection") => {
    const el = textareaRef.current
    const insertAtEnd = placement === "end"
    const next = insertTextAtComposerSelection({
      draft,
      selectionStart: insertAtEnd ? draft.length : (el?.selectionStart ?? draft.length),
      selectionEnd: insertAtEnd ? draft.length : (el?.selectionEnd ?? draft.length),
      text,
    })
    onDraftChange(next.value)
    window.setTimeout(() => {
      const nextEl = textareaRef.current
      if (!nextEl) return
      nextEl.focus()
      nextEl.setSelectionRange(next.cursor, next.cursor)
      setSelectionStart(next.cursor)
    }, 0)
  }

  const insertKnowledgeBaseCommand = (commandText: string) => {
    insertComposerText(commandText)
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      onInputKeyDown(event, attachments, () => acceptSubmittedAttachments(attachments))
      return
    }

    const currentFragment = findAgentSlashFragment(draft, event.currentTarget.selectionStart)
    const currentCandidates = currentFragment
      ? orderAgentSlashCandidates(
          filterAgentSlashCandidates(slashCandidates, currentFragment.query),
          recentSlashSkills,
        )
      : []
    const currentMenuOpen = !slashMenuDismissed && slashCandidates.length > 0

    if (currentFragment && currentMenuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setHighlightedSlashIndex((current) =>
          currentCandidates.length === 0 ? 0 : (current + 1) % currentCandidates.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setHighlightedSlashIndex((current) =>
          currentCandidates.length === 0
            ? 0
            : (current - 1 + currentCandidates.length) % currentCandidates.length)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setSlashMenuDismissed(true)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = currentCandidates[highlightedSlashIndex]
        if (candidate) {
          event.preventDefault()
          insertSlashCandidate(candidate, currentFragment)
          return
        }
      }
    }

    onInputKeyDown(event, attachments, () => acceptSubmittedAttachments(attachments))
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData.items ?? [])
    const files = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (files.length > 0) {
      event.preventDefault()
      if (disabled || attachmentSubmissionPendingRef.current) return
      const hasPath = files.some(attachmentActions.hasDroppedFilePath)
      const hasClipboardImage = files.some((file) => file.type.startsWith("image/"))
      const resultPromise = hasPath || !hasClipboardImage
        ? attachmentActions.stageFiles(files, draftScopeIdRef.current)
        : attachmentActions.stageClipboardImage(draftScopeIdRef.current, files[0]?.name)
      void resultPromise.then((result) => {
        addAttachments(result.attachments)
        showAttachmentRejections(result)
      }).catch((error) => {
        logger.warn("Agent attachment paste failed.", errorDiagnostic(error))
        toast("添加附件失败")
      })
      return
    }

    return
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="agent-composer-fade pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-background/0 to-background"
      />
      <form
        ref={formRef}
        className="agent-composer absolute inset-x-4 bottom-5 z-10 mx-auto max-w-2xl md:inset-x-20"
        data-track="agent-composer"
        onSubmit={handleSubmit}
      >
        {showJumpToBottom ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onJumpToBottom}
            aria-label="跳到最新消息"
            data-track="agent-timeline-jump-to-bottom"
            className="absolute -top-11 right-0 rounded-full shadow-md"
          >
            ↓ 新消息
          </Button>
        ) : showIdleJumpToBottom ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            onClick={onJumpToBottom}
            aria-label="滚动到底部"
            data-track="agent-timeline-idle-jump-to-bottom"
            className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          >
            <ChevronDown />
          </Button>
        ) : null}
        <AgentComposerInputBox
          multiline={multiline}
          dropActive={dropActive}
          contextNotice={showConversationRolloverPrompt && onStartNewConversation ? (
            <AgentConversationRolloverPrompt
              onStartNewConversation={onStartNewConversation}
              disabled={creatingConversation}
            />
          ) : null}
          slashMenu={slashMenuOpen ? (
            <AgentSlashMenu
              candidates={visibleSlashCandidates}
              recentSkillNames={recentSlashSkills}
              highlightedIndex={highlightedSlashIndex}
              onHighlight={setHighlightedSlashIndex}
              onSelect={selectSlashCandidate}
            />
          ) : null}
          pendingMessages={visiblePendingMessages.length > 0 ? (
            <ScrollArea
              className="max-h-40 min-w-0 max-w-full"
              viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
            >
              <div className="flex min-w-0 max-w-full flex-col">
                {visiblePendingMessages.map((message) => (
                  <div
                    key={message.id}
                    className="flex min-w-0 max-w-full items-center gap-2 border-b border-border py-1 last:border-b-0"
                  >
                    <div className="flex shrink-0 items-center text-sm text-muted-foreground">
                      <CornerDownRight className="size-3.5 shrink-0" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate whitespace-nowrap text-sm text-muted-foreground">
                        {formatDraftAttachmentsForMessage(message.content, message.attachments ?? [])}
                      </p>
                      {message.status === "failed" ? (
                        <p className="truncate whitespace-nowrap text-xs text-destructive">{message.error ?? "发送失败"}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {message.status === "failed" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="重试发送"
                          data-track="agent-pending-message-retry"
                          onClick={() => onRetryPendingMessage?.(message.id)}
                        >
                          <RotateCcw />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="删除待发送消息"
                        data-track="agent-pending-message-remove"
                        onClick={() => onRemovePendingMessage?.(message.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}
          attachments={attachments.length > 0 ? (
            <AgentComposerAttachmentStrip
              attachments={attachments}
              onRemove={removeAttachment}
            />
          ) : null}
          editor={(
            <Textarea
              ref={textareaRef}
              className="agent-composer__input max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
              value={draft}
              onChange={(e) => {
                onDraftChange(e.target.value)
                setSelectionStart(e.target.selectionStart)
                setSlashMenuDismissed(false)
              }}
              onClick={updateSelectionStart}
              onKeyDown={handleTextareaKeyDown}
              onPaste={handlePaste}
              onSelect={updateSelectionStart}
              placeholder="输入消息"
              disabled={disabled}
              rows={1}
            />
          )}
          leadingActions={(
            <>
              <AgentAttachmentMenu
                disabled={disabled || choosingAttachments || attachmentSubmissionPending}
                onChoose={(kind) => void chooseAttachments(kind)}
              />
              <QuickInputMenu
                quickInputs={quickInputs}
                disabled={disabled}
                onInsert={(content) => insertComposerText(content, "end")}
              />
              <KnowledgeBaseActionMenu
                actions={knowledgeBaseActions}
                disabled={disabled}
                onSend={(commandText) => onKnowledgeBaseCommand?.(commandText)}
                onInsert={insertKnowledgeBaseCommand}
                onOpenSourceManager={onOpenKnowledgeBaseSourceManager}
              />
              {gitRepositoryAvailable
                && onPrepareGitCommit
                && onRunGitRemote
                && onCancelGitOperation
                && onOpenGit ? (
                  <AgentGitActionMenu
                    busyAction={gitBusyAction}
                    disabled={disabled}
                    preparing={gitPreparing}
                    onPrepareCommit={onPrepareGitCommit}
                    onRunRemote={onRunGitRemote}
                    onCancel={onCancelGitOperation}
                    onOpenGit={onOpenGit}
                  />
                ) : null}
            </>
          )}
          trailingActions={(
            <>
              <AgentPermissionModeMenu
                selectedMode={permissionMode}
                onSelect={selectPermissionMode}
                trigger={(
                  <Button
                    type="button"
                    variant="ghost"
                    className="agent-composer__permission-trigger rounded-lg px-2.5 text-muted-foreground"
                    aria-label={`权限模式：${permissionModeLabels[permissionMode]}`}
                    data-track="agent-permission-mode-select"
                    disabled={disabled}
                  >
                    {permissionModeLabels[permissionMode]}
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                )}
              />
              {sending || cancelPhase === "cancel_pending" ? (
                <Button
                  type="button"
                  className="agent-composer__stop rounded-full"
                  size="icon-sm"
                  onClick={cancelPhase === "cancel_pending" ? onForceKillTurn : onCancelTurn}
                  aria-label={cancelPhase === "cancel_pending" ? "强制停止" : "停止"}
                  data-track={cancelPhase === "cancel_pending" ? "agent-turn-force-stop" : "agent-turn-stop"}
                >
                  <Square fill="currentColor" strokeWidth={0} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="agent-composer__send rounded-full"
                  size="icon-sm"
                  disabled={disabled || !attachmentAwareCanSend}
                  aria-label="发送"
                  data-track="agent-message-send"
                >
                  <ArrowUp strokeWidth={2.5} />
                </Button>
              )}
            </>
          )}
        />
      </form>
      <Dialog open={pendingMode !== null} onOpenChange={(open) => {
        if (!open) {
          setPendingMode(null)
          setPendingModeAction("switch")
        }
      }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNewSessionMode ? "需要新会话" : "切换权限模式"}</DialogTitle>
            <DialogDescription>
              {isNewSessionMode ? "跳过权限只能在会话启动时启用。" : permissionModeConfirmationText(pendingMode)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingMode(null)
                setPendingModeAction("switch")
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={pendingMode === "bypassPermissions" ? "destructive" : "default"}
              disabled={creatingConversation}
              onClick={() => {
                const mode = pendingMode
                if (!mode) return
                setPendingMode(null)
                setPendingModeAction("switch")
                if (isNewSessionMode) {
                  onCreatePermissionModeSession?.(mode)
                  return
                }
                void onPermissionModeChange(mode)
              }}
            >
              {isNewSessionMode ? "新建会话" : "继续切换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function showAttachmentRejections(
  result: DraftAttachmentResult,
): void {
  if (result.rejectedCount === 0) return
  toast(result.attachments.length > 0 ? "部分附件无法添加" : "无法添加附件")
}

function attachmentDuplicateKey(attachment: AgentDraftAttachment): string | null {
  if (attachment.kind === "directory") return `${attachment.kind}:${attachment.attachmentId}`
  return [attachment.kind, attachment.name, attachment.byteSize, attachment.sha256].join(":")
}

function hasFileTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return dataTransfer.files.length > 0 || Array.from(dataTransfer.types ?? []).includes("Files")
}

function errorDiagnostic(error: unknown): Record<string, unknown> {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
  }
}

function createDraftScopeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export { AgentComposer }
