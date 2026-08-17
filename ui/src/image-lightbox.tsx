import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react"
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react"

const ZOOM_STEP = 1.25
const MIN_SCALE = 0.1
const MAX_SCALE = 5
const SCALE_EPSILON = 0.001
const BACKGROUND_CLICK_MOVEMENT_TOLERANCE = 4

type Point = {
  readonly x: number
  readonly y: number
}

type Size = {
  readonly width: number
  readonly height: number
}

type ViewerTransform = Point & {
  readonly scale: number
}

export type ImageLightboxItem = {
  readonly alt: string
  readonly src: string
}

export type ImageLightboxPreview = {
  readonly images: readonly ImageLightboxItem[]
  readonly initialIndex: number
  readonly trigger: HTMLElement
}

export type ImageLightboxProps = {
  readonly preview: ImageLightboxPreview
  readonly onClose: () => void
}

export type ImageLightboxPrimitives = {
  readonly Button: React.ElementType
  readonly Dialog: React.ElementType
  readonly DialogClose: React.ElementType
  readonly DialogContent: React.ElementType
  readonly DialogTitle: React.ElementType
  readonly Tooltip: React.ElementType
  readonly TooltipContent: React.ElementType
  readonly TooltipProvider: React.ElementType
  readonly TooltipTrigger: React.ElementType
}

type PointerGesture =
  | {
      readonly kind: "pan"
      readonly pointer: Point
      readonly transform: ViewerTransform
    }
  | {
      readonly kind: "pinch"
      readonly center: Point
      readonly distance: number
      readonly transform: ViewerTransform
    }

type BackgroundPress = {
  readonly pointerId: number
  readonly start: Point
  moved: boolean
}

const DEFAULT_TRANSFORM: ViewerTransform = { scale: 1, x: 0, y: 0 }

