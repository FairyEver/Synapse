import { useEffect, useMemo, useRef, useState } from "react"
import { EMPTY_FILTERS, ITEMS, PAGE_SIZE, hasFilters, matchingItems, type Filters, type Item, type Scope, type Sort } from "./model"

type SearchSnapshot = { query: string; filters: Filters; scope: Scope; folder: string | null; sort: Sort; page: number }
export function usePrototype() {
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [scope, setScope] = useState<Scope>("all")
  const [folder, setFolder] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>("relevance")
  const [page, setPage] = useState(1)
  const [preview, setPreview] = useState<Item | null>(null)
  const [returnTo, setReturnTo] = useState<SearchSnapshot | null>(null)
  const [located, setLocated] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [dark, setDark] = useState(false)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const [history, setHistory] = useState(["云盘", "设计", ".md"])
  const inputRef = useRef<HTMLInputElement>(null)
  const active = Boolean(query.trim()) || hasFilters(filters)
  const pending = !composing && draft !== query
  const matches = useMemo(() => matchingItems(query, filters, scope, folder, sort), [query, filters, scope, folder, sort])
  const browse = ITEMS.filter(item => item.parent === folder).sort((a, b) => Number(b.type === "folder") - Number(a.type === "folder") || b.modified.localeCompare(a.modified))
  const total = active ? matches.length : browse.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const visible = (active ? matches : browse).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(() => { document.documentElement.classList.toggle("dark", dark) }, [dark])
  useEffect(() => {
    if (composing) return
    const timer = window.setTimeout(() => { setQuery(draft); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [draft, composing])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !preview) {
        event.preventDefault(); inputRef.current?.focus(); inputRef.current?.select()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [preview])
  useEffect(() => {
    if (located) document.querySelector(`[data-item="${located}"]`)?.scrollIntoView?.({ block: "center", behavior: "instant" })
  }, [located, page])

  function remember(value: string) {
    const next = value.trim()
    if (next) setHistory(current => [next, ...current.filter(item => item !== next)].slice(0, 5))
  }
  function search(value: string) {
    setDraft(value); setError(false); setReturnTo(null); setLocated(null)
  }
  function submit(value = draft) {
    setDraft(value); setQuery(value); setPage(1); setError(false); setFocused(false); remember(value)
  }
  function updateFilter(key: keyof Filters, value: string) {
    setFilters(current => ({ ...current, [key]: value })); setPage(1); setError(false); setReturnTo(null)
  }
  function clearFilters() { setFilters(EMPTY_FILTERS); setPage(1); setError(false) }
  function exitSearch() {
    setDraft(""); setQuery(""); setFilters(EMPTY_FILTERS); setPage(1); setError(false); setReturnTo(null); setFocused(false)
    inputRef.current?.blur()
  }
  function navigate(next: string | null, target?: string) {
    setFolder(next); setLocated(target ?? null); setPreview(null); setDraft(""); setQuery(""); setFilters(EMPTY_FILTERS); setError(false); setFocused(false)
    if (!next) setScope("all")
    const children = ITEMS.filter(item => item.parent === next).sort((a, b) => Number(b.type === "folder") - Number(a.type === "folder") || b.modified.localeCompare(a.modified))
    setPage(target ? Math.floor(children.findIndex(item => item.id === target) / PAGE_SIZE) + 1 : 1)
  }
  function keepSearch() {
    if (active) { remember(query); setReturnTo({ query, filters, scope, folder, sort, page }) }
  }
  function locate(item: Item) { keepSearch(); navigate(item.parent, item.id) }
  function open(item: Item) {
    if (item.type === "folder") { keepSearch(); navigate(item.id) }
    else { remember(query); setFocused(false); setPreview(item) }
  }
  function restoreSearch() {
    if (!returnTo) return
    setDraft(returnTo.query); setQuery(returnTo.query); setFilters(returnTo.filters); setScope(returnTo.scope)
    setFolder(returnTo.folder); setSort(returnTo.sort); setPage(returnTo.page); setReturnTo(null); setLocated(null)
  }
  function scenario(value: string) {
    exitSearch(); setPreview(null); setFolder(null); setScope("all"); setSort("relevance"); setLocated(null)
    if (value === "results") submit("云盘")
    if (value === "folder") { setFolder("projects"); setScope("folder"); submit("设计") }
    if (value === "empty") submit("年度预算")
    if (value === "error") { submit("云盘"); setError(true) }
  }
  function changeScope(value: Scope) { setScope(value); setPage(1); setError(false) }
  function changeSort(value: Sort) { setSort(value); setPage(1) }
  return { draft, query, filters, scope, folder, sort, page, pages, preview, setPreview, returnTo, located, error, setError,
    dark, setDark, focused, setFocused, composing, setComposing, history, setHistory, inputRef, active, pending, visible, total,
    setPage, search, submit, updateFilter, clearFilters, exitSearch, navigate, locate, open, restoreSearch, scenario, changeScope, changeSort }
}
export type Prototype = ReturnType<typeof usePrototype>
