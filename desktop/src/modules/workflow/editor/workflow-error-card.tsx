import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { AlertTriangle, ChevronUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { WorkflowValidationDisplayItem } from "./validation-display"

const MAX_VISIBLE_ERRORS = 3

interface WorkflowErrorCardProps {
  items: readonly WorkflowValidationDisplayItem[]
  onSelectItem: (item: WorkflowValidationDisplayItem) => void
}

export function WorkflowErrorCard({ items, onSelectItem }: WorkflowErrorCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (items.length > 0) setCollapsed(false)
  }, [items])

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
    }
  }, [])

  if (items.length === 0) return null

  const positionStyle = offset.x !== 0 || offset.y !== 0
    ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
    : undefined

  const handleDragStart = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof HTMLElement && event.target.closest("button")) return
    event.preventDefault()

    const target = event.currentTarget.closest<HTMLElement>("[data-workflow-error-floating]")
    if (!target) return

    const start = { x: event.clientX, y: event.clientY }
    const startOffset = offset
    const targetRect = target.getBoundingClientRect()
    const parentRect = target.parentElement?.getBoundingClientRect()

    const handleMove = (moveEvent: MouseEvent) => {
      const next = {
        x: startOffset.x + moveEvent.clientX - start.x,
        y: startOffset.y + moveEvent.clientY - start.y,
      }
      setOffset(clampOffset(next, startOffset, targetRect, parentRect))
    }
    const handleEnd = () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleEnd)
      dragCleanupRef.current = null
    }

    dragCleanupRef.current?.()
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleEnd)
    dragCleanupRef.current = handleEnd
  }

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-workflow-error-floating
        className="absolute right-3 top-16 z-20 gap-1.5 bg-background shadow-sm"
        style={positionStyle}
        onClick={() => setCollapsed(false)}
      >
        <AlertTriangle className="size-3.5 text-destructive" />
        {items.length} 处需要处理
        <ChevronUp className="size-3.5 text-muted-foreground" />
      </Button>
    )
  }

  const visibleItems = items.slice(0, MAX_VISIBLE_ERRORS)
  const hiddenCount = Math.max(0, items.length - visibleItems.length)

  return (
    <Card
      data-testid="workflow-error-card"
      data-workflow-error-floating
      className="absolute right-3 top-16 z-20 w-80 gap-0 bg-background py-0 shadow-md"
      style={positionStyle}
    >
      <CardHeader className="cursor-move select-none flex flex-row items-center gap-2 px-3 py-2" onMouseDown={handleDragStart}>
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <CardTitle className="flex-1 text-sm">需要处理 {items.length} 处</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setCollapsed(true)}
          aria-label="关闭错误提示"
        >
          <X className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-1 px-3 pb-3 pt-0">
        {visibleItems.map((item) => (
          <button
            data-track="workflow.error.select"
            data-track-native="true"
            key={item.id}
            type="button"
            className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelectItem(item)}
          >
            <span className="block font-medium text-foreground">{item.location}</span>
            <span className="block text-muted-foreground">{item.summary}</span>
          </button>
        ))}
        {hiddenCount > 0 && (
          <p className="px-2 pt-1 text-xs text-muted-foreground">还有 {hiddenCount} 处</p>
        )}
      </CardContent>
    </Card>
  )
}

function clampOffset(
  next: { x: number; y: number },
  startOffset: { x: number; y: number },
  targetRect: DOMRect,
  parentRect: DOMRect | undefined,
): { x: number; y: number } {
  if (!parentRect || parentRect.width <= 0 || parentRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
    return next
  }

  const minX = startOffset.x + parentRect.left - targetRect.left
  const maxX = startOffset.x + parentRect.right - targetRect.right
  const minY = startOffset.y + parentRect.top - targetRect.top
  const maxY = startOffset.y + parentRect.bottom - targetRect.bottom

  return {
    x: Math.min(Math.max(next.x, minX), maxX),
    y: Math.min(Math.max(next.y, minY), maxY),
  }
}
