import { useEffect, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import type { PokerResolutionFrameView } from "@synapse/shared/game-contracts"
import { useReducedMotion } from "../hooks/useReducedMotion"
import "../styles/cards.css"

type CardFeedbackCue = { id: string; kind: "spark" | "protected" }
export function PokerCardFeedback({ frames, handId, scope }: { frames: readonly PokerResolutionFrameView[]; handId: string | null; scope: string }) {
  const context = `${scope}:${handId}`
  const history = useRef({ context, seen: new Set<string>() })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [feedback, setFeedback] = useState<CardFeedbackCue | null>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const relevant = frames.filter(frame => frame.handId === handId)
    if (history.current.context !== context) {
      if (timer.current !== null) clearTimeout(timer.current)
      setFeedback(null)
      history.current = { context, seen: new Set(relevant.map(frame => frame.id)) }
      return
    }
    const fresh = relevant.filter(frame => !history.current.seen.has(frame.id))
    for (const frame of fresh) history.current.seen.add(frame.id)
    while (history.current.seen.size > 256) history.current.seen.delete(history.current.seen.values().next().value!)
    const cue = fresh.flatMap(frame => frame.events.flatMap<CardFeedbackCue>(event => {
      const kind = event.type === "poker.sparked" ? "spark" : event.type === "ability.blocked" || event.type === "ability.protected" || event.status === "blocked" ? "protected" : null
      return kind ? [{ id: `${frame.id}:${event.index}`, kind }] : []
    })).at(-1)
    if (!cue) return
    if (timer.current !== null) clearTimeout(timer.current)
    setFeedback(cue)
    timer.current = setTimeout(() => { setFeedback(null); timer.current = null }, 1800)
  }, [frames, handId, context])
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
    history.current.seen.clear()
  }, [])
  if (!feedback) return null
  return <span key={feedback.id} className="poker-card-feedback" data-kind={feedback.kind} data-reduced-motion={reduced} role="status">
    {feedback.kind === "spark" && <Sparkles aria-hidden="true" />}
    {feedback.kind === "spark" ? "星光一闪" : "防护已触发"}
  </span>
}
