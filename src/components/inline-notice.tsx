import { useEffect, useId } from "react"
import { toast } from "sonner"

type InlineNoticeProps = {
  message: string
  onDismiss?: () => void
  tone?: "default" | "destructive"
}

function showInlineNoticeToast(
  id: string,
  message: string,
  tone: InlineNoticeProps["tone"],
  onDismiss?: () => void,
) {
  const options = {
    duration: tone === "destructive" ? 6000 : 4500,
    id,
    onDismiss,
  }

  if (tone === "destructive") {
    toast.error(message, options)
    return
  }

  toast(message, options)
}

function InlineNotice({ message, onDismiss, tone = "default" }: InlineNoticeProps) {
  const toastId = useId()

  useEffect(() => {
    showInlineNoticeToast(toastId, message, tone, onDismiss)
  }, [message, onDismiss, toastId, tone])

  return null
}

export { InlineNotice }