export function createImageLightbox(
  primitives: ImageLightboxPrimitives,
): ComponentType<ImageLightboxProps> {
  const {
    Button,
    Dialog,
    DialogClose,
    DialogContent,
    DialogTitle,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  } = primitives

  function ViewerActionButton({
    ariaLabel,
    children,
    className,
    dataTrack,
    disabled = false,
    label,
    onClick,
  }: {
    readonly ariaLabel: string
    readonly children: ReactNode
    readonly className?: string
    readonly dataTrack: string
    readonly disabled?: boolean
    readonly label: string
    readonly onClick: () => void
  }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={ariaLabel}
            className={className}
            data-track={dataTrack}
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }

  return function ImageLightbox({ preview, onClose }: ImageLightboxProps) {
    const [activeIndex, setActiveIndex] = useState(() => clamp(preview.initialIndex, 0, preview.images.length - 1))
    const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading")
    const [retryKey, setRetryKey] = useState(0)
    const [naturalSize, setNaturalSize] = useState<Size | null>(null)
    const [viewportSize, setViewportSize] = useState<Size | null>(null)
    const [transform, setTransform] = useState<ViewerTransform>(DEFAULT_TRANSFORM)
    const [dragging, setDragging] = useState(false)
    const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const fitLockedRef = useRef(true)
    const closeRequestedRef = useRef(false)
    const pointersRef = useRef(new Map<number, Point>())
    const gestureRef = useRef<PointerGesture | null>(null)
    const backgroundPressRef = useRef<BackgroundPress | null | undefined>(undefined)
    const activeImage = preview.images[activeIndex]
    const fitScale = useMemo(
      () => calculateFitScale(naturalSize, viewportSize),
      [naturalSize, viewportSize],
    )
    const minScale = Math.min(MIN_SCALE, fitScale)
    const controlsDisabled = loadState !== "loaded"
      || !naturalSize
      || !viewportSize
      || viewportSize.width <= 0
      || viewportSize.height <= 0
    const canGoPrevious = activeIndex > 0
    const canGoNext = activeIndex < preview.images.length - 1
    const canZoomOut = !controlsDisabled && transform.scale > minScale + SCALE_EPSILON
    const canZoomIn = !controlsDisabled && transform.scale < MAX_SCALE - SCALE_EPSILON
    const canPan = Boolean(
      naturalSize
      && viewportSize
      && (naturalSize.width * transform.scale > viewportSize.width + 1
        || naturalSize.height * transform.scale > viewportSize.height + 1),
    )

    useLayoutEffect(() => {
      const viewport = viewportElement
      if (!viewport) return
      const measure = () => {
        const next = { width: viewport.clientWidth, height: viewport.clientHeight }
        setViewportSize((current) => sizesEqual(current, next) ? current : next)
      }
      measure()
      if (typeof ResizeObserver === "undefined") return undefined
      const observer = new ResizeObserver(measure)
      observer.observe(viewport)
      return () => observer.disconnect()
    }, [viewportElement])

    const setViewportRef = useCallback((element: HTMLDivElement | null) => {
      viewportRef.current = element
      if (element) setViewportElement((current) => current === element ? current : element)
    }, [])

    useLayoutEffect(() => {
      if (!naturalSize || !viewportSize) return
      setTransform((current) => {
        const nextScale = fitLockedRef.current ? fitScale : clamp(current.scale, minScale, MAX_SCALE)
        return clampTransform({ ...current, scale: nextScale }, naturalSize, viewportSize)
      })
    }, [fitScale, minScale, naturalSize, viewportSize])

    useEffect(() => {
      setLoadState("loading")
      setNaturalSize(null)
      setTransform(DEFAULT_TRANSFORM)
      fitLockedRef.current = true
      setDragging(false)
      pointersRef.current.clear()
      gestureRef.current = null
    }, [activeIndex, retryKey])

    const requestClose = useCallback(() => {
      if (closeRequestedRef.current) return
      closeRequestedRef.current = true
      const trigger = preview.trigger
      onClose()
      window.requestAnimationFrame(() => {
        if (trigger.isConnected) trigger.focus()
      })
    }, [onClose, preview.trigger])

    if (!activeImage) return null

    const updateScale = (scale: number, anchor: Point = { x: 0, y: 0 }) => {
      if (!naturalSize || !viewportSize) return
      setTransform((current) => {
        const nextScale = clamp(scale, minScale, MAX_SCALE)
        const ratio = nextScale / current.scale
        return clampTransform({
          scale: nextScale,
          x: anchor.x - (anchor.x - current.x) * ratio,
          y: anchor.y - (anchor.y - current.y) * ratio,
        }, naturalSize, viewportSize)
      })
      fitLockedRef.current = false
    }

    const fitToViewport = () => {
      if (!naturalSize || !viewportSize) return
      fitLockedRef.current = true
      setTransform({ scale: fitScale, x: 0, y: 0 })
    }

    const showOriginalSize = () => {
      updateScale(1)
    }

    const changeImage = (index: number) => {
      if (index < 0 || index >= preview.images.length || index === activeIndex) return
      setActiveIndex(index)
      setRetryKey(0)
    }

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === "ArrowLeft" && canGoPrevious) {
        event.preventDefault()
        changeImage(activeIndex - 1)
        return
      }
      if (event.key === "ArrowRight" && canGoNext) {
        event.preventDefault()
        changeImage(activeIndex + 1)
        return
      }
      if ((event.key === "+" || event.key === "=") && canZoomIn) {
        event.preventDefault()
        updateScale(transform.scale * ZOOM_STEP)
        return
      }
      if (event.key === "-" && canZoomOut) {
        event.preventDefault()
        updateScale(transform.scale / ZOOM_STEP)
        return
      }
      if (event.key === "0" && !controlsDisabled) {
        event.preventDefault()
        fitToViewport()
        return
      }
      if (event.key === "1" && !controlsDisabled) {
        event.preventDefault()
        showOriginalSize()
      }
    }

    const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
      if (controlsDisabled || event.deltaY === 0) return
      event.preventDefault()
      const anchor = pointFromClient(event.clientX, event.clientY, event.currentTarget)
      updateScale(transform.scale * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), anchor)
    }

    const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      if (controlsDisabled || !(event.target instanceof HTMLImageElement)) return
      const targetScale = isScaleEqual(transform.scale, fitScale)
        ? Math.min(MAX_SCALE, Math.max(1, fitScale * 2))
        : fitScale
      if (isScaleEqual(targetScale, fitScale)) {
        fitToViewport()
        return
      }
      updateScale(targetScale, pointFromClient(event.clientX, event.clientY, event.currentTarget))
    }

    const handleBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button > 0) {
        backgroundPressRef.current = null
        return
      }
      const isBackground = event.target === event.currentTarget || event.target === viewportRef.current
      backgroundPressRef.current = isBackground
        ? { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false }
        : null
    }

    const handleBackgroundPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const press = backgroundPressRef.current
      if (!press || press.pointerId !== event.pointerId) return
      if (
        Math.abs(event.clientX - press.start.x) > BACKGROUND_CLICK_MOVEMENT_TOLERANCE
        || Math.abs(event.clientY - press.start.y) > BACKGROUND_CLICK_MOVEMENT_TOLERANCE
      ) press.moved = true
    }

    const handleBackgroundClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      const press = backgroundPressRef.current
      backgroundPressRef.current = undefined
      const isBackground = event.target === event.currentTarget || event.target === viewportRef.current
      if (isBackground && press !== null && !press?.moved) requestClose()
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (controlsDisabled || event.button > 0) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      gestureRef.current = createPointerGesture(pointersRef.current, transform)
      setDragging(canPan || pointersRef.current.size > 1)
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(event.pointerId) || !naturalSize || !viewportSize) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const gesture = gestureRef.current
      if (!gesture) return
      if (gesture.kind === "pan" && pointersRef.current.size === 1) {
        const pointer = pointersRef.current.values().next().value as Point | undefined
        if (!pointer) return
        setTransform(clampTransform({
          ...gesture.transform,
          x: gesture.transform.x + pointer.x - gesture.pointer.x,
          y: gesture.transform.y + pointer.y - gesture.pointer.y,
        }, naturalSize, viewportSize))
        return
      }
      if (gesture.kind === "pinch" && pointersRef.current.size >= 2) {
        const pinch = getPinchMetrics(pointersRef.current)
        if (!pinch || gesture.distance === 0) return
        const nextScale = clamp(gesture.transform.scale * pinch.distance / gesture.distance, minScale, MAX_SCALE)
        const ratio = nextScale / gesture.transform.scale
        const startAnchor = pointFromClient(gesture.center.x, gesture.center.y, event.currentTarget)
        const currentAnchor = pointFromClient(pinch.center.x, pinch.center.y, event.currentTarget)
        fitLockedRef.current = false
        setTransform(clampTransform({
          scale: nextScale,
          x: currentAnchor.x - (startAnchor.x - gesture.transform.x) * ratio,
          y: currentAnchor.y - (startAnchor.y - gesture.transform.y) * ratio,
        }, naturalSize, viewportSize))
      }
    }

    const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size === 0) {
        gestureRef.current = null
        setDragging(false)
        return
      }
      gestureRef.current = createPointerGesture(pointersRef.current, transform)
      setDragging(canPan || pointersRef.current.size > 1)
    }

    return (
      <TooltipProvider>
        <Dialog open onOpenChange={(open: boolean) => {
          if (!open) requestClose()
        }}>
        <DialogContent
          aria-describedby={undefined}
          className="h-screen max-h-none w-screen max-w-none gap-0 rounded-none border-0 bg-black p-0 text-white shadow-none sm:max-w-none"
          data-image-lightbox="true"
          onClick={handleBackgroundClick}
          onKeyDown={handleKeyDown}
          onPointerDownCapture={handleBackgroundPointerDown}
          onPointerDownOutside={(event: { preventDefault: () => void }) => event.preventDefault()}
          onPointerMoveCapture={handleBackgroundPointerMove}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{activeImage.alt || "图片预览"}</DialogTitle>

          {preview.images.length > 1 ? (
            <div
              aria-live="polite"
              className="absolute left-4 top-4 z-10 rounded-md bg-background/90 px-2.5 py-1.5 text-xs tabular-nums text-foreground shadow-sm"
            >
              {activeIndex + 1} / {preview.images.length}
            </div>
          ) : null}

          <DialogClose asChild>
            <Button
              aria-label="关闭图片预览"
              className="absolute right-4 top-4 z-10 bg-background/90 text-foreground hover:bg-background"
              data-track="image-lightbox-close"
              size="icon"
              type="button"
              variant="secondary"
            >
              <X aria-hidden="true" data-icon="inline-start" />
            </Button>
          </DialogClose>

          {preview.images.length > 1 ? (
            <>
              <ViewerActionButton
                ariaLabel="上一张图片"
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 bg-background/90 text-foreground hover:bg-background sm:left-4"
                dataTrack="image-lightbox-previous"
                disabled={!canGoPrevious}
                label="上一张（←）"
                onClick={() => changeImage(activeIndex - 1)}
              >
                <ChevronLeft aria-hidden="true" data-icon="inline-start" />
              </ViewerActionButton>
              <ViewerActionButton
                ariaLabel="下一张图片"
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 bg-background/90 text-foreground hover:bg-background sm:right-4"
                dataTrack="image-lightbox-next"
                disabled={!canGoNext}
                label="下一张（→）"
                onClick={() => changeImage(activeIndex + 1)}
              >
                <ChevronRight aria-hidden="true" data-icon="inline-start" />
              </ViewerActionButton>
            </>
          ) : null}

          <div
            ref={setViewportRef}
            className={joinClassNames(
              "absolute inset-x-3 bottom-20 top-16 overflow-hidden touch-none select-none sm:inset-x-14",
              canPan && (dragging ? "cursor-grabbing" : "cursor-grab"),
            )}
            data-image-lightbox-viewport="true"
            onDoubleClick={handleDoubleClick}
            onPointerCancel={finishPointer}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onWheel={handleWheel}
          >
            {loadState === "loading" ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">正在加载图片</div>
            ) : null}
            {loadState === "error" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <p className="text-sm text-white/70">图片加载失败</p>
                <Button
                  data-track="image-lightbox-retry"
                  type="button"
                  variant="secondary"
                  onClick={() => setRetryKey((value) => value + 1)}
                >
                  重新加载
                </Button>
              </div>
            ) : null}
            <div
              className={joinClassNames(
                "absolute left-1/2 top-1/2 origin-center",
                dragging
                  ? "transition-none"
                  : "motion-safe:transition-transform motion-safe:duration-150 motion-reduce:transition-none",
                loadState !== "loaded" && "invisible",
              )}
              data-image-lightbox-transform="true"
              style={{
                transform: `translate3d(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px), 0) scale(${transform.scale})`,
              }}
            >
              <img
                key={`${activeIndex}:${retryKey}`}
                alt={activeImage.alt}
                className="pointer-events-auto block max-w-none select-none"
                data-image-lightbox-active="true"
                draggable={false}
                src={activeImage.src}
                onError={() => setLoadState("error")}
                onLoad={(event) => {
                  const image = event.currentTarget
                  const width = image.naturalWidth || image.width
                  const height = image.naturalHeight || image.height
                  if (width <= 0 || height <= 0) {
                    setLoadState("error")
                    return
                  }
                  const nextNaturalSize = { width, height }
                  const viewport = viewportRef.current
                  const nextViewportSize = viewport
                    ? { width: viewport.clientWidth, height: viewport.clientHeight }
                    : viewportSize
                  setNaturalSize(nextNaturalSize)
                  if (nextViewportSize) {
                    const nextFitScale = calculateFitScale(nextNaturalSize, nextViewportSize)
                    setViewportSize(nextViewportSize)
                    setTransform({ scale: nextFitScale, x: 0, y: 0 })
                  }
                  setLoadState("loaded")
                }}
              />
            </div>
          </div>

          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-background/95 p-1 text-foreground shadow-sm">
            <ViewerActionButton
              ariaLabel="缩小图片"
              dataTrack="image-lightbox-zoom-out"
              disabled={!canZoomOut}
              label="缩小（-）"
              onClick={() => updateScale(transform.scale / ZOOM_STEP)}
            >
              <ZoomOut aria-hidden="true" data-icon="inline-start" />
            </ViewerActionButton>
            <span
              aria-live="polite"
              className="w-14 text-center text-xs tabular-nums"
              data-image-lightbox-zoom="true"
            >
              {loadState === "loaded" ? `${Math.round(transform.scale * 100)}%` : "—"}
            </span>
            <ViewerActionButton
              ariaLabel="放大图片"
              dataTrack="image-lightbox-zoom-in"
              disabled={!canZoomIn}
              label="放大（+）"
              onClick={() => updateScale(transform.scale * ZOOM_STEP)}
            >
              <ZoomIn aria-hidden="true" data-icon="inline-start" />
            </ViewerActionButton>
            <ViewerActionButton
              ariaLabel="适合窗口"
              dataTrack="image-lightbox-fit"
              disabled={controlsDisabled}
              label="适合窗口（0）"
              onClick={fitToViewport}
            >
              <Maximize2 aria-hidden="true" data-icon="inline-start" />
            </ViewerActionButton>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="按原始尺寸显示图片"
                  className="w-10 px-0 text-xs tabular-nums"
                  data-track="image-lightbox-original-size"
                  disabled={controlsDisabled}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={showOriginalSize}
                >
                  1:1
                </Button>
              </TooltipTrigger>
              <TooltipContent>原始尺寸（1）</TooltipContent>
            </Tooltip>
          </div>
        </DialogContent>
        </Dialog>
      </TooltipProvider>
    )
  }
}

