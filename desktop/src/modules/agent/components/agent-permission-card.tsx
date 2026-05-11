import { useState } from "react"
import { ChevronUp, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SynapseAgentPermissionRequestTimelineItem } from "@/types/agent"

type AgentPermissionCardProps = {
  readonly item: SynapseAgentPermissionRequestTimelineItem
  readonly pending: boolean
  readonly isLatestPending: boolean
  readonly onRespond: (requestId: string, behavior: "allow" | "deny") => void
}

function AgentPermissionCard({ item, pending, isLatestPending, onRespond }: AgentPermissionCardProps) {
  const [resolved, setResolved] = useState<"allow" | "deny" | null>(null)
  const [codeCollapsed, setCodeCollapsed] = useState(false)
  const body = item.toolInput ?? formatRawInput(item.toolInputRaw)
  const showActions = pending && resolved === null
  const isAllowed = resolved === "allow"
  const isDenied = resolved === "deny"

  function handleRespond(behavior: "allow" | "deny") {
    setResolved(behavior)
    onRespond(item.requestId, behavior)
  }

  return (
    <div
      className={cn(
        "my-1 overflow-hidden rounded-lg border border-border bg-card",
        isLatestPending && showActions && "ring-2 ring-primary",
      )}
    >
      {/* 标题区 */}
      <div className="flex items-center gap-2 bg-muted/30 px-3 py-2">
        {isAllowed ? (
          <ShieldCheck className="size-4 shrink-0 text-green-500" />
        ) : isDenied ? (
          <ShieldX className="size-4 shrink-0 text-destructive" />
        ) : (
          <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-semibold">{item.toolName}</span>
        {isAllowed ? (
          <Badge variant="secondary" className="ml-auto gap-1 border-green-200 bg-green-50 text-green-600">
            <ShieldCheck className="size-3" />
            已允许
          </Badge>
        ) : isDenied ? (
          <Badge variant="destructive" className="ml-auto gap-1">
            <ShieldX className="size-3" />
            已拒绝
          </Badge>
        ) : !pending && resolved === null ? (
          <Badge variant="secondary" className="ml-auto">已处理</Badge>
        ) : null}
      </div>

      {/* 代码区 */}
      {body ? (
        <div className="relative border-t border-border bg-muted">
          {!codeCollapsed ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 pr-8 font-mono text-xs leading-5 text-foreground">
              {body}
            </pre>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCodeCollapsed(!codeCollapsed)}
            className="absolute right-1 top-1 h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            aria-label={codeCollapsed ? "展开代码" : "折叠代码"}
          >
            <ChevronUp className={cn("size-3 transition-transform", codeCollapsed && "rotate-180")} />
          </Button>
        </div>
      ) : null}

      {/* 操作区 */}
      {showActions ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
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
    </div>
  )
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(value, null, 2) : ""
}

export { AgentPermissionCard }
