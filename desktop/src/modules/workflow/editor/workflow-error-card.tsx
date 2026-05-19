import { useEffect, useState } from "react"
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

  useEffect(() => {
    if (items.length > 0) setCollapsed(false)
  }, [items])

  if (items.length === 0) return null

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="absolute right-3 top-16 z-20 gap-1.5 bg-background shadow-sm"
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
    <Card className="absolute right-3 top-16 z-20 w-80 bg-background shadow-md">
      <CardHeader className="flex flex-row items-center gap-2 px-3 py-2">
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