function calculateFitScale(naturalSize: Size | null, viewportSize: Size | null): number {
  if (
    !naturalSize
    || !viewportSize
    || naturalSize.width <= 0
    || naturalSize.height <= 0
    || viewportSize.width <= 0
    || viewportSize.height <= 0
  ) return 1
  return Math.min(1, viewportSize.width / naturalSize.width, viewportSize.height / naturalSize.height)
}

function clampTransform(transform: ViewerTransform, naturalSize: Size, viewportSize: Size): ViewerTransform {
  const maxX = Math.max(0, (naturalSize.width * transform.scale - viewportSize.width) / 2)
  const maxY = Math.max(0, (naturalSize.height * transform.scale - viewportSize.height) / 2)
  return {
    scale: transform.scale,
    x: clamp(transform.x, -maxX, maxX),
    y: clamp(transform.y, -maxY, maxY),
  }
}

function pointFromClient(clientX: number, clientY: number, viewport: HTMLElement): Point {
  const bounds = viewport.getBoundingClientRect()
  return {
    x: clientX - bounds.left - bounds.width / 2,
    y: clientY - bounds.top - bounds.height / 2,
  }
}

function createPointerGesture(
  pointers: ReadonlyMap<number, Point>,
  transform: ViewerTransform,
): PointerGesture | null {
  if (pointers.size >= 2) {
    const pinch = getPinchMetrics(pointers)
    return pinch ? { kind: "pinch", ...pinch, transform } : null
  }
  const pointer = pointers.values().next().value as Point | undefined
  return pointer ? { kind: "pan", pointer, transform } : null
}

function getPinchMetrics(
  pointers: ReadonlyMap<number, Point>,
): { readonly center: Point; readonly distance: number } | null {
  const [first, second] = Array.from(pointers.values())
  if (!first || !second) return null
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  }
}

function sizesEqual(first: Size | null, second: Size): boolean {
  return first?.width === second.width && first.height === second.height
}

function isScaleEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= SCALE_EPSILON
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}
