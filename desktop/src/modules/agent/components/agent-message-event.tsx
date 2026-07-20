import { isValidElement, type ComponentProps, type MouseEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { CodeBlockCopyButton, Streamdown, type Components } from "streamdown"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import { MARKDOWN_BODY_CLASSNAME } from "@/components/markdown-viewer"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { redactSensitiveText } from "@/lib/agent-redaction"
import { sanitizeUrl } from "@/lib/url-sanitize"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentMessageTimelineItem,
} from "@/types/agent"
import { AgentMessageHeader } from "./agent-message-header"
import { AgentMessageBubble } from "./agent-message-bubble"
import { AgentMessageToolbar } from "./agent-message-toolbar"
import { AgentUsageCard } from "./agent-usage-card"
import { errorLogMeta } from "../utils"

import "streamdown/styles.css"

const LOCAL_REFERENCE_PATTERN = /(?:\[[^\]]+\]\((?:file:\/\/|[A-Za-z]:[\\/]|[\\/]{2}[^\\/]|\.{1,2}[\\/]|\/|[\w.-]+[\\/])[^)]+\)|(?:file:\/\/|[A-Za-z]:[\\/]|[\\/]{2}[^\\/]|\.{1,2}[\\/]|\/|[\w.-]+[\\/])[^\s`),，。；：！？（）【】]+(?::\d+(?::\d+)?)?)/g
const LOCAL_FILE_MARKDOWN_LINK_PATTERN = /(\[[^\]\r\n]+\])\(\s*(file:\/\/[^)\r\n]+?)\s*\)/g
const OBSIDIAN_WIKILINK_PATTERN = /!?\[\[([^\]\r\n]+)\]\]/g
const SHORT_UPPERCASE_PATH_PATTERN = /^[A-Z0-9]{2,6}(?:\/[A-Z0-9]{2,6})+$/
const TRAILING_REFERENCE_PUNCTUATION_PATTERN = /[.,;:!?，。；：！？]+$/
const STREAMDOWN_CONTROLS = {
  code: {
    copy: true,
    download: false,
  },
  mermaid: false,
  table: false,
} as const
const STREAMDOWN_TRANSLATIONS = {
  copied: "已复制",
  copyCode: "复制代码",
} as const
const agentMessageMarkdownClassName = cn(
  MARKDOWN_BODY_CLASSNAME,
  "min-w-0 max-w-full overflow-hidden break-words",
  "[&_[data-streamdown='code-block']]:max-w-full [&_[data-streamdown='code-block']]:overflow-hidden",
)
const STREAMDOWN_COMPONENTS = {
  a: ({ node: _node, href, children, ...props }) => {
    const reference = streamdownLinkReference(href, children)

    return (
      <a
        {...props}
        data-reference={reference}
        href={href}
      >
        {children}
      </a>
    )
  },
  code: AgentMessageCode,
  table: AgentMessageTable,
  thead: AgentMessageTableHeader,
  tbody: AgentMessageTableBody,
  tr: AgentMessageTableRow,
  th: AgentMessageTableHead,
  td: AgentMessageTableCell,
} satisfies Components
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
    <article className="flex w-full min-w-0 flex-col items-start">
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
  const streaming = item.streaming === true
  const safeContent = redactSensitiveText(item.content)
  const preprocessed = wrapLocalReferences(renderLocalMarkdownImagesAsReferences(renderObsidianWikilinksAsBoldText(safeContent)))
  const hasUsage = Boolean(item.metadata?.usage)

  const handleClick = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return

    const copyBtn = target.closest("[data-streamdown='code-block-copy-button']")
    if (copyBtn) {
      const block = copyBtn.closest("[data-streamdown='code-block']")
      const codeText = block?.querySelector("code")?.textContent ?? ""
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
      return
    }

    const link = target.closest("a")
    if (link) {
      const href = link.getAttribute("href") ?? ""
      const reference = link.getAttribute("data-reference") ?? href
      if (isLocalReferenceHref(reference)) {
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
            referenceLength: reference.length,
          },
        })
        onOpenReference(reference)
      } else {
        // External link — open in system browser via shell.openExternal
        event.preventDefault()
        try {
          await requireBridgeDomain("shell").openExternal(href)
        } catch (error) {
          logger.warn("agent.external-link.open.failed", {
            boundary: "renderer.agent.external-link",
            messageId: item.id,
            role: item.role,
            url: sanitizeUrl(href),
            hrefLength: href.length,
            ...errorLogMeta(error),
          })
          toast.error("无法打开外部链接")
        }
      }
    }
  }

  return (
    <div className="group/message w-full min-w-0 max-w-[76ch] px-1 py-2">
      <div
        data-allow-select="true"
        className="min-w-0 max-w-full overflow-hidden"
        onClick={handleClick}
      >
        <Streamdown
          className={agentMessageMarkdownClassName}
          components={STREAMDOWN_COMPONENTS}
          controls={STREAMDOWN_CONTROLS}
          isAnimating={streaming}
          linkSafety={{ enabled: false }}
          mode={streaming ? "streaming" : "static"}
          parseIncompleteMarkdown={streaming}
          translations={STREAMDOWN_TRANSLATIONS}
        >
          {preprocessed}
        </Streamdown>
      </div>
      {hasUsage ? (
        <AgentUsageCard
          totalUsage={item.metadata?.usage}
          turnUsage={item.metadata?.turnUsage}
          turnCostCny={item.metadata?.costCny}
          totalCostCny={item.metadata?.totalCostCny}
          turnCostBreakdownCny={item.metadata?.costBreakdownCny}
          totalCostBreakdownCny={item.metadata?.totalCostBreakdownCny}
          estimatedCost={item.metadata?.estimatedCost}
          timestamp={item.timestamp}
        />
      ) : null}
      <AgentMessageToolbar
        timestamp={item.timestamp}
        content={safeContent}
        messageId={item.id}
        role={item.role === "user" || item.role === "assistant" ? item.role : undefined}
        className="mt-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100"
      />
    </div>
  )
}

function AgentMessageCode({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"code"> & { readonly node?: unknown }) {
  if (!("data-block" in props)) {
    return (
      <code
        {...props}
        className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
      >
        {children}
      </code>
    )
  }

  const code = textFromReactNode(children).replace(/\n$/, "")
  const language = languageFromCodeClassName(className)

  return (
    <div
      data-streamdown="code-block"
      data-language={language}
      className="my-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-muted/40"
    >
      <div className="flex h-8 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-xs text-muted-foreground">{language}</span>
        <CodeBlockCopyButton
          code={code}
          title="复制代码"
          className="-mr-1"
        />
      </div>
      <pre className="!m-0 max-w-full overflow-hidden whitespace-pre-wrap break-all !rounded-none !border-0 !bg-transparent !p-3 text-sm leading-6">
        <code className="block min-w-0 max-w-full whitespace-pre-wrap break-all !bg-transparent !p-0 font-mono">
          {code}
        </code>
      </pre>
    </div>
  )
}

function AgentMessageTable({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"table"> & { readonly node?: unknown }) {
  return (
    <div
      data-streamdown="table-container"
      className="my-4 max-w-full overflow-x-auto rounded-md border border-border bg-background"
    >
      <table
        {...props}
        data-streamdown="table"
        className={cn("w-full table-fixed border-collapse text-sm", className)}
      >
        {children}
      </table>
    </div>
  )
}

function AgentMessageTableHeader({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"thead"> & { readonly node?: unknown }) {
  return (
    <thead
      {...props}
      data-streamdown="table-header"
      className={cn("bg-muted/40", className)}
    >
      {children}
    </thead>
  )
}

function AgentMessageTableBody({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"tbody"> & { readonly node?: unknown }) {
  return (
    <tbody
      {...props}
      data-streamdown="table-body"
      className={className}
    >
      {children}
    </tbody>
  )
}

function AgentMessageTableRow({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"tr"> & { readonly node?: unknown }) {
  return (
    <tr
      {...props}
      data-streamdown="table-row"
      className={className}
    >
      {children}
    </tr>
  )
}

function AgentMessageTableHead({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"th"> & { readonly node?: unknown }) {
  return (
    <th
      {...props}
      data-streamdown="table-header-cell"
      className={cn("font-medium", className)}
    >
      {children}
    </th>
  )
}

function AgentMessageTableCell({
  node: _node,
  className,
  children,
  ...props
}: ComponentProps<"td"> & { readonly node?: unknown }) {
  return (
    <td
      {...props}
      data-streamdown="table-cell"
      className={className}
    >
      {children}
    </td>
  )
}

function languageFromCodeClassName(className: string | undefined): string {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "text"
}

function textFromReactNode(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(textFromReactNode).join("")
  if (isValidElement<{ children?: ReactNode }>(value)) return textFromReactNode(value.props.children)
  return ""
}

function wrapLocalReferences(content: string): string {
  return transformMarkdownPlainText(content, wrapLocalReferencesInText)
}

function renderObsidianWikilinksAsBoldText(content: string): string {
  return transformMarkdownPlainText(content, renderObsidianWikilinksInText)
}

function renderLocalMarkdownImagesAsReferences(content: string): string {
  return transformMarkdownPlainText(content, renderLocalMarkdownImagesInText)
}

function transformMarkdownPlainText(content: string, transform: (value: string) => string): string {
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

    return transform(part)
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
  return transformInlinePlainText(
    normalizeLocalFileMarkdownLinks(content),
    wrapLocalReferencesInPlainText,
  )
}

function renderObsidianWikilinksInText(content: string): string {
  return transformInlinePlainText(content, renderObsidianWikilinksInPlainText)
}

function renderLocalMarkdownImagesInText(content: string): string {
  return transformInlinePlainText(content, renderLocalMarkdownImagesInPlainText)
}

function transformInlinePlainText(content: string, transform: (value: string) => string): string {
  const marker = /`+/.exec(content)
  if (!marker) return transform(content)

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
      result += transform(content.slice(cursor, start))
      result += content.slice(start)
      break
    }
    result += transform(content.slice(cursor, start))
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
    return `[${reference}](${markdownLinkDestination(reference)})${suffix}`
  })
}

