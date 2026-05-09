import { ChevronDown, Clipboard, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  const failed = item.kind === "toolResult" && item.success === false
  const permission = item.kind === "permissionRequest"
  const defaultOpen = permission || failed || shouldDefaultOpen(
    body,
    rule?.defaultCollapsed ?? profile.toolDefaultCollapsed,
  )
  const status = item.kind === "toolCall" ? null : statusLabel(item, profile)
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
                className="ml-1 h-5 shrink-0 text-[10px]"
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
          <div className="relative flex flex-col gap-2 pb-2 pt-1">
            {body ? (
              <>
                <pre data-allow-select="true" className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 px-2 py-1.5 font-mono text-xs leading-5 text-muted-foreground">
                  {previewText(body, rule?.previewChars ?? profile.toolPreviewChars)}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 size-6 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
                  onClick={() => void navigator.clipboard.writeText(body)}
                >
                  <Clipboard className="size-3.5" />
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
  return item.toolInput ?? formatRawInput(item.toolInputRaw)
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ""
}

function statusLabel(item: AgentToolEventItem, profile: SynapseAgentDisplayProfile): string {
  if (item.kind === "permissionRequest") return profile.statusLabels.pending
  if (item.kind === "toolCall") return profile.statusLabels.running
  if (item.success === false) return profile.statusLabels.error
  return profile.statusLabels.success
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
