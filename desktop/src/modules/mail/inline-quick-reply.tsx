import { toast } from "sonner"
import { InlineQuickReply } from "@/components/inline-quick-reply"
import type { MailDetail, SendReceipt } from "../../../app-capabilities/mail/shared/types"
import { useMailQuickReply } from "./use-mail-quick-reply"

type InlineMailQuickReplyProps = {
  readonly source: MailDetail
  readonly onSent: (receipt: SendReceipt) => void
}

export function InlineMailQuickReply({ source, onSent }: InlineMailQuickReplyProps) {
  const quickReply = useMailQuickReply(source)

  async function send(): Promise<boolean> {
    const receipt = await quickReply.send()
    if (!receipt) return false
    quickReply.setBody("")
    if (receipt.state === "partial") toast.warning("已发送，部分收件人被拒绝")
    else toast.success("已发送")
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
