import { ChevronDown, Clipboard, Sparkles } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { track } from "@/lib/ui-tracking"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentThinkingTimelineItem,
} from "@/types/agent"
import { AgentAnnotation } from "./agent-annotation"

const logger = createRendererLogger("agent")

function AgentThinkingEvent({
  item,
  profile,
}: {
  readonly item: SynapseAgentThinkingTimelineItem
  readonly profile: SynapseAgentDisplayProfile
}) {
  const handleCopy = () => {
    track({
      component: "agent",
      name: "agent-thinking-copy",
      action: "click",
      metadata: {
        boundary: "renderer.agent.thinking-copy",
        itemId: item.id,
        contentLength: item.content.length,
      },
    })
    void navigator.clipboard.writeText(item.content).catch((error: unknown) => {
      logger.warn("Agent thinking copy failed.", {
        boundary: "renderer.agent.thinking-copy",
        itemId: item.id,
        contentLength: item.content.length,
        ...errorLogMeta(error),
      })
    })
  }

  return (
    <AgentAnnotation>
      <Collapsible defaultOpen={!profile.thinkingDefaultCollapsed}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/agent-event-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          >
            <Sparkles className="size-3.5" />
            <span>思考过程</span>
            <ChevronDown
              data-icon="inline-end"
              className="size-3.5 transition-transform group-data-[state=closed]/agent-event-trigger:-rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="group relative pb-2 pt-1">
            <pre data-allow-select="true" className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
              {item.content}
            </pre>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="复制思考过程"
              className="absolute right-1 top-2 size-6 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
              onClick={handleCopy}
            >
              <Clipboard className="size-3.5" />
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  if (error instanceof DOMException) {
    return {
      errorName: error.name || "DOMException",
      errorLength: error.message.length,
    }
  }
  const text = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: text.length,
  }
}

export { AgentThinkingEvent }
