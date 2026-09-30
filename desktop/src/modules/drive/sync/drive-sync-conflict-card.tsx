import type { DriveSyncConflictDto } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { conflictResolutionText, conflictTypeText } from "./drive-sync-copy"

/**
 * 单个冲突。先说清哪边是什么，再给选择；按钮只按服务端给出的可用动作渲染。
 */
export function DriveSyncConflictCard({
  conflict,
  disabled,
  onResolve,
}: {
  readonly conflict: DriveSyncConflictDto
  readonly disabled: boolean
  readonly onResolve: (conflict: DriveSyncConflictDto, action: DriveSyncConflictDto["availableActions"][number]) => void
}) {
  return (
    <div className="rounded-lg border p-3" data-sync-conflict="true">
      <div className="truncate font-medium">{conflict.relativePath || "/"}</div>
      <div className="mt-1 text-sm text-muted-foreground">{conflictTypeText(conflict.type)}</div>
      {conflict.localSummary || conflict.remoteSummary ? (
        <dl className="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {conflict.localSummary ? (
            <>
              <dt className="text-muted-foreground">电脑</dt>
              <dd className="truncate tabular-nums">{conflict.localSummary}</dd>
            </>
          ) : null}
          {conflict.remoteSummary ? (
            <>
              <dt className="text-muted-foreground">云盘</dt>
              <dd className="truncate tabular-nums">{conflict.remoteSummary}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {conflict.availableActions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === "confirm_delete" ? "destructive" : "outline"}
            disabled={disabled}
            onClick={() => onResolve(conflict, action)}
          >
            {conflictResolutionText(action)}
          </Button>
        ))}
      </div>
    </div>
  )
}
