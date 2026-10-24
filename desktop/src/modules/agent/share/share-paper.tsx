import { Fragment, useMemo, type Ref } from "react"
import appIcon from "@/assets/icon.png"
import { formatDateTime } from "@/lib/date-time"
import type { AgentShareSettings } from "@/types/agent-share"
import { AgentShareMessageBody } from "../components/agent-message-event"
import { redactShareText } from "./redaction"
import { shareFooterMetadata, type ShareMessage } from "./messages"
import { AgentShareImageContext, createShareImageReader } from "./guarded-image"
import type { ShareRenderResponse } from "../../../../app-capabilities/agent/shared/share"

export function AgentSharePaper({ paperRef, messages, settings, target, indexes, renderContext }: {
  paperRef: Ref<HTMLElement>; messages: readonly ShareMessage[]; settings: AgentShareSettings;
  target: { projectId: string; conversationId: string }; indexes: ReadonlyMap<string, number>
  renderContext?: ShareRenderResponse
}) {
  const imageReader = useMemo(() => renderContext ? createShareImageReader(renderContext) : undefined, [renderContext])
  const metadata = shareFooterMetadata(messages)
  const models = settings.showModel ? metadata.models : ""
  const timestamp = settings.showTime ? metadata.timestamp : undefined
  return <AgentShareImageContext.Provider value={imageReader}><article ref={paperRef} data-agent-share-paper className="overflow-hidden rounded-lg bg-background p-10 text-sm text-foreground [&_[data-streamdown=code-block-copy-button]]:hidden [&_[data-slot=scroll-area-scrollbar]]:hidden" style={{ width: settings.width }}>
    <header className="mb-8 flex items-center gap-3 border-b pb-7"><img src={appIcon} alt="Synapse" className="size-8 shrink-0" /><span className="text-lg font-semibold">Synapse</span></header>
    <div className="space-y-8">{messages.map((message, index, all) => {
      const previous = index > 0 ? indexes.get(all[index - 1]!.id) : undefined
      const current = indexes.get(message.id)
      const omitted = previous !== undefined && current !== undefined && current > previous + 1
      const item = { ...message, content: redactShareText(message.content, settings.redact) }
      return <Fragment key={message.id}>
        {omitted && <div data-share-omission className="flex items-center gap-4 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />已省略内容<span className="h-px flex-1 bg-border" /></div>}
        <section data-share-export-message={message.id}>
          <AgentShareMessageBody item={item} projectId={target.projectId} conversationId={target.conversationId} hideEmails={settings.redact} />
        </section>
      </Fragment>
    })}</div>
    {(models || timestamp) && <footer className="mt-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t pt-5 text-right text-xs text-muted-foreground">{models && <span className="min-w-0 break-words">{redactShareText(models, settings.redact)}</span>}{timestamp && <time dateTime={timestamp} className="shrink-0 tabular-nums">{formatDateTime(timestamp)}</time>}</footer>}
  </article></AgentShareImageContext.Provider>
}
