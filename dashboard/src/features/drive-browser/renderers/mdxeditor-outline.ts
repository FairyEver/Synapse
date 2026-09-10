import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { DriveMarkdownOutlineItemDto } from '@synapse/shared'
import { flattenDriveDocumentOutline } from './drive-document-outline'

const EDITOR_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
const EDITOR_CONTENT_ROOT_SELECTOR = '.drive-mdxeditor-content'
const EDITOR_TOOLBAR_SELECTOR = '.mdxeditor-toolbar'
const EDITOR_HEADING_ID_PREFIX = 'mdxeditor-heading-'
const OUTLINE_HEADING_GAP = 24
const HEADING_POSITION_EPSILON = 1

type MutableOutlineItem = {
  id: string
  text: string
  depth: number
  children: MutableOutlineItem[]
}

export type DriveMdxEditorOutlineController = {
  readonly activeItemId: string | null
  readonly compactOpen: boolean
  readonly enabled: boolean
  readonly items: readonly DriveMarkdownOutlineItemDto[]
  readonly open: boolean
  readonly outlineScrollRef: RefObject<HTMLElement | null>
  readonly handleContentHostChange: (element: HTMLDivElement | null) => void
  readonly handleEditorScroll: () => void
  readonly notifyEditorUpdate: () => void
  readonly selectItem: (itemId: string) => void
  readonly setPanelOpen: (open: boolean) => void
}

