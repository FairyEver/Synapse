import type { Ref } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

export const PINNED_THRESHOLD_PX = 80
const PROGRAMMATIC_SCROLL_GUARD_MS = 600

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
  viewportRef: Ref<HTMLDivElement>
  isPinned: boolean
  hasUnread: boolean
  scrollToBottom: (options?: ScrollOptions) => void
  forcePin: () => void
}

/**
 * Stick-to-bottom state machine for chat-style timelines.
 *
 * - `autoFollow` is the single source of truth for automatic scrolling.
 * - Entering/sending/jump-to-bottom enables `autoFollow`.
 * - User scroll intent disables `autoFollow`.
 * - Content changes scroll only while `autoFollow` is enabled.
 */
export function useStickToBottom(input: {
  contentSignal: ReadonlyArray<unknown>
  latestEntryId: string | undefined
}): UseStickToBottomReturn {
  const { contentSignal, latestEntryId } = input

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null)
  const autoFollowRef = useRef(true)
  const isPinnedRef = useRef(true)
  const previousLatestIdRef = useRef<string | undefined>(undefined)
  const programmaticScrollUntilRef = useRef(0)
  const lastTouchYRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const instantNextScrollRef = useRef(false)

  const [isPinned, setIsPinned] = useState(true)
  const [hasUnread, setHasUnread] = useState(false)

  const setViewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node
    setViewportNode(node)
  }, [])

  const pauseFollowing = useCallback(() => {
    autoFollowRef.current = false
    programmaticScrollUntilRef.current = 0
    if (isPinnedRef.current) {
      isPinnedRef.current = false
      setIsPinned(false)
    }
  }, [])

  const performScrollToBottom = useCallback((options?: ScrollOptions) => {
    const viewport = viewportRef.current
    if (!viewport) return
    // Mark the next smooth-scroll window as programmatic so the listener
    // does not flip isPinned off mid-animation.
    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_GUARD_MS
    lastScrollTopRef.current = viewport.scrollTop
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: options?.behavior ?? "auto",
    })
  }, [])

  const scrollToBottom = useCallback((options?: ScrollOptions) => {
    autoFollowRef.current = true
    isPinnedRef.current = true
    setIsPinned(true)
    setHasUnread(false)
    performScrollToBottom(options)
  }, [performScrollToBottom])

  const forcePin = useCallback(() => {
    autoFollowRef.current = true
    instantNextScrollRef.current = true
    isPinnedRef.current = true
    setIsPinned(true)
    setHasUnread(false)
    performScrollToBottom({ behavior: "auto" })
  }, [performScrollToBottom])

  // Subscribe to viewport scroll.
  useEffect(() => {
    const viewport = viewportNode
    if (!viewport) return undefined

    let frame: number | null = null
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) {
        pauseFollowing()
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null
    }

    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY
      const previousY = lastTouchYRef.current
      if (typeof nextY === "number" && typeof previousY === "number" && nextY !== previousY) {
        pauseFollowing()
      }
      lastTouchYRef.current = typeof nextY === "number" ? nextY : null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp"
        || event.key === "ArrowDown"
        || event.key === "PageUp"
        || event.key === "PageDown"
        || event.key === "Home"
        || event.key === "End"
        || event.key === " "
      ) {
        pauseFollowing()
      }
    }

    const onScroll = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const now = Date.now()
        const scrollingUp = viewport.scrollTop < lastScrollTopRef.current
        lastScrollTopRef.current = viewport.scrollTop
        if (scrollingUp) {
          pauseFollowing()
          return
        }
        if (autoFollowRef.current && now < programmaticScrollUntilRef.current) {
          return
        }
        const next = computeIsPinned({
          scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight,
          clientHeight: viewport.clientHeight,
        })
        if (!autoFollowRef.current) {
          if (isPinnedRef.current) {
            isPinnedRef.current = false
            setIsPinned(false)
          }
          return
        }
        if (!next) {
          autoFollowRef.current = false
          isPinnedRef.current = false
          setIsPinned(false)
          return
        }
        if (!isPinnedRef.current) {
          isPinnedRef.current = true
          setIsPinned(true)
        }
        setHasUnread(false)
      })
    }

    window.addEventListener("wheel", onWheel, { capture: true, passive: true })
    viewport.addEventListener("touchstart", onTouchStart, { passive: true })
    viewport.addEventListener("touchmove", onTouchMove, { passive: true })
    viewport.addEventListener("keydown", onKeyDown)
    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true })
      viewport.removeEventListener("touchstart", onTouchStart)
      viewport.removeEventListener("touchmove", onTouchMove)
      viewport.removeEventListener("keydown", onKeyDown)
      viewport.removeEventListener("scroll", onScroll)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [pauseFollowing, viewportNode])

  // React to content changes: auto-scroll if pinned, mark unread if latest content changed off-screen.
  useEffect(() => {
    const previousId = previousLatestIdRef.current
    previousLatestIdRef.current = latestEntryId
    const newEntryArrived = isLatestEntryNew({ previousId, latestId: latestEntryId })

    if (autoFollowRef.current) {
      const handle = window.requestAnimationFrame(() => {
        const behavior = instantNextScrollRef.current ? "auto" : "smooth"
        instantNextScrollRef.current = false
        performScrollToBottom({ behavior })
      })
      return () => window.cancelAnimationFrame(handle)
    }

    if (newEntryArrived || latestEntryId) {
      setHasUnread(true)
    }
    return undefined
    // contentSignal members trigger this effect; latestEntryId is already part of contentSignal.
  }, contentSignal)

  return { viewportRef: setViewportRef, isPinned, hasUnread, scrollToBottom, forcePin }
}
