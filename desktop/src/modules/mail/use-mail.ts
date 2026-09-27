import { useCallback, useEffect, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailDraft, MailMessage, MailSummary } from "@/types/mail"

export type MailBox = "inbox" | "sent" | "drafts"

export function useMail(box: MailBox, query: string) {
  const [messages, setMessages] = useState<MailSummary[]>([])
  const [drafts, setDrafts] = useState<MailDraft[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const timer = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const run = box === "drafts"
      ? mailRequest({ kind: "draftList" }).then((result) => { if (active) { setDrafts(result.items); setMessages([]); setNextCursor(null) } })
      : mailRequest({ kind: "messageList", box, query }).then((result) => { if (active) { setMessages(result.items); setNextCursor(result.nextCursor); setDrafts([]) } })
    void run.catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "加载失败。") }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [box, query, revision])

  useEffect(() => {
    if (box === "drafts") { setDetail(null); return }
    if (!selectedId) { setSelectedId(messages[0]?.messageId ?? null); return }
    let active = true
    void mailRequest({ kind: "messageGet", messageId: selectedId })
      .then((result) => { if (active) setDetail(result) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取失败。") })
    return () => { active = false }
  }, [box, messages, selectedId, revision])

  const loadMore = useCallback(async () => {
    if (box === "drafts" || !nextCursor) return
    const result = await mailRequest({ kind: "messageList", box, query, cursor: nextCursor })
    setMessages((current) => [...current, ...result.items])
    setNextCursor(result.nextCursor)
  }, [box, nextCursor, query])

  return { messages, drafts, selectedId, setSelectedId, detail, loading, error, nextCursor, loadMore, refresh }
}
