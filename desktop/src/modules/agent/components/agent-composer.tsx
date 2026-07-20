import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useMemo,
  useRef,
  useEffect,
  useState,
} from "react"
import { ArrowUp, ChevronDown, CornerDownRight, FileIcon, FolderIcon, ImageIcon, RotateCcw, Square, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { requireSynapseBridge } from "@/lib/electron-bridge"
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
import {
  createImageAttachment,
  createPathAttachment,
  formatDraftAttachmentsForMessage,
  nextImageLabel,
  type AgentDraftAttachment,
  type AgentDraftImageAttachment,
} from "../attachments"
import { AgentComposerInputBox } from "./agent-composer-input-box"
import { AgentConversationRolloverPrompt } from "./agent-conversation-rollover-prompt"
import {
  KnowledgeBaseActionMenu,
  type KnowledgeBaseComposerAction,
} from "./knowledge-base-action-menu"
import { QuickInputMenu } from "./quick-input-menu"
import { AgentPermissionModeMenu } from "./permission-mode-menu"
import { AgentSlashMenu } from "./agent-slash-menu"
import {
  filterAgentSlashCandidates,
  findAgentSlashFragment,
  replaceAgentSlashFragment,
  type AgentSlashCandidate,
  type AgentSlashFragment,
} from "../slash-menu"

const SINGLE_LINE_HEIGHT = 48
const MAX_TEXTAREA_HEIGHT = 160
const logger = createRendererLogger("agent")
const SUPPORTED_IMAGE_MIME_TYPES = new Set<AgentDraftImageAttachment["mimeType"]>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])
type RestoreAttachments = () => void
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
  quickInputs = [],
  knowledgeBaseActions = [],
  onKnowledgeBaseCommand,
  onOpenKnowledgeBaseSourceManager,
  onQuickInputDirectSend,
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
  readonly onQuickInputDirectSend?: (content: string) => void
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
  const activeSlashFragment = useMemo(
    () => findAgentSlashFragment(draft, selectionStart),
    [draft, selectionStart],
  )
  const visibleSlashCandidates = useMemo(
    () => activeSlashFragment
      ? filterAgentSlashCandidates(slashCandidates, activeSlashFragment.query)
      : [],
    [activeSlashFragment, slashCandidates],
  )
  const slashMenuOpen = Boolean(activeSlashFragment && !slashMenuDismissed && slashCandidates.length > 0)
  const visiblePendingMessages = pendingMessages.filter((message) => message.status !== "sending")
  const isNewSessionMode = pendingModeAction === "new-session"
  const attachmentAwareCanSend = canSend || attachments.length > 0

  const addAttachments = (next: readonly AgentDraftAttachment[]) => {
    if (next.length === 0) return
    setAttachments((current) => [...current, ...next])
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  const acceptSubmittedAttachments = (submittedAttachments: readonly AgentDraftAttachment[]) => {
    const submittedIds = new Set(submittedAttachments.map((attachment) => attachment.id))
    setAttachments((current) => current.filter((attachment) => !submittedIds.has(attachment.id)))
    let restored = false
    return () => {
      if (restored) return
      restored = true
      setAttachments((current) => {
        const currentIds = new Set(current.map((attachment) => attachment.id))
        const missing = submittedAttachments.filter((attachment) => !currentIds.has(attachment.id))
        return missing.length === 0 ? current : [...current, ...missing]
      })
    }
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
    const scrollHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)
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

  const insertComposerText = (text: string) => {
    const el = textareaRef.current
    const next = insertTextAtComposerSelection({
      draft,
      selectionStart: el?.selectionStart ?? draft.length,
      selectionEnd: el?.selectionEnd ?? draft.length,
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
      ? filterAgentSlashCandidates(slashCandidates, currentFragment.query)
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
      const imageFiles = files.filter((file) => isSupportedImageMimeType(file.type))
      if (imageFiles.length > 0) {
        void addImageFiles(imageFiles, addAttachments).catch((error) => {
          logger.warn("Agent attachment image read failed.", { error })
        })
      }
      const { attachments: pathAttachments, unresolvedCount } = pathAttachmentsFromPastedFiles(
        files.filter((file) => !isSupportedImageMimeType(file.type)),
      )
      addAttachments(pathAttachments)
      if (unresolvedCount > 0) {
        toast("无法读取文件完整路径")
      }
      return
    }

    return
  }

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) return

    event.preventDefault()
    void addDroppedFiles(files, addAttachments).then((unresolvedCount) => {
      if (unresolvedCount > 0) {
        toast("无法读取文件完整路径")
      }
    }).catch((error) => {
      logger.warn("Agent attachment drop failed.", { error })
    })
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
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
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
          contextNotice={showConversationRolloverPrompt && onStartNewConversation ? (
            <AgentConversationRolloverPrompt
              onStartNewConversation={onStartNewConversation}
              disabled={creatingConversation}
            />
          ) : null}
          slashMenu={slashMenuOpen ? (
            <AgentSlashMenu
              candidates={visibleSlashCandidates}
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
            <div className="flex flex-col gap-1">
              {attachments.map((attachment, index) => (
                <div
                  key={attachment.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-sm"
                >
                  {attachment.kind === "image" ? (
                    <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                  ) : attachment.entryType === "directory" ? (
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {attachmentLabel(attachments, attachment, index)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`删除附件 ${attachmentRemoveLabel(attachments, attachment, index)}`}
                    data-track="agent-attachment-remove"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          editor={(
            <Textarea
              ref={textareaRef}
              className="agent-composer__input max-h-40 min-h-12 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
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
              <QuickInputMenu
                quickInputs={quickInputs}
                disabled={disabled}
                onDirectSend={(content) => onQuickInputDirectSend?.(content)}
              />
              <KnowledgeBaseActionMenu
                actions={knowledgeBaseActions}
                disabled={disabled}
                onSend={(commandText) => onKnowledgeBaseCommand?.(commandText)}
                onInsert={insertKnowledgeBaseCommand}
                onOpenSourceManager={onOpenKnowledgeBaseSourceManager}
              />
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

function isSupportedImageMimeType(type: string): type is AgentDraftImageAttachment["mimeType"] {
  return SUPPORTED_IMAGE_MIME_TYPES.has(type as AgentDraftImageAttachment["mimeType"])
}

async function addImageFiles(
  files: readonly File[],
  addAttachments: (attachments: readonly AgentDraftAttachment[]) => void,
) {
  const images = await Promise.all(files.map(createImageAttachmentFromFile))
  addAttachments(images)
}

async function addDroppedFiles(
  files: readonly File[],
  addAttachments: (attachments: readonly AgentDraftAttachment[]) => void,
): Promise<number> {
  const next: AgentDraftAttachment[] = []
  let unresolvedCount = 0
  for (const file of files) {
    if (isSupportedImageMimeType(file.type)) {
      next.push(await createImageAttachmentFromFile(file))
      continue
    }
    const path = droppedFilePath(file)
    if (!path || !isAbsolutePathLine(path)) {
      unresolvedCount += 1
      continue
    }
    next.push(createPathAttachment({
      id: createDraftAttachmentId(),
      path,
      entryType: inferDroppedEntryType(file),
      name: file.name || path,
    }))
  }
  addAttachments(next)
  return unresolvedCount
}

function pathAttachmentsFromPastedFiles(files: readonly File[]): {
  readonly attachments: readonly AgentDraftAttachment[]
  readonly unresolvedCount: number
} {
  const attachments: AgentDraftAttachment[] = []
  let unresolvedCount = 0
  for (const file of files) {
    const path = requireSynapseBridge().shell.filePathForDroppedFile(file)
    if (!path || !isAbsolutePathLine(path)) {
      unresolvedCount += 1
      continue
    }
    attachments.push(createPathAttachment({
      id: createDraftAttachmentId(),
      path,
      entryType: inferDroppedEntryType(file),
      name: file.name || undefined,
    }))
  }
  return { attachments, unresolvedCount }
}

async function createImageAttachmentFromFile(file: File): Promise<AgentDraftImageAttachment> {
  return createImageAttachment({
    id: createDraftAttachmentId(),
    name: file.name || undefined,
    mimeType: file.type as AgentDraftImageAttachment["mimeType"],
    size: file.size,
    bytes: await file.arrayBuffer(),
  })
}

function droppedFilePath(file: File): string | null {
  return requireSynapseBridge().shell.filePathForDroppedFile(file) || legacyFilePath(file)
}

function legacyFilePath(file: File): string | null {
  return (file as File & { readonly path?: string }).path || null
}

function inferDroppedEntryType(file: File): "file" | "directory" {
  return file.size === 0 && !file.type ? "directory" : "file"
}

function isAbsolutePathLine(value: string): boolean {
  return (
    value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || isWindowsUncAbsolutePath(value)
  )
}

function isWindowsUncAbsolutePath(value: string): boolean {
  return /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)
}

function attachmentLabel(
  attachments: readonly AgentDraftAttachment[],
  attachment: AgentDraftAttachment,
  index: number,
): string {
  if (attachment.kind === "path") return attachment.path
  return nextImageLabel(imageIndexAt(attachments, index))
}

function attachmentRemoveLabel(
  attachments: readonly AgentDraftAttachment[],
  attachment: AgentDraftAttachment,
  index: number,
): string {
  if (attachment.kind === "path") return attachment.name
  return nextImageLabel(imageIndexAt(attachments, index))
}

function imageIndexAt(attachments: readonly AgentDraftAttachment[], index: number): number {
  return attachments.slice(0, index + 1).filter((attachment) => attachment.kind === "image").length - 1
}

function createDraftAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export { AgentComposer }
