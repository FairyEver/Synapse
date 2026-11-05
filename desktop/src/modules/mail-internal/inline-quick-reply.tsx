import { toast } from "sonner"
import { InlineQuickReply } from "@/components/inline-quick-reply"
import type { MailMessage, MailOperationResult } from "@/types/mail"
import { useMailQuickReply } from "./use-mail-quick-reply"

type InlineMailQuickReplyProps = {
  readonly source: MailMessage
  readonly onSent: (receipt: MailOperationResult["send"]) => void
}

export function InlineMailQuickReply({ source, onSent }: InlineMailQuickReplyProps) {
  const quickReply = useMailQuickReply(source)

  async function send(): Promise<boolean> {
    const receipt = await quickReply.send()
    if (!receipt) return false
    quickReply.setBody("")
    toast.success("已发送")
    onSent(receipt)
    return true
  }

  return <InlineQuickReply
    className="mt-4"
    value={quickReply.body}
    busy={quickReply.busy}
    error={quickReply.error}
    onValueChange={quickReply.setBody}
    onSubmit={send}
  />
}
