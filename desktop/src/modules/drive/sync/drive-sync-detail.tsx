import { useState } from "react"
import { toast } from "sonner"
import { Cloud, Monitor } from "lucide-react"
import type { DriveSyncBindingDto, DriveSyncConflictDto } from "@synapse/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DriveSyncCopyButton } from "./drive-sync-diagnostics"
import { DriveSyncStatus } from "./drive-sync-status"
import {
  conflictResolutionToast,
  formatRelativeTime,
  formatSyncTimestamp,
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
}: {
  readonly binding: DriveSyncBindingDto
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly controller: DriveSyncController
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
}) {
  const [editingExcludes, setEditingExcludes] = useState(false)
  const [excludeCandidates, setExcludeCandidates] = useState<readonly string[] | null>(null)

  const operations = (controller.snapshot?.operations ?? []).filter((operation) => operation.bindingId === binding.id)
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

  return (
    <ScrollArea className="min-h-0 flex-1" data-track="drive.sync.detail.scroll">
      <div className="grid gap-6 px-5 py-4">
        <DriveSyncStatus binding={binding} operations={operations} conflicts={conflicts} controller={controller} />
        <section aria-labelledby="sync-locations-heading">
          <h3 id="sync-locations-heading" className="mb-3 font-medium">同步位置</h3>
          <dl className="grid gap-4">
            <DriveSyncLocation label={binding.drivePathHint ? "云盘" : "云盘（目录未记录）"} icon={<Cloud className="size-4" />} path={driveSyncRemotePath(binding)} copyLabel="复制云盘路径" openLabel="打开云盘位置"
              onOpen={onOpenDriveItem ? () => { void Promise.resolve(onOpenDriveItem(binding)).catch(() => toast("无法打开云端位置")) } : undefined} />
            <DriveSyncLocation label="本地" icon={<Monitor className="size-4" />} path={binding.localPath} copyLabel="复制本地路径" openLabel="打开本地位置"
              onOpen={() => { void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置")) }} />
          </dl>
        </section>

        {conflicts.length > 0 ? (
          <section>
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
          <section>
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

        <section>
          <h3 className="font-medium">最近活动</h3>
          {activity.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">还没有同步记录。</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {activity.map((operation) => (
                <li key={operation.id} className="grid gap-1 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                  <time dateTime={operation.updatedAt} title={formatSyncTimestamp(operation.updatedAt) ?? undefined} className="tabular-nums text-muted-foreground">
                    {formatRelativeTime(operation.updatedAt)}
                  </time>
                  <span className="min-w-0 break-words leading-relaxed">{operationActivityText(operation)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ScrollArea>
  )
}

function DriveSyncLocation({ label, icon, path, copyLabel, openLabel, onOpen }: {
  readonly label: string
  readonly icon: React.ReactNode
  readonly path: string
  readonly copyLabel: string
  readonly openLabel: string
  readonly onOpen?: () => void
}) {
  return <div className="flex min-w-0 items-center gap-3">
    <div className="min-w-0 flex-1">
      <dt className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</dt>
      <dd data-allow-select="true" className="truncate text-sm" title={path}>{path}</dd>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <DriveSyncCopyButton value={path} label={copyLabel} />
      {onOpen ? <Button type="button" variant="ghost" onClick={onOpen} aria-label={openLabel}>打开</Button> : null}
    </div>
  </div>
}
