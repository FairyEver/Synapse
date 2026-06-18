import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"
import { FileText, LoaderCircle, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { DrivePublicAssetDto, DrivePublicAssetListPageDto } from "@synapse/shared"

import { FormDialog } from "@/components/form-dialog"
import { ModuleContentPanel } from "@/components/module-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { DrivePublicAssetLocalFile, DrivePublicAssetUploadResultItem } from "@/types/bridge"

const DRIVE_PUBLIC_ASSET_PAGE_SIZE = 50
const DRIVE_PUBLIC_ASSET_SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => index)
const DRIVE_PUBLIC_ASSET_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif"
const DRIVE_BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DRIVE_BYTE_NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

type DrivePublicAssetRenameState = {
  readonly asset: DrivePublicAssetDto
  readonly value: string
}

type DrivePublicAssetConfirmState =
  | {
    readonly action: "trash"
    readonly asset: DrivePublicAssetDto
  }
  | {
    readonly action: "delete"
    readonly asset: DrivePublicAssetDto
  }

function DrivePublicAssetsView({ onBack }: { readonly onBack?: () => void }) {
  const [page, setPage] = useState<DrivePublicAssetListPageDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [renameState, setRenameState] = useState<DrivePublicAssetRenameState | null>(null)
  const [confirmState, setConfirmState] = useState<DrivePublicAssetConfirmState | null>(null)
  const [uploadResults, setUploadResults] = useState<readonly DrivePublicAssetUploadResultItem[]>([])
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<DrivePublicAssetDto | null>(null)

  const loadAssets = useCallback(async (offset = 0) => {
    if (offset === 0) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
      setLoadMoreError(null)
    }
    try {
      const result = await requireSynapseBridge().account.listDrivePublicAssets({
        offset,
        limit: DRIVE_PUBLIC_ASSET_PAGE_SIZE,
      })
      setPage((current) => {
        if (offset === 0 || !current) return result
        return {
          ...result,
          items: [...current.items, ...result.items],
          total: result.total,
        }
      })
    } catch (rawError) {
      const message = errorMessage(rawError, offset === 0 ? "公开素材加载失败" : "加载失败")
      if (offset === 0) {
        setError(message)
      } else {
        setLoadMoreError(message)
      }
    } finally {
      if (offset === 0) {
        setLoading(false)
      } else {
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const handleUploadSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = publicAssetLocalFilesFromSelection(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
    if (files.length === 0) {
      toast("没有可上传的文件")
      return
    }
    setUploading(true)
    setUploadResults([])
    try {
      const result = await requireSynapseBridge().account.uploadDrivePublicAssets({ files })
      setUploadResults(result.results)
      toast(publicAssetUploadToast(result.results))
      await loadAssets()
    } catch (rawError) {
      toast(errorMessage(rawError, "上传失败"))
    } finally {
      setUploading(false)
    }
  }, [loadAssets])

  const handleReplaceSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = publicAssetLocalFilesFromSelection(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
    const target = replaceTargetRef.current
    replaceTargetRef.current = null
    if (!target || !file) return
    setBusyAssetId(target.assetId)
    try {
      await requireSynapseBridge().account.replaceDrivePublicAssetFile({
        assetId: target.assetId,
        ...file,
      })
      toast("已替换")
      await loadAssets()
    } catch (rawError) {
      toast(errorMessage(rawError, "替换失败"))
    } finally {
      setBusyAssetId(null)
    }
  }, [loadAssets])

  const handleRenameSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameState) return
    const name = renameState.value.trim()
    if (!name) return
    setBusyAssetId(renameState.asset.assetId)
    try {
      await requireSynapseBridge().account.renameDrivePublicAsset({
        assetId: renameState.asset.assetId,
        name,
      })
      toast("已重命名")
      setRenameState(null)
      await loadAssets()
    } catch (rawError) {
      toast(errorMessage(rawError, "重命名失败"))
    } finally {
      setBusyAssetId(null)
    }
  }, [loadAssets, renameState])

  const runAssetMutation = useCallback(async (asset: DrivePublicAssetDto, action: () => Promise<unknown>, successMessage: string, fallback: string) => {
    setBusyAssetId(asset.assetId)
    try {
      await action()
      toast(successMessage)
      await loadAssets()
    } catch (rawError) {
      toast(errorMessage(rawError, fallback))
    } finally {
      setBusyAssetId(null)
    }
  }, [loadAssets])

  const confirmPublicAssetAction = useCallback(async () => {
    const target = confirmState
    if (!target) return
    setConfirmState(null)
    if (target.action === "trash") {
      await runAssetMutation(
        target.asset,
        () => requireSynapseBridge().account.trashDrivePublicAsset({ assetId: target.asset.assetId }),
        "已移到回收站",
        "移到回收站失败",
      )
      return
    }
    await runAssetMutation(
      target.asset,
      () => requireSynapseBridge().account.deleteDriveTrashItem({ itemId: target.asset.itemId }),
      "已删除",
      "删除失败",
    )
  }, [confirmState, runAssetMutation])

  const content = (() => {
    if (loading) return <DrivePublicAssetTableSkeleton />
    if (error) {
      return (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RefreshCw /></EmptyMedia>
            <EmptyTitle>读取失败</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="sm" variant="outline" onClick={() => { void loadAssets() }}>
              重试
            </Button>
          </EmptyContent>
        </Empty>
      )
    }
    const assets = page?.items ?? []
    if (assets.length === 0) {
      return (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>暂无公开素材</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )
    }
    return (
      <ModuleContentPanel>
        <Table className="table-fixed">
          <DrivePublicAssetTableHeader />
          <TableBody>
            {assets.map((asset) => (
              <DrivePublicAssetRow
                key={asset.assetId}
                asset={asset}
                busy={busyAssetId === asset.assetId}
                onCopy={() => { void copyPublicAssetUrl(asset.url) }}
                onRename={() => setRenameState({ asset, value: asset.name })}
                onReplace={() => {
                  replaceTargetRef.current = asset
                  replaceInputRef.current?.click()
                }}
                onTrash={() => {
                  setConfirmState({ action: "trash", asset })
                }}
                onRestore={() => {
                  void runAssetMutation(
                    asset,
                    () => requireSynapseBridge().account.restoreDrivePublicAsset({ assetId: asset.assetId }),
                    "已恢复",
                    "恢复失败",
                  )
                }}
                onDelete={() => {
                  setConfirmState({ action: "delete", asset })
                }}
              />
            ))}
          </TableBody>
        </Table>
      </ModuleContentPanel>
    )
  })()
  const nextOffset = page?.page.hasMore ? page.page.nextOffset : null

  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button type="button" size="sm" variant="outline" onClick={onBack}>返回</Button>
          ) : null}
          <h2 className="truncate text-base font-medium">公开素材</h2>
          {uploading ? <Badge variant="outline">上传中</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            accept={DRIVE_PUBLIC_ASSET_IMAGE_ACCEPT}
            className="hidden"
            onChange={handleUploadSelected}
          />
          <input
            ref={replaceInputRef}
            type="file"
            accept={DRIVE_PUBLIC_ASSET_IMAGE_ACCEPT}
            className="hidden"
            data-testid="drive-public-asset-replace-input"
            onChange={handleReplaceSelected}
          />
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
            上传公开素材
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => { void loadAssets() }}>
            刷新
          </Button>
        </div>
      </div>
      {uploadResults.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {uploadResults.map((result, index) => (
            <Badge
              key={`${result.fileName}-${index}`}
              variant={result.status === "fulfilled" ? "outline" : "destructive"}
              data-testid="drive-public-asset-upload-result"
            >
              {result.fileName} {result.status === "fulfilled" ? "已上传" : result.message}
            </Badge>
          ))}
        </div>
      ) : null}
      {content}
      {!loading && page?.page.hasMore ? (
        <div className="flex items-center justify-center gap-2">
          {loadMoreError ? <span className="text-sm text-muted-foreground">{loadMoreError}</span> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingMore || nextOffset === null}
            onClick={() => {
              if (nextOffset !== null) void loadAssets(nextOffset)
            }}
          >
            {loadingMore ? "加载中" : "加载更多"}
          </Button>
        </div>
      ) : null}
      <Dialog open={renameState !== null} onOpenChange={(open) => {
        if (!open) setRenameState(null)
      }}>
        {renameState ? (
          <FormDialog
            title="重命名"
            onSubmit={handleRenameSubmit}
            footer={(
              <>
                <Button type="button" variant="outline" disabled={busyAssetId !== null} onClick={() => setRenameState(null)}>取消</Button>
                <Button type="submit" disabled={busyAssetId !== null || renameState.value.trim().length === 0}>保存</Button>
              </>
            )}
          >
            <div className="grid gap-2">
              <Label htmlFor="drive-public-asset-name">名称</Label>
              <Input
                id="drive-public-asset-name"
                value={renameState.value}
                onChange={(event) => updateRenameValue(event.currentTarget.value, setRenameState)}
                onInput={(event) => updateRenameValue(event.currentTarget.value, setRenameState)}
                autoFocus
              />
            </div>
          </FormDialog>
        ) : null}
      </Dialog>
      <AlertDialog open={confirmState !== null} onOpenChange={(open) => {
        if (!open) setConfirmState(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.action === "trash" ? "确认移到回收站" : "确认删除"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {confirmState?.action === "trash" ? (
                  <div>「{confirmState.asset.name}」将移到回收站。</div>
                ) : (
                  <div>普通用户将不再看到「{confirmState?.asset.name}」，仅管理员可见。</div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAssetId !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmState?.action === "delete" ? "destructive" : "default"}
              disabled={busyAssetId !== null}
              onClick={() => { void confirmPublicAssetAction() }}
            >
              {confirmState?.action === "trash" ? "移到回收站" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function updateRenameValue(
  value: string,
  setRenameState: Dispatch<SetStateAction<DrivePublicAssetRenameState | null>>,
): void {
  setRenameState((current) => current ? { ...current, value } : current)
}

function DrivePublicAssetTableHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>名称</TableHead>
        <TableHead className="w-24 text-right">大小</TableHead>
        <TableHead className="w-36">类型</TableHead>
        <TableHead className="w-36 text-right">访问</TableHead>
        <TableHead className="w-40 text-right">创建时间</TableHead>
        <TableHead className="w-56 text-right" aria-label="操作" />
      </TableRow>
    </TableHeader>
  )
}

function DrivePublicAssetTableSkeleton() {
  return (
    <ModuleContentPanel>
      <Table className="table-fixed">
        <DrivePublicAssetTableHeader />
        <TableBody>
          {DRIVE_PUBLIC_ASSET_SKELETON_ROWS.map((row) => (
            <TableRow key={row}>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-28" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-7 w-40" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ModuleContentPanel>
  )
}

function DrivePublicAssetRow({
  asset,
  busy,
  onCopy,
  onDelete,
  onRename,
  onReplace,
  onRestore,
  onTrash,
}: {
  readonly asset: DrivePublicAssetDto
  readonly busy: boolean
  readonly onCopy: () => void
  readonly onDelete: () => void
  readonly onRename: () => void
  readonly onReplace: () => void
  readonly onRestore: () => void
  readonly onTrash: () => void
}) {
  const trashed = asset.lifecycleStatus === "trashed"
  return (
    <TableRow aria-busy={busy || undefined}>
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {busy ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 truncate font-medium" title={asset.name}>{asset.name}</span>
          {trashed ? <Badge variant="outline">回收站</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(asset.size)}</TableCell>
      <TableCell className="truncate text-muted-foreground" title={asset.mimeType}>{asset.mimeType}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        <span title={formatDriveDateTime(asset.lastAccessedAt)}>{asset.accessCount}</span>
      </TableCell>
      <TableCell className="truncate text-right tabular-nums text-muted-foreground">{formatDriveDateTime(asset.createdAt)}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end">
          <Button type="button" variant="ghost" size="xs" disabled={busy} aria-label={`复制 ${asset.name}`} onClick={onCopy}>
            复制链接
          </Button>
          {trashed ? (
            <>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onRestore}>恢复</Button>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onDelete}>删除</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onReplace}>替换文件</Button>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onTrash}>移到回收站</Button>
              <DrivePublicAssetMenu asset={asset} disabled={busy} onRename={onRename} />
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function DrivePublicAssetMenu({
  asset,
  disabled,
  onRename,
}: {
  readonly asset: DrivePublicAssetDto
  readonly disabled: boolean
  readonly onRename: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={disabled} aria-label={`更多 ${asset.name}`}>
          更多
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onRename}>重命名</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function publicAssetLocalFilesFromSelection(files: readonly File[]): DrivePublicAssetLocalFile[] {
  return files.map((file): DrivePublicAssetLocalFile | null => {
    const path = requireSynapseBridge().account.filePathForDroppedFile(file)
    if (!path) return null
    return {
      path,
      name: file.name,
      mimeType: file.type || null,
    }
  }).filter((file): file is DrivePublicAssetLocalFile => file !== null)
}

async function copyPublicAssetUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast("链接已复制")
  } catch (rawError) {
    toast(errorMessage(rawError, "复制失败"))
  }
}

function publicAssetUploadToast(results: readonly DrivePublicAssetUploadResultItem[]): string {
  const completed = results.filter((result) => result.status === "fulfilled").length
  const failed = results.length - completed
  if (failed === 0) return `已上传 ${completed} 个文件`
  return `上传完成 ${completed} 个，失败 ${failed} 个`
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return "-"

  let nextValue = bytes
  let unitIndex = 0
  while (nextValue >= 1024 && unitIndex < DRIVE_BYTE_UNITS.length - 1) {
    nextValue /= 1024
    unitIndex += 1
  }

  const formattedValue = unitIndex === 0 ? String(Math.round(nextValue)) : DRIVE_BYTE_NUMBER_FORMAT.format(nextValue)
  return `${formattedValue} ${DRIVE_BYTE_UNITS[unitIndex]}`
}

function formatDriveDateTime(value: string | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("zh-CN")
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim() || fallback
}

export { DrivePublicAssetsView }
