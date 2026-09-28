import { useCallback, useEffect, useRef, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailPerson } from "@/types/mail"

type RecipientPage = {
  query: string
  items: MailPerson[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

export function useRecipients(open: boolean, search: string) {
  const query = search.trim()
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<RecipientPage | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    const id = ++requestId.current
    setPage({ query, items: [], nextCursor: null, loading: true, loadingMore: false, error: null })
    const timeout = window.setTimeout(() => {
      void mailRequest({ kind: "recipientSearch", query })
        .then((result) => {
          if (requestId.current === id) setPage({ query, items: result.items, nextCursor: result.nextCursor, loading: false, loadingMore: false, error: null })
        })
        .catch((cause: unknown) => {
          if (requestId.current === id) setPage({ query, items: [], nextCursor: null, loading: false, loadingMore: false, error: cause instanceof Error ? cause.message : "加载成员失败。" })
        })
    }, query ? 250 : 0)
    return () => { requestId.current++; window.clearTimeout(timeout) }
  }, [open, query, revision])

  const visible = page?.query === query ? page : { query, items: [], nextCursor: null, loading: true, loadingMore: false, error: null }

  const loadMore = useCallback(() => {
    if (!open || !visible.nextCursor || visible.loadingMore) return
    const cursor = visible.nextCursor
    const id = requestId.current
    setPage((current) => current?.query === query ? { ...current, loadingMore: true, error: null } : current)
    void mailRequest({ kind: "recipientSearch", query, cursor })
      .then((result) => {
        if (requestId.current === id) setPage((current) => current?.query === query && current.nextCursor === cursor ? { ...current, items: [...current.items, ...result.items], nextCursor: result.nextCursor, loadingMore: false } : current)
      })
      .catch((cause: unknown) => {
        if (requestId.current === id) setPage((current) => current?.query === query ? { ...current, loadingMore: false, error: cause instanceof Error ? cause.message : "加载更多成员失败。" } : current)
      })
  }, [open, query, visible.loadingMore, visible.nextCursor])

  return { ...visible, loadMore, retry: () => setRevision((current) => current + 1) }
}
