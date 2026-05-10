import { useEffect, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

const TICK_INTERVAL_MS = 1000

function hasActivePhase(items: readonly SynapseAgentTimelineItem[]): boolean {
  for (const item of items) {
    if (item.kind === "phase" && item.status === "in-progress") return true
  }
  return false
}

export function useActivePhaseTicker(items: readonly SynapseAgentTimelineItem[]): number {
  const [tick, setTick] = useState(0)
  const active = hasActivePhase(items)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((value) => value + 1), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [active])
  return tick
}
