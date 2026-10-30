import { useEffect, useState } from "react"
export function useDealAnimation(handId: string | null, count: number, replay: number) {
  const [visible, setVisible] = useState(count)
  useEffect(() => {
    if (
      typeof matchMedia !== "function" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(count)
      return
    }
    setVisible(0)
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setVisible(i + 1), (i + 1) * 55),
    )
    return () => timers.forEach(clearTimeout)
  }, [handId, count, replay])
  return visible
}
