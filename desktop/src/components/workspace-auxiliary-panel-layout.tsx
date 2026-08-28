import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  readWorkspacePanelWidth,
  writeWorkspacePanelWidth,
  type WorkspacePanelSizeConstraints,
} from "@/lib/workspace-panel-layout-storage"
import { cn } from "@/lib/utils"

const CONVERSATION_MIN_WIDTH = 560
const AUXILIARY_PANEL_MIN_WIDTH = 400
const AUXILIARY_PANEL_DEFAULT_WIDTH = 480
const AUXILIARY_PANEL_MAX_WIDTH = 720
const WIDE_LAYOUT_MIN_WIDTH = 1040

export type WorkspaceAuxiliaryPanelMode = "closed" | "split" | "detail"

type WorkspaceAuxiliaryPanelLayoutProps = {
  readonly main: ReactNode
  readonly auxiliary?: ReactNode
  readonly persistenceId: string
  readonly className?: string
}

export function resolveWorkspaceAuxiliaryPanelMode(
  availableWidth: number | null,
  open: boolean,
): WorkspaceAuxiliaryPanelMode {
  if (!open) return "closed"
  if (availableWidth !== null && availableWidth < WIDE_LAYOUT_MIN_WIDTH) return "detail"
  return "split"
}

export function WorkspaceAuxiliaryPanelLayout({
  main,
  auxiliary,
  persistenceId,
  className,
}: WorkspaceAuxiliaryPanelLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  const constraints: WorkspacePanelSizeConstraints = {
    defaultSize: AUXILIARY_PANEL_DEFAULT_WIDTH,
    minSize: AUXILIARY_PANEL_MIN_WIDTH,
    maxSize: AUXILIARY_PANEL_MAX_WIDTH,
  }
  const [initialPanelWidth] = useState(() => readWorkspacePanelWidth(persistenceId, constraints))
  const [panelWidth, setPanelWidth] = useState(initialPanelWidth)
  const latestPanelWidthRef = useRef(initialPanelWidth)
  const mode = resolveWorkspaceAuxiliaryPanelMode(availableWidth, auxiliary !== undefined)
  const maximumPanelWidth = availableWidth === null
    ? AUXILIARY_PANEL_MAX_WIDTH
    : Math.min(AUXILIARY_PANEL_MAX_WIDTH, Math.floor(availableWidth * 0.55))
  const visiblePanelWidth = Math.min(panelWidth, maximumPanelWidth)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const commitWidth = (width: number) => {
      const rounded = Math.round(width)
      setAvailableWidth((current) => current === rounded ? current : rounded)
    }
    commitWidth(container.getBoundingClientRect().width)
    if (typeof ResizeObserver === "undefined") return undefined

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width !== "number") return
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        commitWidth(width)
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const handlePanelResize = useCallback<NonNullable<ComponentProps<typeof ResizablePanel>["onResize"]>>((size) => {
    latestPanelWidthRef.current = size.inPixels
    setPanelWidth((current) => current === size.inPixels ? current : size.inPixels)
  }, [])
  const handleLayoutChanged = useCallback(() => {
    writeWorkspacePanelWidth(persistenceId, latestPanelWidthRef.current, constraints)
  }, [persistenceId])

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full min-h-0 min-w-0 overflow-hidden bg-background", className)}
      data-workspace-auxiliary-panel-mode={mode}
    >
      {mode === "closed" ? main : null}
      {mode !== "closed" ? (
        <>
        <ResizablePanelGroup
          orientation="horizontal"
          onLayoutChanged={handleLayoutChanged}
          aria-hidden={mode === "detail" ? true : undefined}
          className={cn(
            "h-full min-h-0 w-full overflow-hidden",
            mode === "detail" && "invisible pointer-events-none",
          )}
        >
          <ResizablePanel minSize={CONVERSATION_MIN_WIDTH}>
            <div className="h-full min-h-0 min-w-0 overflow-hidden">{main}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={initialPanelWidth}
            minSize={AUXILIARY_PANEL_MIN_WIDTH}
            maxSize={maximumPanelWidth}
            groupResizeBehavior="preserve-pixel-size"
            onResize={handlePanelResize}
          >
            <div className="h-full" aria-hidden="true" />
          </ResizablePanel>
        </ResizablePanelGroup>
        <div
          className={cn(
            "absolute inset-y-0 right-0 min-w-0 overflow-hidden bg-background",
            mode === "detail" ? "left-0" : "border-l",
          )}
          style={mode === "split" ? { width: visiblePanelWidth } : undefined}
        >
          {auxiliary}
        </div>
        </>
      ) : null}
    </div>
  )
}
