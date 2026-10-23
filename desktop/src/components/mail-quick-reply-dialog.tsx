import { useRef } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useMailQuickReply } from "@/modules/mail-internal/use-mail-quick-reply"
import type { MailMessage, MailOperationResult } from "@/types/mail"

type MailQuickReplyDialogProps = {
  readonly source: MailMessage | null
  readonly onClose: () => void
  readonly onSent: (receipt: MailOperationResult["send"]) => void
}

export function MailQuickReplyDialog({ source, onClose, onSent }: MailQuickReplyDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const quickReply = useMailQuickReply(source)

  function requestClose() {
    if (quickReply.busy) return
    onClose()
  }

  async function send() {
    const receipt = await quickReply.send()
    if (!receipt) return
    toast.success("已发送")
    onSent(receipt)
    onClose()
  }

  return <Dialog open={source !== null} onOpenChange={(open) => { if (!open) requestClose() }}>
    <DialogContent
      aria-describedby={undefined}
      className="sm:max-w-xl"
      onEscapeKeyDown={(event) => { if (quickReply.busy) event.preventDefault() }}
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        textareaRef.current?.focus()
      }}
      onPointerDownOutside={(event) => { if (quickReply.busy) event.preventDefault() }}
    >
      <DialogHeader><DialogTitle>快速回复</DialogTitle></DialogHeader>
      <Textarea
        ref={textareaRef}
        aria-label="回复内容"
        name="quick-reply-body"
        rows={10}
        value={quickReply.body}
        disabled={quickReply.busy}
        onChange={(event) => {
          quickReply.setBody(event.target.value)
        }}
      />
      {quickReply.error && <p role="alert" className="text-sm text-destructive">{quickReply.error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={quickReply.busy} onClick={requestClose}>取消</Button>
        <Button type="button" disabled={quickReply.busy || !quickReply.body.trim()} onClick={() => void send()}>{quickReply.busy ? "发送中…" : "发送"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
