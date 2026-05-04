import { useEffect, useRef, useCallback } from "react"

export function useIdleTimeout(onTimeout: () => void, timeoutMs = 30 * 60 * 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(onTimeout, timeoutMs)
  }, [onTimeout, timeoutMs])

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart"] as const
    events.forEach((event) => window.addEventListener(event, reset))
    reset()

    return () => {
      events.forEach((event) => window.removeEventListener(event, reset))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [reset])
}
