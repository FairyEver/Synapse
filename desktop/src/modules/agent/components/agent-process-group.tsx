import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { AgentAnnotation } from "./agent-annotation"

type AgentProcessGroupProps = {
  readonly label: string
  readonly durationLabel?: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: React.ReactNode
}

function AgentProcessGroup({
  label,
  durationLabel,
  open,
  onOpenChange,
  children,
}: AgentProcessGroupProps) {
  return (
    <AgentAnnotation>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/agent-process-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          >
            <span className="shrink-0">{label}</span>
            {durationLabel ? (
              <span className="shrink-0 tabular-nums">{durationLabel}</span>
            ) : null}
            <ChevronDown
              data-icon="inline-end"
              className="size-3.5 transition-transform group-data-[state=closed]/agent-process-trigger:-rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-2 pb-2 pt-1">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

export { AgentProcessGroup }
export type { AgentProcessGroupProps }
