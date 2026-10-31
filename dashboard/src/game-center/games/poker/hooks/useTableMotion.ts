import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { NO_MOTION, tableMotion } from "../lib/table-motion"

/** State drives money and turns; this bounded presentation never delays state. */
export function useTableMotion(table: PokerTableView, context: string) {
  const previous = useRef<{table: PokerTableView; context: string; at: number} | null>(null)
  const [motion,setMotion] = useState(NO_MOTION)
  useEffect(() => {
    const reset = () => { previous.current = null; setMotion(NO_MOTION) }
    document.addEventListener("visibilitychange",reset)
    return () => document.removeEventListener("visibilitychange",reset)
  },[])
  useLayoutEffect(() => {
    const now=Date.now(), old=previous.current
    if (old && old.context === context && table.handNo < old.table.handNo) return
    if (old?.context === context && old.table.handId === table.handId) {
      const previousSeq=old.table.actionSeq ?? old.table.recentActions.at(-1)?.seq ?? 0
      const currentSeq=table.actionSeq ?? table.recentActions.at(-1)?.seq ?? 0
      if (currentSeq<previousSeq || (old.table.settlement && !table.settlement)) return
    }
    previous.current={table,context,at:now}
    if (!old || old.context !== context || now-old.at>3000) { setMotion(NO_MOTION); return }
    const next=tableMotion(old.table,table)
    if (next.transfers.length || next.actions.length || next.turn !== null || next.celebrate.length) setMotion(next)
    else if (old.table.handId !== table.handId) setMotion(NO_MOTION)
  },[table,context])
  useEffect(() => {
    if (motion === NO_MOTION) return
    const timer=setTimeout(()=>setMotion(NO_MOTION),1400)
    return ()=>clearTimeout(timer)
  },[motion])
  return motion
}
