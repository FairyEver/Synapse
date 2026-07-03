import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"
import { LoaderCircle, MoreHorizontal, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION, type DrivePublicAssetDto, type DrivePublicAssetListPageDto } from "@synapse/shared"

import { FormDialog } from "@/components/form-dialog"
import { ModuleContentPanel } from "@/components/module-page"
import { RelativeTime } from "@/components/relative-time"
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
import { driveErrorMessage as errorMessage, formatDriveBytes as formatBytes } from "@/lib/drive-format"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { DrivePublicAssetLocalFile, DrivePublicAssetUploadResultItem } from "@/types/bridge"
import { DriveItemIcon } from "./drive-item-icon"
import { DRIVE_PUBLIC_ASSET_TABLE_COLUMNS, DriveTableColumns } from "./drive-table-columns"

const DRIVE_PUBLIC_ASSET_PAGE_SIZE = 50
const DRIVE_PUBLIC_ASSET_SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => index)
const DRIVE_PUBLIC_ASSET_IMAGE_ACCEPT = Array.from(new Set(Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION))).join(",")

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

type DrivePublicAssetsViewActionState = {
  readonly loading: boolean
  readonly uploading: boolean
}

type DrivePublicAssetsViewHandle = {
  readonly openUploadDialog: () => void
  readonly refresh: () => void
}

type DrivePublicAssetsViewProps = {
  readonly inlineToolbar?: boolean
  readonly onActionStateChange?: (state: DrivePublicAssetsViewActionState) => void
  readonly onUsageChange?: () => void
}

const DrivePublicAssetsView = forwardRef<DrivePublicAssetsViewHandle, DrivePublicAssetsViewProps>(function DrivePublicAssetsView({
  inlineToolbar = true,
  onActionStateChange,
  onUsageChange,
}, ref) {
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
  const loadRequestIdRef = useRef(0)

  const loadAssets = useCallback(async (offset = 0) => {
    const requestId = ++loadRequestIdRef.current
    if (offset === 0) {
      setLoading(true)
      setError(null)
      setLoadingMore(false)
      setLoadMoreError(null)
    } else {
      setLoadingMore(true)
      setLoadMoreError(null)
    }
    try {
      const result = await requireSynapseBridge().account.listDrivePublicAssets({
        offset,
        limit: DRIVE_PUBLIC_ASSET_PAGE_SIZE,
      })
      if (loadRequestIdRef.current !== requestId) return
      setPage((current) => {
        if (offset === 0 || !current) return result
        return {
          ...result,
          items: [...current.items, ...result.items],
          total: result.total,
        }
      })
    } catch (rawError) {
      if (loadRequestIdRef.current !== requestId) return
      const message = errorMessage(rawError, offset === 0 ? "公开素材加载失败" : "加载失败")
      if (offset === 0) {
        setError(message)
      } else {
        setLoadMoreError(message)
      }
    } finally {
      if (loadRequestIdRef.current !== requestId) return
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

  useImperativeHandle(ref, () => ({
    openUploadDialog: () => {
      uploadInputRef.current?.click()
    },
    refresh: () => {
      void loadAssets()
    },
  }), [loadAssets])

  useEffect(() => {
    onActionStateChange?.({ loading, uploading })
  }, [loading, onActionStateChange, uploading])

  const handleUploadSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = publicAssetLocalFilesFromSelection(Array.from(event.currentTarget.files ?? []))
    event.currentTarget.value = ""
    setUploadResults([])
    if (files.length === 0) {
      toast("没有可上传的文件")
      return
    }
    setUploading(true)
    try {
      const result = await requireSynapseBridge().account.uploadDrivePublicAssets({ files })
      setUploadResults(result.results)
      toast(publicAssetUploadToast(result.results))
      await loadAssets()
      if (result.results.some((item) => item.status === "fulfilled")) {
        onUsageChange?.()
      }
    } catch (rawError) {
      toast(errorMessage(rawError, "上传失败"))
    } finally {
      setUploading(false)
    }
  }, [loadAssets, onUsageChange])

  const handleReplaceSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? [])
    const [file] = publicAssetLocalFilesFromSelection(selectedFiles)
    event.currentTarget.value = ""
    const target = replaceTargetRef.current
    replaceTargetRef.current = null
    if (!target) return
    if (!file) {
      if (selectedFiles.length > 0) toast("没有可替换的文件")
      return
    }
    setBusyAssetId(target.assetId)
    try {
      await requireSynapseBridge().account.replaceDrivePublicAssetFile({
        assetId: target.assetId,
        ...file,
      })
      toast("已替换")
      await loadAssets()
      onUsageChange?.()
    } catch (rawError) {
      toast(errorMessage(rawError, "替换失败"))
    } finally {
      setBusyAssetId(null)
    }
  }, [loadAssets, onUsageChange])

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

  const runAssetMutation = useCallback(async (
    asset: DrivePublicAssetDto,
    action: () => Promise<unknown>,
    successMessage: string,
    fallback: string,
    options: { readonly refreshUsage?: boolean } = {},
  ) => {
    setBusyAssetId(asset.assetId)
    try {
      await action()
      toast(successMessage)
      await loadAssets()
      if (options.refreshUsage) onUsageChange?.()
    } catch (rawError) {
      toast(errorMessage(rawError, fallback))
    } finally {
      setBusyAssetId(null)
    }
  }, [loadAssets, onUsageChange])

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
      { refreshUsage: true },
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
          <DriveTableColumns columns={DRIVE_PUBLIC_ASSET_TABLE_COLUMNS} />
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
      {inlineToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-medium">公开素材</h2>
            {uploading ? <Badge variant="outline">上传中</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
              上传公开素材
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => { void loadAssets() }}>
              刷新
            </Button>
          </div>
        </div>
      ) : null}
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
                  <div>删除「{confirmState?.asset.name}」？此操作完成后将从列表中移除。</div>
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
})

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
        <TableHead className="text-right">大小</TableHead>
        <TableHead>类型</TableHead>
        <TableHead className="text-right">访问</TableHead>
        <TableHead className="whitespace-nowrap text-right">创建时间</TableHead>
        <TableHead className="text-right" aria-label="操作" />
      </TableRow>
    </TableHeader>
  )
}

