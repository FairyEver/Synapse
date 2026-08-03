import type { Ref } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

export const PINNED_THRESHOLD_PX = 80
export const HISTORY_LOAD_THRESHOLD_PX = 80
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

function isEventInsideViewport(event: WheelEvent, viewport: HTMLElement): boolean {
  const rect = viewport.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return true
  }
  return event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom
}

function isViewportPinned(viewport: HTMLElement): boolean {
  return computeIsPinned({
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
  })
}

function isViewportScrollable(viewport: HTMLElement): boolean {
  return viewport.scrollHeight > viewport.clientHeight
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
    case "toolProgress":
      return `${item.kind}:${item.toolName}:${item.status}:${item.inputCharCount}`
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
  hasOlderEntries?: boolean
  loadingOlderEntries?: boolean
  historyLoadBlocked?: boolean
  onLoadOlder?: () => Promise<void>
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
  const olderLoadInFlightRef = useRef(false)
  const suppressNextContentChangeRef = useRef(false)
  const loadOlderAtCurrentAnchorRef = useRef<() => void>(() => {})
  const historyInputRef = useRef({
    hasOlderEntries: input.hasOlderEntries ?? false,
    loadingOlderEntries: input.loadingOlderEntries ?? false,
    historyLoadBlocked: input.historyLoadBlocked ?? false,
    onLoadOlder: input.onLoadOlder,
  })
  historyInputRef.current = {
    hasOlderEntries: input.hasOlderEntries ?? false,
    loadingOlderEntries: input.loadingOlderEntries ?? false,
    historyLoadBlocked: input.historyLoadBlocked ?? false,
    onLoadOlder: input.onLoadOlder,
  }

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

  const scheduleFollowScroll = useCallback(() => {
    const handle = window.requestAnimationFrame(() => {
      if (!autoFollowRef.current) return
      performScrollToBottom({ behavior: "auto" })
    })
    return () => window.cancelAnimationFrame(handle)
  }, [performScrollToBottom])

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

  const loadOlderAtCurrentAnchor = useCallback(() => {
    const viewport = viewportRef.current
    const historyInput = historyInputRef.current
    if (
      !viewport
      || olderLoadInFlightRef.current
      || historyInput.loadingOlderEntries
      || historyInput.historyLoadBlocked
      || !historyInput.hasOlderEntries
      || !historyInput.onLoadOlder
    ) return

    olderLoadInFlightRef.current = true
    suppressNextContentChangeRef.current = true
    const previousScrollHeight = viewport.scrollHeight
    const previousScrollTop = viewport.scrollTop
    void historyInput.onLoadOlder().catch(() => undefined).finally(() => {
      window.requestAnimationFrame(() => {
        const restore = () => {
          const nextScrollTop = previousScrollTop + viewport.scrollHeight - previousScrollHeight
          viewport.scrollTop = Math.max(0, nextScrollTop)
          lastScrollTopRef.current = viewport.scrollTop
        }
        restore()
        window.requestAnimationFrame(() => {
          restore()
          suppressNextContentChangeRef.current = false
          olderLoadInFlightRef.current = false
          if (viewport.clientHeight > 0 && viewport.scrollHeight <= viewport.clientHeight) {
            window.requestAnimationFrame(() => loadOlderAtCurrentAnchorRef.current())
          }
        })
      })
    })
  }, [])
  loadOlderAtCurrentAnchorRef.current = loadOlderAtCurrentAnchor

  // Subscribe to viewport scroll.
  useEffect(() => {
    const viewport = viewportNode
    if (!viewport) return undefined

    let frame: number | null = null
    const onWheel = (event: WheelEvent) => {
      if (
        event.deltaY !== 0
        && isEventInsideViewport(event, viewport)
        && isViewportScrollable(viewport)
        && (event.deltaY < 0 || !isViewportPinned(viewport))
      ) {
        pauseFollowing()
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null
    }

    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY
      const previousY = lastTouchYRef.current
      if (
        typeof nextY === "number"
        && typeof previousY === "number"
        && nextY !== previousY
        && isViewportScrollable(viewport)
      ) {
        pauseFollowing()
      }
      lastTouchYRef.current = typeof nextY === "number" ? nextY : null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isViewportScrollable(viewport)) return
      const scrollsUp =
        event.key === "ArrowUp"
        || event.key === "PageUp"
        || event.key === "Home"
        || (event.key === " " && event.shiftKey)
      const scrollsDown =
        event.key === "ArrowDown"
        || event.key === "PageDown"
        || event.key === "End"
        || (event.key === " " && !event.shiftKey)
      if (scrollsUp || (scrollsDown && !isViewportPinned(viewport))) {
        pauseFollowing()
      }
    }

    const onScroll = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (viewport.scrollTop <= HISTORY_LOAD_THRESHOLD_PX) {
          loadOlderAtCurrentAnchor()
        }
        const now = Date.now()
        const previousScrollTop = lastScrollTopRef.current
        const scrollingUp = viewport.scrollTop < previousScrollTop
        const scrollPositionChanged = viewport.scrollTop !== previousScrollTop
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
          if (next && scrollPositionChanged) {
            autoFollowRef.current = true
            isPinnedRef.current = true
            setIsPinned(true)
            setHasUnread(false)
            return
          }
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
  }, [loadOlderAtCurrentAnchor, pauseFollowing, viewportNode])

  useEffect(() => {
    const viewport = viewportNode
    if (
      !viewport
      || !input.hasOlderEntries
      || input.loadingOlderEntries
      || input.historyLoadBlocked
    ) return undefined
    const frame = window.requestAnimationFrame(() => {
      if (viewport.clientHeight > 0 && viewport.scrollHeight <= viewport.clientHeight) {
        loadOlderAtCurrentAnchor()
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    input.hasOlderEntries,
    input.historyLoadBlocked,
    input.loadingOlderEntries,
    loadOlderAtCurrentAnchor,
    viewportNode,
    ...contentSignal,
  ])

  useEffect(() => {
    const viewport = viewportNode
    if (!viewport) return undefined

    const cancelFollowScroll = autoFollowRef.current
      ? scheduleFollowScroll()
      : undefined

    if (typeof ResizeObserver === "undefined") {
      return cancelFollowScroll
    }

    let cancelResizeScroll: (() => void) | undefined
    const observer = new ResizeObserver(() => {
      if (!autoFollowRef.current || viewport.clientHeight <= 0) return
      cancelResizeScroll?.()
      cancelResizeScroll = scheduleFollowScroll()
    })
    observer.observe(viewport)

    return () => {
      cancelFollowScroll?.()
      cancelResizeScroll?.()
      observer.disconnect()
    }
  }, [scheduleFollowScroll, viewportNode])

  // React to content changes: auto-scroll if pinned, mark unread if latest content changed off-screen.
  useEffect(() => {
    const previousId = previousLatestIdRef.current
    previousLatestIdRef.current = latestEntryId
    const newEntryArrived = isLatestEntryNew({ previousId, latestId: latestEntryId })

    if (suppressNextContentChangeRef.current) return undefined

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
