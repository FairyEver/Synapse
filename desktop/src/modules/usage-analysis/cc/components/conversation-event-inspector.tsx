import type { CcRawConversationEvent } from "@/types/usage-analysis-conversations"

export function ConversationEventInspector({ event }: { readonly event: CcRawConversationEvent | null }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">字段</h3>
      {event ? (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-card p-3 text-xs" data-allow-select="true">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      ) : (
        <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">选择事件</div>
      )}
    </div>
  )
}
