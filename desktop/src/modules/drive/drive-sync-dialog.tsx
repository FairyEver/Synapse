import { useEffect, useState } from "react"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"
import type {
  DriveItemDto,
  DriveSyncBindingDto,
  DriveSyncBindingPreviewDto,
  DriveSyncSnapshotDto,
} from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { requireSynapseBridge } from "@/lib/electron-bridge"

type DriveSyncBindingMode = "bind_existing" | "remote_to_local"
type DriveSyncObjectFilter = "all" | "active" | "conflict" | "paused" | "error"

const DRIVE_SYNC_OBJECT_FILTERS: ReadonlyArray<{
  readonly value: DriveSyncObjectFilter
  readonly label: string
}> = [
  { value: "all", label: "全部" },
  { value: "active", label: "同步中" },
  { value: "conflict", label: "有冲突" },
  { value: "paused", label: "已暂停" },
  { value: "error", label: "错误" },
]

export type DriveSyncDialogState =
  | { readonly mode: "status"; readonly item: null }
  | { readonly mode: "bind"; readonly item: DriveItemDto }

export function DriveSyncDialog({
  onOpenChange,
  onSnapshotChange,
  open,
  snapshot,
  state,
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly onSnapshotChange: (snapshot: DriveSyncSnapshotDto) => void
  readonly open: boolean
  readonly snapshot: DriveSyncSnapshotDto | null
  readonly state: DriveSyncDialogState | null
}) {
  const [localPath, setLocalPath] = useState("")
  const [bindingMode, setBindingMode] = useState<DriveSyncBindingMode>("bind_existing")
  const [preview, setPreview] = useState<DriveSyncBindingPreviewDto | null>(null)
  const [excludeText, setExcludeText] = useState("")
  const [busy, setBusy] = useState(false)
  const item = state?.mode === "bind" ? state.item : null
  const pathFieldCopy = item ? getDriveSyncBindingPathFieldCopy(item.type, bindingMode) : null
  const trimmedLocalPath = localPath.trim()
  const currentPreview = preview?.localPath === trimmedLocalPath ? preview : null
  const canSubmitBinding = trimmedLocalPath.length > 0 && !busy && currentPreview?.status !== "blocked"

  useEffect(() => {
    if (!open) {
      setLocalPath("")
      setBindingMode("bind_existing")
      setPreview(null)
      setExcludeText("")
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
  }

  const chooseLocalPath = async () => {
    if (!item) return
    const nextPath = await requireSynapseBridge().driveSync.chooseLocalPath({
      kind: item.type,
      mode: bindingMode,
      defaultName: item.name,
    })
    if (!nextPath) return
    setLocalPath(nextPath)
    await previewBinding(nextPath, bindingMode)
  }

  const previewBinding = async (
    nextLocalPath = localPath,
    nextMode: DriveSyncBindingMode = bindingMode,
  ): Promise<DriveSyncBindingPreviewDto | null> => {
    if (!item || nextLocalPath.trim().length === 0) return null
    setBusy(true)
    try {
      const nextPreview = await requireSynapseBridge().driveSync.previewBinding({
        driveItemId: item.id,
        driveItemName: item.name,
        kind: item.type,
        drivePathHint: item.name,
        localPath: nextLocalPath.trim(),
        remoteExists: true,
        directionHint: nextMode,
        importGitignore: item.type === "folder",
      })
      setPreview(nextPreview)
      return nextPreview
    } catch (error) {
      toast(errorMessage(error, "校验失败"))
      return null
    } finally {
      setBusy(false)
    }
  }

  const createBinding = async () => {
    if (!item) return
    const currentPath = localPath.trim()
    const currentPreview = preview?.localPath === currentPath && preview.direction === bindingMode
      ? preview
      : await previewBinding(currentPath, bindingMode)
    if (!currentPreview?.direction || currentPreview.status !== "ready") return
    setBusy(true)
    try {
      await requireSynapseBridge().driveSync.createSafeBinding({
        driveItemId: item.id,
        driveItemName: item.name,
        kind: item.type,
        drivePathHint: item.name,
        localPath: currentPath,
        direction: currentPreview.direction,
        excludeRules: item.type === "folder" ? parseExcludeText(excludeText) : [],
        importGitignore: item.type === "folder",
      })
      await refreshSnapshot()
      toast("已创建同步绑定")
      onOpenChange(false)
    } catch (error) {
      toast(errorMessage(error, "绑定失败"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-4xl"
        aria-describedby={undefined}
      >
        <div className="flex h-full min-h-0 max-h-[calc(100vh-2rem)] flex-col overflow-hidden">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>{item ? "绑定同步" : "同步状态"}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-4">
              {item ? (
                <div className="grid gap-4">
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
                      <InputGroupButton type="button" variant="outline" onClick={() => { void chooseLocalPath() }}>{pathFieldCopy?.chooseLabel}</InputGroupButton>
                    </InputGroup>
                  </div>
                  {item.type === "folder" ? (
                    <details className="grid gap-2">
                      <summary className="cursor-default text-sm font-medium">高级设置</summary>
                      <div className="mt-2 grid gap-2">
                        <Label htmlFor="drive-sync-excludes">排除规则（可选）</Label>
                        <Textarea id="drive-sync-excludes" value={excludeText} onChange={(event) => setExcludeText(event.target.value)} />
                      </div>
                    </details>
                  ) : null}
                  {preview ? <DriveSyncPreview preview={preview} /> : null}
                </div>
              ) : (
                <DriveSyncStatusPanel snapshot={snapshot} onSnapshotChange={onSnapshotChange} />
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-2 rounded-none rounded-b-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
            {item ? (
              <>
                <Button type="button" variant="outline" disabled={busy || trimmedLocalPath.length === 0} onClick={() => { void previewBinding() }}>校验</Button>
                <Button type="button" disabled={!canSubmitBinding} onClick={() => { void createBinding() }}>{pathFieldCopy?.submitLabel}</Button>
              </>
            ) : (
              <Button type="button" variant="outline" disabled={busy} onClick={() => { void refreshSnapshot() }}>
                <RefreshCw data-icon="inline-start" />
                刷新
              </Button>
            )}
          </DialogFooter>
        </div>
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
      ? { label: "本地文件夹", placeholder: "选择已有本地文件夹", chooseLabel: "选择文件夹", submitLabel: "创建绑定" }
      : { label: "本地文件", placeholder: "选择已有本地文件", chooseLabel: "选择文件", submitLabel: "创建绑定" }
  }
  return kind === "folder"
    ? { label: "保存位置", placeholder: "选择保存位置", chooseLabel: "选择位置", submitLabel: "下载并绑定" }
    : { label: "保存为", placeholder: "选择保存位置", chooseLabel: "选择位置", submitLabel: "下载并绑定" }
}

function DriveSyncPreview({ preview }: { readonly preview: DriveSyncBindingPreviewDto }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{preview.localPath}</span>
        <Badge variant={preview.status === "ready" ? "secondary" : "destructive"}>{preview.status === "ready" ? "可绑定" : "不可绑定"}</Badge>
      </div>
      {preview.reason ? <p className="mt-2 text-muted-foreground">{preview.reason}</p> : null}
      <div className="mt-2 text-muted-foreground">方向：{formatDirection(preview.direction)}</div>
    </div>
  )
}

function DriveSyncStatusPanel({
  onSnapshotChange,
  snapshot,
}: {
  readonly onSnapshotChange: (snapshot: DriveSyncSnapshotDto) => void
  readonly snapshot: DriveSyncSnapshotDto | null
}) {
  const bindings = snapshot?.bindings ?? []
  const operations = snapshot?.operations ?? []
  const conflicts = snapshot?.conflicts ?? []
  const [filter, setFilter] = useState<DriveSyncObjectFilter>("all")
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null)
  const selectedBinding = bindings.find((binding) => binding.id === selectedBindingId) ?? null
  const visibleBindings = filter === "all"
    ? bindings
    : bindings.filter((binding) => binding.status === filter)

  const refreshSnapshot = async () => {
    onSnapshotChange(await requireSynapseBridge().driveSync.getSnapshot())
  }

  const runBindingAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action()
      await refreshSnapshot()
      toast(success)
    } catch (error) {
      toast(errorMessage(error, "操作失败"))
    }
  }

  useEffect(() => {
    if (selectedBindingId && !selectedBinding) setSelectedBindingId(null)
  }, [selectedBinding, selectedBindingId])

  return (
    <>
      <Tabs value={filter} onValueChange={(value) => setFilter(value as DriveSyncObjectFilter)} className="grid gap-3">
        <TabsList>
          {DRIVE_SYNC_OBJECT_FILTERS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} onClick={() => setFilter(item.value)}>{item.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={filter} className="mt-0">
          <DriveSyncBindingList
            bindings={visibleBindings}
            conflicts={conflicts}
            operations={operations}
            onSelectBinding={(binding) => setSelectedBindingId(binding.id)}
            runBindingAction={runBindingAction}
          />
        </TabsContent>
      </Tabs>
      <DriveSyncBindingDetailDialog
        binding={selectedBinding}
        conflicts={selectedBinding ? conflicts.filter((conflict) => conflict.bindingId === selectedBinding.id) : []}
        onOpenChange={(open) => {
          if (!open) setSelectedBindingId(null)
        }}
        operations={selectedBinding ? operations.filter((operation) => operation.bindingId === selectedBinding.id) : []}
        runBindingAction={runBindingAction}
      />
    </>
  )
}

function DriveSyncBindingList({
  bindings,
  conflicts,
  onSelectBinding,
  operations,
  runBindingAction,
}: {
  readonly bindings: readonly DriveSyncBindingDto[]
  readonly conflicts: NonNullable<DriveSyncSnapshotDto["conflicts"]>
  readonly onSelectBinding: (binding: DriveSyncBindingDto) => void
  readonly operations: NonNullable<DriveSyncSnapshotDto["operations"]>
  readonly runBindingAction: (action: () => Promise<unknown>, success: string) => Promise<void>
}) {
  if (bindings.length === 0) {
    return <DriveSyncEmptyState title="暂无同步对象" />
  }
  return (
    <div className="grid gap-2">
      {bindings.map((binding) => {
        const conflictCount = conflicts.filter((conflict) => conflict.bindingId === binding.id).length
        const operationCount = operations.filter((operation) => operation.bindingId === binding.id).length
        return (
          <div key={binding.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="truncate text-sm font-medium">{binding.driveItemName}</div>
                  <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>
                    {formatBindingStatus(binding.status)}
                  </Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{binding.localPath}</div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatBindingTime(binding)}</span>
                  <span>{conflictCount} 个冲突</span>
                  <span>{operationCount} 条记录</span>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <DriveSyncBindingActions binding={binding} runBindingAction={runBindingAction} showStatus={false} />
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={`查看同步对象 ${binding.driveItemName}`}
                  onClick={() => onSelectBinding(binding)}
                >
                  查看
                </Button>
              </div>
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
  onOpenChange,
  operations,
  runBindingAction,
}: {
  readonly binding: DriveSyncBindingDto | null
  readonly conflicts: NonNullable<DriveSyncSnapshotDto["conflicts"]>
  readonly onOpenChange: (open: boolean) => void
  readonly operations: NonNullable<DriveSyncSnapshotDto["operations"]>
  readonly runBindingAction: (action: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [excludeDraft, setExcludeDraft] = useState("")

  useEffect(() => {
    setExcludeDraft(binding?.excludeRules.user.join("\n") ?? "")
  }, [binding])

  return (
    <Dialog open={binding !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        {binding ? (
          <div className="flex h-full min-h-0 max-h-[calc(100vh-4rem)] flex-col overflow-hidden">
            <DialogHeader className="px-5 pt-5">
              <DialogTitle>{binding.driveItemName}</DialogTitle>
              <DialogDescription className="truncate">{binding.localPath}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
              <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>
                {formatBindingStatus(binding.status)}
              </Badge>
              <DriveSyncBindingActions binding={binding} runBindingAction={runBindingAction} showStatus={false} />
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="grid gap-4 px-5 py-4">
                {binding.kind === "folder" ? (
                  <div className="grid gap-2">
                    <Label htmlFor={`drive-sync-detail-excludes-${binding.id}`}>排除规则</Label>
                    <Textarea
                      id={`drive-sync-detail-excludes-${binding.id}`}
                      value={excludeDraft}
                      onChange={(event) => setExcludeDraft(event.target.value)}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void runBindingAction(
                            () => requireSynapseBridge().driveSync.updateExcludeRules({
                              id: binding.id,
                              user: parseExcludeText(excludeDraft),
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
                  <div className="text-sm font-medium">冲突</div>
                  <DriveSyncConflictTable conflicts={conflicts} runBindingAction={runBindingAction} />
                </div>
                <div className="grid gap-2">
                  <div className="text-sm font-medium">记录</div>
                  <DriveSyncOperationTable operations={operations} />
                </div>
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DriveSyncEmptyState({ title }: { readonly title: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border text-sm text-muted-foreground">
      {title}
    </div>
  )
}

function DriveSyncBindingActions({
  binding,
  runBindingAction,
  showStatus = true,
}: {
  readonly binding: DriveSyncBindingDto
  readonly runBindingAction: (action: () => Promise<unknown>, success: string) => Promise<void>
  readonly showStatus?: boolean
}) {
  const resumable = binding.status === "paused" || binding.status === "error"
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {showStatus ? (
        <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>{formatBindingStatus(binding.status)}</Badge>
      ) : null}
      <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => resumable ? requireSynapseBridge().driveSync.resumeBinding({ id: binding.id }) : requireSynapseBridge().driveSync.pauseBinding({ id: binding.id }), resumable ? "已恢复" : "已暂停") }}>
        {resumable ? "恢复" : "暂停"}
      </Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.rescanBinding({ id: binding.id }), "已重新扫描") }}>扫描</Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.pollRemoteChanges({ id: binding.id }), "已拉取变更") }}>拉取</Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.removeBinding({ id: binding.id }), "已解除绑定") }}>解除</Button>
    </div>
  )
}

function DriveSyncConflictTable({
  conflicts,
  runBindingAction,
}: {
  readonly conflicts: NonNullable<DriveSyncSnapshotDto["conflicts"]>
  readonly runBindingAction: (action: () => Promise<unknown>, success: string) => Promise<void>
}) {
  if (conflicts.length === 0) {
    return <DriveSyncEmptyState title="暂无冲突" />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>路径</TableHead>
          <TableHead>类型</TableHead>
          <TableHead className="text-right">处理</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {conflicts.map((conflict) => (
          <TableRow key={conflict.id}>
            <TableCell className="truncate">{conflict.relativePath || "/"}</TableCell>
            <TableCell>{formatConflictType(conflict.type)}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "keep_local" }), "已保留本地") }}>用本地</Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "keep_remote" }), "已保留云端") }}>用云端</Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "keep_both" }), "已保留两份") }}>保留两份</Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => requireSynapseBridge().driveSync.resolveConflict({ conflictId: conflict.id, action: "skip" }), "已跳过") }}>稍后</Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DriveSyncOperationTable({ operations }: { readonly operations: NonNullable<DriveSyncSnapshotDto["operations"]> }) {
  if (operations.length === 0) {
    return <DriveSyncEmptyState title="暂无记录" />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>路径</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((operation) => (
          <TableRow key={operation.id}>
            <TableCell className="truncate">{operation.relativePath || "/"}</TableCell>
            <TableCell>{operation.status}</TableCell>
            <TableCell>{new Date(operation.updatedAt).toLocaleString()}</TableCell>
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
  const conflictCount = summary?.conflictCount ?? 0
  const errorCount = summary?.errorCount ?? 0
  const activeCount = summary?.activeBindingCount ?? 0
  const badge = conflictCount > 0
    ? { label: String(conflictCount), variant: "destructive" as const, message: `${conflictCount} 个冲突` }
    : errorCount > 0
      ? { label: String(errorCount), variant: "destructive" as const, message: `${errorCount} 个错误` }
      : activeCount > 0
        ? { label: String(activeCount), variant: "secondary" as const, message: `${activeCount} 个绑定` }
        : null
  const message = badge?.message ?? "暂无同步绑定"
  return (
    <Button type="button" variant={conflictCount > 0 ? "destructive" : "outline"} size="sm" aria-label={`同步状态：${message}`} onClick={onOpen}>
      同步
      {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
    </Button>
  )
}

function parseExcludeText(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

function formatDirection(direction: DriveSyncBindingPreviewDto["direction"]): string {
  if (direction === "remote_to_local") return "云端到本地"
  if (direction === "local_to_remote") return "本地到云端"
  if (direction === "bind_existing") return "建立绑定"
  return "-"
}

function formatBindingStatus(status: DriveSyncBindingDto["status"]): string {
  if (status === "active") return "同步中"
  if (status === "paused") return "已暂停"
  if (status === "conflict") return "有冲突"
  if (status === "error") return "错误"
  return status
}

function formatBindingTime(binding: DriveSyncBindingDto): string {
  const value = binding.lastSyncedAt ?? binding.updatedAt
  return `${binding.lastSyncedAt ? "最近同步" : "更新"}：${new Date(value).toLocaleString()}`
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
