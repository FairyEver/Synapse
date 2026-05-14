import type { RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

export const PINNED_THRESHOLD_PX = 80

export function computeIsPinned(metrics: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  const { scrollTop, scrollHeight, clientHeight } = metrics
  if (scrollHeight <= clientHeight) {
    return true
  }
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop
  return distanceFromBottom <= PINNED_THRESHOLD_PX
}

export function isLatestEntryNew(input: {
  previousId: string | undefined
  latestId: string | undefined
}): boolean {
  if (!input.latestId) return false
  return input.previousId !== input.latestId
}

export function latestTimelineContentSignal(item: SynapseAgentTimelineItem | undefined): string {
  if (!item) return "empty"
  switch (item.kind) {
    case "message":
      return `${item.kind}:${item.role}:${item.content.length}`
    case "thinking":
    case "result":
      return `${item.kind}:${item.content.length}`
    case "toolResult":
      return `${item.kind}:${item.toolName}:${item.status ?? "unknown"}:${String(item.success)}:${item.content?.length ?? 0}`
    case "toolCall":
      return `${item.kind}:${item.toolName}:${item.toolInput?.length ?? 0}`
    case "permissionRequest":
      return `${item.kind}:${item.requestId}:${item.toolName}:${item.toolInput?.length ?? 0}`
    case "error":
      return `${item.kind}:${item.message.length}`
    case "phase":
      return `${item.kind}:${item.runId}:${item.phase}:${item.status}:${item.errorMessage?.length ?? 0}`
    case "sdkEvent":
      return `${item.kind}:${item.sdkType}:${item.sdkSubtype ?? ""}:${item.summary?.length ?? 0}`
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

type ScrollOptions = { behavior?: ScrollBehavior }

export type UseStickToBottomReturn = {
  viewportRef: RefObject<HTMLDivElement | null>
  isPinned: boolean
  hasUnread: boolean
  scrollToBottom: (options?: ScrollOptions) => void
  forcePin: () => void
}

/**
 * Stick-to-bottom state machine for chat-style timelines.
 *
 * - `isPinned` reflects whether the viewport is within `PINNED_THRESHOLD_PX` of the bottom.
 * - When pinned and `contentSignal` changes, the viewport auto-scrolls to the bottom.
 * - When unpinned and a *new* entry (via `latestEntryId`) appears, `hasUnread` becomes true.
 * - Scrolling back into the threshold clears `hasUnread`.
 * - `forcePin()` is for scenarios where the user expects to see the latest
 *   (session switch, user-sent message, first mount).
 */
export function useStickToBottom(input: {
  contentSignal: ReadonlyArray<unknown>
  latestEntryId: string | undefined
}): UseStickToBottomReturn {
  const { contentSignal, latestEntryId } = input

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const isPinnedRef = useRef(true)
  const previousLatestIdRef = useRef<string | undefined>(undefined)
  const programmaticScrollUntilRef = useRef(0)

  const [isPinned, setIsPinned] = useState(true)
  const [hasUnread, setHasUnread] = useState(false)

  const performScrollToBottom = useCallback((options?: ScrollOptions) => {
    const viewport = viewportRef.current
    if (!viewport) return
    // Mark the next ~150ms of scroll events as programmatic so the listener
    // does not flip isPinned off mid-animation.
    programmaticScrollUntilRef.current = Date.now() + 150
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: options?.behavior ?? "auto",
    })
  }, [])

  const scrollToBottom = useCallback((options?: ScrollOptions) => {
    performScrollToBottom(options)
  }, [performScrollToBottom])

  const forcePin = useCallback(() => {
    isPinnedRef.current = true
    setIsPinned(true)
    setHasUnread(false)
    performScrollToBottom({ behavior: "auto" })
  }, [performScrollToBottom])

  // Subscribe to viewport scroll.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined

    let frame: number | null = null
    const onScroll = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (Date.now() < programmaticScrollUntilRef.current) {
          return
        }
        const next = computeIsPinned({
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        })
        if (next !== isPinnedRef.current) {
          isPinnedRef.current = next
          setIsPinned(next)
          if (next) {
            // User reached the bottom on their own → clear unread.
            setHasUnread(false)
          }
        }
      })
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      viewport.removeEventListener("scroll", onScroll)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])

  // React to content changes: auto-scroll if pinned, mark unread if a new entry arrived off-screen.
  useEffect(() => {
    const previousId = previousLatestIdRef.current
    previousLatestIdRef.current = latestEntryId
    const newEntryArrived = isLatestEntryNew({ previousId, latestId: latestEntryId })

    if (isPinnedRef.current) {
      const handle = window.requestAnimationFrame(() => {
        performScrollToBottom({ behavior: "auto" })
      })
      return () => window.cancelAnimationFrame(handle)
    }

    if (newEntryArrived) {
      setHasUnread(true)
    }
    return undefined
    // contentSignal members trigger this effect; latestEntryId is already part of contentSignal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, contentSignal)

  return { viewportRef, isPinned, hasUnread, scrollToBottom, forcePin }
}
