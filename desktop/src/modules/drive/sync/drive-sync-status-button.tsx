import type { DriveSyncSnapshotDto } from "@synapse/shared"
import { Badge } from "@/components/ui/badge"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { activeTransferOf } from "./drive-sync-copy"

/**
 * 云盘顶栏的同步入口。
 * 角标只在需要处理时给出数字；正在传输时只给一个次要色圆点；正常时不显示。
 */
export function DriveSyncStatusButton({
  onOpen,
  snapshot,
}: {
  readonly onOpen: () => void
  readonly snapshot: DriveSyncSnapshotDto | null
}) {
  const attentionCount = countAttention(snapshot)
  const transferring = countTransferring(snapshot)

  return (
    <SystemAppTopBarActionButton
      type="button"
      tone={attentionCount > 0 ? "destructive" : "default"}
      aria-label={statusLabel(attentionCount, transferring)}
      onClick={onOpen}
    >
      同步
      {attentionCount > 0 ? <Badge variant="destructive">{attentionCount}</Badge> : null}
      {attentionCount === 0 && transferring > 0
        ? <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />
        : null}
    </SystemAppTopBarActionButton>
  )
}

function countAttention(snapshot: DriveSyncSnapshotDto | null): number {
  if (!snapshot) return 0
  const bindingIds = new Set(snapshot.bindings.map((binding) => binding.id))
  const conflicts = snapshot.conflicts.filter((conflict) => bindingIds.has(conflict.bindingId)).length
  const errors = snapshot.bindings.filter((binding) => binding.status === "error").length
  // 同步后台本身出错时也要在顶栏留一个信号，否则用户不会知道要打开面板处理。
  const health = snapshot.health.status === "error" ? 1 : 0
  return conflicts + errors + health
}

function countTransferring(snapshot: DriveSyncSnapshotDto | null): number {
  if (!snapshot) return 0
  return snapshot.bindings.filter((binding) => {
    if (binding.status === "initializing") return true
    if (binding.status !== "active") return false
    return activeTransferOf(snapshot.operations.filter((operation) => operation.bindingId === binding.id)) !== null
  }).length
}

function statusLabel(attentionCount: number, transferring: number): string {
  if (attentionCount > 0) return `同步：${attentionCount} 个同步项目需要处理`
  if (transferring > 0) return `同步：${transferring} 个同步项目正在工作`
  return "同步"
}
