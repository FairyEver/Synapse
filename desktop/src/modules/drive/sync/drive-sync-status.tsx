import { CircleAlert, CircleCheck, Clock3, LoaderCircle, Pause } from "lucide-react"
import type { DriveSyncBindingDto, DriveSyncConflictDto, DriveSyncOperationDto } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  activeWorkOf,
  bindingListStateText,
  bindingPrimaryAction,
  bindingStateDetail,
  formatBytes,
  formatRelativeTime,
  formatSyncTimestamp,
  retryOperationOf,
} from "./drive-sync-copy"
import { DriveSyncDiagnostics } from "./drive-sync-diagnostics"
import type { DriveSyncController } from "./use-drive-sync"

export function DriveSyncStatus({
  binding,
  operations,
  conflicts,
  controller,
}: {
  readonly binding: DriveSyncBindingDto
  readonly operations: readonly DriveSyncOperationDto[]
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly controller: DriveSyncController
}) {
  const state = bindingListStateText(binding, operations, conflicts)
  const detail = bindingStateDetail(binding, operations, conflicts)
  const action = bindingPrimaryAction(binding, operations, conflicts, controller.readOnly)
  const work = activeWorkOf(operations)
  const retry = !controller.readOnly && state.text === "等待重试" ? retryOperationOf(operations) : null
  const retryAt = formatSyncTimestamp(retry?.nextRetryAt)
  const lastSynced = formatSyncTimestamp(binding.lastSyncedAt)
  const Icon =
    state.tone === "attention"
      ? CircleAlert
      : state.text === "等待重试"
        ? Clock3
        : binding.status === "paused"
          ? Pause
          : work || binding.status === "initializing"
            ? LoaderCircle
            : binding.lastSyncedAt
              ? CircleCheck
              : Clock3
  const messages = [
    binding.lastError ?? "",
    ...operations
      .filter((op) => op.status === "retry_wait" || op.status === "error")
      .map((op) => op.message ?? ""),
  ]
  const runAction = () => {
    const resume = action.kind === "retry" || action.kind === "resume"
    void controller.runBindingAction(
      action.kind === "retry"
        ? "drive.sync.binding.retry"
        : resume
          ? "drive.sync.binding.resume"
          : "drive.sync.binding.pause",
      binding.id,
      () => (resume ? controller.resume(binding.id) : controller.pause(binding.id)),
      action.kind === "retry" ? "已重试同步" : resume ? "已继续同步" : "已暂停同步",
      resume,
    )
  }
  return (
    <section aria-label="同步状态" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          role="status"
          className={`flex items-center gap-2 font-medium ${state.tone === "attention" ? "text-destructive" : ""}`}
        >
          <Icon className="size-4" />
          {state.text}
        </h3>
        {!controller.readOnly ? (
          <Button
            type="button"
            variant={action.kind === "retry" || action.kind === "resume" ? "default" : "outline"}
            disabled={controller.isPending(binding.id) || binding.status === "initializing"}
            aria-label={`${action.kind === "retry" || action.kind === "resume" ? action.label : "暂停同步"} ${binding.driveItemName}`}
            onClick={runAction}
          >
            {action.kind === "retry" || action.kind === "resume" ? action.label : "暂停同步"}
          </Button>
        ) : null}
      </div>
      {controller.readOnly ? (
        <p className="text-sm text-muted-foreground">
          {controller.offline ? "当前离线，同步已暂停。联网后会自动继续。" : "未登录，仅可查看同步状态。"}
        </p>
      ) : null}
      {detail && binding.status !== "paused" ? (
        <p className="min-w-0 break-words text-pretty text-sm">{detail}</p>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">最近成功同步</dt>
        <dd>
          {lastSynced ? (
            <time dateTime={binding.lastSyncedAt!} title={lastSynced}>
              {formatRelativeTime(binding.lastSyncedAt)}
            </time>
          ) : (
            "尚未同步"
          )}
        </dd>
        {retry ? (
          <>
            <dt className="text-muted-foreground">计划重试</dt>
            <dd>{retryAt ? <time dateTime={retry.nextRetryAt!}>{retryAt}</time> : "等待系统安排"}</dd>
          </>
        ) : null}
      </dl>
      {work?.kind === "transfer" && work.percent !== null ? (
        <div className="grid gap-1">
          <Progress value={work.percent} aria-label={`${binding.driveItemName} 同步进度`} />
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatBytes(work.completedBytes)} / {formatBytes(work.totalBytes ?? 0)}
          </p>
        </div>
      ) : null}
      <DriveSyncDiagnostics messages={messages} attempts={retry?.attemptCount} />
    </section>
  )
}
