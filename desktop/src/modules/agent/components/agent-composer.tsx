import { type FormEvent, type KeyboardEvent, useMemo, useRef, useEffect, useState } from "react"
import { ArrowUp, ChevronDown, CornerDownRight, RotateCcw, Square, Trash2 } from "lucide-react"
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
import { getPermissionModeCapability } from "../permission-mode-capability"
import { permissionModeConfirmationText, permissionModeLabels } from "../permission-mode-options"
import type { PendingMessage } from "../pending-message-queue"
import { AgentComposerInputBox } from "./agent-composer-input-box"
import {
  KnowledgeBaseActionMenu,
  type KnowledgeBaseComposerAction,
} from "./knowledge-base-action-menu"
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

function AgentComposer({
  draft,
  disabled,
  canSend,
  sending,
  cancelPhase,
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
  onRemovePendingMessage,
  onRetryPendingMessage,
  onJumpToBottom,
  slashCandidates = [],
  knowledgeBaseActions = [],
  onKnowledgeBaseCommand,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly permissionMode?: SynapseAgentPermissionMode
  readonly pendingMessages?: readonly PendingMessage[]
  readonly showJumpToBottom?: boolean
  readonly slashCandidates?: readonly AgentSlashCandidate[]
  readonly knowledgeBaseActions?: readonly KnowledgeBaseComposerAction[]
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancelTurn: () => void
  readonly onForceKillTurn: () => void
  readonly onJumpToBottom?: () => void
  readonly onPermissionModeChange?: (mode: SynapseAgentPermissionMode) => Promise<void> | void
  readonly onCreatePermissionModeSession?: (mode: SynapseAgentPermissionMode) => void
  readonly onRemovePendingMessage?: (id: string) => void
  readonly onRetryPendingMessage?: (id: string) => void
  readonly onKnowledgeBaseCommand?: (commandText: string) => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const [pendingModeAction, setPendingModeAction] = useState<"switch" | "new-session">("switch")
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
  const [highlightedSlashIndex, setHighlightedSlashIndex] = useState(0)
  const [selectionStart, setSelectionStart] = useState(0)
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
        canSend,
        sending,
        pendingCount: pendingMessages.length,
        permissionMode,
      },
    })
    onSubmit(event)
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

  const insertKnowledgeBaseCommand = (commandText: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    const prefix = draft.slice(0, start)
    const suffix = draft.slice(end)
    const needsLeadingSpace = prefix.length > 0 && !/\s$/.test(prefix)
    const insertion = `${needsLeadingSpace ? " " : ""}${commandText}`
    const nextValue = `${prefix}${insertion}${suffix}`
    const cursor = prefix.length + insertion.length
    onDraftChange(nextValue)
    window.setTimeout(() => {
      const nextEl = textareaRef.current
      if (!nextEl) return
      nextEl.focus()
      nextEl.setSelectionRange(cursor, cursor)
      setSelectionStart(cursor)
    }, 0)
  }

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      onInputKeyDown(event)
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

    onInputKeyDown(event)
  }

  return (
    <>
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
        ) : null}
        <AgentComposerInputBox
          multiline={multiline}
          slashMenu={slashMenuOpen ? (
            <AgentSlashMenu
              candidates={visibleSlashCandidates}
              highlightedIndex={highlightedSlashIndex}
              onHighlight={setHighlightedSlashIndex}
              onSelect={selectSlashCandidate}
            />
          ) : null}
          pendingMessages={visiblePendingMessages.length > 0 ? (
            <ScrollArea className="max-h-40">
              <div className="flex flex-col">
                {visiblePendingMessages.map((message) => (
                  <div
                    key={message.id}
                    className="flex min-w-0 items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                  >
                    <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-muted-foreground">{message.content}</p>
                      {message.status === "failed" ? (
                        <p className="truncate text-xs text-destructive">{message.error ?? "发送失败"}</p>
                      ) : null}
                    </div>
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
                ))}
              </div>
            </ScrollArea>
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
              onSelect={updateSelectionStart}
              placeholder="输入消息"
              disabled={disabled}
              rows={1}
            />
          )}
          leadingActions={(
            <KnowledgeBaseActionMenu
              actions={knowledgeBaseActions}
              disabled={disabled}
              onSend={(commandText) => onKnowledgeBaseCommand?.(commandText)}
              onInsert={insertKnowledgeBaseCommand}
            />
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
                  disabled={!canSend}
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

export { AgentComposer }
