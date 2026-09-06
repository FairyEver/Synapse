import { useState } from "react"
import { AlertCircle, FileDiff, Info } from "lucide-react"
import {
  Alert,
  AlertAction,
  AlertDescription,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentFileCheckpointTimelineItem,
  SynapseAgentPendingPermission,
  SynapseAgentPermissionScope,
  SynapseAgentTimelineItem,
  SynapseAgentToolProgressTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"
import type { AgentReferenceActions } from "../hooks/use-agent-reference-actions"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentAnnotation } from "./agent-annotation"
import { AgentPermissionCard } from "./agent-permission-card"
import { AgentThinkingEvent } from "./agent-thinking-event"
import { AgentToolEvent } from "./agent-tool-event"
import { AgentUserQuestionCard } from "./agent-user-question-card"
import { useAgentWorkspacePanel } from "./agent-workspace-shell"

function AgentTimelineItem({
  item,
  profile,
  agentIcon,
  pendingPermissions,
  latestPendingItemIds,
  onOpenReference,
  referenceActions,
  onRespondPermission,
  onContinue,
  toolResult,
  toolCancelled,
}: {
  readonly item: SynapseAgentTimelineItem
  readonly toolResult?: SynapseAgentToolResultTimelineItem
  readonly toolCancelled?: boolean
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly latestPendingItemIds?: ReadonlySet<string>
  readonly onOpenReference: (reference: string) => void
  readonly referenceActions?: AgentReferenceActions
  readonly onRespondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => void | Promise<void>
  readonly onContinue?: () => void
}) {
  switch (item.kind) {
    case "message":
      return (
        <AgentMessageEvent
          item={item}
          profile={profile}
          agentIcon={agentIcon}
          onOpenReference={onOpenReference}
          referenceActions={referenceActions}
        />
      )
    case "thinking":
      return <AgentThinkingEvent item={item} profile={profile} />
    case "toolCall":
    case "toolResult":
      return <AgentToolEvent item={item} result={toolResult} cancelled={toolCancelled} profile={profile} />
    case "toolProgress":
      return <AgentToolProgressEvent item={item} />
    case "permissionRequest": {
      const hasPendingRequest = pendingPermissions.some((p) => p.requestId === item.requestId)
      const isPending = hasPendingRequest && (latestPendingItemIds?.has(item.id) ?? true)
      const isLatestPending =
        isPending && pendingPermissions[pendingPermissions.length - 1]?.requestId === item.requestId
      if (isAskUserQuestionItem(item)) {
        return (
          <AgentUserQuestionCard
            item={item}
            pending={isPending}
            isLatestPending={isLatestPending}
            onRespond={onRespondPermission}
          />
        )
      }
      return (
        <AgentPermissionCard
          item={item}
          pending={isPending}
          isLatestPending={isLatestPending}
          onRespond={onRespondPermission}
        />
      )
    }
    case "error":
      if (!item.message || item.message.trim().length === 0) return null
      if (item.recoverable) {
        return (
          <Alert>
            <Info data-icon="inline-start" />
            <AlertDescription className="whitespace-pre-wrap break-words">{item.message}</AlertDescription>
            {onContinue ? (
              <AlertAction>
                <Button type="button" variant="outline" size="sm" onClick={onContinue}>
                  继续
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        )
      }
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription className="whitespace-pre-wrap break-words">{item.message}</AlertDescription>
        </Alert>
      )
    case "result": {
      const outcome = item.metadata?.turnOutcome
      if (outcome?.status === "cancelled") {
        return (
          <Alert>
            <Info data-icon="inline-start" />
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )
      }
      return null
    }
    case "phase":
      // Phase rows render through AgentPhaseRow inside AgentTimeline; this
      // branch is unreachable in the current call path but keeps the switch
      // exhaustive without coupling AgentTimelineItem to phase rendering.
      return null
    case "sdkEvent":
      return (
        <AgentAnnotation>
          <div className="flex min-w-0 items-center gap-2 px-0 py-1 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            <span className="shrink-0">{item.label}</span>
            <Badge variant="secondary" className="h-5 shrink-0 text-xs">
              {item.sdkType}
            </Badge>
            {item.sdkSubtype ? (
              <span className="truncate">{item.sdkSubtype}</span>
            ) : item.summary ? (
              <span className="truncate">{item.summary}</span>
            ) : null}
          </div>
        </AgentAnnotation>
      )
    case "fileCheckpoint":
      return <AgentFileCheckpointCard item={item} />
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

function AgentFileCheckpointCard({ item }: { readonly item: SynapseAgentFileCheckpointTimelineItem }) {
  const { openPanel } = useAgentWorkspacePanel()
  const [expanded, setExpanded] = useState(false)
  const visibleFiles = expanded ? item.files : item.files.slice(0, 3)
  const hiddenFileCount = item.files.length - visibleFiles.length
  const statusLabel = item.status === "available"
    ? "可撤销"
    : item.status === "rewound"
      ? "已撤销"
      : item.status === "partial"
        ? "部分撤销"
        : item.status === "unavailable"
          ? "不可用"
          : "仅可审查"
  return (
    <section className="overflow-hidden rounded-lg border" aria-label={`已编辑 ${item.fileCount} 个文件`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <FileDiff className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">已编辑 {item.fileCount} 个文件</div>
          <div className="text-xs text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">+{item.insertions}</span>{" "}
            <span className="text-destructive">-{item.deletions}</span>
          </div>
          {item.coverageWarning ? (
            <div className="text-xs text-muted-foreground">终端或子智能体修改可能不在撤销范围内</div>
          ) : null}
        </div>
        <Badge variant="secondary">{statusLabel}</Badge>
        {item.status === "available" ? (
          <Button
            id={`agent-file-checkpoint-${item.checkpointId}-rewind`}
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => openPanel({
              panelId: "agent.file-diff",
              payload: { checkpointId: item.checkpointId, action: "rewind" },
            })}
          >
            撤销
          </Button>
        ) : null}
        {item.files.length > 0 ? <Button
          id={`agent-file-checkpoint-${item.checkpointId}-review`}
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openPanel({
            panelId: "agent.file-diff",
            payload: { checkpointId: item.checkpointId },
          })}
        >
          审查
        </Button> : null}
      </div>
      {item.files.length > 0 ? <div className="border-t py-1">
        {visibleFiles.map((file) => (
          <Button
            key={file.id}
            id={`agent-file-checkpoint-${item.checkpointId}-file-${file.id}`}
            type="button"
            variant="ghost"
            className="flex h-8 w-full justify-start rounded-none px-3 font-normal"
            onClick={() => openPanel({
              panelId: "agent.file-diff",
              payload: { checkpointId: item.checkpointId, fileId: file.id },
            })}
          >
            <span className="min-w-0 flex-1 truncate text-left text-sm">{file.path}</span>
            <span className="ml-3 shrink-0 text-xs tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{file.insertions}</span>{" "}
              <span className="text-destructive">-{file.deletions}</span>
            </span>
          </Button>
        ))}
        {hiddenFileCount > 0 || expanded ? (
          <Button
            type="button"
            variant="ghost"
            className="h-8 w-full justify-start rounded-none px-3 font-normal"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起" : `再显示 ${hiddenFileCount} 个文件`}
          </Button>
        ) : null}
      </div> : null}
    </section>
  )
}

function AgentToolProgressEvent({ item }: { readonly item: SynapseAgentToolProgressTimelineItem }) {
  const size = formatInputSize(item.inputCharCount)
  return (
    <AgentAnnotation>
      <div className="flex min-w-0 items-center gap-2 px-0 py-1 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        <span className="truncate">
          {item.status === "stopped" ? "已停止，工具未执行" : `正在准备 ${item.toolName}`}
        </span>
        {item.status === "preparing" && size ? (
          <Badge variant="secondary" className="h-5 shrink-0 text-xs">
            {size}
          </Badge>
        ) : null}
      </div>
    </AgentAnnotation>
  )
}

function formatInputSize(chars: number): string | undefined {
  if (chars <= 0) return undefined
  if (chars < 1024) return `${chars} B`
  const kb = chars / 1024
  if (kb < 1024) return `${formatSizeNumber(kb)} KB`
  return `${formatSizeNumber(kb / 1024)} MB`
}

function formatSizeNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function isAskUserQuestionItem(item: SynapseAgentTimelineItem): boolean {
  return item.kind === "permissionRequest" && item.toolName === "AskUserQuestion"
}

export { AgentTimelineItem }
