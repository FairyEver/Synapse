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
  const [excludeDrafts, setExcludeDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setExcludeDrafts(Object.fromEntries(bindings.map((binding) => [
      binding.id,
      binding.excludeRules.user.join("\n"),
    ])))
  }, [bindings])

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

  return (
    <Tabs defaultValue="bindings" className="grid gap-3">
      <TabsList>
        <TabsTrigger value="bindings">绑定</TabsTrigger>
        <TabsTrigger value="conflicts">冲突</TabsTrigger>
        <TabsTrigger value="operations">记录</TabsTrigger>
      </TabsList>
      <TabsContent value="bindings" className="mt-0">
        <div className="grid gap-3">
          {bindings.length === 0 ? (
            <DriveSyncEmptyState title="暂无绑定" />
          ) : bindings.map((binding) => (
            <div key={binding.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{binding.driveItemName}</div>
                  <div className="truncate text-xs text-muted-foreground">{binding.localPath}</div>
                </div>
                <DriveSyncBindingActions binding={binding} runBindingAction={runBindingAction} />
              </div>
              {binding.kind === "folder" ? (
                <div className="mt-3 grid gap-2">
                  <Label htmlFor={`drive-sync-excludes-${binding.id}`}>排除规则</Label>
                  <Textarea
                    id={`drive-sync-excludes-${binding.id}`}
                    value={excludeDrafts[binding.id] ?? ""}
                    onChange={(event) => setExcludeDrafts((current) => ({ ...current, [binding.id]: event.target.value }))}
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
                            user: parseExcludeText(excludeDrafts[binding.id] ?? ""),
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
            </div>
          ))}
        </div>
      </TabsContent>
      <TabsContent value="conflicts" className="mt-0">
        <DriveSyncConflictTable conflicts={conflicts} runBindingAction={runBindingAction} />
      </TabsContent>
      <TabsContent value="operations" className="mt-0">
        <DriveSyncOperationTable operations={operations} />
      </TabsContent>
    </Tabs>
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
}: {
  readonly binding: DriveSyncBindingDto
  readonly runBindingAction: (action: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const resumable = binding.status === "paused" || binding.status === "error"
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>{formatBindingStatus(binding.status)}</Badge>
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