function normalizeLocalFileMarkdownLinks(content: string): string {
  return content.replace(LOCAL_FILE_MARKDOWN_LINK_PATTERN, (_match, label: string, fileUrl: string) => {
    const reference = localPathFromFileUrl(fileUrl.trim())
    return `${label}(${markdownLinkDestination(reference)})`
  })
}

function localPathFromFileUrl(fileUrl: string): string {
  const path = fileUrl.slice("file://".length)
  const localPath = path.startsWith("/") ? path : `//${path}`
  const windowsPath = localPath.replace(/^\/([A-Za-z]:[\\/])/, "$1")

  try {
    return decodeURI(windowsPath)
  } catch {
    return windowsPath
  }
}

function renderObsidianWikilinksInPlainText(content: string): string {
  return content.replace(OBSIDIAN_WIKILINK_PATTERN, (_match, body: string) => {
    const wikilink = parseObsidianWikilink(body)
    if (!wikilink.displayText) return _match
    return `**${escapeMarkdownStrongText(wikilink.displayText)}**`
  })
}

const LOCAL_MARKDOWN_IMAGE_PATTERN = /!\[([^\]\r\n]*)\]\((<[^>\r\n]+>|[^)\r\n]+)\)/g

function renderLocalMarkdownImagesInPlainText(content: string): string {
  return content.replace(LOCAL_MARKDOWN_IMAGE_PATTERN, (match, altText: string, destination: string) => {
    const reference = markdownImageReference(destination)
    if (!reference || !isLocalReferenceHref(reference)) return match
    return `[${altText.trim() || reference}](${destination})`
  })
}

