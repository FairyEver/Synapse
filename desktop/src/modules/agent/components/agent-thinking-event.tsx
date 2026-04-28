import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentThinkingTimelineItem,
} from "@/types/agent"

function AgentThinkingEvent({
  item,
  profile,
}: {
  readonly item: SynapseAgentThinkingTimelineItem
  readonly profile: SynapseAgentDisplayProfile
}) {
  return (
    <Collapsible defaultOpen={!profile.thinkingDefaultCollapsed} className="rounded-md border border-border">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-full justify-start">
          <ChevronDown data-icon="inline-start" />
          Thinking
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="whitespace-pre-wrap break-words px-3 pb-3 text-sm text-muted-foreground">
          {item.content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

export { AgentThinkingEvent }
