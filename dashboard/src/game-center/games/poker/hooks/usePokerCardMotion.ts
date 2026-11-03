import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { planPokerCardMotion, type PokerCardMotionBatch } from "../lib/table-card-motion"
import { useReducedMotion } from "./useReducedMotion"

export function usePokerCardMotion(table: PokerTableView, scope: string) {
  const reduced = useReducedMotion()
  const previous = useRef<{ table: PokerTableView; scope: string; at: number } | null>(null)
  const [state, setState] = useState<{ scope: string; handId: string | null; batches: PokerCardMotionBatch[] } | null>(null)
  useLayoutEffect(() => {
    const before = previous.current, now = Date.now()
    if (before?.scope === scope && (table.handNo < before.table.handNo ||
      table.handId === before.table.handId && (table.actionSeq ?? 0) < (before.table.actionSeq ?? 0))) return
    previous.current = { table, scope, at: now }
    if (!before || before.scope !== scope || now - before.at > 3000 || reduced || document.visibilityState === "hidden") {
      setState(null)
      return
    }
    const batch = planPokerCardMotion(before.table, table)
    if (batch) setState(active => ({
      scope, handId: table.handId,
      batches: active?.scope === scope && active.handId === table.handId && active.batches.length
        ? [active.batches[0], batch] : [batch],
    }))
    else if (before.table.handId !== table.handId) setState(null)
  }, [table, scope, reduced])
  useEffect(() => {
    const reset = () => { previous.current = null; setState(null) }
    document.addEventListener("visibilitychange", reset)
    return () => document.removeEventListener("visibilitychange", reset)
  }, [])
  const complete = useCallback((batch: PokerCardMotionBatch) => {
    setState(active => active?.batches[0] === batch ? { ...active, batches: active.batches.slice(1) } : active)
  }, [])
  const batches = !reduced && state?.scope === scope && state.handId === table.handId ? state.batches : []
  return { batch: batches[0] ?? null, queued: batches[1], complete }
}
