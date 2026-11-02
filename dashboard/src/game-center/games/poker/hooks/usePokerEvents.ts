import { useEffect, useRef, useState } from "react"
import type { PokerTableEvent, PokerResolutionFrameView } from "@synapse/shared/game-contracts"
import { useGameQuery } from "../../../hooks/useGameQuery"
import { gameApi } from "../../../lib/api"
import { mergeCardFrames } from "../lib/card-effects"
import { mergeTableEvents } from "../lib/table-layout"
export function usePokerEvents(roomCode: string, perspective: "owner" | "public", enabled: boolean, identityKey?: string) {
  const cursor = useRef<string | undefined>(undefined), lastRead = useRef(0)
  const baseline = useRef(true), history = useRef<PokerTableEvent[]>([])
  const [events, setEvents] = useState<PokerTableEvent[]>([]), [animate, setAnimate] = useState<PokerTableEvent[]>([])
  const frameHistory = useRef<PokerResolutionFrameView[]>([])
  const [frames, setFrames] = useState<PokerResolutionFrameView[]>([]), [animateFrames, setAnimateFrames] = useState<PokerResolutionFrameView[]>([])
  const key = `${identityKey ?? "anonymous"}:${roomCode}:${perspective}`
  useEffect(() => { frameHistory.current = []; setFrames([]); setAnimateFrames([]); cursor.current = undefined; baseline.current = true; history.current = []; setEvents([]); setAnimate([]); lastRead.current = 0 }, [key])
  const query = useGameQuery(() => gameApi().poker.table.events({ roomCode, perspective, cursor: cursor.current, limit: 100 }), `poker:events:${key}`, 1000, enabled)
  useEffect(() => { if (query.error) baseline.current = true }, [query.error])
  useEffect(() => {
    if (!query.data) return
    const now = Date.now(), result = mergeTableEvents(history.current, query.data.events, baseline.current || now - lastRead.current > 3000)
    const cardResult = mergeCardFrames(frameHistory.current, query.data.frames ?? [], baseline.current || now - lastRead.current > 3000)
    frameHistory.current = cardResult.frames; setFrames(cardResult.frames); setAnimateFrames(cardResult.animate)
    history.current = result.events; cursor.current = query.data.cursor
    // A reconnect/backfill establishes state; only live events animate.
    baseline.current = query.data.hasMore; lastRead.current = now
    setEvents(result.events); setAnimate(result.animate)
  }, [query.data])
  return { events, animate, frames, animateFrames, error: query.error }
}
