import { useState } from "react"
import { toast } from "sonner"
import { Clock3, File, Folder, MoreHorizontal } from "lucide-react"
import type { DriveSyncBindingDto, DriveSyncConflictDto, DriveSyncOperationDto } from "@synapse/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { startTrackedOperation } from "@/lib/ui-tracking"
import {
  DRIVE_SYNC_FILTERS,
  bindingListStateText,
  filterCounts,
  formatRelativeTime,
  formatSyncTimestamp,
  isBindingInFilter,
  matchesDriveSyncSearch,
  retryOperationOf,
  syncErrorSummary,
  type DriveSyncFilter,
} from "./drive-sync-copy"
import { DriveSyncDiagnostics } from "./drive-sync-diagnostics"
import type { DriveSyncController } from "./use-drive-sync"

export function DriveSyncFilterBar({
  controller,
  filter,
  query,
  onFilterChange,
}: {
  readonly controller: DriveSyncController
  readonly filter: DriveSyncFilter
  readonly query: string
  readonly onFilterChange: (filter: DriveSyncFilter) => void
}) {
  const snapshot = controller.snapshot
  const counts = filterCounts(
    (snapshot?.bindings ?? []).filter((binding) => matchesDriveSyncSearch(binding, query)),
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
}: {
  readonly controller: DriveSyncController
  readonly filter: DriveSyncFilter
  readonly query?: string
  readonly onCreate: () => void
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestRemove: (binding: DriveSyncBindingDto) => void
  readonly onSelectBinding: (bindingId: string) => void
}) {
  const snapshot = controller.snapshot
  const [retrying, setRetrying] = useState(false)
  const bindings = snapshot?.bindings ?? []
  const conflicts = snapshot?.conflicts ?? []
  const operations = snapshot?.operations ?? []
  const visible = bindings.filter(
    (binding) =>
      matchesDriveSyncSearch(binding, query) &&
      isBindingInFilter(
        binding,
        operations.filter((operation) => operation.bindingId === binding.id),
        conflicts.filter((conflict) => conflict.bindingId === binding.id),
        filter,
      ),
  )
  const retry = (remote: boolean) => {
    const eventKey = remote ? "drive.sync.global.retry" : "drive.sync.snapshot.retry"
    const finish = startTrackedOperation({
      component: "drive",
      eventKey,
    })
    setRetrying(true)
    void (remote ? controller.pollRemoteChanges().then(() => controller.refresh()) : controller.refresh())
      .then(() => {
        finish("success")
      })
      .catch((cause: unknown) => {
        finish("failure")
        toast(cause instanceof Error ? syncErrorSummary(cause.message) : "重试失败")
      })
      .finally(() => setRetrying(false))
  }
  const retryMessage = snapshot?.health.status === "retrying" ? snapshot.health.lastError : null
  const error =
    controller.error ?? (snapshot?.health.status === "retrying" ? null : snapshot?.health.lastError)
  return (
    <ScrollArea className="min-h-0 flex-1" data-track="drive.sync.list.scroll">
      <div className="px-5 pb-4">
        {controller.loading && !snapshot ? <CenterPlaceholder title="正在加载同步状态" /> : null}
        {controller.readOnly && snapshot ? (
          <p className="py-3 text-sm text-muted-foreground">
            {controller.offline
              ? "当前离线，同步已暂停。联网后会自动继续。"
              : "未登录，只能查看上次登录账号的同步状态。"}
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTitle>同步状态异常</AlertTitle>
            <AlertDescription>
              <p>{syncErrorSummary(error)}</p>
              {syncErrorSummary(error) !== error ? <DriveSyncDiagnostics messages={[error]} /> : null}
              <Button
                type="button"
                variant="outline"
                disabled={retrying || (!controller.error && controller.readOnly)}
                onClick={() => retry(!controller.error)}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!error && !controller.readOnly ? (
          <RetryNotice
            bindings={visible}
            operations={operations}
            conflicts={conflicts}
            message={retryMessage}
          />
        ) : null}
        {snapshot && visible.length === 0 ? (
          bindings.length === 0 ? (
            <CenterEmpty onCreate={onCreate} />
          ) : (
            <CenterPlaceholder title={query.trim() ? "没有匹配的同步项目" : "这一分类下没有同步项目"} />
          )
        ) : null}
        {visible.length > 0 ? (
          <Table className="table-fixed" scrollbars="none">
            <TableHeader>
              <TableRow>
                <TableHead>同步项目</TableHead>
                <TableHead className="w-32">状态</TableHead>
                <TableHead className="hidden w-28 text-right sm:table-cell">最近成功同步</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">操作</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((binding) => (
                <DriveSyncRow
                  key={binding.id}
                  binding={binding}
                  operations={operations.filter((operation) => operation.bindingId === binding.id)}
                  conflicts={conflicts.filter((conflict) => conflict.bindingId === binding.id)}
                  controller={controller}
                  onOpenDriveItem={onOpenDriveItem}
                  onRequestStop={() => onRequestRemove(binding)}
                  onSelect={() =>
                    binding.status === "removed" ? onRequestRemove(binding) : onSelectBinding(binding.id)
                  }
                />
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function RetryNotice({
  bindings,
  operations,
  conflicts,
  message,
}: {
  readonly bindings: readonly DriveSyncBindingDto[]
  readonly operations: readonly DriveSyncOperationDto[]
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly message: string | null
}) {
  const waiting = bindings
    .filter((binding) =>
      isBindingInFilter(
        binding,
        operations.filter((op) => op.bindingId === binding.id),
        conflicts.filter((conflict) => conflict.bindingId === binding.id),
        "waiting",
      ),
    )
    .map((binding) => retryOperationOf(operations.filter((op) => op.bindingId === binding.id))!)
  if (!message && waiting.length < 2) return null
  const reasons = new Set(
    message
      ? [syncErrorSummary(message)]
      : waiting.map((op) => (op.message ? syncErrorSummary(op.message) : "将自动重试。")),
  )
  if (reasons.size !== 1) return null
  const next = retryOperationOf(waiting)
  const at = formatSyncTimestamp(next?.nextRetryAt)
  return (
    <Alert role="status" className="mb-3">
      <Clock3 />
      <AlertTitle>{[...reasons][0]}</AlertTitle>
      <AlertDescription>
        {waiting.length ? `${waiting.length} 个项目等待自动重试` : "等待自动重试"}
        {at ? (
          <>
            ，计划 <time dateTime={next!.nextRetryAt!}>{at}</time> 开始
          </>
        ) : null}
        。{message ? <DriveSyncDiagnostics messages={[message]} /> : null}
      </AlertDescription>
    </Alert>
  )
}

function DriveSyncRow({
  binding,
  operations,
  conflicts,
  controller,
  onOpenDriveItem,
  onRequestStop,
  onSelect,
}: {
  readonly binding: DriveSyncBindingDto
  readonly operations: readonly DriveSyncOperationDto[]
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly controller: DriveSyncController
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onRequestStop: () => void
  readonly onSelect: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const state = bindingListStateText(binding, operations, conflicts)
  const pending = controller.isPending(binding.id)
  const readOnly = controller.readOnly
  const manualDisabled =
    readOnly ||
    pending ||
    ["paused", "initializing", "error", "removed"].includes(binding.status) ||
    retryOperationOf(operations) !== null
  const canPause = binding.status === "active" || binding.status === "conflict"
  return (
    <TableRow
      data-drive-sync-row={binding.id}
      data-state={menuOpen ? "selected" : undefined}
      onClick={onSelect}
      className="cursor-pointer"
    >
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full min-w-0 justify-start gap-2 text-left"
          aria-label={`同步详情 ${binding.driveItemName}`}
          data-track="drive.sync.card.open"
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
        >
          {binding.kind === "folder" ? <Folder /> : <File />}
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate">{binding.driveItemName}</span>
            <span className="truncate text-xs font-normal text-muted-foreground" title={binding.localPath}>
              {binding.localPath}
            </span>
          </span>
        </Button>
      </TableCell>
      <TableCell>
        <span className={state.tone === "attention" ? "text-destructive" : "text-muted-foreground"}>
          {state.text}
        </span>
      </TableCell>
      <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
        <span title={formatSyncTimestamp(binding.lastSyncedAt) ?? undefined}>
          {binding.lastSyncedAt ? formatRelativeTime(binding.lastSyncedAt) : "尚未同步"}
        </span>
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={`更多同步操作 ${binding.driveItemName}`}
              title="更多操作"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onSelect}>
                {binding.status === "removed" ? "重试文件处理…" : "同步详情"}
              </DropdownMenuItem>
              {onOpenDriveItem && (
                <DropdownMenuItem
                  onSelect={() => {
                    void Promise.resolve(onOpenDriveItem(binding)).catch(() => toast("无法打开云端位置"))
                  }}
                >
                  打开云盘位置
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  void controller.revealLocalPath(binding.localPath).catch(() => toast("无法打开本地位置"))
                }}
              >
                打开本地位置
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {binding.status !== "removed" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={manualDisabled}
                    onSelect={() => {
                      void controller.runBindingAction(
                        "drive.sync.binding.sync-now",
                        binding.id,
                        () => controller.pollRemoteChanges(binding.id),
                        "已同步云端变更",
                      )
                    }}
                  >
                    立即同步
                  </DropdownMenuItem>
                  {canPause ? (
                    <DropdownMenuItem
                      disabled={readOnly || pending}
                      onSelect={() => {
                        void controller.runBindingAction(
                          "drive.sync.binding.pause",
                          binding.id,
                          () => controller.pause(binding.id),
                          "已暂停同步",
                          false,
                        )
                      }}
                    >
                      暂停同步
                    </DropdownMenuItem>
                  ) : binding.status === "paused" || binding.status === "error" ? (
                    <DropdownMenuItem
                      disabled={readOnly || pending}
                      onSelect={() => {
                        void controller.runBindingAction(
                          "drive.sync.binding.resume",
                          binding.id,
                          () => controller.resume(binding.id),
                          "已继续同步",
                        )
                      }}
                    >
                      继续同步
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={readOnly || pending}
                    onSelect={onRequestStop}
                  >
                    解除同步…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function CenterEmpty({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
      <div className="font-medium">还没有同步项目</div>
      <Button type="button" onClick={onCreate}>
        新建同步
      </Button>
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
