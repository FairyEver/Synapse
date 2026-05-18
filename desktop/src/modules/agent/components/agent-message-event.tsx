import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import { renderMarkdown } from "@/lib/markdown"
import { MARKDOWN_BODY_CLASSNAME } from "@/components/markdown-viewer"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentMessageTimelineItem,
} from "@/types/agent"
import { AgentMessageHeader } from "./agent-message-header"
import { AgentMessageBubble } from "./agent-message-bubble"
import { AgentMessageToolbar } from "./agent-message-toolbar"
import { errorLogMeta } from "../utils"

const COPY_BUTTON_HTML = `<button type="button" class="code-copy-btn absolute right-2 top-2 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 transition-opacity" aria-label="复制代码"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>`

const LOCAL_REFERENCE_PATTERN = /(?:\[[^\]]+\]\((?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^)]+\)|(?:file:\/\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`),]+(?::\d+(?::\d+)?)?)/g
const SHORT_UPPERCASE_PATH_PATTERN = /^[A-Z0-9]{2,6}(?:\/[A-Z0-9]{2,6})+$/
const TRAILING_REFERENCE_PUNCTUATION_PATTERN = /[.,;:!?，。；：！？]+$/
const logger = createRendererLogger("agent")

interface AgentMessageEventProps {
  readonly item: SynapseAgentMessageTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly onOpenReference: (reference: string) => void
}

function AgentMessageEvent({
  item,
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
          messageId={item.id}
          role={item.role}
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
      pre.classList.add("relative")
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
        const codeText = code?.textContent ?? pre.textContent ?? ""
        track({
          component: "agent",
          name: "agent-code-copy",
          action: "click",
          metadata: {
            boundary: "renderer.agent.code-copy",
            messageId: item.id,
            role: item.role,
            contentLength: item.content.length,
            codeLength: codeText.length,
          },
        })
        void navigator.clipboard.writeText(codeText).catch((error: unknown) => {
          logger.warn("agent.code.copy.failed", {
            boundary: "renderer.agent.code-copy",
            messageId: item.id,
            role: item.role,
            contentLength: item.content.length,
            codeLength: codeText.length,
            ...errorLogMeta(error),
          })
          toast("复制失败")
        })
      }
      return
    }

    const link = target.closest("a")
    if (link) {
      const href = link.getAttribute("href") ?? ""
      if (isLocalReferenceHref(href)) {
        event.preventDefault()
        track({
          component: "agent",
          name: "agent-reference-open",
          action: "click",
          metadata: {
            boundary: "renderer.agent.reference-open",
            messageId: item.id,
            role: item.role,
            contentLength: item.content.length,
            referenceLength: href.length,
          },
        })
        onOpenReference(href)
      } else {
        // External link — open in system browser via shell.openExternal
        event.preventDefault()
        try {
          requireBridgeDomain("shell").openExternal(href)
        } catch (error) {
          logger.warn("agent.external-link.open.failed", {
            boundary: "renderer.agent.external-link",
            messageId: item.id,
            role: item.role,
            href,
            ...errorLogMeta(error),
          })
          toast.error("无法打开外部链接")
        }
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
        messageId={item.id}
        role={item.role === "user" || item.role === "assistant" ? item.role : undefined}
        className="mt-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
      />
    </div>
  )
}

function wrapLocalReferences(content: string): string {
  const parts = content.split(/(\r\n|\n|\r)/)
  let fence: MarkdownFence | undefined

  return parts.map((part, index) => {
    if (index % 2 === 1) return part

    const marker = markdownFence(part)
    if (fence) {
      if (marker && marker.char === fence.char && marker.length >= fence.length) {
        fence = undefined
      }
      return part
    }

    if (marker) {
      fence = marker
      return part
    }

    return wrapLocalReferencesInText(part)
  }).join("")
}

interface MarkdownFence {
  readonly char: "`" | "~"
  readonly length: number
}

function markdownFence(line: string): MarkdownFence | undefined {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line)
  const marker = match?.[1]
  if (!marker) return undefined
  return {
    char: marker[0] as "`" | "~",
    length: marker.length,
  }
}

function wrapLocalReferencesInText(content: string): string {
  const marker = /`+/.exec(content)
  if (!marker) return wrapLocalReferencesInPlainText(content)

  let result = ""
  let cursor = 0
  while (cursor < content.length) {
    const opening = /`+/.exec(content.slice(cursor))
    if (!opening) {
      result += wrapLocalReferencesInPlainText(content.slice(cursor))
      break
    }
    const start = cursor + opening.index
    const ticks = opening[0]
    const end = content.indexOf(ticks, start + ticks.length)
    if (end === -1) {
      result += wrapLocalReferencesInPlainText(content.slice(cursor, start))
      result += content.slice(start)
      break
    }
    result += wrapLocalReferencesInPlainText(content.slice(cursor, start))
    result += content.slice(start, end + ticks.length)
    cursor = end + ticks.length
  }
  return result
}

function wrapLocalReferencesInPlainText(content: string): string {
  return content.replace(LOCAL_REFERENCE_PATTERN, (match, offset: number) => {
    if (match.startsWith("[")) return match
    if (!shouldWrapLocalReference(match, offset, content)) return match
    const { reference, suffix } = splitTrailingReferencePunctuation(match)
    return `[${reference}](${reference})${suffix}`
  })
}

function splitTrailingReferencePunctuation(match: string): {
  readonly reference: string
  readonly suffix: string
} {
  const punctuation = TRAILING_REFERENCE_PUNCTUATION_PATTERN.exec(match)?.[0] ?? ""
  if (!punctuation) return { reference: match, suffix: "" }
  const reference = match.slice(0, -punctuation.length)
  return reference ? { reference, suffix: punctuation } : { reference: match, suffix: "" }
}

function shouldWrapLocalReference(reference: string, offset: number, content: string): boolean {
  if (isProtocolUrlMatch(reference, content, offset)) {
    return false
  }

  const previous = content[offset - 1]
  if (previous && /[\p{L}\p{N}_]/u.test(previous)) {
    return false
  }

  const pathWithoutLine = reference.replace(/:\d+(?::\d+)?$/, "")
  if (SHORT_UPPERCASE_PATH_PATTERN.test(pathWithoutLine)) {
    return false
  }

  return true
}

function isProtocolUrlMatch(reference: string, content: string, offset: number): boolean {
  const prefix = content.slice(0, offset)
  return /[A-Za-z][A-Za-z0-9+.-]*:\/\/$/.test(prefix)
    || (reference.startsWith("//") && /[A-Za-z][A-Za-z0-9+.-]*:$/.test(prefix))
    || (reference.startsWith("/") && /[A-Za-z][A-Za-z0-9+.-]*:\/$/.test(prefix))
}

function isLocalReferenceHref(href: string): boolean {
  return href.startsWith("file://")
    || href.startsWith("./")
    || href.startsWith("../")
    || href.startsWith("/")
    || /^[\w.-]+\//.test(href)
}

export { AgentMessageEvent, wrapLocalReferences }
export type { AgentMessageEventProps }
