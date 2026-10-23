import { useCallback, useEffect, useRef, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import { createMailQuickReplyContent } from "@/lib/mail-reply"
import type { MailMessage, MailOperationResult } from "@/types/mail"

type PendingQuickReply = {
  readonly fingerprint: string
  readonly previewId: string
  readonly clientRequestId: string
}

export function useMailQuickReply(source: MailMessage | null) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const pending = useRef<PendingQuickReply | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    busyRef.current = false
    pending.current = null
    setBody("")
    setBusy(false)
    setError(null)
  }, [source])

  const send = useCallback(async (): Promise<MailOperationResult["send"] | null> => {
    if (!source || busyRef.current) return null
    const replyBody = body.trim()
    if (!replyBody) return null

    const requestGeneration = generation.current
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const content = createMailQuickReplyContent(source, replyBody)
      const fingerprint = JSON.stringify(content)
      if (!pending.current || pending.current.fingerprint !== fingerprint) {
        const preview = await mailRequest({ kind: "sendPreview", content })
        if (requestGeneration !== generation.current) return null
        pending.current = {
          fingerprint,
          previewId: preview.previewId,
          clientRequestId: crypto.randomUUID(),
        }
      }
      const receipt = await mailRequest({
        kind: "send",
        previewId: pending.current.previewId,
        clientRequestId: pending.current.clientRequestId,
      })
      if (requestGeneration !== generation.current) return null
      pending.current = null
      return receipt
    } catch (cause) {
      if (requestGeneration !== generation.current) return null
      const message = cause instanceof Error ? cause.message : ""
      if (message.includes("发送预览已过期")) {
        pending.current = null
        setError("发送预览已过期，请重试。")
      } else {
        setError(message || "发送失败。")
      }
      return null
    } finally {
      if (requestGeneration === generation.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }, [body, source])

  return { body, setBody, busy, error, send }
}
