import type { Ref } from "react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { SynapseAgentTimelineItem } from "@/types/agent"

export const PINNED_THRESHOLD_PX = 80
export const HISTORY_LOAD_THRESHOLD_PX = 80
const PROGRAMMATIC_SCROLL_GUARD_MS = 600
const SCROLL_POSITION_EPSILON_PX = 1

type ScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

type ScrollPosition = {
  viewport: HTMLElement
  scrollTop: number
  maxScrollTop: number
}

function readScrollMetrics(viewport: HTMLElement): ScrollMetrics {
  return {
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
  }
}

export function computeIsPinned(metrics: ScrollMetrics): boolean {
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
  return computeIsPinned(readScrollMetrics(viewport))
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
    case "fileCheckpoint":
      return `${item.kind}:${item.checkpointId}:${item.status}:${item.files.length}`
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
  const lastScrollPositionRef = useRef<ScrollPosition | null>(null)
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

  const recordScrollPosition = useCallback((viewport: HTMLElement, metrics: ScrollMetrics) => {
    const previous = lastScrollPositionRef.current
    const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
    const sameViewport = previous?.viewport === viewport
    const clampedByResize = sameViewport
      && maxScrollTop < previous.maxScrollTop
      && previous.scrollTop > maxScrollTop
      && Math.abs(metrics.scrollTop - maxScrollTop) <= SCROLL_POSITION_EPSILON_PX
    lastScrollPositionRef.current = { viewport, scrollTop: metrics.scrollTop, maxScrollTop }
    return {
      scrollingUp: sameViewport && metrics.scrollTop < previous.scrollTop - SCROLL_POSITION_EPSILON_PX && !clampedByResize,
      positionChanged: sameViewport && Math.abs(metrics.scrollTop - previous.scrollTop) > SCROLL_POSITION_EPSILON_PX && !clampedByResize,
    }
  }, [])

  const performScrollToBottom = useCallback((options?: ScrollOptions, measured?: ScrollMetrics) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const metrics = measured ?? readScrollMetrics(viewport)
    const target = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
    // Mark the next smooth-scroll window as programmatic so the listener
    // does not flip isPinned off mid-animation.
    programmaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_GUARD_MS
    viewport.scrollTo({
      top: metrics.scrollHeight,
      behavior: options?.behavior ?? "auto",
    })
    // Instant scrolling clamps to this target; smooth scrolling starts from
    // the measured position and subsequent scroll events track its progress.
    lastScrollPositionRef.current = {
      viewport,
      scrollTop: options?.behavior === "smooth" ? metrics.scrollTop : target,
      maxScrollTop: target,
    }
  }, [])

  const followContent = useCallback(() => {
    if (!autoFollowRef.current || suppressNextContentChangeRef.current) return
    const viewport = viewportRef.current
    if (!viewport) return
    const metrics = readScrollMetrics(viewport)
    // Radix dragging writes scrollTop before the native scroll event arrives.
    // Honor that movement even when a streamed commit wins the event race.
    if (recordScrollPosition(viewport, metrics).scrollingUp) {
      pauseFollowing()
      return
    }
    const target = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
    if (Math.abs(metrics.scrollTop - target) <= SCROLL_POSITION_EPSILON_PX) {
      // Layout and ResizeObserver may report the same change. Keep the resize
      // baseline current without restarting scrolling or its input guard.
      return
    }
    performScrollToBottom({ behavior: "auto" }, metrics)
  }, [pauseFollowing, performScrollToBottom, recordScrollPosition])

  const scrollToBottom = useCallback((options?: ScrollOptions) => {
    autoFollowRef.current = true
    isPinnedRef.current = true
    setIsPinned(true)
    setHasUnread(false)
    performScrollToBottom(options)
  }, [performScrollToBottom])

  const forcePin = useCallback(() => {
    autoFollowRef.current = true
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
          recordScrollPosition(viewport, readScrollMetrics(viewport))
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
  }, [recordScrollPosition])
  loadOlderAtCurrentAnchorRef.current = loadOlderAtCurrentAnchor

  // Subscribe to viewport scroll.
  useEffect(() => {
    const viewport = viewportNode
    if (!viewport) return undefined

    let frame: number | null = null
    let pendingScroll: (ScrollMetrics & { scrollingUp: boolean; positionChanged: boolean }) | null = null
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
      const metrics = readScrollMetrics(viewport)
      const change = recordScrollPosition(viewport, metrics)
      pendingScroll = { ...metrics, ...change }
      // Scrollbar dragging has no wheel/key event. Pause at delivery, before a
      // layout effect can overwrite the user's position while this frame waits.
      if (change.scrollingUp) pauseFollowing()
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const scroll = pendingScroll
        if (!scroll) return
        if (scroll.scrollTop <= HISTORY_LOAD_THRESHOLD_PX) {
          loadOlderAtCurrentAnchor()
        }
        const now = Date.now()
        if (scroll.scrollingUp) return
        if (autoFollowRef.current && now < programmaticScrollUntilRef.current) {
          return
        }
        const next = computeIsPinned(scroll)
        if (!autoFollowRef.current) {
          if (next && scroll.positionChanged) {
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
  }, [loadOlderAtCurrentAnchor, pauseFollowing, recordScrollPosition, viewportNode])

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

  useLayoutEffect(() => {
    const viewport = viewportNode
    if (!viewport) return undefined

    followContent()

    if (typeof ResizeObserver === "undefined") {
      return undefined
    }

    // Both callbacks run before paint. Deferring to another animation frame
    // would expose the new content height with the old scroll position.
    const observer = new ResizeObserver(() => {
      if (viewport.clientHeight > 0) followContent()
    })
    observer.observe(viewport)
    // Radix ScrollArea keeps an intrinsic content wrapper inside its viewport.
    // Images, wrapping and collapsed groups can resize it without a new event.
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)

    return () => {
      observer.disconnect()
    }
  }, [followContent, viewportNode])

  // React to content changes: auto-scroll if pinned, mark unread if latest content changed off-screen.
  useLayoutEffect(() => {
    const previousId = previousLatestIdRef.current
    previousLatestIdRef.current = latestEntryId
    const newEntryArrived = isLatestEntryNew({ previousId, latestId: latestEntryId })

    if (suppressNextContentChangeRef.current) return undefined

    if (autoFollowRef.current) {
      followContent()
      if (autoFollowRef.current) return undefined
    }

    if (newEntryArrived || latestEntryId) {
      setHasUnread(true)
    }
    return undefined
    // contentSignal members trigger this effect; latestEntryId is already part of contentSignal.
  }, contentSignal)

  return { viewportRef: setViewportRef, isPinned, hasUnread, scrollToBottom, forcePin }
}
