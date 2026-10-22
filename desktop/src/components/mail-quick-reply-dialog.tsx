import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { mailRequest } from "@/lib/mail-api"
import { createMailQuickReplyContent } from "@/lib/mail-reply"
import type { MailMessage, MailOperationResult } from "@/types/mail"

type PendingQuickReply = {
  readonly fingerprint: string
  readonly previewId: string
  readonly clientRequestId: string
}

type MailQuickReplyDialogProps = {
  readonly source: MailMessage | null
  readonly onClose: () => void
  readonly onSent: (receipt: MailOperationResult["send"]) => void
}

export function MailQuickReplyDialog({ source, onClose, onSent }: MailQuickReplyDialogProps) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const busyRef = useRef(false)
  const pending = useRef<PendingQuickReply | null>(null)

  useEffect(() => {
    setBody("")
    setError(null)
    busyRef.current = false
    setBusy(false)
    pending.current = null
  }, [source?.messageId])

  function requestClose() {
    if (busyRef.current) return
    pending.current = null
    onClose()
  }

  async function send() {
    if (!source || busyRef.current) return
    const replyBody = body.trim()
    if (!replyBody) return

    busyRef.current = true
    setBusy(true)
    setError(null)
    let receipt: MailOperationResult["send"] | null = null
    try {
      const content = createMailQuickReplyContent(source, replyBody)
      const fingerprint = JSON.stringify(content)
      if (!pending.current || pending.current.fingerprint !== fingerprint) {
        const preview = await mailRequest({ kind: "sendPreview", content })
        pending.current = {
          fingerprint,
          previewId: preview.previewId,
          clientRequestId: crypto.randomUUID(),
        }
      }
      receipt = await mailRequest({
        kind: "send",
        previewId: pending.current.previewId,
        clientRequestId: pending.current.clientRequestId,
      })
      pending.current = null
      toast.success("已发送")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ""
      if (message.includes("发送预览已过期")) {
        pending.current = null
        setError("发送预览已过期，请重试。")
      } else {
        setError(message || "发送失败。")
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    if (receipt) {
      onSent(receipt)
      onClose()
    }
  }

  return <Dialog open={source !== null} onOpenChange={(open) => { if (!open) requestClose() }}>
    <DialogContent
      aria-describedby={undefined}
      className="sm:max-w-xl"
      onEscapeKeyDown={(event) => { if (busyRef.current) event.preventDefault() }}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        textareaRef.current?.focus()
      }}
      onPointerDownOutside={(event) => { if (busyRef.current) event.preventDefault() }}
    >
      <DialogHeader><DialogTitle>快速回复</DialogTitle></DialogHeader>
      <Textarea
        ref={textareaRef}
        aria-label="回复内容"
        name="quick-reply-body"
        rows={10}
        value={body}
        disabled={busy}
        onChange={(event) => {
          setBody(event.target.value)
          setError(null)
        }}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>取消</Button>
        <Button type="button" disabled={busy || !body.trim()} onClick={() => void send()}>{busy ? "发送中…" : "发送"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
