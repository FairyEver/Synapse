import { useState } from "react"
import { toast } from "sonner"
import { Cloud, File, Folder, Monitor, MoreHorizontal } from "lucide-react"
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
import { Item, ItemGroup } from "@/components/ui/item"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DriveSyncEditItems } from "./drive-sync-edit-menu"
import type { SyncWizardEdit } from "./drive-sync-flow"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { startTrackedOperation } from "@/lib/ui-tracking"
import {
  DRIVE_SYNC_FILTERS,
  activeWorkOf,
  bindingPrimaryAction,
  formatRelativeTime,
  bindingStateDetail,
  bindingListStateText,
  filterCounts,
  isBindingInFilter,
  matchesDriveSyncSearch,
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
    <Tabs value={filter} onValueChange={(value) => onFilterChange(value as DriveSyncFilter)}>
      <TabsList aria-label="同步筛选">
        {DRIVE_SYNC_FILTERS.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
            <span className="tabular-nums text-muted-foreground">{counts[item.value]}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function DriveSyncCenter({
  controller,
  filter,
  query = "",
  onCreate,
  onOpenDriveItem,
  onRequestRemove,
  onSelectBinding,
  onEditBinding,
}: {
  readonly controller: DriveSyncController
  readonly filter: DriveSyncFilter
  readonly query?: string
  readonly onCreate: () => void
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestRemove: (binding: DriveSyncBindingDto) => void
  readonly onSelectBinding: (bindingId: string) => void
  readonly onEditBinding: (binding: DriveSyncBindingDto, edit: SyncWizardEdit) => void
}) {
  const snapshot = controller.snapshot
  const [rescanTarget, setRescanTarget] = useState<DriveSyncBindingDto | null>(null)
  const [retrying, setRetrying] = useState(false)
  const bindings = snapshot?.bindings ?? []
  const conflicts = snapshot?.conflicts ?? []
  const operations = snapshot?.operations ?? []
  const visible = bindings.filter((binding) => matchesDriveSyncSearch(binding, query) && isBindingInFilter(
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
              disabled={retrying}
              onClick={() => {
                const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.snapshot.retry" })
                setRetrying(true)
                void controller.refresh()
                  .then(() => { finishTracking("success") })
                  .catch(() => { finishTracking("failure") })
                  .finally(() => setRetrying(false))
              }}
            >
              重试
            </Button>
          </div>
        ) : null}
        {controller.readOnly && snapshot ? (
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
              disabled={controller.readOnly || retrying}
              onClick={() => {
                const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.global.retry" })
                setRetrying(true)
                void controller.pollRemoteChanges()
                  .then(() => controller.refresh())
                  .then(() => { finishTracking("success") })
                  .catch((cause: unknown) => {
                    finishTracking("failure")
                    toast(cause instanceof Error ? cause.message : "重试失败")
                  })
                  .finally(() => setRetrying(false))
              }}
            >
              重试
            </Button>
          </div>
        ) : null}
        {snapshot && visible.length === 0 ? (
          bindings.length === 0
            ? <CenterEmpty onCreate={onCreate} />
            : <CenterPlaceholder title={query.trim() ? "没有匹配的同步项目" : "这一分类下没有同步项目"} />
        ) : null}
        <ItemGroup className="gap-1">
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
              onEdit={(edit) => onEditBinding(binding, edit)}
            />
          ))}
        </ItemGroup>
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

