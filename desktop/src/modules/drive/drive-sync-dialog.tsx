import { useEffect, useState } from "react"
import { toast } from "sonner"
import { FolderSync, RefreshCw } from "lucide-react"
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
  const [preview, setPreview] = useState<DriveSyncBindingPreviewDto | null>(null)
  const [excludeText, setExcludeText] = useState("")
  const [busy, setBusy] = useState(false)
  const item = state?.mode === "bind" ? state.item : null

  useEffect(() => {
    if (!open) {
      setLocalPath("")
      setPreview(null)
      setExcludeText("")
    }
  }, [open])

  const refreshSnapshot = async () => {
    onSnapshotChange(await requireSynapseBridge().driveSync.getSnapshot())
  }

  const chooseLocalPath = async () => {
    if (!item) return
    const nextPath = await requireSynapseBridge().driveSync.chooseLocalPath({ kind: item.type })
    if (nextPath) setLocalPath(nextPath)
  }

  const previewBinding = async () => {
    if (!item || localPath.trim().length === 0) return
    setBusy(true)
    try {
      setPreview(await requireSynapseBridge().driveSync.previewBinding({
        driveItemId: item.id,
        driveItemName: item.name,
        kind: item.type,
        drivePathHint: item.name,
        localPath: localPath.trim(),
        remoteExists: true,
        importGitignore: item.type === "folder",
      }))
    } catch (error) {
      toast(errorMessage(error, "校验失败"))
    } finally {
      setBusy(false)
    }
  }

  const createBinding = async () => {
    if (!item || !preview?.direction || preview.status !== "ready") return
    setBusy(true)
    try {
      await requireSynapseBridge().driveSync.createSafeBinding({
        driveItemId: item.id,
        driveItemName: item.name,
        kind: item.type,
        drivePathHint: item.name,
        localPath: localPath.trim(),
        direction: preview.direction,
        excludeRules: parseExcludeText(excludeText),
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
      <DialogContent className="max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{item ? "绑定同步" : "同步状态"}</DialogTitle>
        </DialogHeader>
        {item ? (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="drive-sync-local-path">本地路径</Label>
              <InputGroup>
                <InputGroupInput id="drive-sync-local-path" value={localPath} onChange={(event) => setLocalPath(event.target.value)} />
                <InputGroupButton type="button" variant="outline" onClick={() => { void chooseLocalPath() }}>选择</InputGroupButton>
              </InputGroup>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="drive-sync-excludes">排除规则</Label>
              <Textarea id="drive-sync-excludes" value={excludeText} onChange={(event) => setExcludeText(event.target.value)} />
            </div>
            {preview ? <DriveSyncPreview preview={preview} /> : null}
          </div>
        ) : (
          <DriveSyncStatusPanel snapshot={snapshot} onSnapshotChange={onSnapshotChange} />
        )}
        <DialogFooter>
          {item ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { void previewBinding() }}>校验</Button>
              <Button type="button" disabled={busy || preview?.status !== "ready"} onClick={() => { void createBinding() }}>创建绑定</Button>
            </>
          ) : (
            <Button type="button" variant="outline" disabled={busy} onClick={() => { void refreshSnapshot() }}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
    <Tabs defaultValue="bindings">
      <TabsList>
        <TabsTrigger value="bindings">绑定</TabsTrigger>
        <TabsTrigger value="conflicts">冲突</TabsTrigger>
        <TabsTrigger value="operations">记录</TabsTrigger>
      </TabsList>
      <TabsContent value="bindings">
        <ScrollArea className="max-h-96">
          <div className="grid gap-3 pr-3">
            {bindings.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center rounded-lg border text-sm text-muted-foreground">暂无绑定</div>
            ) : bindings.map((binding) => (
              <div key={binding.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{binding.driveItemName}</div>
                    <div className="truncate text-xs text-muted-foreground">{binding.localPath}</div>
                  </div>
                  <DriveSyncBindingActions binding={binding} runBindingAction={runBindingAction} />
                </div>
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
              </div>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="conflicts">
        <DriveSyncConflictTable conflicts={conflicts} runBindingAction={runBindingAction} />
      </TabsContent>
      <TabsContent value="operations">
        <DriveSyncOperationTable operations={operations} />
      </TabsContent>
    </Tabs>
  )
}

function DriveSyncBindingActions({
  binding,
  runBindingAction,
}: {
  readonly binding: DriveSyncBindingDto
  readonly runBindingAction: (action: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const paused = binding.status === "paused"
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Badge variant={binding.status === "error" || binding.status === "conflict" ? "destructive" : "secondary"}>{formatBindingStatus(binding.status)}</Badge>
      <Button type="button" variant="ghost" size="xs" onClick={() => { void runBindingAction(() => paused ? requireSynapseBridge().driveSync.resumeBinding({ id: binding.id }) : requireSynapseBridge().driveSync.pauseBinding({ id: binding.id }), paused ? "已恢复" : "已暂停") }}>
        {paused ? "恢复" : "暂停"}
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
    return <div className="flex min-h-24 items-center justify-center rounded-lg border text-sm text-muted-foreground">暂无冲突</div>
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
    return <div className="flex min-h-24 items-center justify-center rounded-lg border text-sm text-muted-foreground">暂无记录</div>
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
    <Button type="button" variant={conflictCount > 0 || errorCount > 0 ? "destructive" : "outline"} size="sm" aria-label={`同步状态：${message}`} onClick={onOpen}>
      <FolderSync data-icon="inline-start" />
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
