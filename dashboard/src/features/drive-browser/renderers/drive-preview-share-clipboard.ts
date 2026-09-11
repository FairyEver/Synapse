import { toast } from 'sonner'
import { buildDriveShareClipboardText, type DrivePreviewCopyShareLinkAction } from './drive-preview-actions'

export async function copyDrivePreviewShareLink(action: DrivePreviewCopyShareLinkAction): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(buildDriveShareClipboardText(
      action.itemName,
      action.shareKind,
      action.shareUrl,
      window.location.origin,
    ))
    toast('已复制分享链接')
  } catch {
    toast('复制失败，请重试')
  }
}