function markdownImageReference(destination: string): string | undefined {
  const value = destination.trim()
  if (!value) return undefined
  if (value.startsWith("<") && value.endsWith(">")) return value.slice(1, -1).trim()
  if (/\s/.test(value)) return undefined
  return value
}

type ParsedObsidianWikilink = {
  readonly target: string
  readonly alias?: string
  readonly displayText: string
}

function parseObsidianWikilink(body: string): ParsedObsidianWikilink {
  const pipeIndex = body.indexOf("|")
  const target = (pipeIndex === -1 ? body : body.slice(0, pipeIndex)).trim()
  const alias = pipeIndex === -1 ? undefined : body.slice(pipeIndex + 1).trim()
  const displayText = alias || displayTextFromWikilinkTarget(target)
  return { target, alias, displayText }
}

function displayTextFromWikilinkTarget(target: string): string {
  const pageTarget = target.split("#")[0]?.trim()
  if (pageTarget) return pageTarget.split("/").at(-1) ?? pageTarget
  return target.replace(/^#\^?/, "").trim()
}

function escapeMarkdownStrongText(value: string): string {
  return value.replace(/[\\*_`[\]]/g, "\\$&")
}

function markdownLinkHref(reference: string): string {
  if (isWindowsPathReference(reference)) {
    return `./${reference}`
  }
  if (isAbsoluteLocalReferenceHref(reference)
    || reference.startsWith("./")
    || reference.startsWith("../")
    || reference.startsWith(".\\")
    || reference.startsWith("..\\")) {
    return reference
  }
  return `./${reference}`
}

function markdownLinkDestination(reference: string): string {
  const href = markdownLinkHref(reference)
  return /[\\\s]/.test(href) ? `<${href}>` : href
}

function isWindowsPathReference(reference: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(reference)
    || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(reference)
    || reference.startsWith(".\\")
    || reference.startsWith("..\\")
    || /^[\w.-]+\\/.test(reference)
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
  if (isInsideMarkdownLinkDestination(content, offset)) {
    return false
  }
  if (isBareWebDomainPathReference(reference)) {
    return false
  }

  const previous = content[offset - 1]
  if (previous && /[\p{L}\p{N}_]/u.test(previous)) {
    return false
  }

  const pathWithoutLine = reference.replace(/:\d+(?::\d+)?$/, "")
  if (!/[\p{L}_]/u.test(pathWithoutLine)) {
    return false
  }
  if (SHORT_UPPERCASE_PATH_PATTERN.test(pathWithoutLine)) {
    return false
  }

  return true
}

function isInsideMarkdownLinkDestination(content: string, offset: number): boolean {
  const prefix = content.slice(0, offset)
  return prefix.lastIndexOf("](") > prefix.lastIndexOf(")")
}

function isProtocolUrlMatch(reference: string, content: string, offset: number): boolean {
  const prefix = content.slice(0, offset)
  return /[A-Za-z][A-Za-z0-9+.-]*:\/\/$/.test(prefix)
    || (reference.startsWith("//") && /[A-Za-z][A-Za-z0-9+.-]*:$/.test(prefix))
    || (reference.startsWith("/") && /[A-Za-z][A-Za-z0-9+.-]*:\/$/.test(prefix))
}

function isLocalReferenceHref(href: string): boolean {
  if (isBareWebDomainPathReference(href)) return false
  return isAbsoluteLocalReferenceHref(href)
    || href.startsWith("./")
    || href.startsWith("../")
    || href.startsWith(".\\")
    || href.startsWith("..\\")
    || /^[\w.-]+[\\/]/.test(href)
}

function isBareWebDomainPathReference(reference: string): boolean {
  if (reference.includes("\\")
    || isAbsoluteLocalReferenceHref(reference)
    || reference.startsWith("./")
    || reference.startsWith("../")
    || reference.startsWith(".\\")
    || reference.startsWith("..\\")) {
    return false
  }
  const pathWithoutLine = reference.replace(/:\d+(?::\d+)?$/, "")
  const firstSegment = pathWithoutLine.split("/")[0] ?? ""
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/u.test(firstSegment)
}

function isAbsoluteLocalReferenceHref(href: string): boolean {
  return href.startsWith("file://")
    || href.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(href)
    || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(href)
}

function streamdownLinkReference(href: string | undefined, children: ReactNode): string | undefined {
  if (!href) return href
  const childText = reactNodeText(children)
  if (isLocalReferenceHref(href) && isLocalReferenceHref(childText)) {
    return childText
  }
  return href
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(reactNodeText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeText(node.props.children)
  return ""
}

export { AgentMessageEvent, renderObsidianWikilinksAsBoldText, wrapLocalReferences }
export type { AgentMessageEventProps }
