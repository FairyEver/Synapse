import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface PanelCollapseButtonProps {
  side: "left" | "right"
  collapsed: boolean
  onToggle: () => void
}

export function PanelCollapseButton({ side, collapsed, onToggle }: PanelCollapseButtonProps) {
  const showExpand = collapsed
  const Icon = side === "left"
    ? (showExpand ? ChevronRight : ChevronLeft)
    : (showExpand ? ChevronLeft : ChevronRight)

  return (
    <button
      onClick={onToggle}
      className={cn(
        "absolute z-10 flex h-5 w-5 items-center justify-center rounded-full",
        "border border-border bg-background hover:bg-accent",
        "transition-colors",
        side === "left" ? "-right-2.5" : "-left-2.5",
        "bottom-[100px]"
      )}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
    </button>
  )
}
