import { useCallback, useEffect, useRef, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailMessage, MailSummary } from "@/types/mail"

export type MailBox = "inbox" | "sent"

export function useMail(box: MailBox, query: string, unreadOnly = false) {
  const [messages, setMessages] = useState<MailSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ inboxTotal: number; sentTotal: number; unread: number } | null>(null)
  const [revision, setRevision] = useState(0)
  const [loadedKey, setLoadedKey] = useState("")
  const listKey = `${box}:${query}:${unreadOnly}`
  const currentListKey = useRef(listKey)
  const handledSelectedRead = useRef(false)
  currentListKey.current = listKey

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let active = true
    void mailRequest({ kind: "messageCount" }).then((result) => { if (active) setCounts(result) }).catch(() => { if (active) setCounts(null) })
    return () => { active = false }
  }, [revision])

  useEffect(() => {
    const timer = window.setInterval(refresh, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const run = mailRequest({ kind: "messageList", box, query, unreadOnly }).then((result) => { if (active) { setMessages(result.items); setNextCursor(result.nextCursor); setLoadedKey(listKey) } })
    void run.catch((cause: unknown) => { if (active) { setLoadedKey(""); setError(cause instanceof Error ? cause.message : "加载失败。") } }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [box, query, unreadOnly, revision, listKey])

  useEffect(() => { handledSelectedRead.current = false }, [box, selectedId])

  useEffect(() => {
    setDetail(null)
    if (!selectedId) return
    let active = true
    void mailRequest({ kind: "messageGet", messageId: selectedId })
      .then(async (result) => {
        if (!active) return
        setDetail(result)
        const shouldMarkRead = box === "inbox" && !handledSelectedRead.current && !result.readAt
        handledSelectedRead.current = true
        if (shouldMarkRead) {
          try {
            await mailRequest({ kind: "messageSetRead", messageId: selectedId, read: true })
            if (active) refresh()
          } catch (cause) {
            if (active) setError(cause instanceof Error ? cause.message : "已读状态更新失败。")
          }
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        const message = cause instanceof Error ? cause.message : "读取失败。"
        if (message.includes("HTTP 404") || message.includes("信件不存在")) { setSelectedId(null); refresh() }
        else setError(message)
      })
    return () => { active = false }
  }, [box, selectedId, revision, refresh])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadedKey !== listKey) return
    const result = await mailRequest({ kind: "messageList", box, query, cursor: nextCursor, unreadOnly })
    if (currentListKey.current !== listKey) return
    setMessages((current) => [...current, ...result.items])
    setNextCursor(result.nextCursor)
  }, [box, loadedKey, listKey, nextCursor, query, unreadOnly])

  return { messages: loadedKey === listKey ? messages : [], ready: loadedKey === listKey, selectedId, setSelectedId, detail: detail?.messageId === selectedId ? detail : null, loading, error, nextCursor: loadedKey === listKey ? nextCursor : null, counts, loadMore, refresh }
}
