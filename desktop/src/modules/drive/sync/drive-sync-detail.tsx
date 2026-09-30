import { useState } from "react"
import { toast } from "sonner"
import type { DriveSyncBindingDto, DriveSyncConflictDto } from "@synapse/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  activeWorkOf,
  bindingPrimaryAction,
  bindingStateDetail,
  bindingStateText,
  conflictResolutionToast,
  formatBytes,
  formatRelativeTime,
  operationActivityText,
} from "./drive-sync-copy"
import { DriveSyncConflictCard } from "./drive-sync-conflict-card"
import { DriveSyncExcludeEditor } from "./drive-sync-exclude-editor"
import { driveSyncRemotePath, type DriveSyncController } from "./use-drive-sync"

const ACTIVITY_LIMIT = 8

export function DriveSyncDetail({
  binding,
  conflicts,
  controller,
  onOpenDriveItem,
  onRequestRemove,
}: {
  readonly binding: DriveSyncBindingDto
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly controller: DriveSyncController
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestRemove: () => void
}) {
  const [editingExcludes, setEditingExcludes] = useState(false)
  const [excludeCandidates, setExcludeCandidates] = useState<readonly string[] | null>(null)

  const operations = (controller.snapshot?.operations ?? []).filter((operation) => operation.bindingId === binding.id)
  const state = bindingStateText(binding, operations, conflicts)
  const detail = bindingStateDetail(binding, operations, conflicts)
  const action = bindingPrimaryAction(binding, operations, conflicts, controller.readOnly)
  const work = activeWorkOf(operations)
  const pending = controller.isPending(binding.id)
  const readOnly = controller.readOnly
  // 同一条规则可能同时出现在多个规则组里，展示时按规则去重，避免重复的 React key。
  const excludedRules = Array.from(new Set([
    ...binding.excludeRules.defaults,
    ...binding.excludeRules.user,
    ...binding.excludeRules.importedGitignore,
  ]))
  const activity = [...operations]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, ACTIVITY_LIMIT)

  const openExcludeEditor = () => {
    setEditingExcludes(true)
    if (excludeCandidates !== null) return
    void controller.preview({
      driveItemId: binding.driveItemId,
      driveItemName: binding.driveItemName,
      kind: binding.kind,
      drivePathHint: binding.drivePathHint,
      localPath: binding.localPath,
      remoteExists: true,
      directionHint: "bind_existing",
    })
      .then((preview) => setExcludeCandidates(preview.defaultExcludeRules))
      .catch(() => setExcludeCandidates([]))
  }

  const runStatusAction = () => {
    if (action.kind === "view") return
    if (action.kind === "retry") {
      void controller.runBindingAction("drive.sync.binding.retry", binding.id, () => controller.resume(binding.id), "已重试同步")
      return
    }
    if (action.kind === "resume") {
      void controller.runBindingAction("drive.sync.binding.resume", binding.id, () => controller.resume(binding.id), "已继续同步")
      return
    }
    if (action.kind === "open") {
      void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置"))
      return
    }
    if (action.kind === "conflicts") return
    void controller.runBindingAction("drive.sync.binding.pause", binding.id, () => controller.pause(binding.id), "已暂停同步", false)
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <div className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={state.tone === "attention" ? "destructive" : "secondary"}>{state.text}</Badge>
            <div className="ml-auto">
              {readOnly ? (
                <Button
                  type="button"
                  variant={action.variant}
                  aria-label={`${action.label} ${binding.driveItemName}`}
                  onClick={runStatusAction}
                >
                  {action.label}
                </Button>
              ) : binding.status === "paused" || binding.status === "error" ? (
                <Button
                  type="button"
                  variant={action.variant}
                  aria-label={`${action.label} ${binding.driveItemName}`}
                  disabled={pending}
                  onClick={runStatusAction}
                >
                  {action.label}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || binding.status === "initializing"}
                  onClick={() => {
                    void controller.runBindingAction("drive.sync.binding.pause", binding.id, () => controller.pause(binding.id), "已暂停同步", false)
                  }}
                >
                  暂停同步
                </Button>
              )}
            </div>
          </div>
          {detail ? <div className="mt-1.5 text-sm text-muted-foreground">{detail}</div> : null}
          {work?.kind === "transfer" && work.percent !== null ? (
            <div className="mt-3 grid gap-1">
              <Progress value={work.percent} aria-label={`${binding.driveItemName} 同步进度`} />
              <div className="text-xs tabular-nums text-muted-foreground">
                {formatBytes(work.completedBytes)} / {formatBytes(work.totalBytes ?? 0)}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 rounded-lg border p-3 text-sm">
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
            <span className="text-muted-foreground">云盘</span>
            <span className="truncate">{driveSyncRemotePath(binding)}</span>
            <span className="text-muted-foreground">电脑</span>
            <span className="truncate">{binding.localPath}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {onOpenDriveItem ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => { void Promise.resolve(onOpenDriveItem(binding)).catch(() => toast("无法打开云端位置")) }}
              >
                打开云盘位置
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => { void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置")) }}
            >
              打开本地位置
            </Button>
          </div>
        </div>

        {conflicts.length > 0 ? (
          <section className="mt-5">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">需要处理</h3>
              <Badge variant="destructive">{conflicts.length}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">这些文件两边都有内容，同步不会自动覆盖。选一个版本后继续。</p>
            <div className="mt-3 grid gap-2">
              {conflicts.map((conflict) => (
                <DriveSyncConflictCard
                  key={conflict.id}
                  conflict={conflict}
                  disabled={readOnly || pending}
                  onResolve={(target, resolution) => {
                    void controller.runBindingAction(
                      `drive.sync.conflict.${resolution}`,
                      binding.id,
                      () => controller.resolveConflict({ conflictId: target.id, action: resolution }),
                      conflictResolutionToast(resolution),
                      false,
                    )
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}

        {binding.kind === "folder" ? (
          <section className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">同步范围</h3>
              {editingExcludes ? null : (
                <Button type="button" variant="outline" onClick={openExcludeEditor}>管理</Button>
              )}
            </div>
            {editingExcludes ? (
              <div className="mt-3">
                <DriveSyncExcludeEditor
                  binding={binding}
                  candidates={excludeCandidates ?? []}
                  readOnly={readOnly}
                  pending={pending}
                  onCancel={() => setEditingExcludes(false)}
                  onSave={(rules) => {
                    void controller
                      .runBindingAction(
                        "drive.sync.binding.excludes.update",
                        binding.id,
                        () => controller.updateExcludes({ id: binding.id, ...rules }),
                        "已更新排除规则",
                      )
                      .then((ok) => { if (ok) setEditingExcludes(false) })
                  }}
                />
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  始终排除 {binding.excludeRules.forced.length} 项
                </span>
                {excludedRules.map((rule) => (
                  <span key={rule} className="rounded-md border px-2 py-1 font-mono text-xs">{rule}</span>
                ))}
                {excludedRules.length === 0
                  ? <span className="text-sm text-muted-foreground">除始终排除的内容外，全部参与同步。</span>
                  : null}
              </div>
            )}
          </section>
        ) : null}

        <section className="mt-5">
          <h3 className="font-medium">最近活动</h3>
          {activity.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">还没有同步记录。</p>
          ) : (
            <ul className="mt-2 grid gap-1.5">
              {activity.map((operation) => (
                <li key={operation.id} className="flex gap-3 text-sm">
                  <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                    {formatRelativeTime(operation.updatedAt)}
                  </span>
                  <span className="min-w-0 truncate">{operationActivityText(operation)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6 border-t pt-4">
          <h3 className="font-medium">移除同步</h3>
          <p className="mt-1 text-sm text-muted-foreground">移除后不再自动同步。云盘和电脑上的文件都会保留。</p>
          <Button type="button" variant="outline" className="mt-3" disabled={readOnly || pending} onClick={onRequestRemove}>
            移除同步
          </Button>
        </section>
      </div>
    </>
  )
}
