import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { DriveTrashItemDto, DriveTrashListPageDto } from "@synapse/shared"

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
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
import { DriveItemIcon } from "./drive-item-icon"
import { DRIVE_TRASH_TABLE_COLUMNS, DriveTableColumns } from "./drive-table-columns"

const DRIVE_TRASH_PAGE_SIZE = 50
const DRIVE_TRASH_SKELETON_ROWS = Array.from({ length: 6 }, (_, index) => index)
const DRIVE_BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DRIVE_BYTE_NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

type DriveTrashViewActionState = {
  readonly loading: boolean
}

type DriveTrashViewHandle = {
  readonly refresh: () => void
}

type DriveTrashViewProps = {
  readonly inlineToolbar?: boolean
  readonly onActionStateChange?: (state: DriveTrashViewActionState) => void
  readonly onDriveItemsChanged?: () => void | Promise<void>
  readonly onUsageChange?: () => void | Promise<void>
}

const DriveTrashView = forwardRef<DriveTrashViewHandle, DriveTrashViewProps>(function DriveTrashView({
  inlineToolbar = true,
  onActionStateChange,
  onDriveItemsChanged,
  onUsageChange,
}, ref) {
  const [page, setPage] = useState<DriveTrashListPageDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveTrashItemDto | null>(null)

  const loadTrash = useCallback(async (offset = 0) => {
    if (offset === 0) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
      setLoadMoreError(null)
    }
    try {
      const result = await requireSynapseBridge().account.listDriveTrash({
        offset,
        limit: DRIVE_TRASH_PAGE_SIZE,
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
      const message = errorMessage(rawError, offset === 0 ? "回收站加载失败" : "加载失败")
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
    void loadTrash()
  }, [loadTrash])

  useImperativeHandle(ref, () => ({
    refresh: () => {
      void loadTrash()
    },
  }), [loadTrash])

  useEffect(() => {
    onActionStateChange?.({ loading })
  }, [loading, onActionStateChange])

  const runTrashMutation = useCallback(async (
    item: DriveTrashItemDto,
    action: () => Promise<unknown>,
    successMessage: string,
    fallback: string,
    onSuccess?: () => void | Promise<void>,
  ) => {
    setBusyItemId(item.id)
    try {
      await action()
      toast(successMessage)
      await loadTrash()
      await onSuccess?.()
    } catch (rawError) {
      toast(errorMessage(rawError, fallback))
    } finally {
      setBusyItemId(null)
    }
  }, [loadTrash])

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    await runTrashMutation(
      target,
      () => requireSynapseBridge().account.deleteDriveTrashItem({ itemId: target.id }),
      "已删除",
      "删除失败",
      onUsageChange,
    )
  }, [deleteTarget, onUsageChange, runTrashMutation])

  const content = (() => {
    if (loading) return <DriveTrashTableSkeleton />
    if (error) {
      return (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RefreshCw /></EmptyMedia>
            <EmptyTitle>读取失败</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" size="sm" variant="outline" onClick={() => { void loadTrash() }}>
              重试
            </Button>
          </EmptyContent>
        </Empty>
      )
    }
    const items = page?.items ?? []
    if (items.length === 0) {
      return (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>回收站为空</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )
    }
    return (
      <ModuleContentPanel>
        <Table className="table-fixed">
          <DriveTableColumns columns={DRIVE_TRASH_TABLE_COLUMNS} />
          <DriveTrashTableHeader />
          <TableBody>
            {items.map((item) => (
              <DriveTrashRow
                key={item.id}
                item={item}
                busy={busyItemId === item.id}
                onRestore={() => {
                  void runTrashMutation(
                    item,
                    () => requireSynapseBridge().account.restoreDriveTrashItem({
                      itemId: item.id,
                      kind: item.kind,
                      ...(item.assetId ? { assetId: item.assetId } : {}),
                    }),
                    "已恢复",
                    "恢复失败",
                    onDriveItemsChanged,
                  )
                }}
                onDelete={() => {
                  setDeleteTarget(item)
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
      {inlineToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="truncate text-base font-medium">回收站</h2>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => { void loadTrash() }}>
            刷新
          </Button>
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
              if (nextOffset !== null) void loadTrash(nextOffset)
            }}
          >
            {loadingMore ? "加载中" : "加载更多"}
          </Button>
        </div>
      ) : null}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>删除「{deleteTarget?.name}」？此操作完成后将从回收站移除。</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyItemId !== null}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busyItemId !== null} onClick={() => { void confirmDelete() }}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})

function DriveTrashTableHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>名称</TableHead>
        <TableHead>来源</TableHead>
        <TableHead className="text-right">大小</TableHead>
        <TableHead>原路径</TableHead>
        <TableHead className="whitespace-nowrap text-right">删除时间</TableHead>
        <TableHead className="text-right" aria-label="操作" />
      </TableRow>
    </TableHeader>
  )
}

function DriveTrashTableSkeleton() {
  return (
    <ModuleContentPanel>
      <Table className="table-fixed">
        <DriveTableColumns columns={DRIVE_TRASH_TABLE_COLUMNS} />
        <DriveTrashTableHeader />
        <TableBody>
          {DRIVE_TRASH_SKELETON_ROWS.map((row) => (
            <TableRow key={row}>
              <TableCell><Skeleton className="h-4 w-48" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-4 w-36" /></TableCell>
              <TableCell><Skeleton className="ml-auto h-7 w-20" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ModuleContentPanel>
  )
}

function DriveTrashRow({
  busy,
  item,
  onDelete,
  onRestore,
}: {
  readonly busy: boolean
  readonly item: DriveTrashItemDto
  readonly onDelete: () => void
  readonly onRestore: () => void
}) {
  const isFolder = item.type === "folder"
  return (
    <TableRow aria-busy={busy || undefined}>
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {busy ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : isFolder ? (
            <DriveItemIcon kind="folder" />
          ) : (
            <DriveItemIcon kind="file" />
          )}
          <span className="min-w-0 truncate font-medium" title={item.name}>{item.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{item.kind === "public_asset" ? "公开素材" : "普通文件"}</Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{isFolder ? "-" : formatBytes(item.size)}</TableCell>
      <TableCell className="truncate text-muted-foreground" title={item.originalPath ?? undefined}>{item.originalPath ?? "-"}</TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
        <RelativeTime value={item.trashedAt} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onRestore}>恢复</Button>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onDelete}>删除</Button>
        </div>
      </TableCell>
    </TableRow>
  )
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

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim() || fallback
}

export { DriveTrashView }
export type { DriveTrashViewActionState, DriveTrashViewHandle }
