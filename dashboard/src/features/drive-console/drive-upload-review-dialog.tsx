import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDriveBrowserBytes } from '@/features/drive-browser/shared/drive-format'
import type { DriveWebUploadReview } from './drive-upload-review'

export function DriveUploadReviewDialog({ review, replacement, uploading, onCancel, onConfirm }: {
  readonly review: DriveWebUploadReview | null
  readonly replacement: boolean
  readonly uploading: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <Dialog open={review !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent data-drive-telemetry-scope='portal'>
        <DialogHeader>
          <DialogTitle>{replacement ? '上传新版本' : '确认覆盖文件'}</DialogTitle>
          <DialogDescription>保留云端名称、分享链接和历史版本。其他设备可能同步这些更新；未同步的修改仍按冲突规则处理。</DialogDescription>
        </DialogHeader>
        {replacement && review?.files[0] ? (
          <div className='grid gap-1 text-sm'>
            <span className='text-muted-foreground'>新文件</span>
            <span className='break-all'>{review.files[0].file.name} · {formatDriveBrowserBytes(String(review.files[0].file.size))}</span>
          </div>
        ) : null}
        <ul className='max-h-64 overflow-y-auto'>
          {review?.overwrites.map((entry) => (
            <li key={entry.itemId} className='flex items-center justify-between gap-3 py-2'>
              <span className='min-w-0 break-all text-sm'>{entry.path}</span>
              <span className='shrink-0 text-sm tabular-nums text-muted-foreground'>当前 {formatDriveBrowserBytes(entry.size)}</span>
            </li>
          ))}
        </ul>
        {review?.folders.length ? <p className='text-sm text-muted-foreground'>文件夹合并上传，云端独有文件保留。</p> : null}
        <DialogFooter>
          <Button type='button' variant='outline' disabled={uploading} onClick={onCancel}>取消</Button>
          <Button data-drive-telemetry-event='web.drive.upload.overwrite-confirm' type='button' disabled={uploading} onClick={onConfirm}>{uploading ? '上传中' : '确认上传'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
