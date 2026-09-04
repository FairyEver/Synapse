import { useEffect, type RefObject } from "react"

export function useDismissOnPointerDownOutside<
  TContainer extends HTMLElement,
  TTrigger extends HTMLElement,
>(
  enabled: boolean,
  containerRef: RefObject<TContainer | null>,
  triggerRef: RefObject<TTrigger | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!enabled) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (containerRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onDismiss()
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => document.removeEventListener("pointerdown", handlePointerDown, true)
  }, [containerRef, enabled, onDismiss, triggerRef])
}
