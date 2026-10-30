import { useEffect, useRef, useState } from "react"
import type { PokerTableEvent } from "@synapse/shared/game-contracts"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { mergeTableEvents } from "../lib/table-layout"
export function usePokerEvents(roomCode: string, perspective: "owner" | "public", enabled: boolean, identityKey?: string) {
  const cursor = useRef<string | undefined>(undefined), lastRead = useRef(0)
  const baseline = useRef(true), history = useRef<PokerTableEvent[]>([])
  const [events, setEvents] = useState<PokerTableEvent[]>([]), [animate, setAnimate] = useState<PokerTableEvent[]>([])
  const key = `${identityKey ?? "anonymous"}:${roomCode}:${perspective}`
  useEffect(() => { cursor.current = undefined; baseline.current = true; history.current = []; setEvents([]); setAnimate([]); lastRead.current = 0 }, [key])
  const query = useGameQuery(() => gameApi().poker.table.events({ roomCode, perspective, cursor: cursor.current, limit: 100 }), `poker:events:${key}`, 1000, enabled)
  useEffect(() => { if (query.error) baseline.current = true }, [query.error])
  useEffect(() => {
    if (!query.data) return
    const now = Date.now(), result = mergeTableEvents(history.current, query.data.events, baseline.current || now - lastRead.current > 3000)
    history.current = result.events; cursor.current = query.data.cursor
    // A reconnect/backfill establishes state; only live events animate.
    baseline.current = query.data.hasMore; lastRead.current = now
    setEvents(result.events); setAnimate(result.animate)
  }, [query.data])
  return { events, animate, error: query.error }
}
