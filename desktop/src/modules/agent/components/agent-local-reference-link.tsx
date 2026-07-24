import {
  isValidElement,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import { ExternalLink, FolderSearch } from "lucide-react"
import { toast } from "sonner"
import type { Components } from "streamdown"
import { createRendererLogger } from "@/app-shell/logging"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { track } from "@/lib/ui-tracking"
import type { AgentReferenceActionResult } from "@/types/agent-reference-action"
import type { AgentReferenceActions } from "../hooks/use-agent-reference-actions"

type AgentReferenceOperation = "open_default" | "show_in_folder"
type AgentReferenceActionOutcome =
  | "accepted"
  | "ipc_failure"
  | Exclude<AgentReferenceActionResult, { ok: true }>["code"]

type AgentLocalReferenceLinkOptions = {
  readonly enabled: boolean
  readonly suppressNativeMenu: boolean
  readonly messageId: string
  readonly messageLength: number
  readonly referenceActions: AgentReferenceActions
}

type AgentLocalReferenceLinkProps = ComponentProps<"a"> & {
  readonly node?: unknown
  readonly options: AgentLocalReferenceLinkOptions
}

const logger = createRendererLogger("agent")

export function createAgentLocalReferenceLink(
  options: AgentLocalReferenceLinkOptions,
): Components["a"] {
  return function AgentMessageLocalReferenceLink(props) {
    return <AgentLocalReferenceLink {...props} options={options} />
  }
}

function AgentLocalReferenceLink({
  node: _node,
  href,
  children,
  onContextMenu,
  onKeyDown,
  options,
  ...props
}: AgentLocalReferenceLinkProps) {
  const reference = streamdownLinkReference(href, children)
  const localReference = reference && isLocalReferenceHref(reference) ? reference : undefined
  const handleKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !localReference || !options.enabled) return
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    event.currentTarget.dispatchEvent(new window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left,
      clientY: bounds.bottom,
    }))
  }
  const anchor = (
    <a
      {...props}
      data-reference={reference}
      href={href}
      onKeyDown={handleKeyDown}
      {...(options.suppressNativeMenu && localReference
        ? {
            onContextMenu: (event: MouseEvent<HTMLAnchorElement>) => {
              onContextMenu?.(event)
              event.preventDefault()
            },
          }
        : onContextMenu
          ? { onContextMenu }
          : {})}
    >
      {children}
    </a>
  )
  if (!options.enabled || !localReference) return anchor

  return (
    <ContextMenu data-track="agent-reference">
      <ContextMenuTrigger asChild className="select-text">
        {anchor}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => void runAgentReferenceAction("open_default", localReference, options)}
        >
          <ExternalLink data-icon="inline-start" />
          使用默认应用打开
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void runAgentReferenceAction("show_in_folder", localReference, options)}
        >
          <FolderSearch data-icon="inline-start" />
          在文件夹中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

async function runAgentReferenceAction(
  operation: AgentReferenceOperation,
  reference: string,
  options: AgentLocalReferenceLinkOptions,
): Promise<void> {
  let result: AgentReferenceActionOutcome
  try {
    const response = operation === "open_default"
      ? await options.referenceActions.openDefault(reference)
      : await options.referenceActions.showInFolder(reference)
    result = response.ok ? "accepted" : response.code
  } catch {
    result = "ipc_failure"
  }
  track({
    component: "agent",
    name: operation === "open_default"
      ? "agent-reference-open-default"
      : "agent-reference-show-in-folder",
    action: "complete",
    metadata: {
      operation,
      messageId: options.messageId,
      messageLength: options.messageLength,
      referenceLength: [...reference].length,
      result,
    },
  })
  if (result === "accepted") return

  logger.warn("agent.reference-action.failed", {
    boundary: "renderer.agent.reference-action",
    operation,
    messageId: options.messageId,
    result,
  })
  toast.error(operation === "open_default" ? "打开失败" : "在文件夹中显示失败")
}

export function isLocalReferenceHref(href: string): boolean {
  if (isBareWebDomainPathReference(href)) return false
  return isAbsoluteLocalReferenceHref(href)
    || href.startsWith("./")
    || href.startsWith("../")
    || href.startsWith(".\\")
    || href.startsWith("..\\")
    || /^[\w.-]+[\\/]/.test(href)
}

export function isBareWebDomainPathReference(reference: string): boolean {
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

export function isAbsoluteLocalReferenceHref(href: string): boolean {
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
