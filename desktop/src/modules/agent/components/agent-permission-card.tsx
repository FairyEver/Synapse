import { useEffect, useState } from "react"
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentPermissionScope,
} from "@/types/agent"
import { formatAgentInputText, sanitizeAgentRawInput } from "../utils"

type AgentPermissionCardProps = {
  readonly item: SynapseAgentPermissionRequestTimelineItem
  readonly pending: boolean
  readonly isLatestPending: boolean
  readonly onRespond: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => void | Promise<void>
}

function AgentPermissionCard({ item, pending, isLatestPending, onRespond }: AgentPermissionCardProps) {
  const [codeCollapsed, setCodeCollapsed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Reset submitting state when the permission is no longer pending (submission succeeded)
  useEffect(() => {
    if (submitting && !pending) {
      setSubmitting(false)
    }
  }, [submitting, pending])

  const body = item.toolInput ? formatAgentInputText(item.toolInput) : formatRawInput(item.toolInputRaw)
  const showActions = pending

  async function handleRespond(behavior: "allow" | "deny", scope?: SynapseAgentPermissionScope) {
    if (submitting) return
    setSubmitting(true)
    track({
      component: "agent",
      name: "agent-permission-card-response",
      action: "submit",
      value: behavior,
      metadata: {
        boundary: "renderer.agent.permission-card-response",
        itemId: item.id,
        requestId: item.requestId,
        toolName: item.toolName,
        behavior,
        ...(scope ? { scope } : {}),
        inputLength: body.length,
        hasRawInput: Boolean(item.toolInputRaw),
        ...(item.sdkSessionId ? { sdkSessionId: item.sdkSessionId } : {}),
        ...(item.agentSessionId ? { agentSessionId: item.agentSessionId } : {}),
        ...(item.threadId ? { threadId: item.threadId } : {}),
      },
    })
    try {
      if (scope) {
        await onRespond(item.requestId, behavior, undefined, undefined, scope)
      } else {
        await onRespond(item.requestId, behavior)
      }
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-agent-permission-request-id={item.requestId}
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
          <ScrollArea className="max-h-48 p-3" scrollbars="both">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{body}</pre>
          </ScrollArea>
        </div>
      ) : null}

      {/* 操作区 */}
      {showActions ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={() => handleRespond("deny")}
          >
            <ShieldX data-icon="inline-start" />
            拒绝
          </Button>
          <Button
            size="sm"
            disabled={submitting}
            variant={item.sessionDirectoryGrantAvailable ? "outline" : "default"}
            onClick={() => handleRespond(
              "allow",
              item.sessionDirectoryGrantAvailable ? "once" : undefined,
            )}
          >
            <ShieldCheck data-icon="inline-start" />
            {item.sessionDirectoryGrantAvailable ? "允许一次" : "允许"}
          </Button>
          {item.sessionDirectoryGrantAvailable ? (
            <Button
              size="sm"
              disabled={submitting}
              onClick={() => handleRespond("allow", "session")}
            >
              本会话允许
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function formatRawInput(value: Record<string, unknown> | undefined): string {
  return value ? JSON.stringify(sanitizeAgentRawInput(value), null, 2) : ""
}

export { AgentPermissionCard }
