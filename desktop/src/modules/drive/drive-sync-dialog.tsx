import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { MoreHorizontal, RefreshCw } from "lucide-react"
import type {
  DriveItemDto,
  DriveSyncBindingDto,
  DriveSyncBindingPreviewDto,
  DriveSyncSnapshotDto,
} from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
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
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"

type DriveSyncBindingMode = "bind_existing" | "remote_to_local" | "local_to_remote"
type DriveSyncLocalKind = "file" | "folder"
type DriveSyncObjectFilter = "all" | "initializing" | "active" | "conflict" | "paused" | "error"
type DriveSyncStopTarget = Pick<DriveSyncBindingDto, "id" | "driveItemName"> | null
type DriveSyncBindingActionRunner = (
  eventKey: string,
  bindingId: string,
  action: () => Promise<unknown>,
  success: string,
) => Promise<void>

const DRIVE_SYNC_OBJECT_FILTERS: ReadonlyArray<{
  readonly value: DriveSyncObjectFilter
  readonly label: string
}> = [
  { value: "all", label: "全部" },
  { value: "initializing", label: "初始化" },
  { value: "active", label: "已启用" },
  { value: "conflict", label: "有冲突" },
  { value: "paused", label: "已暂停" },
  { value: "error", label: "错误" },
]

export type DriveSyncDialogState =
  | { readonly mode: "status"; readonly item: null; readonly bindingId?: string }
  | { readonly mode: "bind"; readonly item: DriveItemDto; readonly drivePathHint: string | null }
  | { readonly mode: "local"; readonly item: null; readonly targetParentId: string | null; readonly drivePathHint: string | null }

