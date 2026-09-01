import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Clipboard, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { redactSensitiveText } from "@/lib/agent-redaction"
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
import { errorLogMeta } from "../utils"

const logger = createRendererLogger("agent")

function AgentThinkingEvent({
  item,
  profile,
}: {
  readonly item: SynapseAgentThinkingTimelineItem
  readonly profile: SynapseAgentDisplayProfile
}) {
  const redactedContent = redactSensitiveText(item.content)
  const handleCopy = () => {
    track({
      component: "agent",
      name: "agent-thinking-copy",
      action: "click",
      eventKey: "agent.thinking.copy",
      metadata: {
        boundary: "renderer.agent.thinking-copy",
        itemId: item.id,
        contentLength: item.content.length,
      },
    })
    void navigator.clipboard.writeText(redactedContent).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopyState("success")
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined
        setCopyState("idle")
      }, 1500)
    }).catch((error: unknown) => {
      logger.warn("Agent thinking copy failed.", {
        boundary: "renderer.agent.thinking-copy",
        itemId: item.id,
        contentLength: item.content.length,
        ...errorLogMeta(error),
      })
      toast("复制失败")
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopyState("error")
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined
        setCopyState("idle")
      }, 1500)
    })
  }

  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle")
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

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
            <div className="rounded bg-muted/50 px-2 py-1.5">
              <pre data-allow-select="true" className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                {redactedContent}
              </pre>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="复制思考过程"
              className="absolute right-1 top-2 size-6 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
              onClick={handleCopy}
            >
              {copyState === "success" ? (
                <Check className="size-3.5" />
              ) : copyState === "error" ? (
                <X className="size-3.5 text-destructive" />
              ) : (
                <Clipboard className="size-3.5" />
              )}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

export { AgentThinkingEvent }
