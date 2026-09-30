import { useEffect, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { DriveItemDto, DriveSyncBindingDto } from "@synapse/shared"
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
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { DriveSyncCenter, DriveSyncFilterBar } from "./drive-sync-center"
import { DriveSyncDetail } from "./drive-sync-detail"
import type { DriveSyncFilter } from "./drive-sync-copy"
import { DriveSyncWizard, type DriveSyncWizardEntry } from "./drive-sync-wizard"
import { driveSyncRemotePath, type DriveSyncController } from "./use-drive-sync"

export type DriveSyncDialogState =
  | { readonly mode: "center"; readonly bindingId?: string | null }
  | { readonly mode: "wizard-item"; readonly item: DriveItemDto; readonly drivePathHint: string | null }
  | { readonly mode: "wizard-local"; readonly targetParentId: string | null; readonly drivePathHint: string | null }

type DriveSyncView =
  | { readonly kind: "center"; readonly selectedBindingId: string | null }
  | { readonly kind: "detail"; readonly bindingId: string }
  | { readonly kind: "wizard"; readonly entry: DriveSyncWizardEntry }

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
  const [filter, setFilter] = useState<DriveSyncFilter>("all")
  const [removeTarget, setRemoveTarget] = useState<DriveSyncBindingDto | null>(null)

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
      entry: state.mode === "wizard-item"
        ? { mode: "item", item: state.item, drivePathHint: state.drivePathHint }
        : { mode: "local", targetParentId: state.targetParentId, drivePathHint: state.drivePathHint },
    })
  }, [open, state])

  useEffect(() => {
    if (open) return
    setFilter("all")
    setRemoveTarget(null)
    setView({ kind: "center", selectedBindingId: null })
  }, [open])

  const bindings = controller.snapshot?.bindings ?? []
  const conflicts = controller.snapshot?.conflicts ?? []
  const detailBinding = view.kind === "detail"
    ? bindings.find((binding) => binding.id === view.bindingId) ?? null
    : null

  const requestRemove = (binding: DriveSyncBindingDto) => setRemoveTarget(binding)
  const openWizard = () => setView({
    kind: "wizard",
    entry: { mode: "local", targetParentId: null, drivePathHint: null },
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={view.kind === "wizard"
            ? "max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl"
            : "h-[36rem] max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-4xl"}
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogFrame className={view.kind === "wizard" ? "max-h-[calc(100vh-2rem)]" : "h-full"}>
            {view.kind === "center" ? (
              <>
                <DialogFrameHeader
                  bordered
                  title="云盘同步"
                  center={<DriveSyncFilterBar controller={controller} filter={filter} onFilterChange={setFilter} />}
                  actions={(
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="刷新同步状态"
                        disabled={controller.loading}
                        onClick={() => {
                          void controller.refresh().catch((cause: unknown) => {
                            toast(cause instanceof Error ? cause.message : "加载同步状态失败")
                          })
                        }}
                      >
                        <RefreshCw />
                      </Button>
                      <Button type="button" disabled={controller.readOnly} onClick={openWizard}>新建同步</Button>
                    </>
                  )}
                />
                <DialogFrameBody className="flex flex-col">
                  <DriveSyncCenter
                    controller={controller}
                    filter={filter}
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
                      size="icon-sm"
                      aria-label="返回同步列表"
                      onClick={() => setView({ kind: "center", selectedBindingId: null })}
                    >
                      <ArrowLeft />
                    </Button>
                  )}
                  title={detailBinding.driveItemName}
                  description={`云盘 ${driveSyncRemotePath(detailBinding)} · 电脑 ${detailBinding.localPath}`}
                />
                <DialogFrameBody className="flex flex-col">
                  <DriveSyncDetail
                    binding={detailBinding}
                    conflicts={conflicts.filter((conflict) => conflict.bindingId === detailBinding.id)}
                    controller={controller}
                    onOpenDriveItem={onOpenDriveItem}
                    onRequestRemove={() => requestRemove(detailBinding)}
                  />
                </DialogFrameBody>
              </>
            ) : view.kind === "detail" ? (
              <>
                <DialogFrameHeader bordered title="云盘同步" />
                <div className="flex min-h-0 flex-1 items-center justify-center px-5 text-sm text-muted-foreground">
                  这条同步已经不存在了。
                </div>
              </>
            ) : (
              <DriveSyncWizard
                controller={controller}
                entry={view.entry}
                onBindingCreated={onBindingCreated}
                onClose={() => onOpenChange(false)}
                onViewBinding={(bindingId) => setView({ kind: "detail", bindingId })}
              />
            )}
          </DialogFrame>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(next) => { if (!next) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除同步 {removeTarget?.driveItemName}</AlertDialogTitle>
            <AlertDialogDescription>
              不再自动同步，云盘和电脑上的文件都会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeTarget ? controller.isPending(removeTarget.id) : false}
              onClick={() => {
                if (!removeTarget) return
                const target = removeTarget
                void controller
                  .runBindingAction("drive.sync.binding.remove", target.id, () => controller.remove(target.id), "已移除同步")
                  .then((ok) => { if (ok) setView({ kind: "center", selectedBindingId: null }) })
                  .finally(() => setRemoveTarget(null))
              }}
            >
              移除同步
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
