import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type {
  DriveAnnotationThreadDto,
  DriveMarkdownProjectionDto,
} from '@synapse/shared'

const GEOMETRY_EPSILON = 0.5
export const DRIVE_EDITOR_COMMENT_IGNORED_SELECTOR = [
  '[data-toolbar-item="true"]',
  '[data-drive-markdown-comment-excluded="true"]',
].join(', ')
export const MILKDOWN_COMMENT_IGNORED_SELECTOR = [
  '.list-item > .label-wrapper',
  '.milkdown-code-block > .tools',
  '.milkdown-code-block > .preview-panel',
  '[data-type="html"]',
].join(', ')

type TextRange = { readonly start: number; readonly end: number }

type DriveEditorTextSegment = {
  readonly start: number
  readonly end: number
  readonly node: Text | null
  readonly utf16Offsets: readonly number[]
}

export type DriveEditorCommentOverlayRect = {
  readonly key: string
  readonly threadId: string
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export type DriveEditorCommentGeometry = {
  readonly anchorTopByThreadId: Readonly<Record<string, number | null>>
  readonly overlayRects: readonly DriveEditorCommentOverlayRect[]
  readonly naturalHeight: number
}

export type DriveEditorCommentGeometryInput = {
  readonly enabled: boolean
  readonly layoutKey: string
  readonly resetKey: string
  readonly threads: readonly DriveAnnotationThreadDto[]
  readonly projection: DriveMarkdownProjectionDto | null | undefined
  readonly imagePreviewUrls: ReadonlyMap<string, string | null>
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly contentHostRef: RefObject<HTMLDivElement | null>
  readonly contentRootSelector?: string
  readonly ignoredElementSelector?: string
}

const EMPTY_GEOMETRY: DriveEditorCommentGeometry = {
  anchorTopByThreadId: {},
  overlayRects: [],
  naturalHeight: 0,
}

export function useDriveEditorCommentGeometry(input: DriveEditorCommentGeometryInput) {
  const inputRef = useRef(input)
  inputRef.current = input
  const frameRef = useRef<number | null>(null)
  const modelDirtyRef = useRef(true)
  const geometryDirtyRef = useRef(true)
  const previousTextRef = useRef<string | null>(null)
  const workingRangesRef = useRef(new Map<string, TextRange | null>())
  const modelRef = useRef<DriveEditorTextModel | null>(null)
  const resetKeyRef = useRef(input.resetKey)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [geometry, setGeometry] = useState<DriveEditorCommentGeometry>(EMPTY_GEOMETRY)

  const measure = useCallback(() => {
    const current = inputRef.current
    const scroller = current.scrollRef.current
    const contentHost = current.contentHostRef.current
    const contentRoot = contentHost?.querySelector<HTMLElement>(current.contentRootSelector ?? '.drive-mdxeditor-content') ?? null
    if (!current.enabled || !scroller || !contentHost || !contentRoot) {
      setGeometry((existing) => sameGeometry(existing, EMPTY_GEOMETRY) ? existing : EMPTY_GEOMETRY)
      return
    }

    const reset = resetKeyRef.current !== current.resetKey
    if (reset) {
      resetKeyRef.current = current.resetKey
      previousTextRef.current = null
      workingRangesRef.current = new Map()
      modelDirtyRef.current = true
    }

    if (modelDirtyRef.current || !modelRef.current) {
      const nextModel = createDriveEditorTextModel(
        contentRoot,
        current.ignoredElementSelector ?? DRIVE_EDITOR_COMMENT_IGNORED_SELECTOR,
      )
      contentRoot.querySelectorAll('img').forEach((image) => resizeObserverRef.current?.observe(image))
      const previousText = previousTextRef.current
      if (previousText === null) {
        workingRangesRef.current = initialWorkingRanges(current.threads, nextModel.text)
      } else if (previousText !== nextModel.text) {
        workingRangesRef.current = mapWorkingRanges(previousText, nextModel.text, workingRangesRef.current)
      }
      previousTextRef.current = nextModel.text
      modelRef.current = nextModel
      modelDirtyRef.current = false
      geometryDirtyRef.current = true
    }

    if (!geometryDirtyRef.current || !modelRef.current) return
    const nextGeometry = measureGeometry({
      contentHost,
      contentRoot,
      imagePreviewUrls: current.imagePreviewUrls,
      model: modelRef.current,
      projection: current.projection,
      scroller,
      threads: current.threads,
      workingRanges: workingRangesRef.current,
    })
    geometryDirtyRef.current = false
    setGeometry((existing) => sameGeometry(existing, nextGeometry) ? existing : nextGeometry)
  }, [])

  const schedule = useCallback((modelDirty: boolean) => {
    if (modelDirty) modelDirtyRef.current = true
    geometryDirtyRef.current = true
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  const notifyEditorUpdate = useCallback(() => schedule(true), [schedule])
  const scheduleGeometry = useCallback(() => schedule(false), [schedule])

  useLayoutEffect(() => {
    const current = inputRef.current
    const scroller = current.scrollRef.current
    const contentHost = current.contentHostRef.current
    if (!current.enabled || !scroller || !contentHost) {
      previousTextRef.current = null
      workingRangesRef.current = new Map()
      modelRef.current = null
      modelDirtyRef.current = true
      geometryDirtyRef.current = true
      setGeometry((existing) => sameGeometry(existing, EMPTY_GEOMETRY) ? existing : EMPTY_GEOMETRY)
      return
    }

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => schedule(false))
    resizeObserverRef.current = resizeObserver
    resizeObserver?.observe(scroller)
    resizeObserver?.observe(contentHost)

    const contentRootSelector = current.contentRootSelector ?? '.drive-mdxeditor-content'
    let observedContentRoot: HTMLElement | null = null
    const updateObservedContentRoot = () => {
      const nextContentRoot = contentHost.querySelector<HTMLElement>(contentRootSelector)
      if (nextContentRoot === observedContentRoot) {
        nextContentRoot?.querySelectorAll('img').forEach((image) => resizeObserver?.observe(image))
        return false
      }
      if (observedContentRoot) {
        resizeObserver?.unobserve(observedContentRoot)
        observedContentRoot.querySelectorAll('img').forEach((image) => resizeObserver?.unobserve(image))
      }
      observedContentRoot = nextContentRoot
      if (nextContentRoot) {
        resizeObserver?.observe(nextContentRoot)
        nextContentRoot.querySelectorAll('img').forEach((image) => resizeObserver?.observe(image))
      }
      return true
    }
    const mutationObserver = new MutationObserver((records) => {
      const rootChanged = updateObservedContentRoot()
      const contentChanged = observedContentRoot !== null && records.some((record) => (
        record.target === observedContentRoot || observedContentRoot?.contains(record.target)
      ))
      if (rootChanged || contentChanged) schedule(true)
    })
    mutationObserver.observe(contentHost, { characterData: true, childList: true, subtree: true })

    const handleAssetLayout = () => schedule(false)
    const handleContentAssetLayout = (event: Event) => {
      if (event.target instanceof Node && observedContentRoot?.contains(event.target)) handleAssetLayout()
    }
    contentHost.addEventListener('load', handleContentAssetLayout, true)
    contentHost.addEventListener('error', handleContentAssetLayout, true)
    document.fonts?.addEventListener?.('loadingdone', handleAssetLayout)
    if (updateObservedContentRoot()) schedule(true)

    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      resizeObserverRef.current = null
      contentHost.removeEventListener('load', handleContentAssetLayout, true)
      contentHost.removeEventListener('error', handleContentAssetLayout, true)
      document.fonts?.removeEventListener?.('loadingdone', handleAssetLayout)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [input.enabled, input.layoutKey, input.resetKey, schedule])

  return { geometry, notifyEditorUpdate, scheduleGeometry }
}

export function useMilkdownCommentGeometry(input: Omit<DriveEditorCommentGeometryInput, 'contentRootSelector' | 'ignoredElementSelector'>) {
  return useDriveEditorCommentGeometry({
    ...input,
    contentRootSelector: '.milkdown .ProseMirror',
    ignoredElementSelector: MILKDOWN_COMMENT_IGNORED_SELECTOR,
  })
}

export type DriveEditorTextModel = {
  readonly text: string
  readonly segments: readonly DriveEditorTextSegment[]
}

export function createDriveEditorTextModel(
  root: HTMLElement,
  ignoredElementSelector = DRIVE_EDITOR_COMMENT_IGNORED_SELECTOR,
): DriveEditorTextModel {
  const values: string[] = []
  const segments: DriveEditorTextSegment[] = []
  let cursor = 0

  const appendText = (node: Text) => {
    const value = node.data
    if (!value) return
    const utf16Offsets = codePointUtf16Offsets(value)
    const length = utf16Offsets.length - 1
    segments.push({ start: cursor, end: cursor + length, node, utf16Offsets })
    values.push(value)
    cursor += length
  }
  const appendSynthetic = (value: string) => {
    if (!value) return
    const length = Array.from(value).length
    segments.push({ start: cursor, end: cursor + length, node: null, utf16Offsets: [] })
    values.push(value)
    cursor += length
  }
  const visit = (node: Node) => {
    if (node instanceof Text) {
      appendText(node)
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (
      node.hidden
      || node.getAttribute('aria-hidden') === 'true'
      || node.matches('.cm-gutters, textarea')
      || (ignoredElementSelector && node.matches(ignoredElementSelector))
    ) return
    if (node instanceof HTMLImageElement) {
      appendSynthetic(node.alt)
      return
    }
    if (node.tagName === 'BR') {
      if (isEditorPlaceholderBreak(node, ignoredElementSelector)) return
      appendSynthetic('\n')
      return
    }
    if (node.classList.contains('cm-content')) {
      const lines = Array.from(node.querySelectorAll<HTMLElement>(':scope > .cm-line'))
      appendSynthetic(lines.map((line) => line.textContent ?? '').join('\n'))
      return
    }
    node.childNodes.forEach(visit)
  }

  root.childNodes.forEach(visit)
  return { text: values.join(''), segments }
}

function isEditorPlaceholderBreak(node: HTMLElement, ignoredElementSelector: string): boolean {
  if (node.classList.contains('ProseMirror-trailingBreak')) return true
  const parent = node.parentElement
  if (!parent || parent.tagName !== 'P') return false
  const siblings = Array.from(parent.childNodes).filter((sibling) => sibling !== node)
  if (siblings.length === 0) return true
  return siblings.every((sibling) => (
    sibling instanceof HTMLElement
    && (
      sibling.matches('[data-lexical-decorator="true"]')
      || sibling.matches(ignoredElementSelector)
    )
  ))
}

export function mapWorkingRange(
  previousText: string,
  nextText: string,
  range: TextRange,
): TextRange | null {
  const previous = Array.from(previousText)
  const next = Array.from(nextText)
  let prefix = 0
  const sharedLimit = Math.min(previous.length, next.length)
  while (prefix < sharedLimit && previous[prefix] === next[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix += 1

  const previousChangeEnd = previous.length - suffix
  if (range.end <= prefix) return range
  if (range.start >= previousChangeEnd) {
    const delta = next.length - previous.length
    return { start: range.start + delta, end: range.end + delta }
  }
  return null
}

function mapWorkingRanges(
  previousText: string,
  nextText: string,
  ranges: ReadonlyMap<string, TextRange | null>,
): Map<string, TextRange | null> {
  return new Map([...ranges].map(([threadId, range]) => [
    threadId,
    range ? mapWorkingRange(previousText, nextText, range) : null,
  ]))
}

function initialWorkingRanges(
  threads: readonly DriveAnnotationThreadDto[],
  renderedText: string,
): Map<string, TextRange | null> {
  const renderedLength = Array.from(renderedText).length
  return new Map(threads.map((thread) => {
    if (thread.anchorStatus === 'orphaned' || thread.target.kind !== 'textRange') return [thread.id, null]
    const range = thread.anchor?.resolvedRenderedRange
    if (!range || range.end <= range.start || range.start < 0 || range.end > renderedLength) return [thread.id, null]
    if (thread.anchor?.quoteStatus !== 'exact') return [thread.id, range]
    const exact = Array.from(renderedText).slice(range.start, range.end).join('')
    return [thread.id, exact === thread.target.quote.exact ? range : null]
  }))
}

function measureGeometry(input: {
  readonly contentHost: HTMLElement
  readonly contentRoot: HTMLElement
  readonly imagePreviewUrls: ReadonlyMap<string, string | null>
  readonly model: DriveEditorTextModel
  readonly projection: DriveMarkdownProjectionDto | null | undefined
  readonly scroller: HTMLElement
  readonly threads: readonly DriveAnnotationThreadDto[]
  readonly workingRanges: ReadonlyMap<string, TextRange | null>
}): DriveEditorCommentGeometry {
  const hostRect = input.contentHost.getBoundingClientRect()
  const scrollerRect = input.scroller.getBoundingClientRect()
  const anchorTopByThreadId: Record<string, number | null> = {}
  const overlayRects: DriveEditorCommentOverlayRect[] = []
  const measuredRanges = new Map<string, readonly DOMRect[]>()

  for (const thread of input.threads) {
    if (thread.anchorStatus === 'orphaned') {
      anchorTopByThreadId[thread.id] = null
      continue
    }
    if (thread.target.kind === 'image') {
      const image = findDriveEditorCommentImage(input.contentRoot, thread, input.projection, input.imagePreviewUrls)
      if (!image) {
        anchorTopByThreadId[thread.id] = null
        continue
      }
      const rect = image.getBoundingClientRect()
      anchorTopByThreadId[thread.id] = rect.top - scrollerRect.top + input.scroller.scrollTop
      overlayRects.push(toOverlayRect(`${thread.id}-image`, thread.id, rect, hostRect))
      continue
    }

    const range = input.workingRanges.get(thread.id) ?? null
    if (!range) {
      anchorTopByThreadId[thread.id] = null
      continue
    }
    const rangeKey = `${range.start}:${range.end}`
    let rects = measuredRanges.get(rangeKey)
    if (!rects) {
      rects = measureTextRange(input.model, range)
      measuredRanges.set(rangeKey, rects)
    }
    const first = rects[0]
    if (!first) {
      anchorTopByThreadId[thread.id] = null
      continue
    }
    anchorTopByThreadId[thread.id] = first.top - scrollerRect.top + input.scroller.scrollTop
    rects.forEach((rect, index) => {
      overlayRects.push(toOverlayRect(`${thread.id}-${index}`, thread.id, rect, hostRect))
    })
  }

  return {
    anchorTopByThreadId,
    overlayRects,
    naturalHeight: input.contentHost.getBoundingClientRect().height,
  }
}

function measureTextRange(model: DriveEditorTextModel, range: TextRange): readonly DOMRect[] {
  const start = findBoundary(model.segments, range.start, 'start')
  const end = findBoundary(model.segments, range.end, 'end')
  if (!start || !end || !start.segment.node || !end.segment.node) return []
  if (model.segments.some((segment) => segment.node === null && segment.start < range.end && segment.end > range.start)) return []

  const domRange = document.createRange()
  domRange.setStart(start.segment.node, start.segment.utf16Offsets[start.offset] ?? 0)
  domRange.setEnd(end.segment.node, end.segment.utf16Offsets[end.offset] ?? end.segment.node.length)
  return Array.from(domRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
}

function findBoundary(
  segments: readonly DriveEditorTextSegment[],
  offset: number,
  bias: 'start' | 'end',
): { readonly segment: DriveEditorTextSegment; readonly offset: number } | null {
  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]
    const before = bias === 'start' ? offset >= segment.end : offset > segment.end
    if (before) {
      low = middle + 1
    } else if (offset < segment.start) {
      high = middle - 1
    } else {
      return { segment, offset: Math.max(0, Math.min(offset - segment.start, segment.end - segment.start)) }
    }
  }
  return null
}

export function findDriveEditorCommentImage(
  root: HTMLElement,
  thread: DriveAnnotationThreadDto,
  projection: DriveMarkdownProjectionDto | null | undefined,
  imagePreviewUrls: ReadonlyMap<string, string | null>,
): HTMLImageElement | null {
  if (thread.target.kind !== 'image') return null
  const target = thread.target
  const projectionImage = projection?.images?.find((image) => image.imageId === target.imageId)
  if (!projectionImage || !projection?.images) return null
  if (projectionImage.resourceKey !== target.resourceKey) return null
  const authoredSource = projectionImage.source
  const previewSource = imagePreviewUrls.get(authoredSource) ?? authoredSource
  const matching = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'))
    .filter((image) => sameImageSource(image, previewSource))
  const projectedMatches = projection.images
    .filter((image) => image.resourceKey === projectionImage.resourceKey)
  if (matching.length !== projectedMatches.length) return null
  if (projectedMatches.length === 1) return matching[0] ?? null
  // Editor DOM has no imageId. Metadata only proves that a distinguishable duplicate sequence is unchanged.
  const targetDescriptorMatches = projectedMatches
    .filter((image) => sameProjectedImageDescriptor(image, projectionImage, imagePreviewUrls))
  if (targetDescriptorMatches.length !== 1) return null
  if (projectedMatches.some((image, index) => !sameProjectedImage(matching[index], image, imagePreviewUrls))) return null
  const ordinal = projectedMatches
    .filter((image) => image.documentIndex < projectionImage.documentIndex)
    .length
  return matching[ordinal] ?? null
}

function sameProjectedImageDescriptor(
  left: NonNullable<DriveMarkdownProjectionDto['images']>[number],
  right: NonNullable<DriveMarkdownProjectionDto['images']>[number],
  imagePreviewUrls: ReadonlyMap<string, string | null>,
): boolean {
  const leftSource = imagePreviewUrls.get(left.source) ?? left.source
  const rightSource = imagePreviewUrls.get(right.source) ?? right.source
  return sameImageSourceValue(leftSource, rightSource)
    && left.alt === right.alt
    && left.title === right.title
}

function sameProjectedImage(
  image: HTMLImageElement | undefined,
  projected: NonNullable<DriveMarkdownProjectionDto['images']>[number],
  imagePreviewUrls: ReadonlyMap<string, string | null>,
): boolean {
  if (!image) return false
  const previewSource = imagePreviewUrls.get(projected.source) ?? projected.source
  return sameImageSource(image, previewSource)
    && image.alt === projected.alt
    && image.getAttribute('title') === projected.title
}

function sameImageSource(image: HTMLImageElement, expected: string): boolean {
  const authored = image.getAttribute('src') ?? ''
  if (authored === expected || image.currentSrc === expected) return true
  return sameImageSourceValue(authored, expected)
}

function sameImageSourceValue(actual: string, expected: string): boolean {
  try {
    return new URL(actual, document.baseURI).href === new URL(expected, document.baseURI).href
  } catch {
    return false
  }
}

function toOverlayRect(
  key: string,
  threadId: string,
  rect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>,
  hostRect: Pick<DOMRect, 'top' | 'left'>,
): DriveEditorCommentOverlayRect {
  return {
    key,
    threadId,
    top: rect.top - hostRect.top,
    left: rect.left - hostRect.left,
    width: rect.width,
    height: rect.height,
  }
}

function codePointUtf16Offsets(value: string): readonly number[] {
  const offsets = [0]
  let utf16Offset = 0
  for (const codePoint of Array.from(value)) {
    utf16Offset += codePoint.length
    offsets.push(utf16Offset)
  }
  return offsets
}

function sameGeometry(left: DriveEditorCommentGeometry, right: DriveEditorCommentGeometry): boolean {
  if (!near(left.naturalHeight, right.naturalHeight)) return false
  const leftEntries = Object.entries(left.anchorTopByThreadId)
  const rightEntries = Object.entries(right.anchorTopByThreadId)
  if (leftEntries.length !== rightEntries.length) return false
  for (const [threadId, leftTop] of leftEntries) {
    const rightTop = right.anchorTopByThreadId[threadId]
    if (leftTop === null || rightTop === null) {
      if (leftTop !== rightTop) return false
    } else if (!near(leftTop, rightTop)) return false
  }
  if (left.overlayRects.length !== right.overlayRects.length) return false
  return left.overlayRects.every((rect, index) => {
    const other = right.overlayRects[index]
    return rect.key === other?.key
      && rect.threadId === other.threadId
      && near(rect.top, other.top)
      && near(rect.left, other.left)
      && near(rect.width, other.width)
      && near(rect.height, other.height)
  })
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) < GEOMETRY_EPSILON
}
