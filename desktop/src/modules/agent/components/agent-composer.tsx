import { type FormEvent, type KeyboardEvent, useRef, useEffect, useState } from "react"
import { ArrowUp, Square } from "lucide-react"
import "./agent-composer.css"

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
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly cancelPhase: "idle" | "cancel_pending" | "cancelled"
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancelTurn: () => void
  readonly onForceKillTurn: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const scrollHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${scrollHeight}px`
    setMultiline(scrollHeight > SINGLE_LINE_HEIGHT)
  }, [draft])

  return (
    <form className="agent-composer" onSubmit={onSubmit}>
      <div
        className="agent-composer__container"
        data-multiline={multiline || undefined}
      >
        <textarea
          ref={textareaRef}
          className="agent-composer__input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="输入消息"
          disabled={disabled}
          rows={1}
        />
        {sending || cancelPhase === "cancel_pending" ? (
          <button
            type="button"
            className="agent-composer__stop"
            onClick={cancelPhase === "cancel_pending" ? onForceKillTurn : onCancelTurn}
            aria-label={cancelPhase === "cancel_pending" ? "强制停止" : "停止"}
          >
            <Square size={12} strokeWidth={0} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="agent-composer__send"
            disabled={!canSend}
            aria-label="发送"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  )
}

export { AgentComposer }
