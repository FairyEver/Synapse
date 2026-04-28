import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"

type MessageSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "reference"; readonly value: string }

const LOCAL_REFERENCE_PATTERN = /(\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g

function AgentMessageEvent({
  item,
  onOpenReference,
}: {
  readonly item: SynapseAgentMessageTimelineItem
  readonly onOpenReference: (reference: string) => void
}) {
  const outgoing = item.role === "user"
  const segments = splitLocalReferences(item.content)
  return (
    <article className={cn("flex min-w-0", outgoing ? "justify-end" : "justify-start")}>
      <div className={cn(
        "min-w-0 max-w-[78%] whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm leading-relaxed",
        outgoing ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground",
      )}>
        {segments.map((segment, index) => segment.kind === "text" ? (
          <span key={`${item.id}:text:${String(index)}`}>{segment.value}</span>
        ) : (
          <Button
            key={`${item.id}:ref:${String(index)}`}
            type="button"
            variant="link"
            size="sm"
            className={cn(
              "h-auto min-w-0 max-w-full whitespace-normal break-all px-1 py-0 text-left align-baseline",
              outgoing ? "text-inherit hover:text-inherit" : null,
            )}
            onClick={() => onOpenReference(segment.value)}
          >
            {segment.value}
          </Button>
        ))}
      </div>
    </article>
  )
}

function splitLocalReferences(content: string): readonly MessageSegment[] {
  const segments: MessageSegment[] = []
  let lastIndex = 0
  for (const match of content.matchAll(LOCAL_REFERENCE_PATTERN)) {
    const value = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, index) })
    }
    segments.push({ kind: "reference", value })
    lastIndex = index + value.length
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) })
  }
  return segments.length > 0 ? segments : [{ kind: "text", value: content }]
}

export { AgentMessageEvent }
