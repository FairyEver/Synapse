import { useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { sanitizeError } from "@/lib/error-sanitize"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type {
  CcConversationDetail,
  CcConversationParseError,
  CcConversationWindowRequest,
  CcRawConversationEvent,
} from "@/types/usage-analysis-conversations"
import { ConversationEventInspector } from "./conversation-event-inspector"
import { ConversationEventStream } from "./conversation-event-stream"

function selectFocusedEvent(
  events: readonly CcRawConversationEvent[],
  request: CcConversationWindowRequest,
): CcRawConversationEvent | null {
  return events.find((event) => event.id === request.focus?.eventId)
    ?? events.find((event) => event.toolUseId === request.focus?.toolEventId)
    ?? events.find((event) => event.timestampMs === request.focus?.timestampMs)
    ?? events[0]
    ?? null
}

function parseErrorSummary(errors: readonly CcConversationParseError[]): string {
  return `${errors.length} 行解析失败`
}

function loadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeError(message).trim() || "读取失败"
}

export function CcConversationDetailWindowPage({ request }: { readonly request: CcConversationWindowRequest }) {
  const [detail, setDetail] = useState<CcConversationDetail | null>(null)
  const [selected, setSelected] = useState<CcRawConversationEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const events = detail?.events ?? []
  const parseErrors = detail?.parseErrors ?? []
  const title = detail?.session.title || request.title || request.sessionId
  const subtitle = detail?.session.workspaceLabel || detail?.session.sourceFilePath || request.sessionId

  useEffect(() => {
    let cancelled = false

    requireSynapseBridge().usageAnalysis.cc.getConversation(request.sessionId, request.focus)
      .then((next) => {
        if (cancelled) return
        setDetail(next)
        setSelected(selectFocusedEvent(next.events, request))
        setError(null)
        setLoadingMore(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(loadErrorMessage(err))
      })

    return () => {
      cancelled = true
    }
  }, [
    request.sessionId,
    request.focus?.eventId,
    request.focus?.toolEventId,
    request.focus?.timestampMs,
  ])

  const loadMore = async () => {
    if (!detail?.hasMore || !detail.nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const chunk = await requireSynapseBridge().usageAnalysis.cc.getConversationChunk({
        sessionId: detail.session.sessionId,
        cursor: detail.nextCursor,
      })
      setDetail({
        session: detail.session,
        events: [...detail.events, ...chunk.events],
        parseErrors: [...detail.parseErrors, ...chunk.parseErrors],
        hasMore: chunk.hasMore,
        ...(chunk.nextCursor ? { nextCursor: chunk.nextCursor } : {}),
      })
      setError(null)
    } catch (err) {
      setError(loadErrorMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{title}</h1>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <div className="text-xs text-muted-foreground">{detail?.hasMore ? `已加载 ${events.length} 事件` : `${events.length} 事件`}</div>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-12">
        {parseErrors.length > 0 ? (
          <Alert variant="destructive" className="lg:col-span-12">
            <AlertTitle>{parseErrorSummary(parseErrors)}</AlertTitle>
            <AlertDescription>
              <div>部分事件可能缺失。</div>
              <div className="mt-1 flex flex-col gap-1">
                {parseErrors.slice(0, 3).map((parseError) => (
                  <div key={parseError.id}>
                    第 {parseError.lineNumber} 行：{parseError.message}
                  </div>
                ))}
                {parseErrors.length > 3 ? <div>还有 {parseErrors.length - 3} 行未显示。</div> : null}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        <aside className="min-h-0 overflow-auto rounded-md border bg-card p-2 lg:col-span-2">
          <h2 className="text-sm font-medium">事件</h2>
          <div className="mt-2 flex flex-col gap-1">
            {events.map((event) => (
              <button
                data-track="usage.conversation.event.select"
                data-track-native="true"
                key={event.id}
                type="button"
                className={selected?.id === event.id
                  ? "truncate rounded-md bg-muted px-2 py-1 text-left text-xs"
                  : "truncate rounded-md px-2 py-1 text-left text-xs hover:bg-accent"}
                onClick={() => setSelected(event)}
              >
                {event.type}
              </button>
            ))}
            {!detail && !error ? <div className="text-xs text-muted-foreground">加载中</div> : null}
            {error ? <div className="text-xs text-destructive">{error}</div> : null}
            {detail?.hasMore ? (
              <button
                data-track="usage.conversation.load-more"
                data-track-native="true"
                type="button"
                className="rounded-md border px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "加载中" : "加载更多"}
              </button>
            ) : null}
          </div>
        </aside>
        <section className="min-h-0 overflow-auto lg:col-span-7">
          <ConversationEventStream events={events} selectedId={selected?.id} onSelect={setSelected} />
        </section>
        <aside className="min-h-0 overflow-hidden lg:col-span-3">
          <ConversationEventInspector event={selected} />
        </aside>
      </main>
    </div>
  )
}
