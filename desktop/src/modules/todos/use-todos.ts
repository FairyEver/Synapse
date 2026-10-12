import { useCallback, useEffect, useRef, useState } from "react"
import type { TodoFilter, TodoItemDto } from "@synapse/shared/todo-contracts"
import { useAccount } from "@/app-shell/account"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { todosApi } from "@/lib/todos-api"
import { TodoCloudError } from "../../../app-capabilities/todos/shared/ipc-result"
import { mergeTodoItems, todoErrorMessage } from "./todo-state"

export function useTodos() {
  const { state } = useAccount()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const online = state.status === "authenticated" && state.connectivity !== "offline"
  const [items, setItems] = useState<TodoItemDto[]>([])
  const [filter, updateFilter] = useState<TodoFilter>("pending")
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [undo, setUndo] = useState<TodoItemDto | null>(null)
  const [writingIds, setWritingIds] = useState<Set<string>>(new Set())
  const epoch = useRef(0), readSequence = useRef(0), filterRef = useRef<TodoFilter>("pending"), active = useRef(true)
  const loadingRef = useRef(false), writes = useRef(new Set<string>())
  const retries = useRef(new Map<string, string>())
  const reset = useCallback(() => {
    epoch.current++; readSequence.current++; filterRef.current = "pending"; retries.current.clear(); writes.current.clear()
    setGeneration(epoch.current); setItems([]); setNextOffset(null); setError(null); setUndo(null); updateFilter("pending"); setWritingIds(new Set()); setLoading(false); loadingRef.current = false
  }, [])
  const refresh = useCallback(async () => {
    if (!userId || !online) return
    const identity = epoch.current, sequence = ++readSequence.current, selected = filterRef.current
    loadingRef.current = true; setLoading(true)
    const current = () => active.current && identity === epoch.current && sequence === readSequence.current && selected === filterRef.current
    try {
      const page = await todosApi.list({ filter: selected, offset: 0, limit: 50 })
      if (current()) { setItems((existing) => mergeTodoItems(existing, page.items, selected, true)); setNextOffset(page.nextOffset); setError(null) }
    } catch (cause) { if (current()) setError(todoErrorMessage(cause)) }
    finally { if (current()) { loadingRef.current = false; setLoading(false) } }
  }, [userId, online])
  const latestRefresh = useRef(refresh); latestRefresh.current = refresh
  useEffect(() => {
    active.current = true
    const offReset = todosApi.onReset(reset), offChanged = todosApi.onChanged(() => { void latestRefresh.current() })
    const focus = () => { if (document.visibilityState === "visible") void latestRefresh.current() }
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus)
    const offLive = getSynapseBridge()?.live.onStateChanged((event) => { if (event.state.status === "connected") void latestRefresh.current() })
    return () => { active.current = false; epoch.current++; readSequence.current++; offReset(); offChanged(); offLive?.(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus) }
  }, [reset])
  useEffect(() => { if (!userId) reset(); else if (online) void refresh() }, [userId, online, reset, refresh])
  const setFilter = useCallback((value: TodoFilter) => {
    if (filterRef.current === value) return
    filterRef.current = value; readSequence.current++; updateFilter(value); setItems([]); setNextOffset(null); setError(null); void latestRefresh.current()
  }, [])
  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingRef.current || !online) return
    const identity = epoch.current, sequence = readSequence.current, selected = filterRef.current
    const current = () => active.current && identity === epoch.current && sequence === readSequence.current && selected === filterRef.current
    loadingRef.current = true; setLoading(true)
    try { const page = await todosApi.list({ filter: selected, offset: nextOffset, limit: 50 }); if (current()) { setItems((existing) => mergeTodoItems(existing, page.items, selected)); setNextOffset(page.nextOffset); setError(null) } }
    catch (cause) { if (current()) setError(todoErrorMessage(cause)) }
    finally { if (current()) { loadingRef.current = false; setLoading(false) } }
  }, [nextOffset, online])
  const mutate = useCallback(async <T,>(item: TodoItemDto, action: string, run: (requestId: string) => Promise<T>): Promise<T> => {
    if (!online) throw new TodoCloudError(0, "TODO_OFFLINE", "连接失败，请重试")
    if (writes.current.has(item.id)) throw new TodoCloudError(0, "TODO_BUSY", "正在保存")
    const identity = epoch.current, key = `${item.id}:${item.version}:${action}`
    const requestId = retries.current.get(key) ?? crypto.randomUUID(); retries.current.set(key, requestId)
    writes.current.add(item.id); setWritingIds(new Set(writes.current))
    try {
      const result = await run(requestId)
      if (!active.current || identity !== epoch.current) throw new TodoCloudError(0, "TODO_IDENTITY_CHANGED", "账号已变化")
      retries.current.delete(key); return result
    } catch (cause) { if (identity === epoch.current) { await latestRefresh.current(); if (identity === epoch.current) setError(todoErrorMessage(cause)) }; throw cause }
    finally { if (identity === epoch.current) { writes.current.delete(item.id); setWritingIds(new Set(writes.current)) } }
  }, [online])
  const setCompleted = useCallback(async (item: TodoItemDto, completed: boolean) => {
    const result = await mutate(item, `completed:${completed}`, (clientRequestId) => todosApi.setCompleted(item.id, { completed, expectedVersion: item.version, clientRequestId }))
    setUndo(completed ? result : null)
    await latestRefresh.current(); return result
  }, [mutate])
  const remove = useCallback(async (item: TodoItemDto) => {
    await mutate(item, "delete", (clientRequestId) => todosApi.delete(item.id, { expectedVersion: item.version, clientRequestId }))
    setItems((existing) => existing.filter((entry) => entry.id !== item.id)); setUndo(null); await latestRefresh.current()
  }, [mutate])
  const undoCompletion = useCallback(async () => { if (undo) { const receipt = undo; setUndo(null); await setCompleted(receipt, false) } }, [undo, setCompleted])
  return { items, filter, setFilter, nextOffset, loading, error, generation, authenticated: !!userId, online, writingIds, undo, undoCompletion, refresh, loadMore, setCompleted, remove }
}
