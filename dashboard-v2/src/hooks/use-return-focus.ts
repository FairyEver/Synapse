import { useEffect, useRef, type RefObject } from 'react'
/** Return focus after a controlled business dialog closes, including deleted-row fallbacks. */
export function useReturnFocus(open: boolean, target: RefObject<HTMLElement | null>, fallback?: RefObject<HTMLElement | null>, skip = false) {
  const wasOpen = useRef(false)
  useEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    if (!closed || skip) return
    const frame = requestAnimationFrame(() => {
      const element = target.current?.isConnected ? target.current : fallback?.current
      element?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, target, fallback, skip])
}
