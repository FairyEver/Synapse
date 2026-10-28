import { useCallback, useEffect, useRef, useState } from "react"
import type { DriveBrowsingHistoryEntryDto, DriveBrowsingHistoryKind, DriveBrowsingHistoryListInput } from "@synapse/shared"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { driveErrorMessage } from "@/lib/drive-format"

type State = { key: string; items: readonly DriveBrowsingHistoryEntryDto[]; nextCursor: string | null; loading: boolean; loadingMore: boolean; error: string | null }
const empty: State = { key: "", items: [], nextCursor: null, loading: false, loadingMore: false, error: null }
export function useDriveBrowsingHistory({ accountId, open }: { accountId: string | null; open: boolean }) {
  const [scope, setScope] = useState({ accountId, open })
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<DriveBrowsingHistoryKind | "all">("all")
  const [composing, setComposing] = useState(false)
  const [state, setState] = useState<State>(empty)
  const [clearing, setClearing] = useState(false)
  const generation = useRef(0)
  const clearLock = useRef(false)
  const scopeGeneration = useRef(0)
  const accountGeneration = useRef(0)
  if (scope.accountId !== accountId || scope.open !== open) {
    if (scope.accountId !== accountId) accountGeneration.current += 1
    generation.current += 1; scopeGeneration.current += 1; clearLock.current = false
    setScope({ accountId, open }); setQuery(""); setKind("all"); setState(empty); setClearing(false); setComposing(false)
  }
  const active = Boolean(accountId && open)
  const key = active ? JSON.stringify([accountId, query, kind]) : ""
  const latest = useRef({ key, state, query, kind, composing })
  latest.current = { key, state, query, kind, composing }
  const fetchPage = useCallback(async (append = false) => {
    const current = latest.current
    if (!current.key || clearLock.current || current.composing || (append && (current.state.loadingMore || !current.state.nextCursor))) return
    const id = ++generation.current
    const input: DriveBrowsingHistoryListInput = { ...(current.query.trim() ? { query: current.query.trim() } : {}), ...(current.kind !== "all" ? { kind: current.kind } : {}), limit: 50, ...(append ? { cursor: current.state.nextCursor! } : {}) }
    setState(previous => append ? { ...previous, loadingMore: true, error: null } : { ...empty, key: current.key, loading: true })
    try {
      const page = await requireSynapseBridge().drive.browsingHistory.list(input)
      if (generation.current !== id || latest.current.key !== current.key) return
      if (append && page.nextCursor === input.cursor) throw new Error("浏览历史分页无效，请重试。")
      setState(previous => ({ ...empty, key: current.key, items: append ? [...previous.items, ...page.items.filter(item => !previous.items.some(old => old.id === item.id))] : page.items, nextCursor: page.nextCursor }))
    } catch (cause) {
      if (generation.current !== id || latest.current.key !== current.key) return
      setState(previous => ({ ...previous, key: current.key, loading: false, loadingMore: false, error: driveErrorMessage(cause, "浏览历史加载失败。") }))
    }
  }, [])
  useEffect(() => {
    generation.current += 1
    if (!key || composing) return
    const timer = window.setTimeout(() => { void fetchPage() }, 250)
    return () => { window.clearTimeout(timer); generation.current += 1 }
  }, [key, composing, fetchPage])
  useEffect(() => () => { generation.current += 1; scopeGeneration.current += 1 }, [])
  const clearAll = useCallback(async () => {
    if (!latest.current.key || clearLock.current) return
    clearLock.current = true; setClearing(true); generation.current += 1
    const owner = scopeGeneration.current
    const ownerAccount = accountGeneration.current
    try {
      await requireSynapseBridge().drive.browsingHistory.clear()
      if (owner !== scopeGeneration.current) {
        if (ownerAccount === accountGeneration.current && latest.current.key) await fetchPage()
        return
      }
      generation.current += 1
      setState({ ...empty, key: latest.current.key })
    } catch (cause) {
      if (owner !== scopeGeneration.current) return
      setState(previous => ({ ...previous, key: latest.current.key, items: previous.key === latest.current.key ? previous.items : [], nextCursor: previous.key === latest.current.key ? previous.nextCursor : null, loading: false, loadingMore: false, error: driveErrorMessage(cause, "浏览历史清空失败。") }))
    } finally {
      if (owner === scopeGeneration.current) { clearLock.current = false; setClearing(false) }
    }
  }, [fetchPage])
  const openEntry = useCallback(async (entry: DriveBrowsingHistoryEntryDto) => {
    const owner = scopeGeneration.current
    const requestKey = latest.current.key
    try { await requireSynapseBridge().shell.openExternal(entry.url) }
    catch (cause) {
      if (owner !== scopeGeneration.current || requestKey !== latest.current.key) return
      setState(previous => ({ ...previous, error: driveErrorMessage(cause, "打开失败。") }))
    }
  }, [])
  const current = active && state.key === key
  return { query, setQuery, kind, setKind, setComposing, items: current ? state.items : [], loading: active && (!current || state.loading), loadingMore: current && state.loadingMore, error: current ? state.error : null, hasMore: current && state.nextCursor !== null, clearing, clearAll, openEntry, retry: () => fetchPage(), loadMore: () => fetchPage(true) }
}