export function useDriveMdxEditorOutline({
  enabled,
  isCompact,
  scrollRef,
  stateResetKey,
}: {
  readonly enabled: boolean
  readonly isCompact: boolean
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly stateResetKey: string
}): DriveMdxEditorOutlineController {
  const headingElementsRef = useRef(new Map<string, HTMLElement>())
  const outlineFrameRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const outlineScrollRef = useRef<HTMLElement | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)
  const contentObserverRef = useRef<MutationObserver | null>(null)
  const [items, setItems] = useState<readonly DriveMarkdownOutlineItemDto[]>([])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [compactOpen, setCompactOpen] = useState(false)
  const flatItems = useMemo(() => flattenDriveDocumentOutline(items), [items])

  const updateActiveItem = useCallback((nextItems: readonly DriveMarkdownOutlineItemDto[]) => {
    const scroller = scrollRef.current
    if (!scroller || nextItems.length === 0) {
      setActiveItemId(null)
      return
    }
    const threshold = editorHeadingViewportTop(scroller, contentHostRef.current)
    let nextActiveId = nextItems[0]?.id ?? null
    for (const item of nextItems) {
      const heading = headingElementsRef.current.get(item.id)
      if (!heading) continue
      if (heading.getBoundingClientRect().top > threshold + HEADING_POSITION_EPSILON) break
      nextActiveId = item.id
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
      nextActiveId = nextItems[nextItems.length - 1]?.id ?? nextActiveId
    }
    setActiveItemId((current) => current === nextActiveId ? current : nextActiveId)
  }, [scrollRef])

  const refreshOutline = useCallback(() => {
    outlineFrameRef.current = null
    if (!enabled) return
    const contentRoot = contentHostRef.current?.querySelector<HTMLElement>(EDITOR_CONTENT_ROOT_SELECTOR)
    if (!contentRoot) return
    const nextElements = new Map<string, HTMLElement>()
    const flatOutline = Array.from(contentRoot.querySelectorAll<HTMLElement>(EDITOR_HEADING_SELECTOR))
      .flatMap((heading, index) => {
        const text = normalizeHeadingText(heading.textContent ?? '')
        if (!text) return []
        const id = `${EDITOR_HEADING_ID_PREFIX}${index + 1}`
        nextElements.set(id, heading)
        return [{ id, text, depth: Number(heading.tagName.slice(1)), children: [] } satisfies MutableOutlineItem]
      })
    const nextItems = nestOutlineItems(flatOutline)
    headingElementsRef.current = nextElements
    setItems((current) => outlineItemsEqual(current, nextItems) ? current : nextItems)
    updateActiveItem(flatOutline)
  }, [enabled, updateActiveItem])

  const notifyEditorUpdate = useCallback(() => {
    if (!enabled || outlineFrameRef.current !== null) return
    outlineFrameRef.current = window.requestAnimationFrame(refreshOutline)
  }, [enabled, refreshOutline])

  const observeContentHost = useCallback((element: HTMLDivElement | null) => {
    contentObserverRef.current?.disconnect()
    contentObserverRef.current = null
    if (!enabled || !element) return
    notifyEditorUpdate()
    const observer = new MutationObserver(notifyEditorUpdate)
    observer.observe(element, { characterData: true, childList: true, subtree: true })
    contentObserverRef.current = observer
  }, [enabled, notifyEditorUpdate])

  const handleContentHostChange = useCallback((element: HTMLDivElement | null) => {
    contentHostRef.current = element
    observeContentHost(element)
  }, [observeContentHost])

  const handleEditorScroll = useCallback(() => {
    if (!enabled || scrollFrameRef.current !== null) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      updateActiveItem(flatItems)
    })
  }, [enabled, flatItems, updateActiveItem])

  const selectItem = useCallback((itemId: string) => {
    const scroller = scrollRef.current
    const heading = headingElementsRef.current.get(itemId)
    if (!scroller || !heading) return
    const top = Math.max(
      0,
      scroller.scrollTop
        + heading.getBoundingClientRect().top
        - editorHeadingViewportTop(scroller, contentHostRef.current),
    )
    setActiveItemId(itemId)
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'instant' })
    else scroller.scrollTop = top
    if (isCompact) setCompactOpen(false)
  }, [isCompact, scrollRef])

  const setPanelOpen = useCallback((nextOpen: boolean) => {
    if (isCompact) setCompactOpen(nextOpen)
    else setOpen(nextOpen)
  }, [isCompact])

  useLayoutEffect(() => {
    setItems([])
    setActiveItemId(null)
    setOpen(true)
    setCompactOpen(false)
    headingElementsRef.current.clear()
  }, [stateResetKey])

  useEffect(() => {
    observeContentHost(contentHostRef.current)
    return () => {
      contentObserverRef.current?.disconnect()
      contentObserverRef.current = null
    }
  }, [observeContentHost, stateResetKey])

  useEffect(() => {
    if (!activeItemId) return
    const outlineScroller = outlineScrollRef.current
    const activeLink = outlineScroller
      ? Array.from(outlineScroller.querySelectorAll<HTMLElement>('[data-markdown-outline-id]'))
        .find((element) => element.dataset.markdownOutlineId === activeItemId)
      : null
    if (!outlineScroller || !activeLink) return
    const scrollerRect = outlineScroller.getBoundingClientRect()
    const linkRect = activeLink.getBoundingClientRect()
    if (linkRect.top < scrollerRect.top) {
      outlineScroller.scrollTop += linkRect.top - scrollerRect.top
    } else if (linkRect.bottom > scrollerRect.bottom) {
      outlineScroller.scrollTop += linkRect.bottom - scrollerRect.bottom
    }
  }, [activeItemId, compactOpen, open])

  useEffect(() => () => {
    if (outlineFrameRef.current !== null) {
      window.cancelAnimationFrame(outlineFrameRef.current)
      outlineFrameRef.current = null
    }
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
  }, [])

  return {
    activeItemId,
    compactOpen,
    enabled: enabled && items.length > 0,
    items,
    open,
    outlineScrollRef,
    handleContentHostChange,
    handleEditorScroll,
    notifyEditorUpdate,
    selectItem,
    setPanelOpen,
  }
}

function editorHeadingViewportTop(scroller: HTMLElement, contentHost: HTMLElement | null): number {
  const scrollerTop = scroller.getBoundingClientRect().top
  const toolbarBottom = contentHost
    ?.querySelector<HTMLElement>(EDITOR_TOOLBAR_SELECTOR)
    ?.getBoundingClientRect().bottom ?? scrollerTop
  return Math.max(scrollerTop, toolbarBottom) + OUTLINE_HEADING_GAP
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function nestOutlineItems(flatItems: readonly MutableOutlineItem[]): readonly DriveMarkdownOutlineItemDto[] {
  const roots: MutableOutlineItem[] = []
  for (const item of flatItems) {
    let siblings = roots
    while (true) {
      const parent = siblings[siblings.length - 1]
      if (!parent || parent.depth >= item.depth) {
        siblings.push(item)
        break
      }
      siblings = parent.children
    }
  }
  return roots
}

function outlineItemsEqual(
  left: readonly DriveMarkdownOutlineItemDto[],
  right: readonly DriveMarkdownOutlineItemDto[],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return Boolean(other)
      && item.id === other.id
      && item.text === other.text
      && item.depth === other.depth
      && outlineItemsEqual(item.children, other.children)
  })
}
