import { useRef, type FormEvent, type KeyboardEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MailMessage, MailOperationResult } from "@/types/mail"
import { useMailQuickReply } from "./use-mail-quick-reply"

type InlineMailQuickReplyProps = {
  readonly source: MailMessage
  readonly onSent: (receipt: MailOperationResult["send"]) => void
}

export function InlineMailQuickReply({ source, onSent }: InlineMailQuickReplyProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const quickReply = useMailQuickReply(source)

  async function send() {
    const receipt = await quickReply.send()
    if (!receipt) return
    quickReply.setBody("")
    toast.success("已发送")
    onSent(receipt)
    window.requestAnimationFrame(() => inputRef.current?.focus())
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

  return <form aria-label="快速回复" className="mt-4 flex items-start gap-2" onSubmit={submit}>
    <div className="min-w-0 flex-1">
      <Input
        ref={inputRef}
        name="quick-reply-body"
        value={quickReply.body}
        placeholder="快速回复"
        aria-label="快速回复内容"
        aria-invalid={Boolean(quickReply.error)}
        aria-describedby={quickReply.error ? "inline-quick-reply-error" : undefined}
        autoComplete="off"
        enterKeyHint="send"
        disabled={quickReply.busy}
        onChange={(event) => quickReply.setBody(event.target.value)}
        onKeyDown={keyDown}
      />
      {quickReply.error && <p id="inline-quick-reply-error" role="alert" className="mt-2 text-sm text-destructive">{quickReply.error}</p>}
    </div>
    <Button type="submit" className="min-w-20" disabled={quickReply.busy || !quickReply.body.trim()} aria-busy={quickReply.busy}>
      {quickReply.busy ? "发送中…" : "发送"}
    </Button>
  </form>
}
