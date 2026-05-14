import { type FormEvent, type KeyboardEvent, useRef, useEffect, useState } from "react"
import { ArrowUp, CornerDownRight, RotateCcw, ShieldCheck, Square, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import { getPermissionModeCapability } from "../permission-mode-capability"
import { permissionModeConfirmationText } from "../permission-mode-options"
import type { PendingMessage } from "../pending-message-queue"
import { AgentPermissionModeMenu } from "./permission-mode-menu"

const SINGLE_LINE_HEIGHT = 28

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
  onRemovePendingMessage,
  onRetryPendingMessage,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly permissionMode?: SynapseAgentPermissionMode
  readonly pendingMessages?: readonly PendingMessage[]
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancelTurn: () => void
  readonly onForceKillTurn: () => void
  readonly onPermissionModeChange?: (mode: SynapseAgentPermissionMode) => Promise<void> | void
  readonly onCreatePermissionModeSession?: (mode: SynapseAgentPermissionMode) => void
  readonly onRemovePendingMessage?: (id: string) => void
  readonly onRetryPendingMessage?: (id: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)
  const [pendingMode, setPendingMode] = useState<SynapseAgentPermissionMode | null>(null)
  const [pendingModeAction, setPendingModeAction] = useState<"switch" | "new-session">("switch")
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
    const scrollHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${scrollHeight}px`
    setMultiline(scrollHeight > SINGLE_LINE_HEIGHT)
  }, [draft])

  return (
    <>
      <form
        className="agent-composer absolute inset-x-4 bottom-5 z-10 mx-auto max-w-2xl md:inset-x-20"
        data-track="agent-composer"
        onSubmit={onSubmit}
      >
        <div
          className="agent-composer__container rounded-lg border border-border bg-background p-2"
          data-multiline={multiline || undefined}
        >
          {visiblePendingMessages.length > 0 ? (
            <div className="mb-2 flex max-h-40 flex-col overflow-y-auto">
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
          ) : null}
          <div className="flex items-center gap-2">
            <Textarea
              ref={textareaRef}
              className="agent-composer__input max-h-30 min-h-7 resize-none border-0 bg-transparent px-0 py-1 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="输入消息"
              disabled={disabled}
              rows={1}
            />
            <AgentPermissionModeMenu
              selectedMode={permissionMode}
              onSelect={selectPermissionMode}
              trigger={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="权限模式"
                  data-track="agent-permission-mode-select"
                  disabled={disabled}
                >
                  <ShieldCheck size={14} />
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
                <Square size={12} strokeWidth={0} fill="currentColor" />
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
                <ArrowUp size={14} strokeWidth={2.5} />
              </Button>
            )}
          </div>
        </div>
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
