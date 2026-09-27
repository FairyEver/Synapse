import { useCallback, useEffect, useRef, useState } from "react"
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
  const [loadedKey, setLoadedKey] = useState("")
  const listKey = `${box}:${query}`
  const currentListKey = useRef(listKey)
  currentListKey.current = listKey

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
      ? mailRequest({ kind: "draftList" }).then((result) => { if (active) { setDrafts(result.items); setMessages([]); setNextCursor(null); setLoadedKey(listKey) } })
      : mailRequest({ kind: "messageList", box, query }).then((result) => { if (active) { setMessages(result.items); setNextCursor(result.nextCursor); setDrafts([]); setLoadedKey(listKey) } })
    void run.catch((cause: unknown) => { if (active) { setLoadedKey(""); setError(cause instanceof Error ? cause.message : "加载失败。") } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [box, query, revision, listKey])

  useEffect(() => {
    setDetail(null)
    if (box === "drafts" || !selectedId) return
    let active = true
    void mailRequest({ kind: "messageGet", messageId: selectedId })
      .then((result) => { if (active) setDetail(result) })
      .catch((cause: unknown) => {
        if (!active) return
        const message = cause instanceof Error ? cause.message : "读取失败。"
        if (message.includes("HTTP 404") || message.includes("信件不存在")) { setSelectedId(null); refresh() }
        else setError(message)
      })
    return () => { active = false }
  }, [box, selectedId, revision, refresh])

  const loadMore = useCallback(async () => {
    if (box === "drafts" || !nextCursor || loadedKey !== listKey) return
    const result = await mailRequest({ kind: "messageList", box, query, cursor: nextCursor })
    if (currentListKey.current !== listKey) return
    setMessages((current) => [...current, ...result.items])
    setNextCursor(result.nextCursor)
  }, [box, loadedKey, listKey, nextCursor, query])

  return { messages: loadedKey === listKey ? messages : [], drafts: loadedKey === listKey ? drafts : [], selectedId, setSelectedId, detail: detail?.messageId === selectedId ? detail : null, loading, error, nextCursor: loadedKey === listKey ? nextCursor : null, loadMore, refresh }
}
