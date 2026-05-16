import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface PanelCollapseButtonProps {
  side: "left" | "right"
  collapsed: boolean
  onToggle: () => void
}

export function PanelCollapseButton({ side, collapsed, onToggle }: PanelCollapseButtonProps) {
  const Icon = side === "left"
    ? (collapsed ? ChevronRight : ChevronLeft)
    : (collapsed ? ChevronLeft : ChevronRight)

  return (
    <button
      type="button"
      aria-label={collapsed ? `展开${side === "left" ? "左侧" : "右侧"}面板` : `收起${side === "left" ? "左侧" : "右侧"}面板`}
      onClick={onToggle}
      className={cn(
        "absolute z-10 flex h-5 w-5 items-center justify-center rounded-full",
        "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        "transition-colors",
        side === "left" ? "right-0" : "left-0",
        "bottom-[100px]"
      )}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
    </button>
  )
}
