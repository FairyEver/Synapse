import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import type { PokerTableView } from "@synapse/shared/game-contracts"
import { createPokerAudio } from "../lib/poker-audio"
import type { PresentedTransfer } from "../lib/chip-presentation"
import { pokerSoundCues, soundActionSeq } from "../lib/poker-sounds"

export function usePokerAudio(table: PokerTableView, perspective: "owner" | "public", identityKey: string, enabled: boolean) {
  const audio = useRef<ReturnType<typeof createPokerAudio> | null>(null)
  const previous = useRef<{ table: PokerTableView; context: string; at: number } | null>(null)
  const foreground = useRef(true)
  const context = `${table.roomCode}:${identityKey}:${perspective}:${table.controlVersion}:${table.mySeatNo}:${table.controller}:${enabled}`

  useEffect(() => {
    const player = createPokerAudio()
    audio.current = player
    foreground.current = document.hasFocus()
    const reset = () => { previous.current = null; player.stop() }
    const blur = () => { foreground.current = false; reset() }
    const focus = () => { foreground.current = true; reset() }
    const activate = () => { if (document.visibilityState !== "hidden" && foreground.current) void player.activate() }
    document.addEventListener("pointerdown", activate)
    document.addEventListener("keydown", activate)
    document.addEventListener("visibilitychange", reset)
    window.addEventListener("blur", blur)
    window.addEventListener("focus", focus)
    return () => {
      document.removeEventListener("pointerdown", activate)
      document.removeEventListener("keydown", activate)
      document.removeEventListener("visibilitychange", reset)
      window.removeEventListener("blur", blur)
      window.removeEventListener("focus", focus)
      previous.current = null
      audio.current = null
      void player.dispose()
    }
  }, [])

  useLayoutEffect(() => {
    const old = previous.current, now = Date.now()
    if (old?.context === context && (table.handNo < old.table.handNo || (table.handId === old.table.handId
      && (soundActionSeq(table) < soundActionSeq(old.table) || (old.table.settlement && !table.settlement))))) return
    previous.current = { table, context, at: now }
    if (!enabled || document.visibilityState === "hidden" || !foreground.current || !old || old.context !== context || now - old.at > 3000) {
      audio.current?.stop()
      return
    }
    if (table.handId !== old.table.handId) audio.current?.stop()
    const cues = pokerSoundCues(old.table, table, perspective)
    if (cues.length) audio.current?.play(cues)
  }, [table, context, enabled, perspective])

  return useCallback((_transfer: PresentedTransfer, index: number) => {
    if (!enabled || table.status === "closed" || document.visibilityState === "hidden" || !foreground.current || previous.current?.context !== context) return
    // One short physical impact per landed chip, with subtle variation and natural tails.
    audio.current?.land({ sound: "chip", delay: 0, volume: 0.3 + (index % 3) * 0.025, playbackRate: 0.97 + (index % 5) * 0.015 })
  }, [context, enabled, table.status])
}
