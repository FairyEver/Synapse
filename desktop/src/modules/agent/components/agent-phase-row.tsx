import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  SynapseAgentPhaseTimelineItem,
  SynapseAgentPhaseValue,
} from "@/types/agent"

const PHASE_LABEL_IN_PROGRESS: Partial<Record<SynapseAgentPhaseValue, string>> = {
  // In Plan A `received` stays in-progress for the entire `agent.send` await
  // (no runtime-side phase emits yet), so its label needs to read like an
  // ongoing activity rather than a terminal acknowledgement. Plan B's
  // runtime_starting / request_submitted / streaming events will pre-empt
  // this row within a few ms.
  received: "Agent 处理中",
  runtime_starting: "Agent 启动中",
  request_submitted: "已提交给模型",
  awaiting_first_token: "等待回复",
  streaming: "正在回复",
  cancel_pending: "正在停止",
}

const PHASE_LABEL_DONE: Partial<Record<SynapseAgentPhaseValue, string>> = {
  submitted: "已发送",
  received: "已收到",
  runtime_starting: "Agent 已就绪",
  request_submitted: "已提交",
  awaiting_first_token: "模型已回应",
  streaming: "回复完成",
  completed: "已完成",
  cancel_pending: "已停止",
  cancelled: "已停止",
}

const PHASE_LABEL_FAILED: Partial<Record<SynapseAgentPhaseValue, string>> = {
  submitted: "已发送",
  received: "已收到",
  runtime_starting: "启动失败",
  request_submitted: "提交失败",
  awaiting_first_token: "等待超时",
  streaming: "回复中断",
  cancel_pending: "已停止",
  cancelled: "已停止",
  failed: "失败",
}

function pickLabel(item: SynapseAgentPhaseTimelineItem): string {
  if (item.status === "in-progress") return PHASE_LABEL_IN_PROGRESS[item.phase] ?? item.phase
  if (item.status === "failed") return PHASE_LABEL_FAILED[item.phase] ?? item.phase
  return PHASE_LABEL_DONE[item.phase] ?? item.phase
}

function elapsedSeconds(item: SynapseAgentPhaseTimelineItem, now: number): number {
  const start = Date.parse(item.startedAt)
  const end = item.completedAt ? Date.parse(item.completedAt) : now
  const ms = Math.max(0, end - start)
  return ms / 1000
}

function formatElapsed(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

function AgentPhaseRow({
  item,
  now,
}: {
  readonly item: SynapseAgentPhaseTimelineItem
  readonly now: number
}) {
  const failed = item.status === "failed"
  const inProgress = item.status === "in-progress"
  const label = pickLabel(item)
  const elapsed = elapsedSeconds(item, now)

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 px-1 py-1 text-xs",
        failed ? "text-destructive" : "text-muted-foreground",
      )}
      aria-live={inProgress ? "polite" : undefined}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex w-3 items-center justify-center">
          {inProgress ? (
            <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden />
          ) : failed ? (
            <X size={12} strokeWidth={2.5} aria-hidden />
          ) : (
            <Check size={12} strokeWidth={2.5} aria-hidden />
          )}
        </span>
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular-nums">{formatElapsed(elapsed)}</span>
      </div>
      {failed && item.errorMessage ? (
        <div className="pl-5 text-destructive">{item.errorMessage}</div>
      ) : null}
    </div>
  )
}

export { AgentPhaseRow }
