import { useEffect, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { DriveItemDto, DriveSyncBindingDto } from "@synapse/shared"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { DriveSyncCenter, DriveSyncFilterBar } from "./drive-sync-center"
import { DriveSyncRemovalDialog } from "./drive-sync-removal-dialog"
import { DriveSyncEditMenu } from "./drive-sync-edit-menu"
import { DriveSyncDetail } from "./drive-sync-detail"
import { retryOperationOf, syncErrorSummary, type DriveSyncFilter } from "./drive-sync-copy"
import { DriveSyncWizard, type DriveSyncWizardEntry } from "./drive-sync-wizard"
import type { DriveSyncController } from "./use-drive-sync"

export type DriveSyncDialogState =
  | { readonly mode: "center"; readonly bindingId?: string | null }
  | { readonly mode: "wizard-item"; readonly item: DriveItemDto; readonly drivePathHint: string | null }
  | { readonly mode: "wizard-local"; readonly targetParentId: string | null; readonly drivePathHint: string | null }

type DriveSyncView =
  | { readonly kind: "center"; readonly selectedBindingId: string | null }
  | { readonly kind: "detail"; readonly bindingId: string }
  | { readonly kind: "wizard"; readonly entry: DriveSyncWizardEntry; readonly returnTo: "drive" | "center" | "detail" }

export function DriveSyncDialog({
  controller,
  onBindingCreated,
  onOpenChange,
  onOpenDriveItem,
  open,
  state,
}: {
  readonly controller: DriveSyncController
  readonly onBindingCreated?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onOpenChange: (open: boolean) => void
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly open: boolean
  readonly state: DriveSyncDialogState | null
}) {
  const [view, setView] = useState<DriveSyncView>({ kind: "center", selectedBindingId: null })
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<DriveSyncFilter>("all")
  const [removeTarget, setRemoveTarget] = useState<DriveSyncBindingDto | null>(null)
  const [rescanTarget, setRescanTarget] = useState<DriveSyncBindingDto | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!open || !state) return
    if (state.mode === "center") {
      // 从云盘条目的行菜单进来时直接看这条同步的详情，不是停在列表上。
      setView(state.bindingId
        ? { kind: "detail", bindingId: state.bindingId }
        : { kind: "center", selectedBindingId: null })
      return
    }
    setView({
      kind: "wizard",
      returnTo: "drive",
      entry: state.mode === "wizard-item"
        ? { mode: "item", item: state.item, drivePathHint: state.drivePathHint }
        : { mode: "local", targetParentId: state.targetParentId, drivePathHint: state.drivePathHint },
    })
  }, [open, state])

  useEffect(() => {
    if (open) return
    setQuery("")
    setFilter("all")
    setRemoveTarget(null)
    setRescanTarget(null)
    setView({ kind: "center", selectedBindingId: null })
  }, [open])

  const bindings = controller.snapshot?.bindings ?? []
  const conflicts = controller.snapshot?.conflicts ?? []
  const detailBinding = view.kind === "detail"
    ? bindings.find((binding) => binding.id === view.bindingId) ?? null
    : null

  useEffect(() => {
    if (!detailBinding || detailBinding.status !== "removed") return
    setRemoveTarget(detailBinding)
    setView({ kind: "center", selectedBindingId: null })
  }, [detailBinding])

  const requestRemove = (binding: DriveSyncBindingDto) => setRemoveTarget(binding)
  const refreshSyncState = () => {
    if (refreshing) return
    setRefreshing(true)
    void controller.refresh()
      .catch((cause: unknown) => {
        toast(cause instanceof Error ? syncErrorSummary(cause.message) : "加载同步状态失败")
      })
      .finally(() => setRefreshing(false))
  }
  const openWizard = () => {
    // 只读时不让用户把三步走完再吃一个主进程报错，入口直接拦住。
    if (controller.readOnly) {
      toast(controller.offline ? "联网后可新建同步。" : "登录后可新建同步。")
      return
    }
    setView({
      kind: "wizard",
      returnTo: "center",
      entry: { mode: "local", targetParentId: null, drivePathHint: null },
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={view.kind === "wizard"
            ? "max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl"
            : view.kind === "center" ? "h-[42rem] max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-3xl"
              : "h-[34rem] max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl"}
          showCloseButton={false}
          // 状态和恢复信息在正文呈现，不再重复为标题栏描述。
          aria-describedby={undefined}
        >
          <DialogFrame className={view.kind === "wizard" ? "max-h-[calc(100vh-2rem)]" : "h-full"}>
            {view.kind === "center" ? (
              <>
                <DialogFrameHeader
                  bordered
                  title="云盘同步"
                  actions={(
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="刷新同步状态"
                        title="刷新同步状态"
                        disabled={controller.loading || refreshing}
                        aria-busy={refreshing}
                        onClick={refreshSyncState}
                      >
                        <RefreshCw className={controller.loading || refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />
                      </Button>
                      <Button type="button" disabled={controller.readOnly} onClick={openWizard}>新建同步</Button>
                    </>
                  )}
                />
                <DialogFrameBody className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Input className="min-w-48 flex-1" type="search" aria-label="搜索同步" placeholder="搜索名称或路径" value={query} onChange={(event) => setQuery(event.target.value)} />
                    <div className="max-w-full overflow-x-auto"><DriveSyncFilterBar controller={controller} filter={filter} query={query} onFilterChange={setFilter} /></div>
                  </div>
                  <DriveSyncCenter
                    controller={controller}
                    filter={filter}
                    query={query}
                    onCreate={openWizard}
                    onOpenDriveItem={onOpenDriveItem}
                    onRequestRemove={requestRemove}
                    onSelectBinding={(bindingId) => setView({ kind: "detail", bindingId })}
                  />
                </DialogFrameBody>
              </>
            ) : view.kind === "detail" && detailBinding ? (
              <>
                <DialogFrameHeader
                  bordered
                  leading={(
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="返回同步列表"
                      onClick={() => setView({ kind: "center", selectedBindingId: null })}
                    >
                      <ArrowLeft />
                    </Button>
                  )}
                  actions={<DriveSyncEditMenu binding={detailBinding} disabled={controller.readOnly || controller.isPending(detailBinding.id) || detailBinding.status === "removed"}
                    onEdit={(edit) => setView({ kind: "wizard", returnTo: "detail", entry: { mode: "edit", binding: detailBinding, edit } })}
                    onRequestRemove={() => requestRemove(detailBinding)} onRequestRescan={() => setRescanTarget(detailBinding)}
                    rescanDisabled={controller.readOnly || controller.isPending(detailBinding.id) || !["active", "conflict"].includes(detailBinding.status) || retryOperationOf(controller.snapshot?.operations.filter((op) => op.bindingId === detailBinding.id) ?? []) !== null} /> }
                  title={detailBinding.driveItemName}
                />
                <DialogFrameBody className="flex flex-col">
                  <DriveSyncDetail
                    binding={detailBinding}
                    conflicts={conflicts.filter((conflict) => conflict.bindingId === detailBinding.id)}
                    controller={controller}
                    onOpenDriveItem={onOpenDriveItem}
                  />
                </DialogFrameBody>
              </>
            ) : view.kind === "detail" ? (
              <>
                <DialogFrameHeader
                  bordered
                  title="云盘同步"
                  leading={(
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="返回同步列表"
                      onClick={() => setView({ kind: "center", selectedBindingId: null })}
                    >
                      <ArrowLeft />
                    </Button>
                  )}
                />
                <div className="flex min-h-0 flex-1 items-center justify-center px-5 text-sm text-muted-foreground">
                  这条同步已经不存在了。
                </div>
              </>
            ) : (
              <DriveSyncWizard
                key={view.entry.mode === "edit" ? `${view.entry.binding.id}:${view.entry.edit ?? "choose"}` : view.entry.mode}
                controller={controller}
                entry={view.entry}
                onBindingCreated={onBindingCreated}
                onClose={() => {
                  if (view.returnTo === "drive") onOpenChange(false)
                  else if (view.returnTo === "detail" && view.entry.mode === "edit") setView({ kind: "detail", bindingId: view.entry.binding.id })
                  else setView({ kind: "center", selectedBindingId: null })
                }}
                onViewBinding={(bindingId) => setView({ kind: "detail", bindingId })}
              />
            )}
          </DialogFrame>
        </DialogContent>
      </Dialog>

      <AlertDialog open={rescanTarget !== null} onOpenChange={(next) => { if (!next) setRescanTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>重新核对 {rescanTarget?.driveItemName}</AlertDialogTitle>
            <AlertDialogDescription>会读取全部本地文件并下载云端文件做比对，内容多时需要较长时间。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction disabled={rescanTarget ? controller.isPending(rescanTarget.id) : false} onClick={() => {
              if (!rescanTarget) return
              const target = rescanTarget
              void controller.runBindingAction("drive.sync.binding.rescan", target.id, () => controller.rescan(target.id), "重新核对完成").finally(() => setRescanTarget(null))
            }}>开始核对</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {removeTarget && <DriveSyncRemovalDialog key={removeTarget.id} controller={controller} binding={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={() => { setRemoveTarget(null); setView({ kind: "center", selectedBindingId: null }) }}
      />}
    </>
  )
}