export function DriveSyncDialog({
  onDriveItemsChanged,
  onOpenDriveItem,
  onOpenChange,
  onSnapshotChange,
  open,
  snapshot,
  snapshotError = null,
  snapshotLoading = false,
  state,
}: {
  readonly onDriveItemsChanged?: () => void | Promise<void>
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onOpenChange: (open: boolean) => void
  readonly onSnapshotChange: (snapshot: DriveSyncSnapshotDto) => void
  readonly open: boolean
  readonly snapshot: DriveSyncSnapshotDto | null
  readonly snapshotError?: string | null
  readonly snapshotLoading?: boolean
  readonly state: DriveSyncDialogState | null
}) {
  const [localPath, setLocalPath] = useState("")
  const [bindingMode, setBindingMode] = useState<DriveSyncBindingMode>("bind_existing")
  const [localKind, setLocalKind] = useState<DriveSyncLocalKind>("folder")
  const [preview, setPreview] = useState<DriveSyncBindingPreviewDto | null>(null)
  const [previewConfigKey, setPreviewConfigKey] = useState<string | null>(null)
  const [excludeText, setExcludeText] = useState("")
  const [useDefaultExcludes, setUseDefaultExcludes] = useState(true)
  const [importGitignore, setImportGitignore] = useState(false)
  const [statusFilter, setStatusFilter] = useState<DriveSyncObjectFilter>("all")
  const [busy, setBusy] = useState(false)
  const item = state?.mode === "bind" ? state.item : null
  const drivePathHint = state?.mode === "bind" || state?.mode === "local" ? state.drivePathHint : null
  const targetParentId = state?.mode === "local" ? state.targetParentId : null
  const isLocalBinding = state?.mode === "local"
  const isBindingDialog = state?.mode === "bind" || isLocalBinding
  const isStatusDialog = !isBindingDialog
  const effectiveBindingMode = isLocalBinding ? "local_to_remote" : bindingMode
  const bindingKind = item?.type ?? localKind
  const pathFieldCopy = isBindingDialog ? getDriveSyncBindingPathFieldCopy(bindingKind, effectiveBindingMode) : null
  const hasLocalPath = localPath.trim().length > 0
  const currentConfigKey = driveSyncPreviewConfigKey(localPath, effectiveBindingMode, excludeText, useDefaultExcludes, importGitignore)
  const currentPreview = preview?.localPath === localPath && previewConfigKey === currentConfigKey ? preview : null
  const canSubmitBinding = hasLocalPath
    && !busy
    && !snapshotLoading
    && !snapshotError
    && snapshot?.health.readOnly !== true
    && currentPreview?.status === "ready"
    && currentPreview.direction === effectiveBindingMode

  useEffect(() => {
    if (!open) {
      setLocalPath("")
      setBindingMode("bind_existing")
      setLocalKind("folder")
      setPreview(null)
      setPreviewConfigKey(null)
      setExcludeText("")
      setUseDefaultExcludes(true)
      setImportGitignore(false)
      setStatusFilter("all")
    }
  }, [open])

  const refreshSnapshot = async () => {
    onSnapshotChange(await requireSynapseBridge().driveSync.getSnapshot())
  }

  const selectBindingMode = (nextMode: DriveSyncBindingMode) => {
    if (nextMode === bindingMode) return
    setBindingMode(nextMode)
    setLocalPath("")
    setPreview(null)
    setPreviewConfigKey(null)
  }

  const selectLocalKind = (nextKind: DriveSyncLocalKind) => {
    if (nextKind === localKind) return
    setLocalKind(nextKind)
    setLocalPath("")
    setPreview(null)
    setPreviewConfigKey(null)
  }

  const chooseLocalPath = async () => {
    const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.local-path.choose" })
    try {
      const nextPath = await requireSynapseBridge().driveSync.chooseLocalPath({
        kind: bindingKind,
        mode: effectiveBindingMode,
        defaultName: item?.name,
      })
      if (!nextPath) {
        finishTracking("cancelled")
        return
      }
      setLocalPath(nextPath)
      finishTracking("success")
      await previewBinding(nextPath, effectiveBindingMode)
    } catch (error) {
      finishTracking("failure")
      toast(errorMessage(error, "无法选择本地位置"))
    }
  }

  const previewBinding = async (
    nextLocalPath = localPath,
    nextMode: DriveSyncBindingMode = effectiveBindingMode,
    options: { readonly defaults?: boolean; readonly gitignore?: boolean } = {},
  ): Promise<DriveSyncBindingPreviewDto | null> => {
    if (!isBindingDialog || nextLocalPath.trim().length === 0) return null
    const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.binding.preview" })
    const currentPath = nextLocalPath
    const driveItemName = item?.name ?? getDriveSyncLocalName(currentPath, bindingKind)
    const bindingDrivePathHint = isLocalBinding
      ? joinDriveSyncPathHint(drivePathHint, driveItemName)
      : drivePathHint ?? item?.name ?? driveItemName
    const nextUseDefaultExcludes = options.defaults ?? useDefaultExcludes
    const nextImportGitignore = options.gitignore ?? importGitignore
    const configKey = driveSyncPreviewConfigKey(currentPath, nextMode, excludeText, nextUseDefaultExcludes, nextImportGitignore)
    setBusy(true)
    try {
      const nextPreview = await requireSynapseBridge().driveSync.previewBinding({
        driveItemId: item?.id ?? getDriveSyncLocalPlaceholderId(currentPath),
        driveItemName,
        kind: bindingKind,
        drivePathHint: bindingDrivePathHint,
        localPath: currentPath,
        remoteExists: nextMode !== "local_to_remote",
        directionHint: nextMode,
        excludeRules: bindingKind === "folder" ? parseExcludeText(excludeText) : [],
        useDefaultExcludes: bindingKind === "folder" ? nextUseDefaultExcludes : false,
        importGitignore: bindingKind === "folder" ? nextImportGitignore : false,
      })
      setPreview(nextPreview)
      setPreviewConfigKey(configKey)
      finishTracking("success")
      return nextPreview
    } catch (error) {
      finishTracking("failure")
      toast(errorMessage(error, "校验失败"))
      return null
    } finally {
      setBusy(false)
    }
  }

  const createBinding = async () => {
    if (!isBindingDialog) return
    if (localPath.trim().length === 0) return
    const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.binding.create" })
    let outcome: "success" | "failure" | "cancelled" = "cancelled"
    const currentPath = localPath
    const driveItemName = item?.name ?? getDriveSyncLocalName(currentPath, bindingKind)
    const bindingDrivePathHint = isLocalBinding
      ? joinDriveSyncPathHint(drivePathHint, driveItemName)
      : drivePathHint ?? item?.name ?? driveItemName
    const currentPreview = preview?.localPath === currentPath && preview.direction === effectiveBindingMode
      ? preview
      : await previewBinding(currentPath, effectiveBindingMode)
    if (!currentPreview?.direction || currentPreview.status !== "ready") {
      finishTracking(outcome)
      return
    }
    outcome = "failure"
    setBusy(true)
    try {
      const binding = await requireSynapseBridge().driveSync.createSafeBinding({
        driveItemId: item?.id ?? getDriveSyncLocalPlaceholderId(currentPath),
        driveItemName,
        kind: bindingKind,
        drivePathHint: bindingDrivePathHint,
        targetParentId,
        localPath: currentPath,
        direction: currentPreview.direction,
        excludeRules: bindingKind === "folder" ? parseExcludeText(excludeText) : [],
        useDefaultExcludes: bindingKind === "folder" ? useDefaultExcludes : false,
        importGitignore: bindingKind === "folder" ? importGitignore : false,
      })
      await refreshSnapshot()
      if (binding.status === "error") {
        toast(binding.lastError ?? "同步失败")
        return
      }
      if (currentPreview.direction === "local_to_remote") {
        await onDriveItemsChanged?.()
      }
      toast("已创建同步绑定")
      onOpenChange(false)
      outcome = "success"
    } catch (error) {
      toast(errorMessage(error, "绑定失败"))
    } finally {
      setBusy(false)
      finishTracking(outcome)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-4xl",
          isStatusDialog ? "h-[36rem]" : null,
        )}
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogFrame className="max-h-[calc(100vh-2rem)]">
          {isStatusDialog ? (
            <DialogFrameHeader
              title="同步状态"
              center={(
                <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as DriveSyncObjectFilter)} className="min-w-0">
                <TabsList>
                  {DRIVE_SYNC_OBJECT_FILTERS.map((filter) => (
                    <TabsTrigger key={filter.value} value={filter.value} onClick={() => setStatusFilter(filter.value)}>{filter.label}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              )}
            />
          ) : (
            <DialogFrameHeader title={isLocalBinding ? "本地同步" : "绑定同步"} />
          )}
          <DialogFrameBody>
            <ScrollArea className="h-full min-h-0">
              <div className="px-5 py-4">
                {isBindingDialog ? (
                  <div className="grid gap-4">
                    {isLocalBinding ? (
                      <Tabs value={localKind} onValueChange={(value) => selectLocalKind(value as DriveSyncLocalKind)}>
                        <TabsList>
                          <TabsTrigger value="file" onClick={() => selectLocalKind("file")}>文件</TabsTrigger>
                          <TabsTrigger value="folder" onClick={() => selectLocalKind("folder")}>文件夹</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    ) : (
                      <Tabs
                        value={bindingMode}
                        onValueChange={(value) => {
                          selectBindingMode(value as DriveSyncBindingMode)
                        }}
                      >
                        <TabsList>
                          <TabsTrigger value="bind_existing" onClick={() => selectBindingMode("bind_existing")}>绑定已有本地项</TabsTrigger>
                          <TabsTrigger value="remote_to_local" onClick={() => selectBindingMode("remote_to_local")}>下载到本地</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="drive-sync-local-path">{pathFieldCopy?.label}</Label>
                      <InputGroup>
                        <InputGroupInput
                          id="drive-sync-local-path"
                          placeholder={pathFieldCopy?.placeholder}
                          value={localPath}
                          onChange={(event) => {
                            setLocalPath(event.target.value)
                            setPreview(null)
                          }}
                        />
                        <InputGroupButton type="button" variant="outline" disabled={busy || snapshotLoading || Boolean(snapshotError) || snapshot?.health.readOnly === true} onClick={() => { void chooseLocalPath() }}>{pathFieldCopy?.chooseLabel}</InputGroupButton>
                      </InputGroup>
                    </div>
                    {bindingKind === "folder" ? (
                      <details className="grid gap-2">
                        <summary className="cursor-default text-sm font-medium">高级设置</summary>
                        <div className="mt-2 grid gap-3">
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={useDefaultExcludes}
                              onCheckedChange={(checked) => {
                                const next = checked === true
                                setUseDefaultExcludes(next)
                                setPreview(null)
                                setPreviewConfigKey(null)
                                if (localPath) void previewBinding(localPath, effectiveBindingMode, { defaults: next })
                              }}
                            />
                            使用推荐排除规则
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={importGitignore}
                              onCheckedChange={(checked) => {
                                const next = checked === true
                                setImportGitignore(next)
                                setPreview(null)
                                setPreviewConfigKey(null)
                                if (localPath) void previewBinding(localPath, effectiveBindingMode, { gitignore: next })
                              }}
                            />
                            导入 .gitignore
                          </label>
                          <Label htmlFor="drive-sync-excludes">排除规则（可选）</Label>
                          <Textarea id="drive-sync-excludes" value={excludeText} onChange={(event) => {
                            setExcludeText(event.target.value)
                            setPreview(null)
                            setPreviewConfigKey(null)
                          }} />
                        </div>
                      </details>
                    ) : null}
                    {isLocalBinding ? (
                      <div className="grid gap-1 text-sm">
                        <span className="font-medium">云端目标</span>
                        <span className="truncate text-muted-foreground">{drivePathHint ?? "根目录"}</span>
                      </div>
                    ) : null}
                    {preview ? <DriveSyncPreview preview={preview} showDetectedGitignore={importGitignore} /> : null}
                    <div className="text-sm text-muted-foreground">仅在 Synapse 运行期间同步。</div>
                  </div>
                ) : (
                  <DriveSyncStatusPanel
                    filter={statusFilter}
                    initialSelectedBindingId={state?.mode === "status" ? state.bindingId ?? null : null}
                    snapshot={snapshot}
                    snapshotError={snapshotError}
                    snapshotLoading={snapshotLoading}
                    onSnapshotChange={onSnapshotChange}
                    onOpenDriveItem={onOpenDriveItem}
                  />
                )}
              </div>
            </ScrollArea>
          </DialogFrameBody>
          <DialogFrameFooter>
            {isBindingDialog ? (
              <>
                <Button type="button" variant="outline" disabled={busy || !hasLocalPath || snapshotLoading || Boolean(snapshotError) || snapshot?.health.readOnly === true} onClick={() => { void previewBinding() }}>校验</Button>
                <Button type="button" disabled={!canSubmitBinding} onClick={() => { void createBinding() }}>{pathFieldCopy?.submitLabel}</Button>
              </>
            ) : (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { void refreshSnapshot() }}>
                <RefreshCw data-icon="inline-start" />
                刷新
              </Button>
            )}
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function getDriveSyncBindingPathFieldCopy(
  kind: DriveItemDto["type"],
  mode: DriveSyncBindingMode,
): {
  readonly label: string
  readonly placeholder: string
  readonly chooseLabel: string
  readonly submitLabel: string
} {
  if (mode === "bind_existing") {
    return kind === "folder"
      ? { label: "本地文件夹", placeholder: "选择已有本地文件夹", chooseLabel: "选择文件夹", submitLabel: "创建同步" }
      : { label: "本地文件", placeholder: "选择已有本地文件", chooseLabel: "选择文件", submitLabel: "创建同步" }
  }
  if (mode === "local_to_remote") {
    return kind === "folder"
      ? { label: "本地文件夹", placeholder: "选择要同步的本地文件夹", chooseLabel: "选择文件夹", submitLabel: "上传并同步" }
      : { label: "本地文件", placeholder: "选择要同步的本地文件", chooseLabel: "选择文件", submitLabel: "上传并同步" }
  }
  return kind === "folder"
    ? { label: "保存位置", placeholder: "选择保存位置", chooseLabel: "选择位置", submitLabel: "下载并同步" }
    : { label: "保存为", placeholder: "选择保存位置", chooseLabel: "选择位置", submitLabel: "下载并同步" }
}

function getDriveSyncLocalName(localPath: string, kind: DriveSyncLocalKind): string {
  const name = localPath.split(/[\\/]/u).filter(Boolean).at(-1)
  if (name) return name
  return kind === "folder" ? "同步文件夹" : "同步文件"
}

function getDriveSyncLocalPlaceholderId(localPath: string): string {
  return `local:${localPath}`
}

function DriveSyncPreview({
  preview,
  showDetectedGitignore,
}: {
  readonly preview: DriveSyncBindingPreviewDto
  readonly showDetectedGitignore: boolean
}) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{preview.localPath}</span>
        <Badge variant={preview.status === "ready" ? "secondary" : "destructive"}>{preview.status === "ready" ? "可绑定" : "不可绑定"}</Badge>
      </div>
      {preview.reason ? <p className="mt-2 text-muted-foreground">{preview.reason}</p> : null}
      <div className="mt-2 text-muted-foreground">同步方向：{formatDirection(preview.direction)}</div>
      {showDetectedGitignore && preview.detectedGitignoreRules.length > 0 ? (
        <div className="mt-2 grid gap-1">
          <Label htmlFor="drive-sync-detected-gitignore">将导入的 .gitignore 规则</Label>
          <Textarea id="drive-sync-detected-gitignore" readOnly value={preview.detectedGitignoreRules.join("\n")} />
        </div>
      ) : null}
    </div>
  )
}

function DriveSyncStatusPanel({
  filter,
  initialSelectedBindingId,
  onSnapshotChange,
  onOpenDriveItem,
  snapshot,
  snapshotError,
  snapshotLoading,
}: {
  readonly filter: DriveSyncObjectFilter
  readonly initialSelectedBindingId: string | null
  readonly onSnapshotChange: (snapshot: DriveSyncSnapshotDto) => void
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly snapshot: DriveSyncSnapshotDto | null
  readonly snapshotError: string | null
  readonly snapshotLoading: boolean
}) {
  const bindings = snapshot?.bindings ?? []
  const operations = snapshot?.operations ?? []
  const conflicts = snapshot?.conflicts ?? []
  const readOnly = snapshot?.health.readOnly ?? false
  const offline = snapshot?.health.connectivity === "offline"
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(initialSelectedBindingId)
  const [stopTarget, setStopTarget] = useState<DriveSyncStopTarget>(null)
  const [pendingBindingActionIds, setPendingBindingActionIds] = useState<ReadonlySet<string>>(() => new Set())
  const [globalRetrying, setGlobalRetrying] = useState(false)
  const pendingBindingActionIdsRef = useRef<Set<string>>(new Set())
  const selectedBinding = bindings.find((binding) => binding.id === selectedBindingId) ?? null
  const conflictBindingIds = new Set(conflicts.map((conflict) => conflict.bindingId))
  const visibleBindings = filter === "all"
    ? bindings
    : bindings.filter((binding) => filter === "conflict"
      ? binding.status === "conflict" || conflictBindingIds.has(binding.id)
      : binding.status === filter)

  const refreshSnapshot = async (): Promise<DriveSyncSnapshotDto> => {
    const nextSnapshot = await requireSynapseBridge().driveSync.getSnapshot()
    onSnapshotChange(nextSnapshot)
    return nextSnapshot
  }

  const setBindingActionPending = (bindingId: string, pending: boolean) => {
    const next = new Set(pendingBindingActionIdsRef.current)
    if (pending) {
      next.add(bindingId)
    } else {
      next.delete(bindingId)
    }
    pendingBindingActionIdsRef.current = next
    setPendingBindingActionIds(next)
  }

  const isBindingActionPending = (bindingId: string) => pendingBindingActionIds.has(bindingId)

  const runBindingAction: DriveSyncBindingActionRunner = async (eventKey, bindingId, action, success) => {
    const finishTracking = startTrackedOperation({ component: "drive", eventKey })
    if (readOnly) {
      toast(offline ? "联网后可管理同步。" : "登录后可管理同步。")
      finishTracking("cancelled")
      return
    }
    if (pendingBindingActionIdsRef.current.has(bindingId)) {
      toast("同步操作正在执行，请稍后再试。")
      finishTracking("cancelled")
      return
    }
    let outcome: "success" | "failure" = "failure"
    setBindingActionPending(bindingId, true)
    try {
      await action()
      const nextSnapshot = await refreshSnapshot()
      const actionError = driveSyncManualActionErrorMessage(nextSnapshot, bindingId)
      if (actionError) {
        toast(actionError)
        return
      }
      toast(success)
      outcome = "success"
    } catch (error) {
      await refreshSnapshot().catch(() => undefined)
      toast(errorMessage(error, "操作失败"))
    } finally {
      setBindingActionPending(bindingId, false)
      finishTracking(outcome)
    }
  }

  const retryGlobalSync = async () => {
    if (globalRetrying || readOnly) return
    const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.global.retry" })
    let outcome: "success" | "failure" = "failure"
    setGlobalRetrying(true)
    try {
      await requireSynapseBridge().driveSync.pollRemoteChanges({})
      await refreshSnapshot()
      outcome = "success"
    } catch (error) {
      toast(errorMessage(error, "重试失败"))
    } finally {
      setGlobalRetrying(false)
      finishTracking(outcome)
    }
  }

  const retrySnapshotLoad = async () => {
    if (globalRetrying) return
    const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.snapshot.retry" })
    let outcome: "success" | "failure" = "failure"
    setGlobalRetrying(true)
    try {
      await refreshSnapshot()
      outcome = "success"
    } catch (error) {
      toast(errorMessage(error, "加载同步状态失败"))
    } finally {
      setGlobalRetrying(false)
      finishTracking(outcome)
    }
  }

  useEffect(() => {
    if (selectedBindingId && !selectedBinding) setSelectedBindingId(null)
  }, [selectedBinding, selectedBindingId])

  useEffect(() => {
    setSelectedBindingId(initialSelectedBindingId)
  }, [initialSelectedBindingId])

  return (
    <>
      {snapshotLoading && !snapshot ? <DriveSyncEmptyState compact title="正在加载同步状态" /> : null}
      {snapshotError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-destructive">
          <span>{snapshotError}</span>
          <Button type="button" size="sm" variant="outline" disabled={globalRetrying} onClick={() => { void retrySnapshotLoad() }}>重试</Button>
        </div>
      ) : null}
      {readOnly ? (
        <div className="mb-3 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          {offline ? "当前离线，仅显示同步状态；联网后会自动追平。" : "未登录，仅显示上次登录账号的同步状态。"}
        </div>
      ) : null}
      {snapshot?.health.lastError ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-destructive">
          <span>{snapshot.health.lastError}</span>
          <Button type="button" size="sm" variant="outline" disabled={globalRetrying || readOnly} onClick={() => { void retryGlobalSync() }}>重试</Button>
        </div>
      ) : null}
      {snapshot ? (
        <div className="mb-3 flex flex-wrap gap-2" aria-label="同步汇总">
          <Badge variant="secondary">启用 {snapshot.summary.activeBindingCount}</Badge>
          <Badge variant="secondary">进行中 {snapshot.summary.runningOperationCount}</Badge>
          <Badge variant={snapshot.summary.conflictCount > 0 ? "destructive" : "secondary"}>冲突 {snapshot.summary.conflictCount}</Badge>
          <Badge variant={snapshot.summary.errorCount > 0 ? "destructive" : "secondary"}>错误 {snapshot.summary.errorCount}</Badge>
        </div>
      ) : null}
      {snapshot ? (
        <DriveSyncBindingList
          bindings={visibleBindings}
          conflicts={conflicts}
          onRequestStop={(binding) => setStopTarget({ id: binding.id, driveItemName: binding.driveItemName })}
          operations={operations}
          isBindingActionPending={isBindingActionPending}
          readOnly={readOnly}
          onSelectBinding={(binding) => setSelectedBindingId(binding.id)}
          runBindingAction={runBindingAction}
        />
      ) : !snapshotLoading && !snapshotError ? <DriveSyncEmptyState title="暂无同步对象" /> : null}
      <DriveSyncBindingDetailDialog
        binding={selectedBinding}
        conflicts={selectedBinding ? conflicts.filter((conflict) => conflict.bindingId === selectedBinding.id) : []}
        isBindingActionPending={isBindingActionPending}
        onRequestStop={(binding) => setStopTarget({ id: binding.id, driveItemName: binding.driveItemName })}
        onOpenChange={(open) => {
          if (!open) setSelectedBindingId(null)
        }}
        operations={selectedBinding ? operations.filter((operation) => operation.bindingId === selectedBinding.id) : []}
        onOpenDriveItem={onOpenDriveItem}
        readOnly={readOnly}
        runBindingAction={runBindingAction}
      />
      <AlertDialog open={stopTarget !== null} onOpenChange={(open) => {
        if (!open) setStopTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>停止同步 {stopTarget?.driveItemName}</AlertDialogTitle>
            <AlertDialogDescription>
              不会删除本地或云端文件，只会取消这条同步关系。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={stopTarget ? isBindingActionPending(stopTarget.id) : false}
              onClick={() => {
                if (!stopTarget) return
                const targetId = stopTarget.id
                void runBindingAction(
                  "drive.sync.binding.stop",
                  targetId,
                  () => requireSynapseBridge().driveSync.removeBinding({ id: targetId }),
                  "已停止同步",
                ).finally(() => setStopTarget(null))
              }}
            >
              停止同步
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DriveSyncBindingList({
  bindings,
  conflicts,
  isBindingActionPending,
  onRequestStop,
  onSelectBinding,
  operations,
  readOnly,
  runBindingAction,
}: {
  readonly bindings: readonly DriveSyncBindingDto[]
  readonly conflicts: NonNullable<DriveSyncSnapshotDto["conflicts"]>
  readonly isBindingActionPending: (bindingId: string) => boolean
  readonly onRequestStop: (binding: DriveSyncBindingDto) => void
  readonly onSelectBinding: (binding: DriveSyncBindingDto) => void
  readonly operations: NonNullable<DriveSyncSnapshotDto["operations"]>
  readonly readOnly: boolean
  readonly runBindingAction: DriveSyncBindingActionRunner
}) {
  if (bindings.length === 0) {
    return <DriveSyncEmptyState title="暂无同步对象" />
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      {bindings.map((binding) => {
        const conflictCount = conflicts.filter((conflict) => conflict.bindingId === binding.id).length
        const bindingOperations = operations.filter((operation) => operation.bindingId === binding.id)
        const operationCount = bindingOperations.length
        const issueSummary = getBindingIssueSummary(binding, conflictCount, bindingOperations)
        const remotePath = driveSyncRemotePath(binding)
        return (
          <div
            key={binding.id}
            className="grid gap-3 border-b p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="truncate text-sm font-medium">{binding.driveItemName}</div>
                <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>
                  {formatBindingStatus(binding.status)}
                </Badge>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">云端 {remotePath}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">本地 {binding.localPath}</div>
              <div className="mt-2 truncate text-sm">{issueSummary}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span>{formatBindingTime(binding)}</span>
                <span>{conflictCount} 个冲突</span>
                <span>{operationCount} 条同步记录</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-start gap-1 sm:justify-end">
              <DriveSyncBindingActions
                binding={binding}
                conflictCount={conflictCount}
                isPending={isBindingActionPending(binding.id)}
                readOnly={readOnly}
                onOpenDetails={() => onSelectBinding(binding)}
                onRequestStop={() => onRequestStop(binding)}
                runBindingAction={runBindingAction}
                showStatus={false}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DriveSyncBindingDetailDialog({
  binding,
  conflicts,
  isBindingActionPending,
  onRequestStop,
  onOpenChange,
  onOpenDriveItem,
  operations,
  readOnly,
  runBindingAction,
}: {
  readonly binding: DriveSyncBindingDto | null
  readonly conflicts: NonNullable<DriveSyncSnapshotDto["conflicts"]>
  readonly isBindingActionPending: (bindingId: string) => boolean
  readonly onRequestStop: (binding: DriveSyncBindingDto) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onOpenDriveItem?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly operations: NonNullable<DriveSyncSnapshotDto["operations"]>
  readonly readOnly: boolean
  readonly runBindingAction: DriveSyncBindingActionRunner
}) {
  const [defaultExcludeDraft, setDefaultExcludeDraft] = useState("")
  const [importedExcludeDraft, setImportedExcludeDraft] = useState("")
  const [userExcludeDraft, setUserExcludeDraft] = useState("")

  useEffect(() => {
    setDefaultExcludeDraft(binding?.excludeRules.defaults.join("\n") ?? "")
    setImportedExcludeDraft(binding?.excludeRules.importedGitignore.join("\n") ?? "")
    setUserExcludeDraft(binding?.excludeRules.user.join("\n") ?? "")
  }, [binding])

  return (
    <Dialog open={binding !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        {binding ? (
          <DialogFrame className="max-h-[calc(100vh-4rem)]">
            <DialogFrameHeader
              bordered
              title={binding.driveItemName}
              description={`云端 ${driveSyncRemotePath(binding)} · 本地 ${binding.localPath}`}
              actions={(
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void Promise.resolve(requireSynapseBridge().shell.showItemInFolder(binding.localPath))
                        .catch((error) => toast(errorMessage(error, "无法打开本地位置")))
                    }}
                  >
                    打开本地位置
                  </Button>
                  {onOpenDriveItem ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void Promise.resolve(onOpenDriveItem(binding))
                          .catch((error) => toast(errorMessage(error, "无法打开云端位置")))
                      }}
                    >
                      打开云端位置
                    </Button>
                  ) : null}
                  <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>
                    {formatBindingStatus(binding.status)}
                  </Badge>
                  <DriveSyncBindingActions
                    binding={binding}
                    conflictCount={conflicts.length}
                    isPending={isBindingActionPending(binding.id)}
                    readOnly={readOnly}
                    onOpenDetails={() => undefined}
                    onRequestStop={() => onRequestStop(binding)}
                    runBindingAction={runBindingAction}
                    showPrimary={false}
                    showStatus={false}
                  />
                </>
              )}
            >
              <div className="mt-3 text-sm">{getBindingIssueSummary(binding, conflicts.length, operations)}</div>
            </DialogFrameHeader>
            <DialogFrameBody>
              <ScrollArea className="h-full min-h-0">
                <div className="grid gap-4 px-5 py-4">
                  {binding.kind === "folder" ? (
                    <div className="grid gap-2">
                      <div className="text-sm font-medium">排除规则</div>
                      <Label htmlFor={`drive-sync-detail-forced-excludes-${binding.id}`}>强制规则</Label>
                      <Textarea
                        id={`drive-sync-detail-forced-excludes-${binding.id}`}
                        readOnly
                        value={binding.excludeRules.forced.join("\n")}
                      />
                      <Label htmlFor={`drive-sync-detail-default-excludes-${binding.id}`}>推荐规则</Label>
                      <Textarea
                        id={`drive-sync-detail-default-excludes-${binding.id}`}
                        value={defaultExcludeDraft}
                        readOnly={readOnly}
                        onChange={(event) => setDefaultExcludeDraft(event.target.value)}
                      />
                      <Label htmlFor={`drive-sync-detail-imported-excludes-${binding.id}`}>已导入的 .gitignore 规则</Label>
                      <Textarea
                        id={`drive-sync-detail-imported-excludes-${binding.id}`}
                        value={importedExcludeDraft}
                        readOnly={readOnly}
                        onChange={(event) => setImportedExcludeDraft(event.target.value)}
                      />
                      <Label htmlFor={`drive-sync-detail-user-excludes-${binding.id}`}>用户规则</Label>
                      <Textarea
                        id={`drive-sync-detail-user-excludes-${binding.id}`}
                        value={userExcludeDraft}
                        readOnly={readOnly}
                        onChange={(event) => setUserExcludeDraft(event.target.value)}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={readOnly || isBindingActionPending(binding.id)}
                          onClick={() => {
                            void runBindingAction(
                              "drive.sync.binding.excludes.update",
                              binding.id,
                              () => requireSynapseBridge().driveSync.updateExcludeRules({
                                id: binding.id,
                                defaults: parseExcludeText(defaultExcludeDraft),
                                importedGitignore: parseExcludeText(importedExcludeDraft),
                                user: parseExcludeText(userExcludeDraft),
                              }),
                              "已更新排除规则",
                            )
                          }}
                        >
                          保存规则
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-2">
                    <div className="text-sm font-medium">处理冲突</div>
                    <DriveSyncConflictTable
                      conflicts={conflicts}
                      isBindingActionPending={isBindingActionPending}
                      readOnly={readOnly}
                      runBindingAction={runBindingAction}
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="text-sm font-medium">同步记录</div>
                    <DriveSyncOperationTable operations={operations} />
                  </div>
                </div>
              </ScrollArea>
            </DialogFrameBody>
          </DialogFrame>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DriveSyncEmptyState({
  compact = false,
  title,
}: {
  readonly compact?: boolean
  readonly title: string
}) {
  return (
    <div className={cn("flex items-center justify-center rounded-lg border text-sm text-muted-foreground", compact ? "min-h-28" : "min-h-48")}>
      {title}
    </div>
  )
}

function DriveSyncBindingActions({
  binding,
  conflictCount,
  isPending,
  readOnly,
  onOpenDetails,
  onRequestStop,
  runBindingAction,
  showPrimary = true,
  showStatus = true,
}: {
  readonly binding: DriveSyncBindingDto
  readonly conflictCount: number
  readonly isPending: boolean
  readonly readOnly: boolean
  readonly onOpenDetails: () => void
  readonly onRequestStop: () => void
  readonly runBindingAction: DriveSyncBindingActionRunner
  readonly showPrimary?: boolean
  readonly showStatus?: boolean
}) {
  const [rescanOpen, setRescanOpen] = useState(false)
  const canPause = binding.status === "active" || binding.status === "conflict"
  const primaryAction = getBindingPrimaryAction(binding, conflictCount)
  const manualSyncDisabled = readOnly || isPending || binding.status === "paused" || binding.status === "initializing"
  const runRetry = () => runBindingAction(
    "drive.sync.binding.retry",
    binding.id,
    async () => {
      const { driveSync } = requireSynapseBridge()
      await driveSync.resumeBinding({ id: binding.id })
    },
    "已重试同步",
  )
  const runResume = () => runBindingAction(
    "drive.sync.binding.resume",
    binding.id,
    () => requireSynapseBridge().driveSync.resumeBinding({ id: binding.id }),
    "已继续同步",
  )
  return (
    <>
      <div className="flex flex-wrap justify-end gap-1">
      {showStatus ? (
        <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>{formatBindingStatus(binding.status)}</Badge>
      ) : null}
      {showPrimary ? (
        <Button
          type="button"
          variant={primaryAction.kind === "details" ? "outline" : "default"}
          size="sm"
          aria-label={`${primaryAction.ariaPrefix} ${binding.driveItemName}`}
          disabled={isPending || (readOnly && primaryAction.kind !== "details" && primaryAction.kind !== "conflicts")}
          onClick={() => {
            if (primaryAction.kind === "details" || primaryAction.kind === "conflicts") {
              onOpenDetails()
              return
            }
            void (binding.status === "error" ? runRetry() : runResume())
          }}
        >
          {primaryAction.label}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" disabled={isPending} aria-label={`更多同步操作 ${binding.driveItemName}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem disabled={manualSyncDisabled} onClick={() => setRescanOpen(true)}>
            完整校验
          </DropdownMenuItem>
          <DropdownMenuItem disabled={manualSyncDisabled} onClick={() => { void runBindingAction("drive.sync.binding.poll", binding.id, () => requireSynapseBridge().driveSync.pollRemoteChanges({ id: binding.id }), "已同步云端变更") }}>
            同步云端变更
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {canPause ? (
            <DropdownMenuItem disabled={readOnly || isPending} onClick={() => { void runBindingAction("drive.sync.binding.pause", binding.id, () => requireSynapseBridge().driveSync.pauseBinding({ id: binding.id }), "已暂停同步") }}>
              暂停同步
            </DropdownMenuItem>
          ) : binding.status === "paused" || binding.status === "error" ? (
            <DropdownMenuItem disabled={readOnly || isPending} onClick={() => { void runResume() }}>
              继续同步
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={readOnly || isPending} onClick={onRequestStop}>
            停止同步
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
      <AlertDialog open={rescanOpen} onOpenChange={setRescanOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>完整校验 {binding.driveItemName}</AlertDialogTitle>
            <AlertDialogDescription>将读取全部本地文件并下载云端文件进行内容校验。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={readOnly || isPending}
              onClick={() => {
                void runBindingAction(
                  "drive.sync.binding.rescan",
                  binding.id,
                  () => requireSynapseBridge().driveSync.rescanBinding({ id: binding.id }),
                  "完整校验已完成",
                ).finally(() => setRescanOpen(false))
              }}
            >
              开始校验
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function DriveSyncConflictTable({
  conflicts,
  isBindingActionPending,
  readOnly,
  runBindingAction,
}: {
  readonly conflicts: NonNullable<DriveSyncSnapshotDto["conflicts"]>
  readonly isBindingActionPending: (bindingId: string) => boolean
  readonly readOnly: boolean
  readonly runBindingAction: DriveSyncBindingActionRunner
}) {
  if (conflicts.length === 0) {
    return <DriveSyncEmptyState compact title="暂无冲突" />
  }
  return (
    <Table className="table-fixed" containerClassName="rounded-lg border">
      <TableHeader>
        <TableRow>
          <TableHead>路径</TableHead>
          <TableHead className="w-28">类型</TableHead>
          <TableHead className="w-64 text-right">处理</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {conflicts.map((conflict) => {
          const isPending = readOnly || isBindingActionPending(conflict.bindingId)
          const availableActions = new Set(conflict.availableActions)
          return (
            <TableRow key={conflict.id}>
              <TableCell className="min-w-0">
                <div className="truncate">{conflict.relativePath || "/"}</div>
                {conflict.localSummary || conflict.remoteSummary ? (
                  <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
                    {conflict.localSummary ? <div className="truncate">{conflict.localSummary}</div> : null}
                    {conflict.remoteSummary ? <div className="truncate">{conflict.remoteSummary}</div> : null}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>{formatConflictType(conflict.type)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {availableActions.has("confirm_delete") ? (
                    <Button type="button" variant="ghost" size="xs" disabled={isPending} onClick={() => { void runBindingAction("drive.sync.conflict.confirm-delete", conflict.bindingId, () => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "confirm_delete" }), "已确认删除") }}>确认删除</Button>
                  ) : null}
                  {availableActions.has("keep_local") ? (
                    <Button type="button" variant="ghost" size="xs" disabled={isPending} onClick={() => { void runBindingAction("drive.sync.conflict.keep-local", conflict.bindingId, () => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "keep_local" }), "已保留本地") }}>用本地</Button>
                  ) : null}
                  {availableActions.has("keep_remote") ? (
                    <Button type="button" variant="ghost" size="xs" disabled={isPending} onClick={() => { void runBindingAction("drive.sync.conflict.keep-remote", conflict.bindingId, () => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "keep_remote" }), "已保留云端") }}>用云端</Button>
                  ) : null}
                  {availableActions.has("keep_both") ? (
                    <Button type="button" variant="ghost" size="xs" disabled={isPending} onClick={() => { void runBindingAction("drive.sync.conflict.keep-both", conflict.bindingId, () => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "keep_both" }), "已保留两份") }}>保留两份</Button>
                  ) : null}
                  {availableActions.has("skip") ? (
                    <Button type="button" variant="ghost" size="xs" disabled={isPending} onClick={() => { void runBindingAction("drive.sync.conflict.skip", conflict.bindingId, () => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "skip" }), "稍后处理") }}>稍后</Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function DriveSyncOperationTable({ operations }: { readonly operations: NonNullable<DriveSyncSnapshotDto["operations"]> }) {
  if (operations.length === 0) {
    return <DriveSyncEmptyState compact title="暂无记录" />
  }
  return (
    <Table className="table-fixed" containerClassName="rounded-lg border">
      <TableHeader>
        <TableRow>
          <TableHead>路径</TableHead>
          <TableHead className="w-24">操作</TableHead>
          <TableHead className="w-28">状态</TableHead>
          <TableHead className="w-48 text-right">时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((operation) => (
          <TableRow key={operation.id}>
            <TableCell className="truncate">{operation.relativePath || "/"}</TableCell>
            <TableCell>{formatOperationKind(operation.kind)}</TableCell>
            <TableCell>
              <div className="truncate">{operation.message ?? formatOperationStatus(operation.status)}</div>
              {operation.message ? <div className="truncate text-xs text-muted-foreground">{formatOperationStatus(operation.status)}</div> : null}
              {operation.totalBytes !== null && operation.totalBytes > 0 ? (
                <Progress
                  className="mt-1"
                  value={Math.min(100, ((operation.completedBytes ?? 0) / operation.totalBytes) * 100)}
                  aria-label={`${operation.relativePath || "/"} 同步进度`}
                />
              ) : null}
              {operation.status === "retry_wait" && operation.nextRetryAt ? (
                <div className="truncate text-xs text-muted-foreground">
                  第 {operation.attemptCount} 次重试 · {new Date(operation.nextRetryAt).toLocaleString()}
                </div>
              ) : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">{new Date(operation.updatedAt).toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function DriveSyncStatusButton({
  onOpen,
  snapshot,
}: {
  readonly onOpen: () => void
  readonly snapshot: DriveSyncSnapshotDto | null
}) {
  const summary = snapshot?.summary
  const conflictCount = countVisibleDriveSyncConflicts(snapshot)
  const hasHealthError = snapshot?.health.status === "error"
  const errorCount = Math.max(summary?.errorCount ?? 0, hasHealthError ? 1 : 0)
  const activeCount = summary?.activeBindingCount ?? 0
  const runningCount = summary?.runningOperationCount ?? 0
  const retryingCount = summary?.retryWaitingOperationCount ?? 0
  const initializingCount = snapshot?.bindings.filter((binding) => binding.status === "initializing").length ?? 0
  const pausedCount = snapshot?.bindings.filter((binding) => binding.status === "paused").length ?? 0
  const badge = conflictCount > 0
    ? { label: String(conflictCount), variant: "destructive" as const, message: `${conflictCount} 个冲突` }
    : errorCount > 0
      ? { label: String(errorCount), variant: "outline" as const, message: `${errorCount} 个错误` }
      : runningCount > 0 || initializingCount > 0
        ? { label: String(runningCount + initializingCount), variant: "secondary" as const, message: `${runningCount + initializingCount} 个同步中` }
        : retryingCount > 0 || snapshot?.health.status === "retrying"
          ? { label: String(Math.max(1, retryingCount)), variant: "outline" as const, message: `${Math.max(1, retryingCount)} 个等待重试` }
          : activeCount > 0
            ? { label: String(activeCount), variant: "secondary" as const, message: `${activeCount} 个绑定` }
            : pausedCount > 0
              ? { label: String(pausedCount), variant: "secondary" as const, message: `${pausedCount} 个暂停` }
              : null
  const message = badge?.message ?? "暂无同步绑定"
  return (
    <SystemAppTopBarActionButton
      type="button"
      tone={conflictCount > 0 ? "destructive" : "default"}
      aria-label={`同步状态：${message}`}
      onClick={onOpen}
    >
      同步
      {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
    </SystemAppTopBarActionButton>
  )
}

function countVisibleDriveSyncConflicts(snapshot: DriveSyncSnapshotDto | null): number {
  if (!snapshot) return 0
  const bindingIds = new Set(snapshot.bindings.map((binding) => binding.id))
  return snapshot.conflicts.filter((conflict) => bindingIds.has(conflict.bindingId)).length
}

function driveSyncManualActionErrorMessage(snapshot: DriveSyncSnapshotDto, bindingId: string): string | null {
  const binding = snapshot.bindings.find((item) => item.id === bindingId)
  if (binding?.status === "error") return binding.lastError?.trim() || "同步失败，请查看同步记录"
  if (binding?.status === "conflict" || snapshot.conflicts.some((conflict) => conflict.bindingId === bindingId)) {
    return "同步产生冲突，请处理冲突"
  }
  return null
}

function driveSyncRemotePath(binding: DriveSyncBindingDto): string {
  return binding.drivePathHint?.trim() || binding.driveItemName
}

function parseExcludeText(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

function driveSyncPreviewConfigKey(
  localPath: string,
  direction: DriveSyncBindingMode,
  excludeText: string,
  useDefaultExcludes: boolean,
  importGitignore: boolean,
): string {
  return JSON.stringify([localPath, direction, parseExcludeText(excludeText), useDefaultExcludes, importGitignore])
}

function joinDriveSyncPathHint(parentPath: string | null | undefined, name: string): string {
  const normalizedParent = parentPath?.trim()
  if (!normalizedParent || normalizedParent === "根目录" || normalizedParent === "/") return `/${name}`
  return `${normalizedParent.replace(/\/+$/u, "")}/${name}`
}

function formatDirection(direction: DriveSyncBindingPreviewDto["direction"]): string {
  if (direction === "remote_to_local") return "云端到本地"
  if (direction === "local_to_remote") return "本地到云端"
  if (direction === "bind_existing") return "建立绑定"
  return "-"
}

function formatBindingStatus(status: DriveSyncBindingDto["status"]): string {
  if (status === "initializing") return "初始化中"
  if (status === "active") return "已启用"
  if (status === "paused") return "已暂停"
  if (status === "conflict") return "有冲突"
  if (status === "error") return "错误"
  return status
}

function getBindingPrimaryAction(
  binding: DriveSyncBindingDto,
  conflictCount: number,
): { readonly ariaPrefix: string; readonly kind: "conflicts" | "details" | "resume"; readonly label: string } {
  if (binding.status === "error") {
    return { ariaPrefix: "重试同步", kind: "resume", label: "重试同步" }
  }
  if (binding.status === "conflict" || conflictCount > 0) {
    return { ariaPrefix: "处理同步冲突", kind: "conflicts", label: "处理冲突" }
  }
  if (binding.status === "paused") {
    return { ariaPrefix: "继续同步", kind: "resume", label: "继续同步" }
  }
  return { ariaPrefix: "查看同步详情", kind: "details", label: "详情" }
}

function getBindingIssueSummary(
  binding: DriveSyncBindingDto,
  conflictCount: number,
  operations: readonly DriveSyncSnapshotDto["operations"][number][],
): string {
  if (binding.status === "error") {
    return binding.lastError ?? operations.find((operation) => operation.status === "error" && operation.message)?.message ?? "同步失败，请查看同步记录"
  }
  if (binding.status === "conflict" || conflictCount > 0) {
    return conflictCount > 0 ? `${conflictCount} 个冲突需要处理` : "存在同步冲突"
  }
  if (binding.status === "paused") return "已暂停自动同步"
  if (binding.status === "initializing") return "正在初始化同步内容"
  const retrying = operations.find((operation) => operation.status === "retry_wait")
  if (retrying) return retrying.message ?? "等待重试"
  return "同步关系正常"
}

function formatBindingTime(binding: DriveSyncBindingDto): string {
  const value = binding.lastSyncedAt ?? binding.updatedAt
  return `${binding.lastSyncedAt ? "最近同步" : "更新"}：${new Date(value).toLocaleString()}`
}

function formatOperationStatus(status: DriveSyncSnapshotDto["operations"][number]["status"]): string {
  if (status === "pending") return "等待中"
  if (status === "running") return "同步中"
  if (status === "succeeded") return "已完成"
  if (status === "retry_wait") return "等待重试"
  if (status === "conflict") return "有冲突"
  if (status === "error") return "失败"
  return status
}

function formatOperationKind(kind: DriveSyncSnapshotDto["operations"][number]["kind"]): string {
  if (kind === "download") return "下载"
  if (kind === "upload") return "上传"
  if (kind === "delete_local") return "删除本地"
  if (kind === "delete_remote") return "删除云端"
  if (kind === "move_local") return "移动本地"
  if (kind === "move_remote") return "移动云端"
  if (kind === "scan") return "扫描"
  if (kind === "resync") return "重新同步"
  return kind
}

function formatConflictType(type: string): string {
  if (type === "both_modified") return "双边修改"
  if (type === "delete_vs_modify") return "删除与修改"
  if (type === "type_mismatch") return "类型冲突"
  if (type === "path_conflict") return "路径占用"
  return type
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
