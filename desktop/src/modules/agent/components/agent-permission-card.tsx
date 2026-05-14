import { useState } from "react"
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react"
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
  const [codeCollapsed, setCodeCollapsed] = useState(false)
  const body = item.toolInput ?? formatRawInput(item.toolInputRaw)
  const showActions = pending

  function handleRespond(behavior: "allow" | "deny") {
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
      <div
        className={cn("flex items-center gap-2 bg-muted/30 px-3 py-2", body && "cursor-pointer select-none")}
        onClick={body ? () => setCodeCollapsed(!codeCollapsed) : undefined}
      >
        <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">{item.toolName}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {!pending ? (
            <Badge variant="secondary">已处理</Badge>
          ) : null}
        </div>
      </div>

      {/* 代码区 */}
      {body && !codeCollapsed ? (
        <div className="border-t border-border bg-muted">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground">
            {body}
          </pre>
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
  return value ? JSON.stringify(sanitizeRawInput(value), null, 2) : ""
}

const REDACTED = "[redacted]"
const MAX_RAW_INPUT_STRING_LENGTH = 160
const sensitiveRawInputKeyPattern = /token|secret|api[-_]?key|authorization|cookie|password|credential/i

function sanitizeRawInput(value: unknown, key = ""): unknown {
  if (sensitiveRawInputKeyPattern.test(key)) return REDACTED
  if (typeof value === "string") return truncateRawInputString(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeRawInput(item))
  if (!value || typeof value !== "object") return value

  const sanitized: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = sanitizeRawInput(childValue, childKey)
  }
  return sanitized
}

function truncateRawInputString(value: string): string {
  if (value.length <= MAX_RAW_INPUT_STRING_LENGTH) return value
  return `${value.slice(0, MAX_RAW_INPUT_STRING_LENGTH)}...[truncated]`
}

export { AgentPermissionCard }