function DrivePublicAssetTableSkeleton() {
  return (
    <ModuleContentPanel>
      <Table className="table-fixed">
        <DriveTableColumns columns={DRIVE_PUBLIC_ASSET_TABLE_COLUMNS} />
        <DrivePublicAssetTableHeader />
        <TableBody>
          {DRIVE_PUBLIC_ASSET_SKELETON_ROWS.map((row) => (
            <TableRow key={row}>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-12" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-8" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-36" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-7 w-20" /></TableCell>
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
  const unavailable = asset.lifecycleStatus === "legacy_missing"
  return (
    <TableRow aria-busy={busy || undefined}>
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {busy ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <DriveItemIcon kind="file" />
          )}
          <span className="min-w-0 truncate font-medium" title={asset.name}>{asset.name}</span>
          {trashed ? <Badge variant="outline">回收站</Badge> : null}
          {unavailable ? <Badge variant="secondary">不可用</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatBytes(asset.size)}</TableCell>
      <TableCell className="truncate text-muted-foreground" title={asset.mimeType}>{asset.mimeType}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        <span title={formatDriveDateTime(asset.lastAccessedAt)}>{asset.accessCount}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
        <RelativeTime value={asset.createdAt} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button type="button" variant="ghost" size="xs" disabled={busy || unavailable || trashed} aria-label={`复制 ${asset.name}`} onClick={onCopy}>
            复制链接
          </Button>
          {unavailable ? null : trashed ? (
            <>
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onRestore}>恢复</Button>
              <DrivePublicAssetMenu asset={asset} disabled={busy} onDelete={onDelete} />
            </>
          ) : (
            <DrivePublicAssetMenu
              asset={asset}
              disabled={busy}
              onRename={onRename}
              onReplace={onReplace}
              onTrash={onTrash}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function DrivePublicAssetMenu({
  asset,
  disabled,
  onDelete,
  onRename,
  onReplace,
  onTrash,
}: {
  readonly asset: DrivePublicAssetDto
  readonly disabled: boolean
  readonly onDelete?: () => void
  readonly onRename?: () => void
  readonly onReplace?: () => void
  readonly onTrash?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`更多 ${asset.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {onReplace ? <DropdownMenuItem onClick={onReplace}>替换文件</DropdownMenuItem> : null}
          {onTrash ? <DropdownMenuItem onClick={onTrash}>移到回收站</DropdownMenuItem> : null}
          {onRename ? <DropdownMenuItem onClick={onRename}>重命名</DropdownMenuItem> : null}
          {onDelete ? <DropdownMenuItem variant="destructive" onClick={onDelete}>删除</DropdownMenuItem> : null}
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

function formatDriveDateTime(value: string | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("zh-CN")
}

export { DrivePublicAssetsView }
export type { DrivePublicAssetsViewActionState, DrivePublicAssetsViewHandle }
