import type { CcRawConversationEvent } from "@/types/usage-analysis-conversations"
import {
  redactSensitiveText,
  redactSensitiveValue,
} from "@/lib/agent-redaction"

function eventText(event: CcRawConversationEvent): string {
  return event.contentBlocks.map((block) => {
    const text = block.text
    const thinking = block.thinking
    const content = block.content
    if (typeof text === "string") return redactSensitiveText(text)
    if (typeof thinking === "string") return redactSensitiveText(thinking)
    if (typeof content === "string") return redactSensitiveText(content)
    return JSON.stringify(redactSensitiveValue(block))
  }).filter(Boolean).join("\n")
}

export function ConversationEventStream({
  events,
  selectedId,
  onSelect,
}: {
  readonly events: readonly CcRawConversationEvent[]
  readonly selectedId?: string
  readonly onSelect: (event: CcRawConversationEvent) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {events.map((event) => (
        <button
          data-track="usage.conversation.event.select"
          data-track-native="true"
          key={event.id}
          type="button"
          className={selectedId === event.id
            ? "min-w-0 rounded-md border bg-muted p-3 text-left"
            : "min-w-0 rounded-md border bg-card p-3 text-left"}
          onClick={() => onSelect(event)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{event.type}</span>
            <span className="text-xs text-muted-foreground">{event.timestamp ?? `#${event.lineNumber}`}</span>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs" data-allow-select="true">
            {eventText(event) || JSON.stringify(redactSensitiveValue(event.raw), null, 2)}
          </pre>
        </button>
      ))}
    </div>
  )
}
