import { useCallback, useEffect, useRef, useState } from "react"
import { registerNavigationGuard } from "@/app-shell/navigation-guard"
import { holdBeforeUnloadForCustomDialog } from "@/lib/before-unload"

/** Stashing ends the editor's guard, but must not silently destroy its drafts. */
export function useAutomationDraftGuard(hasDrafts: boolean, onDiscard: () => void) {
  const drafts = useRef(hasDrafts)
  const discard = useRef(onDiscard)
  drafts.current = hasDrafts
  discard.current = onDiscard
  const [leaving, setLeaving] = useState<"navigation" | "close" | null>(null)
  const reply = useRef<((allowed: boolean) => void) | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const requestLeave = useCallback((kind: "navigation" | "close") => {
    reply.current?.(false)
    reply.current = null
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setLeaving(kind)
  }, [])

  useEffect(() => registerNavigationGuard(() => {
    if (!drafts.current) return true
    requestLeave("navigation")
    return new Promise<boolean>(resolve => { reply.current = resolve })
  }), [requestLeave])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!drafts.current) return
      holdBeforeUnloadForCustomDialog(event)
      requestLeave("close")
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      reply.current?.(false)
      reply.current = null
    }
  }, [requestLeave])

  function keepDrafts() {
    setLeaving(null)
    reply.current?.(false)
    reply.current = null
    returnFocus.current?.focus()
  }

  function discardDrafts() {
    drafts.current = false
    discard.current()
    setLeaving(null)
    if (leaving === "close") window.close()
    else reply.current?.(true)
    reply.current = null
  }

  return { leaving, keepDrafts, discardDrafts }
}
