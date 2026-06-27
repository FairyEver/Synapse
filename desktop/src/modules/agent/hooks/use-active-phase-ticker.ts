import { useEffect, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

const TICK_INTERVAL_MS = 1000

function hasActiveTimelineItem(items: readonly SynapseAgentTimelineItem[]): boolean {
  const completedToolUseIds = new Set<string>()
  for (const item of items) {
    if (item.kind === "toolResult" && item.toolUseId) completedToolUseIds.add(item.toolUseId)
  }
  for (const item of items) {
    if (item.kind === "phase" && item.status === "in-progress") return true
    if (item.kind === "toolProgress" && item.status === "preparing") return true
    if (item.kind === "permissionRequest") return true
    if (item.kind === "toolCall" && (!item.toolUseId || !completedToolUseIds.has(item.toolUseId))) return true
  }
  return false
}

export function useActivePhaseTicker(items: readonly SynapseAgentTimelineItem[]): number {
  const [tick, setTick] = useState(0)
  const active = hasActiveTimelineItem(items)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((value) => value + 1), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [active])
  return tick
}
