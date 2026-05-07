import { useState } from "react"
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { SynapseAgentPermissionRequestTimelineItem } from "@/types/agent"

type AgentPermissionCardProps = {
  readonly item: SynapseAgentPermissionRequestTimelineItem
  readonly pending: boolean
  readonly onRespond: (requestId: string, behavior: "allow" | "deny") => void
}

function AgentPermissionCard({ item, pending, onRespond }: AgentPermissionCardProps) {
  const [resolved, setResolved] = useState<"allow" | "deny" | null>(null)
  const body = item.toolInput ?? formatRawInput(item.toolInputRaw)
  const showActions = pending && resolved === null

  function handleRespond(behavior: "allow" | "deny") {
    setResolved(behavior)
    onRespond(item.requestId, behavior)
  }

  return (
    <Card className="border-l-2 border-l-primary py-3 px-4 my-1">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">{item.toolName}</span>
        {resolved === "allow" ? (
          <Badge variant="secondary" className="ml-auto">
            <ShieldCheck className="size-3" />
            已允许
          </Badge>
        ) : null}
        {resolved === "deny" ? (
          <Badge variant="destructive" className="ml-auto">
            <ShieldX className="size-3" />
            已拒绝
          </Badge>
        ) : null}
        {!pending && resolved === null ? (
          <Badge variant="secondary" className="ml-auto">已处理</Badge>
        ) : null}
      </div>

      {body ? (
        <Collapsible defaultOpen={body.length <= 300} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group/perm-trigger h-6 px-1 text-xs text-muted-foreground"
            >
              详情
              <ChevronDown className="size-3 transition-transform group-data-[state=closed]/perm-trigger:-rotate-90" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs leading-5">
              {body}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {showActions ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRespond("deny")}
          >
            <ShieldX data-icon="inline-start" />
            拒绝
          </Button>
          <Button
            size="sm"
            onClick={() => handleRespond("allow")}
          >
            <ShieldCheck data-icon="inline-start" />
            允许
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ""
}

export { AgentPermissionCard }
