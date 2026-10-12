import { useCallback, useEffect, useRef, useState } from "react"
import type { TodoItemDto } from "@synapse/shared/todo-contracts"
import { todosApi } from "@/lib/todos-api"
import type { TodoOpenRequest } from "../apps/types"
import { todoErrorMessage } from "./todo-state"

export function useTodoTarget({ request, ready, generation, blocked = false, open, selectAll, consumed }: { request?: TodoOpenRequest | null; ready: boolean; generation: number; blocked?: boolean; open: (item: TodoItemDto) => void; selectAll: () => void; consumed?: (requestId: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0), handled = useRef(new Set<string>()), started = useRef(false), previousGeneration = useRef(generation), latestRequest = useRef(request)
  latestRequest.current = request
  const latestBlocked = useRef(blocked); latestBlocked.current = blocked
  const failed = useRef<TodoOpenRequest | null>(null)
  const cancel = useCallback(() => { sequence.current++; failed.current = null; const target = latestRequest.current; if (target) { handled.current.add(target.requestId); consumed?.(target.requestId) }; setError(null) }, [consumed])
  useEffect(() => {
    if (previousGeneration.current !== generation && started.current) cancel()
    previousGeneration.current = generation
  }, [generation, cancel])
  const resolve = useCallback(async (target: TodoOpenRequest) => {
    if (latestBlocked.current) return
    const token = ++sequence.current; started.current = true
    let settled = false
    setError(null); failed.current = null
    try {
      const item = await todosApi.get({ id: target.id })
      if (token !== sequence.current || latestBlocked.current) return
      if (item.completedAt) selectAll()
      open(item)
      settled = true
    } catch (cause) { if (token === sequence.current && !latestBlocked.current) { settled = true; failed.current = target; setError(todoErrorMessage(cause)) } }
    finally { if (settled && token === sequence.current) { handled.current.add(target.requestId); consumed?.(target.requestId) } }
  }, [open, selectAll, consumed])
  useEffect(() => {
    if (!request || !ready || blocked || handled.current.has(request.requestId)) return
    void resolve(request)
    return () => { sequence.current++ }
  }, [request?.requestId, request?.id, ready, generation, blocked, resolve])
  const retry = useCallback(async () => { if (ready && !blocked && failed.current) await resolve(failed.current) }, [ready, blocked, resolve])
  return { error, cancel, retry }
}
