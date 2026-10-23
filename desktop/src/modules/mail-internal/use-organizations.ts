import { useEffect, useState } from "react"
import { mailRequest } from "@/lib/mail-api"
import type { MailOrganization } from "@/types/mail"

export function useOrganizations(open: boolean, search: string) {
  const [items, setItems] = useState<MailOrganization[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    const timeout = window.setTimeout(() => {
      void mailRequest({ kind: "organizationSearch", query: search.trim() }).then((result) => {
        if (active) setItems(result.items)
      }).catch((cause: unknown) => {
        if (active) { setItems([]); setError(cause instanceof Error ? cause.message : "加载组织失败。") }
      }).finally(() => { if (active) setLoading(false) })
    }, search.trim() ? 250 : 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [open, search, revision])
  return { items, loading, error, retry: () => setRevision((value) => value + 1) }
}
