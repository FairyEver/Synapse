import { useLayoutEffect, useRef, useState } from "react"
export function useDealAnimation(handId: string | null, count: number, replay: number, snapshot?: object) {
  const [visible, setVisible] = useState(count)
  const progress = useRef({ handId, replay, visible: count, at: Date.now() })
  useLayoutEffect(() => {
    const reduced =
      typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches
    const restart = progress.current.handId !== handId || progress.current.replay !== replay
    const now = Date.now()
    const synchronize = now - progress.current.at > 3000 || (typeof document !== "undefined" && document.visibilityState === "hidden")
    const start = reduced || synchronize ? count : restart ? 0 : Math.min(progress.current.visible, count)
    progress.current = { handId, replay, visible: start, at: now }
    setVisible(start)
    if (reduced || synchronize) return
    const timers = Array.from({ length: count - start }, (_, i) =>
      setTimeout(
        () => {
          progress.current.visible = start + i + 1
          setVisible(start + i + 1)
        },
        (i + 1) * 55,
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [handId, count, replay, snapshot])
  return visible
}
