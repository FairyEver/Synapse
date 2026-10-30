import { useLayoutEffect, useRef, useState } from "react"
export function useDealAnimation(handId: string | null, count: number, replay: number) {
  const [visible, setVisible] = useState(0)
  const progress = useRef({ handId, replay, visible: 0 })
  useLayoutEffect(() => {
    const reduced =
      typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches
    const restart = progress.current.handId !== handId || progress.current.replay !== replay
    const start = reduced ? count : restart ? 0 : Math.min(progress.current.visible, count)
    progress.current = { handId, replay, visible: start }
    setVisible(start)
    if (reduced) return
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
  }, [handId, count, replay])
  return visible
}
