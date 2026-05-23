import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Clipboard, Terminal, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"
import { AgentAnnotation } from "./agent-annotation"
import { errorLogMeta, formatAgentInputText, sanitizeAgentRawInput } from "../utils"

const logger = createRendererLogger("agent")

type AgentToolEventItem =
  | SynapseAgentToolCallTimelineItem
  | SynapseAgentToolResultTimelineItem
  | SynapseAgentPermissionRequestTimelineItem

function AgentToolEvent({
  item,
  profile,
}: {
  readonly item: AgentToolEventItem
  readonly profile: SynapseAgentDisplayProfile
}) {
  const rule = profile.tools?.[item.toolName]
  const label = rule?.label ?? profile.aliases?.[item.toolName] ?? item.toolName
  const body = toolBody(item)
  const failed = isFailedToolResult(item)
  const permission = item.kind === "permissionRequest"
  const defaultOpen = permission || failed || shouldDefaultOpen(
    body,
    rule?.defaultCollapsed ?? profile.toolDefaultCollapsed,
  )
  const status = statusLabel(item, profile)
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle")
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleCopy = () => {
    track({
      component: "agent",
      name: "agent-tool-copy",
      action: "click",
      metadata: {
        boundary: "renderer.agent.tool-copy",
        itemId: item.id,
        kind: item.kind,
        toolName: item.toolName,
        bodyLength: body.length,
      },
    })
    void navigator.clipboard.writeText(body).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopyState("success")
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined
        setCopyState("idle")
      }, 1500)
    }).catch((error: unknown) => {
      logger.warn("Agent tool body copy failed.", {
        boundary: "renderer.agent.tool-copy",
        itemId: item.id,
        kind: item.kind,
        toolName: item.toolName,
        bodyLength: body.length,
        ...errorLogMeta(error),
      })
      toast("复制失败")
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopyState("error")
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined
        setCopyState("idle")
      }, 1500)
    })
  }

  return (
    <AgentAnnotation>
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="group/agent-event-trigger h-7 w-full min-w-0 justify-start gap-1.5 px-0 py-0 text-xs hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
          >
            <Terminal className="size-3.5 text-muted-foreground" />
            <span className="truncate">{label}</span>
            {status ? (
              <Badge
                variant={failed ? "destructive" : "secondary"}
                className="ml-1 h-5 shrink-0 text-xs"
              >
                {status}
              </Badge>
            ) : null}
            <ChevronDown
              data-icon="inline-end"
              className="size-3.5 transition-transform group-data-[state=closed]/agent-event-trigger:-rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="group relative flex flex-col gap-2 pb-2 pt-1">
            {body ? (
              <>
                <div className="max-h-60 min-w-0 max-w-full overflow-y-auto overflow-x-hidden rounded bg-muted/50 px-2 py-1.5">
                  <pre data-allow-select="true" className="min-w-0 max-w-full whitespace-pre-wrap break-all font-mono text-xs leading-5 text-muted-foreground">
                    {previewText(body, rule?.previewChars ?? profile.toolPreviewChars)}
                  </pre>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="复制工具输出"
                  className="absolute right-1 top-1 size-6 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
                  onClick={handleCopy}
                >
                  {copyState === "success" ? (
                    <Check className="size-3.5" />
                  ) : copyState === "error" ? (
                    <X className="size-3.5 text-destructive" />
                  ) : (
                    <Clipboard className="size-3.5" />
                  )}
                </Button>
              </>
            ) : null}
            {item.kind === "toolResult" && typeof item.exitCode === "number" ? (
              <span className="text-xs text-muted-foreground">exit {item.exitCode}</span>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </AgentAnnotation>
  )
}

function toolBody(item: AgentToolEventItem): string {
  if (item.kind === "toolResult") return item.content ?? ""
  return item.toolInput ? formatAgentInputText(item.toolInput) : formatRawInput(item.toolInputRaw)
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(sanitizeAgentRawInput(value), null, 2) : ""
}

function statusLabel(item: AgentToolEventItem, profile: SynapseAgentDisplayProfile): string {
  if (item.kind === "permissionRequest") return profile.statusLabels.pending
  if (item.kind === "toolCall") return profile.statusLabels.running
  if (isDeniedToolResult(item)) return profile.statusLabels.denied
  if (isFailedToolResult(item)) return profile.statusLabels.error
  return profile.statusLabels.success
}

function isDeniedToolResult(item: AgentToolEventItem): boolean {
  return item.kind === "toolResult" && item.status?.toLowerCase() === "denied"
}

function isFailedToolResult(item: AgentToolEventItem): boolean {
  if (item.kind !== "toolResult") return false
  if (item.success === false) return true
  if (typeof item.exitCode === "number" && item.exitCode !== 0) return true
  const status = item.status?.toLowerCase()
  return status === "failed" || status === "error" || status === "denied"
}

function shouldDefaultOpen(body: string, mode: "expanded" | "collapsed" | "auto"): boolean {
  if (mode === "expanded") return true
  if (mode === "collapsed") return false
  return body.trim().length > 0 && body.length <= 400
}

function previewText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit).trimEnd()}\n...`
}

export { AgentToolEvent }