function DriveSyncCard({ binding, conflicts, controller, onOpenDriveItem, onRequestRescan, onRequestStop, onSelect, onEdit }: {
  readonly binding: DriveSyncBindingDto
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly controller: DriveSyncController
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestRescan: () => void
  readonly onRequestStop: () => void
  readonly onSelect: () => void
  readonly onEdit: (edit: SyncWizardEdit) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const operations = (controller.snapshot?.operations ?? []).filter((operation) => operation.bindingId === binding.id)
  const state = bindingListStateText(binding, operations, conflicts)
  const detail = bindingStateDetail(binding, operations, conflicts)
  const action = bindingPrimaryAction(binding, operations, conflicts, controller.readOnly)
  const work = activeWorkOf(operations)
  const pending = controller.isPending(binding.id)
  const readOnly = controller.readOnly
  const manualDisabled = readOnly || pending || ["paused", "initializing", "error", "removed"].includes(binding.status)
  const canPause = binding.status === "active" || binding.status === "conflict"
  const manage = () => { setDetailsOpen(false); if (binding.status === "removed") onRequestStop(); else onSelect() }
  return (
    <Item variant="outline" className="h-12 flex-nowrap gap-2" role="listitem" data-track="drive.sync.card.open" data-drive-sync-row={binding.id}>
      <Popover open={detailsOpen} onOpenChange={setDetailsOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" className="min-w-0 flex-1 justify-start" aria-label={`同步信息 ${binding.driveItemName}`} data-track="drive.sync.card.open">
            {binding.kind === "folder" ? <Folder data-icon="inline-start" /> : <File data-icon="inline-start" />}
            <span className="min-w-0 flex-1 truncate text-left">{binding.driveItemName}</span>
            <Badge variant={state.tone === "attention" ? "destructive" : "secondary"}>{state.text}</Badge>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 max-w-full" aria-label={`同步简要信息 ${binding.driveItemName}`}>
          <div className="font-medium">{binding.driveItemName}</div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="flex items-center gap-1 text-muted-foreground"><Cloud className="size-3.5" />云盘</dt><dd className="break-all">{driveSyncRemotePath(binding)}</dd>
            <dt className="flex items-center gap-1 text-muted-foreground"><Monitor className="size-3.5" />电脑</dt><dd className="break-all">{binding.localPath}</dd>
            <dt className="text-muted-foreground">最近同步</dt><dd>{binding.lastSyncedAt ? formatRelativeTime(binding.lastSyncedAt) : "尚未完成同步"}</dd>
          </dl>
          {detail && <p className={state.tone === "attention" ? "break-words text-destructive" : "break-words text-muted-foreground"}>{detail}</p>}
          {work?.kind === "transfer" && work.percent !== null && <Progress value={work.percent} aria-label={`${binding.driveItemName} 同步进度`} />}
          <div className="flex flex-wrap gap-2">
            {(action.kind === "retry" || action.kind === "resume") && <Button disabled={pending || readOnly} aria-label={`${action.label} ${binding.driveItemName}`} onClick={() => { void controller.runBindingAction(action.kind === "retry" ? "drive.sync.binding.retry" : "drive.sync.binding.resume", binding.id, () => controller.resume(binding.id), action.kind === "retry" ? "已重试同步" : "已继续同步") }}>{action.label}</Button>}
            <Button onClick={manage}>{binding.status === "removed" ? "重试文件处理" : "管理同步"}</Button>
          </div>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" disabled={pending} aria-label={`更多同步操作 ${binding.driveItemName}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={manage}>{binding.status === "removed" ? "重试文件处理…" : "管理同步"}</DropdownMenuItem>
            {action.kind === "conflicts" && <DropdownMenuItem onSelect={onSelect}>处理冲突</DropdownMenuItem>}
            {onOpenDriveItem && <DropdownMenuItem onSelect={() => { void Promise.resolve(onOpenDriveItem(binding)).catch(() => toast("无法打开云端位置")) }}>打开云盘位置</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => { void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置")) }}>打开本地位置</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DriveSyncEditItems binding={binding} disabled={readOnly || pending || binding.status === "removed"} onEdit={onEdit} />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={manualDisabled} onSelect={() => { void controller.runBindingAction("drive.sync.binding.sync-now", binding.id, () => controller.pollRemoteChanges(binding.id), "已同步云端变更") }}>立即同步一次</DropdownMenuItem>
            <DropdownMenuItem disabled={manualDisabled} onSelect={onRequestRescan}>重新核对两边内容</DropdownMenuItem>
            {canPause ? <DropdownMenuItem disabled={readOnly || pending} onSelect={() => { void controller.runBindingAction("drive.sync.binding.pause", binding.id, () => controller.pause(binding.id), "已暂停同步", false) }}>暂停同步</DropdownMenuItem>
              : binding.status === "paused" || binding.status === "error" ? <DropdownMenuItem disabled={readOnly || pending} onSelect={() => { void controller.runBindingAction("drive.sync.binding.resume", binding.id, () => controller.resume(binding.id), "已继续同步") }}>继续同步</DropdownMenuItem> : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {binding.status !== "removed" && <DropdownMenuGroup><DropdownMenuItem variant="destructive" disabled={readOnly || pending} onSelect={onRequestStop}>解除同步…</DropdownMenuItem></DropdownMenuGroup>}
        </DropdownMenuContent>
      </DropdownMenu>
    </Item>
  )
}

function CenterEmpty({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
      <div className="font-medium">还没有同步项目</div>
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
