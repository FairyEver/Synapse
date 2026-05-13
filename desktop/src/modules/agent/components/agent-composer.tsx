import { type FormEvent, type KeyboardEvent, useRef, useEffect, useState } from "react"
import { ArrowUp, CornerDownRight, RotateCcw, Square, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { PendingMessage } from "../pending-message-queue"

const SINGLE_LINE_HEIGHT = 28

function AgentComposer({
  draft,
  disabled,
  canSend,
  sending,
  cancelPhase,
  onDraftChange,
  onInputKeyDown,
  onSubmit,
  onCancelTurn,
  onForceKillTurn,
  pendingMessages = [],
  onRemovePendingMessage,
  onRetryPendingMessage,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly pendingMessages?: readonly PendingMessage[]
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancelTurn: () => void
  readonly onForceKillTurn: () => void
  readonly onRemovePendingMessage?: (id: string) => void
  readonly onRetryPendingMessage?: (id: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)
  const visiblePendingMessages = pendingMessages.filter((message) => message.status !== "sending")

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const scrollHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${scrollHeight}px`
    setMultiline(scrollHeight > SINGLE_LINE_HEIGHT)
  }, [draft])

  return (
    <form
      className="agent-composer absolute inset-x-4 bottom-5 z-10 mx-auto max-w-2xl md:inset-x-20"
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
          {sending || cancelPhase === "cancel_pending" ? (
            <Button
              type="button"
              className="agent-composer__stop rounded-full"
              size="icon-sm"
              onClick={cancelPhase === "cancel_pending" ? onForceKillTurn : onCancelTurn}
              aria-label={cancelPhase === "cancel_pending" ? "强制停止" : "停止"}
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
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

export { AgentComposer }
