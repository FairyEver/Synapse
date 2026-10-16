import { useRef, useState } from 'react'
import { buildOwnerDriveBrowserUrl, type DriveBrowserItemDto } from '@synapse/shared'
import { trackDriveEvent } from '@/features/drive-browser/shared/drive-telemetry'
import { navigateDriveBrowserUrl, type DriveBrowserNavigate } from '@/features/drive-browser/shared/drive-navigation'
import { toast } from 'sonner'
import { uploadDriveFiles, type DriveWebUploadInput, type DriveWebUploadResult } from './drive-upload'
import { prepareDriveUploadReview, reviewDriveFileReplacement, type DriveWebUploadReview } from './drive-upload-review'

type PendingUpload = { readonly input: DriveWebUploadInput; readonly review: DriveWebUploadReview; readonly replacement: boolean }

export function useDriveUpload(onChanged: () => Promise<void>, onNavigate: DriveBrowserNavigate = navigateDriveBrowserUrl) {
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const busy = useRef(false)
  const pendingRef = useRef<PendingUpload | null>(null)
  const updatePending = (value: PendingUpload | null) => { pendingRef.current = value; setPending(value) }

  const execute = async (upload: PendingUpload) => {
    const result = await uploadDriveFiles({ ...upload.input, review: upload.review })
    if (upload.replacement && result.completed === 1 && result.failed === 0) {
      const itemId = upload.review.overwrites[0].itemId
      toast('云端已更新；同步设备将按各自状态处理更新', {
        action: { label: '查看历史版本', onClick: () => {
          trackDriveEvent({ eventKey: 'web.drive.upload.history-open', component: 'drive-console', action: 'open' })
          onNavigate(`${buildOwnerDriveBrowserUrl(itemId)}?versions=1`)
        } },
      })
    } else toast(uploadResultMessage(result))
    updatePending(null)
    await onChanged()
  }
  const review = async (input: DriveWebUploadInput, target?: DriveBrowserItemDto) => {
    if (busy.current || pendingRef.current || (input.files.length === 0 && (input.folders?.length ?? 0) === 0)) return
    busy.current = true
    setUploading(true)
    try {
      const reviewed = target
        ? await reviewDriveFileReplacement({ ...target, parentId: input.parentId }, input.files[0])
        : await prepareDriveUploadReview(input)
      const next = { input, review: reviewed, replacement: Boolean(target) }
      if (reviewed.overwrites.length > 0) updatePending(next)
      else await execute(next)
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传检查失败')
    } finally {
      busy.current = false
      setUploading(false)
    }
  }
  const confirm = async () => {
    const next = pendingRef.current
    if (!next || busy.current) return
    busy.current = true
    setUploading(true)
    try {
      await execute(next)
    } catch (error) {
      toast(error instanceof Error ? error.message : '上传失败')
      updatePending(null)
    } finally {
      busy.current = false
      setUploading(false)
    }
  }
  return { uploading, blocked: uploading || pending !== null, pending, review, confirm, cancel: () => { if (!busy.current) updatePending(null) } }
}

function uploadResultMessage(result: DriveWebUploadResult): string {
  if (result.completed > 0 && result.failed === 0 && result.skipped === 0) return `云端已上传 ${result.completed} 个文件`
  if (result.completed > 0) return `云端已上传 ${result.completed} 个文件，失败 ${result.failed} 个，跳过 ${result.skipped} 个${result.message ? `：${result.message}` : ''}`
  if (result.skipped > 0 && result.failed === 0) return result.message ?? `已跳过 ${result.skipped} 个文件`
  return result.message ?? '上传失败'
}
