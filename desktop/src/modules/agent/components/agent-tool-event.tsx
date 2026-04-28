import { ChevronDown, Clipboard, Terminal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"

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
  const status = statusLabel(item, profile)
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="min-w-0 justify-start px-0">
            <ChevronDown data-icon="inline-start" />
            <Terminal data-icon="inline-start" />
            <span className="truncate">{label}</span>
          </Button>
        </CollapsibleTrigger>
        <Badge variant={failed ? "destructive" : "secondary"}>{status}</Badge>
      </div>
      <CollapsibleContent>
        <Separator />
        <div className="flex flex-col gap-2 p-3">
          {body ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
              {previewText(body, rule?.previewChars ?? profile.toolPreviewChars)}
            </pre>
          ) : null}
          {item.kind === "toolResult" && typeof item.exitCode === "number" ? (
            <span className="text-xs text-muted-foreground">exit {item.exitCode}</span>
          ) : null}
          {body ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void navigator.clipboard.writeText(body)}
            >
              <Clipboard data-icon="inline-start" />
              复制
            </Button>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
