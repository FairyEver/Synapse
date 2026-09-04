import type { CcRawConversationEvent } from "@/types/usage-analysis-conversations"
import { redactSensitiveValue } from "@/lib/agent-redaction"
import { ScrollArea } from "@/components/ui/scroll-area"

export function ConversationEventInspector({ event }: { readonly event: CcRawConversationEvent | null }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">字段</h3>
      {event ? (
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-card" scrollbars="both">
          <pre className="p-3 text-xs" data-allow-select="true">
            {JSON.stringify(redactSensitiveValue(event.raw), null, 2)}
          </pre>
        </ScrollArea>
      ) : (
        <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">选择事件</div>
      )}
    </div>
  )
}
