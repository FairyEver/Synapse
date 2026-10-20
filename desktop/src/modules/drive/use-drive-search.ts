import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DriveItemTreeEntryDto, DriveItemTreeListInput, DriveItemTreeListPageDto, DriveSearchFilters } from "@synapse/shared"
import { DRIVE_SEARCH_PAGE_SIZE } from "@synapse/shared/drive-search"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { driveErrorMessage } from "@/lib/drive-format"

export interface DriveSearchControls {
  readonly scope: "all" | "folder"
  readonly fileType: "all" | NonNullable<DriveSearchFilters["fileType"]>
  readonly days: "all" | "1" | "7" | "30"
  readonly shareStatus: "all" | NonNullable<DriveSearchFilters["shareStatus"]>
  readonly sort: NonNullable<DriveSearchFilters["sort"]>
}
const defaults: DriveSearchControls = { scope: "all", fileType: "all", days: "all", shareStatus: "all", sort: "relevance" }
type Request = { readonly key: string; readonly input: DriveItemTreeListInput }
type State = { key: string; status: "idle" | "loading" | "ready" | "error"; items: readonly DriveItemTreeEntryDto[]; total: number; nextOffset: number | null; loadingMore: boolean; error: string | null; moreError: string | null }
const empty: State = { key: "", status: "idle", items: [], total: 0, nextOffset: null, loadingMore: false, error: null, moreError: null }

function requestInput(draft: string, filters: DriveSearchControls, parentId: string | null): DriveItemTreeListInput {
  let updatedAfter: string | undefined
  if (filters.days !== "all") {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - Number(filters.days) + 1)
    updatedAfter = date.toISOString()
  }
  return { parentId: filters.scope === "folder" ? parentId : null, query: draft.trim(),
    ...(filters.fileType !== "all" ? { fileType: filters.fileType } : {}),
    ...(filters.shareStatus !== "all" ? { shareStatus: filters.shareStatus } : {}),
    ...(updatedAfter ? { updatedAfter } : {}), sort: filters.sort, offset: 0, limit: DRIVE_SEARCH_PAGE_SIZE }
}

