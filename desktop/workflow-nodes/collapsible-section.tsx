import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

interface CollapsibleSectionProps {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function CollapsibleSection({ title, summary, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="flex-1 text-left">{title}</span>
        {summary && <span className="text-[10px] text-muted-foreground/70 tabular-nums">{summary}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1.5 pb-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
