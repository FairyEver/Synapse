import { useEffect, useRef, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailSummary } from "@/types/mail"

export function useMailContext(messageId: string | null) {
  const [items, setItems] = useState<MailSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const currentMessageId = useRef(messageId)
  currentMessageId.current = messageId

  useEffect(() => {
    setItems([])
    setNextCursor(null)
    setError(null)
    if (!messageId) return
    let active = true
    void mailRequest({ kind: "messageContext", messageId }).then((page) => {
      if (active) { setItems(page.items); setNextCursor(page.nextCursor) }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取往来失败。") })
    return () => { active = false }
  }, [messageId])

  async function loadMore() {
    if (!messageId || !nextCursor) return
    const page = await mailRequest({ kind: "messageContext", messageId, cursor: nextCursor })
    if (currentMessageId.current !== messageId) return
    setItems((current) => [...page.items, ...current])
    setNextCursor(page.nextCursor)
  }

  return { items, nextCursor, error, loadMore }
}