export function useDriveSearch({ enabled, accountId, parentId }: { enabled: boolean; accountId: string | null; parentId: string | null }) {
  const [owner, setOwner] = useState(accountId)
  const [expanded, setExpanded] = useState(false)
  const [suspended, setSuspended] = useState(false)
  const [draft, setDraft] = useState("")
  const [filters, setFilters] = useState(defaults)
  const [composing, setComposing] = useState(false)
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [committed, setCommitted] = useState<Request | null>(null)
  const [state, setState] = useState<State>(empty)
  const inputRef = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const suspendedDirty = useRef(false)
  const filtered = filters.fileType !== "all" || filters.days !== "all" || filters.shareStatus !== "all"
  const hasCriteria = Boolean(draft.trim()) || filtered
  const active = enabled && owner === accountId && expanded && hasCriteria && (!composing || committed !== null)
  const input = useMemo(() => requestInput(draft, filters, parentId), [draft, filters, parentId])
  const intentKey = `${accountId}:${JSON.stringify(input)}`
  const pending = active && !composing && committed?.key !== intentKey
  const currentKey = useRef<string | null>(null)
  currentKey.current = active ? composing ? committed?.key ?? null : intentKey : null
  const latest = useRef({ state, active, suspended, pending, committed, draft })
  latest.current = { state, active, suspended, pending, committed, draft }

  useEffect(() => {
    if (owner === accountId) return
    generation.current += 1
    suspendedDirty.current = false
    setOwner(accountId); setExpanded(false); setSuspended(false); setDraft(""); setFilters(defaults)
    setCommitted(null); setState(empty); setHistory([]); setComposing(false); setFocused(false)
  }, [accountId, owner])
  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])
  useEffect(() => {
    if (!enabled || !expanded || composing || owner !== accountId) return
    if (!hasCriteria) { setCommitted(null); return }
    const timer = window.setTimeout(() => setCommitted({ key: intentKey, input }), 250)
    return () => window.clearTimeout(timer)
  }, [enabled, expanded, composing, owner, accountId, hasCriteria, intentKey, input])

  const fetchPage = useCallback(async (request: Request, offset = 0, append = false, minimumItems = DRIVE_SEARCH_PAGE_SIZE) => {
    const id = ++generation.current
    setState(previous => append && previous.key === request.key ? { ...previous, loadingMore: true, moreError: null } : { ...empty, key: request.key, status: "loading" })
    try {
      const collected = new Map<string, DriveItemTreeEntryDto>()
      let page: DriveItemTreeListPageDto
      let nextOffset = offset
      do {
        const pageOffset = nextOffset
        page = await requireSynapseBridge().drive.itemTree.list({ ...request.input, offset: pageOffset })
        if (generation.current !== id || currentKey.current !== request.key) return
        if (page.hasMore && (page.nextOffset === null || page.nextOffset <= pageOffset)) throw new Error("搜索分页信息无效，请重试。")
        for (const item of page.items) collected.set(item.id, item)
        nextOffset = page.nextOffset ?? pageOffset
      } while (!append && page.hasMore && collected.size < minimumItems)
      setState(previous => {
        const previousItems = append && previous.key === request.key ? previous.items : []
        const ids = new Set(previousItems.map(item => item.id))
        return { ...empty, key: request.key, status: "ready", items: [...previousItems, ...[...collected.values()].filter(item => !ids.has(item.id))], total: page.total, nextOffset: page.hasMore ? page.nextOffset : null }
      })
    } catch (cause) {
      if (generation.current !== id || currentKey.current !== request.key) return
      const message = driveErrorMessage(cause, "搜索失败，请重试。")
      setState(previous => append ? { ...previous, loadingMore: false, moreError: message } : { ...empty, key: request.key, status: "error", error: message })
    }
  }, [])
  useEffect(() => {
    if (!active || pending || composing || !committed) return
    if (latest.current.state.key === committed.key && latest.current.state.status === "ready") return
    void fetchPage(committed, 0, false, latest.current.state.key === committed.key ? latest.current.state.items.length : DRIVE_SEARCH_PAGE_SIZE)
    return () => { generation.current += 1 }
  }, [active, pending, composing, committed?.key, fetchPage])
  useEffect(() => () => { generation.current += 1 }, [])

  const remember = useCallback(() => {
    const value = latest.current.draft.trim()
    if (value) setHistory(previous => [value, ...previous.filter(entry => entry !== value)].slice(0, 5))
  }, [])
  const refresh = useCallback(async () => {
    const value = latest.current
    if (value.suspended) { suspendedDirty.current = true; return }
    if (value.active && !value.pending && value.committed) await fetchPage(value.committed, 0, false, value.state.items.length)
  }, [fetchPage])
  const loadMore = useCallback(async () => {
    const value = latest.current
    if (!value.active || value.pending || !value.committed || value.state.loadingMore || value.state.nextOffset === null) return
    await fetchPage(value.committed, value.state.nextOffset, true)
  }, [fetchPage])
  const start = useCallback(() => { suspendedDirty.current = false; setDraft(""); setFilters(defaults); setCommitted(null); setState(empty); setSuspended(false); setExpanded(true) }, [])
  const close = useCallback(() => {
    suspendedDirty.current = false; generation.current += 1; setExpanded(false); setSuspended(false); setDraft(""); setFilters(defaults)
    setCommitted(null); setState(empty); setFocused(false); setComposing(false); inputRef.current?.blur()
  }, [])
  function suspend() { remember(); generation.current += 1; setExpanded(false); setSuspended(active); setFocused(false) }
  function restore() {
    if (suspendedDirty.current) setState(previous => ({ ...previous, status: "idle" }))
    suspendedDirty.current = false; setSuspended(false); setExpanded(true)
  }
  function submit(value = draft) {
    if (composing) return
    setDraft(value); setCommitted({ key: `${accountId}:${JSON.stringify(requestInput(value, filters, parentId))}`, input: requestInput(value, filters, parentId) }); setFocused(false)
    const text = value.trim()
    if (text) setHistory(previous => [text, ...previous.filter(entry => entry !== text)].slice(0, 5))
  }
  function updateFilter(key: keyof DriveSearchControls, value: string) { setFilters(previous => ({ ...previous, [key]: value })) }
  const matches = state.key === committed?.key
  const loading = active && (pending || !matches || state.status === "loading" || state.status === "idle")
  return { expanded, suspended, active, pending, loading, draft, query: committed?.input.query ?? "", setDraft, filters, filtered, updateFilter, composing, setComposing,
    focused, setFocused, inputRef, history, clearHistory: () => setHistory([]), clearFilters: () => setFilters(previous => ({ ...defaults, scope: previous.scope })),
    items: matches ? state.items : [], total: matches ? state.total : 0, error: matches && !pending ? state.error : null,
    loadingMore: state.loadingMore, moreError: state.moreError, hasMore: state.nextOffset !== null, nextOffset: state.nextOffset,
    start, close, suspend, restore, submit, remember, refresh, loadMore }
}
export type DriveSearchController = ReturnType<typeof useDriveSearch>
