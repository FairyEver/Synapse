import { useState } from "react"
import { toast } from "sonner"
import { MoreHorizontal } from "lucide-react"
import type { DriveSyncBindingDto, DriveSyncConflictDto } from "@synapse/shared"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import {
  DRIVE_SYNC_FILTERS,
  activeTransferOf,
  bindingPrimaryAction,
  bindingStateDetail,
  bindingStateText,
  filterCounts,
  formatBytes,
  isBindingInFilter,
  type DriveSyncFilter,
} from "./drive-sync-copy"
import { driveSyncRemotePath, type DriveSyncController } from "./use-drive-sync"

export function DriveSyncFilterBar({
  controller,
  filter,
  onFilterChange,
}: {
  readonly controller: DriveSyncController
  readonly filter: DriveSyncFilter
  readonly onFilterChange: (filter: DriveSyncFilter) => void
}) {
  const snapshot = controller.snapshot
  const counts = filterCounts(
    snapshot?.bindings ?? [],
    snapshot?.operations ?? [],
    snapshot?.conflicts ?? [],
  )
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="同步筛选">
      {DRIVE_SYNC_FILTERS.map((item) => (
        <Button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={filter === item.value}
          variant={filter === item.value ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onFilterChange(item.value)}
        >
          {item.label}
          <span className="tabular-nums text-muted-foreground">{counts[item.value]}</span>
        </Button>
      ))}
    </div>
  )
}

