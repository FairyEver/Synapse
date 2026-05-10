import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { renderMarkdown } from "@/lib/markdown"
import { MARKDOWN_BODY_CLASSNAME } from "@/components/markdown-viewer"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentMessageTimelineItem,
} from "@/types/agent"
import { AgentMessageHeader } from "./agent-message-header"
import { AgentMessageBubble } from "./agent-message-bubble"
import { AgentMessageToolbar } from "./agent-message-toolbar"

const COPY_BUTTON_HTML = `<button type="button" class="code-copy-btn" aria-label="复制代码" style="position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:1px solid var(--border);background:var(--background);color:var(--muted-foreground);cursor:pointer;opacity:0;transition:opacity .15s"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>`

const LOCAL_REFERENCE_PATTERN = /(\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g

interface AgentMessageEventProps {
  readonly item: SynapseAgentMessageTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly onOpenReference: (reference: string) => void
}

function AgentMessageEvent({
  item,
  profile,
  agentIcon,
  onOpenReference,
}: AgentMessageEventProps) {
  const outgoing = item.role === "user"

  if (outgoing) {
    // Toolbar sits OUTSIDE the bubble so it does not contribute to the
    // bubble's layout height. Otherwise a single-line message looks like it
    // has a trailing blank line because the invisible toolbar still reserves
    // space inside the bubble.
    return (
      <article className="group/message flex min-w-0 flex-col items-end">
        <AgentMessageBubble role="user">
          <span data-allow-select="true">{item.content}</span>
        </AgentMessageBubble>
        <AgentMessageToolbar
          timestamp={item.timestamp}
          content={item.content}
          className="mt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
        />
      </article>
    )
  }

  return (
    <article className="flex min-w-0 flex-col items-start">
      <AgentMessageHeader
        agentIcon={agentIcon}
        timestamp={item.timestamp}
        className="mb-1"
      />
      <AssistantMessageBody
        item={item}
        onOpenReference={onOpenReference}
      />
    </article>
  )
}

function AssistantMessageBody({
  item,
  onOpenReference,
}: {
  readonly item: SynapseAgentMessageTimelineItem
  readonly onOpenReference: (reference: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const preprocessed = wrapLocalReferences(item.content)
  const renderedHtml = renderMarkdown(preprocessed)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const preElements = container.querySelectorAll("pre")
    for (const pre of preElements) {
      if (pre.querySelector(".code-copy-btn")) continue
      pre.style.position = "relative"
      pre.insertAdjacentHTML("beforeend", COPY_BUTTON_HTML)
    }
  }, [renderedHtml])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    const copyBtn = target.closest(".code-copy-btn")
    if (copyBtn) {
      event.preventDefault()
      const pre = copyBtn.closest("pre")
      if (pre) {
        const code = pre.querySelector("code")
        void navigator.clipboard.writeText(code?.textContent ?? pre.textContent ?? "")
      }
      return
    }

    const link = target.closest("a")
    if (link) {
      const href = link.getAttribute("href") ?? ""
      if (href.startsWith("file://") || href.startsWith("./") || href.startsWith("../") || href.startsWith("/")) {
        event.preventDefault()
        onOpenReference(href)
      }
    }
  }

  return (
    <div className="group/message max-w-[76ch] px-1 py-2">
      <div
        ref={containerRef}
        data-allow-select="true"
        className={cn(MARKDOWN_BODY_CLASSNAME, "[&_pre:hover_.code-copy-btn]:opacity-100")}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      <AgentMessageToolbar
        timestamp={item.timestamp}
        content={item.content}
        className="mt-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
      />
    </div>
  )
}

function wrapLocalReferences(content: string): string {
  return content.replace(LOCAL_REFERENCE_PATTERN, (match) => {
    if (match.startsWith("[")) return match
    return `[${match}](${match})`
  })
}

export { AgentMessageEvent, wrapLocalReferences }
export type { AgentMessageEventProps }
