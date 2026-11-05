import { useId, useRef, type FormEvent, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type InlineQuickReplyProps = {
  readonly value: string
  readonly busy: boolean
  readonly error: string | null
  readonly onValueChange: (value: string) => void
  readonly onSubmit: () => Promise<boolean>
  readonly className?: string
}

export function InlineQuickReply({ value, busy, error, onValueChange, onSubmit, className }: InlineQuickReplyProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()

  async function send() {
    if (busy || !value.trim()) return
    const sent = await onSubmit()
    if (sent) window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void send()
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return
    event.preventDefault()
    if (event.nativeEvent.isComposing) return
    void send()
  }

  return <form aria-label="快速回复" className={cn("flex items-start gap-2", className)} onSubmit={submit}>
    <div className="min-w-0 flex-1">
      <Input
        ref={inputRef}
        name="quick-reply-body"
        value={value}
        placeholder="快速回复"
        aria-label="快速回复内容"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        enterKeyHint="send"
        disabled={busy}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={keyDown}
      />
      {error && <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
    <Button type="submit" className="min-w-20" disabled={busy || !value.trim()} aria-busy={busy}>
      {busy ? "发送中…" : "发送"}
    </Button>
  </form>
}