export function DriveSyncCenter({
  controller,
  filter,
  onCreate,
  onOpenDriveItem,
  onRequestRemove,
  onSelectBinding,
}: {
  readonly controller: DriveSyncController
  readonly filter: DriveSyncFilter
  readonly onCreate: () => void
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestRemove: (binding: DriveSyncBindingDto) => void
  readonly onSelectBinding: (bindingId: string) => void
}) {
  const snapshot = controller.snapshot
  const [rescanTarget, setRescanTarget] = useState<DriveSyncBindingDto | null>(null)
  const bindings = snapshot?.bindings ?? []
  const conflicts = snapshot?.conflicts ?? []
  const operations = snapshot?.operations ?? []
  const visible = bindings.filter((binding) => isBindingInFilter(
    binding,
    operations.filter((operation) => operation.bindingId === binding.id),
    conflicts.filter((conflict) => conflict.bindingId === binding.id),
    filter,
  ))

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {controller.loading && !snapshot ? <CenterPlaceholder title="正在加载同步状态" /> : null}
        {controller.error ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-destructive">
            <span>{controller.error}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => { void controller.refresh().catch(() => undefined) }}
            >
              重试
            </Button>
          </div>
        ) : null}
        {controller.readOnly ? (
          <div className="mb-3 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
            {controller.offline
              ? "当前离线，同步已暂停。联网后会自动继续。"
              : "未登录，只能查看上次登录账号的同步状态。"}
          </div>
        ) : null}
        {snapshot?.health.lastError ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-destructive">
            <span>{snapshot.health.lastError}</span>
            <Button
              type="button"
              variant="outline"
              disabled={controller.readOnly}
              onClick={() => {
                void controller.pollRemoteChanges().then(() => controller.refresh()).catch((cause: unknown) => {
                  toast(cause instanceof Error ? cause.message : "重试失败")
                })
              }}
            >
              重试
            </Button>
          </div>
        ) : null}
        {snapshot && visible.length === 0 ? (
          bindings.length === 0
            ? <CenterEmpty onCreate={onCreate} />
            : <CenterPlaceholder title="这一分类下没有同步项目" />
        ) : null}
        <div className="grid gap-2">
          {visible.map((binding) => (
            <DriveSyncCard
              key={binding.id}
              binding={binding}
              conflicts={conflicts.filter((conflict) => conflict.bindingId === binding.id)}
              controller={controller}
              onOpenDriveItem={onOpenDriveItem}
              onRequestRescan={() => setRescanTarget(binding)}
              onRequestStop={() => onRequestRemove(binding)}
              onSelect={() => onSelectBinding(binding.id)}
            />
          ))}
        </div>
      </div>

      <AlertDialog open={rescanTarget !== null} onOpenChange={(next) => { if (!next) setRescanTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新核对两边内容 {rescanTarget?.driveItemName}</AlertDialogTitle>
            <AlertDialogDescription>
              会读取全部本地文件并下载云端文件做比对，内容多时需要较长时间。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={rescanTarget ? controller.isPending(rescanTarget.id) : false}
              onClick={() => {
                if (!rescanTarget) return
                const target = rescanTarget
                void controller
                  .runBindingAction("drive.sync.binding.rescan", target.id, () => controller.rescan(target.id), "重新核对完成")
                  .finally(() => setRescanTarget(null))
              }}
            >
              开始核对
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DriveSyncCard({
  binding,
  conflicts,
  controller,
  onOpenDriveItem,
  onRequestRescan,
  onRequestStop,
  onSelect,
}: {
  readonly binding: DriveSyncBindingDto
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly controller: DriveSyncController
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestRescan: () => void
  readonly onRequestStop: () => void
  readonly onSelect: () => void
}) {
  const operations = (controller.snapshot?.operations ?? []).filter((operation) => operation.bindingId === binding.id)
  const state = bindingStateText(binding, operations, conflicts)
  const detail = bindingStateDetail(binding, operations, conflicts)
  const action = bindingPrimaryAction(binding, operations, conflicts, controller.readOnly)
  const transfer = activeTransferOf(operations)
  const pending = controller.isPending(binding.id)
  const readOnly = controller.readOnly

  const runPrimary = () => {
    switch (action.kind) {
      case "conflicts":
      case "progress":
        onSelect()
        return
      case "open":
        void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置"))
        return
      case "retry":
        void controller.runBindingAction("drive.sync.binding.retry", binding.id, () => controller.resume(binding.id), "已重试同步")
        return
      case "resume":
        void controller.runBindingAction("drive.sync.binding.resume", binding.id, () => controller.resume(binding.id), "已继续同步")
    }
  }

  const manualDisabled = readOnly || pending || binding.status === "paused" || binding.status === "initializing"
  const canPause = binding.status === "active" || binding.status === "conflict"

  return (
    <div
      className="grid cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
      data-track="drive.sync.card.open"
      data-track-native="true"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onSelect()
      }}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium">{binding.driveItemName}</span>
          <Badge variant={state.tone === "attention" ? "destructive" : "secondary"}>{state.text}</Badge>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <span className="truncate">云盘 {driveSyncRemotePath(binding)}</span>
          <span aria-hidden="true">⇄</span>
          <span className="truncate">电脑 {binding.localPath}</span>
        </div>
        {detail ? <div className="mt-1.5 truncate text-sm text-muted-foreground">{detail}</div> : null}
        {transfer ? (
          <div className="mt-2 grid gap-1">
            <Progress value={transfer.percent ?? 0} aria-label={`${binding.driveItemName} 同步进度`} />
            {transfer.percent === null ? (
              <div className="text-xs tabular-nums text-muted-foreground">{formatBytes(transfer.completedBytes)}</div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        className="flex flex-wrap items-center gap-1 sm:justify-end"
        onClick={(event) => { event.stopPropagation() }}
      >
        <Button
          type="button"
          variant={action.variant}
          size="sm"
          aria-label={`${action.label} ${binding.driveItemName}`}
          disabled={pending}
          onClick={runPrimary}
        >
          {action.label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" disabled={pending} aria-label={`更多同步操作 ${binding.driveItemName}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {onOpenDriveItem ? (
              <DropdownMenuItem onSelect={() => { void Promise.resolve(onOpenDriveItem(binding)).catch(() => toast("无法打开云端位置")) }}>
                打开云盘位置
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => { void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置")) }}>
              打开本地位置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={manualDisabled}
              onSelect={() => {
                void controller.runBindingAction("drive.sync.binding.sync-now", binding.id, () => controller.pollRemoteChanges(binding.id), "已同步云端变更")
              }}
            >
              立即同步一次
            </DropdownMenuItem>
            <DropdownMenuItem disabled={manualDisabled} onSelect={onRequestRescan}>
              重新核对两边内容
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {canPause ? (
              <DropdownMenuItem
                disabled={readOnly || pending}
                onSelect={() => {
                  void controller.runBindingAction("drive.sync.binding.pause", binding.id, () => controller.pause(binding.id), "已暂停同步")
                }}
              >
                暂停同步
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={readOnly || pending}
                onSelect={() => {
                  void controller.runBindingAction("drive.sync.binding.resume", binding.id, () => controller.resume(binding.id), "已继续同步")
                }}
              >
                继续同步
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={readOnly || pending} onSelect={onRequestStop}>
              移除同步
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function CenterEmpty({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
      <div className="font-medium">还没有同步项目</div>
      <div className="text-sm text-muted-foreground">把云盘上的文件夹同步到这台电脑，两边的改动会自动保持一致。</div>
      <Button type="button" onClick={onCreate}>新建同步</Button>
    </div>
  )
}

function CenterPlaceholder({ title }: { readonly title: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
      {title}
    </div>
  )
}
