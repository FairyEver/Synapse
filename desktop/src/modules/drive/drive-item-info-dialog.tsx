import type { DriveItemDto } from "@synapse/shared"
import { formatDateTime } from "@/lib/date-time"
import { formatDriveBytes } from "@/lib/drive-format"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DriveItemIcon } from "./drive-item-icon"

type DriveItemInfoDialogProps = {
  readonly item: DriveItemDto | null
  readonly path: string
  readonly onOpenChange: (open: boolean) => void
}

const DRIVE_STORAGE_STATUS_LABELS: Record<DriveItemDto["storageStatus"], string> = {
  active: "可用",
  pending: "上传中",
  delete_pending: "删除中",
  deleted: "已删除",
  failed: "上传失败",
}

function DriveItemInfoDialog({ item, path, onOpenChange }: DriveItemInfoDialogProps) {
  const isFolder = item?.type === "folder"

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      {item ? (
        <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>信息</DialogTitle>
          </DialogHeader>
          <div className="flex min-w-0 items-center gap-3 py-2">
            <DriveItemIcon kind={isFolder ? "folder" : "file"} />
            <span className="min-w-0 truncate font-medium" title={item.name}>{item.name}</span>
          </div>
          <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-t pt-4">
            <DriveInfoRow label="类型" value={isFolder ? "文件夹" : "文件"} />
            <DriveInfoRow label="大小" value={isFolder ? "未统计" : formatDriveBytes(item.size)} numeric={!isFolder} />
            <DriveInfoRow label="路径" value={path} />
            {!isFolder ? <DriveInfoRow label="内容类型" value={item.mimeType ?? "未知"} /> : null}
            <DriveInfoRow label="创建时间" value={formatDateTime(item.createdAt)} />
            <DriveInfoRow label="更新时间" value={formatDateTime(item.updatedAt)} />
            <DriveInfoRow label="状态" value={DRIVE_STORAGE_STATUS_LABELS[item.storageStatus]} />
            <DriveInfoRow label="分享" value={item.shared || item.activeShareId ? "已分享" : "未分享"} />
          </dl>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function DriveInfoRow({
  label,
  numeric = false,
  value,
}: {
  readonly label: string
  readonly numeric?: boolean
  readonly value: string
}) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={numeric ? "min-w-0 break-words tabular-nums" : "min-w-0 break-words"}>{value}</dd>
    </div>
  )
}

export { DriveItemInfoDialog }
