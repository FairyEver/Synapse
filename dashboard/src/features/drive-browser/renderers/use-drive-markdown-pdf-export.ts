import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { ApiError } from '@/lib/api'
import { startDriveOperation } from '../shared/drive-telemetry'
import { trackedDriveBrowserApi as driveBrowserApi } from '../shared/drive-telemetry-api'
import type { DriveAnnotationContext } from '../use-drive-annotations'

export function useDriveMarkdownPdfExport(input: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly context?: DriveAnnotationContext
  readonly hasUnsavedChanges: boolean
}) {
  const [exporting, setExporting] = useState(false)
  const exportingRef = useRef(false)
  const available = input.snapshot.current.type === 'file'
    && input.snapshot.current.previewKind === 'markdown'
    && (input.snapshot.context === 'owner' || input.context?.context === 'share')
  const exportPdf = useCallback(async () => {
    if (!available || input.hasUnsavedChanges || exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    const toastId = toast.loading('正在导出')
    const finish = startDriveOperation('web.drive.preview.export-pdf', 'drive-preview')
    try {
      const filename = pdfFilename(input.snapshot.current.name)
      const result = input.snapshot.context === 'owner'
        ? await driveBrowserApi.exportOwnerPdf(input.snapshot.current.id, filename)
        : await driveBrowserApi.exportSharePdf(
            input.context?.context === 'share' ? input.context.shareId : '',
            input.context?.context === 'share' ? input.context.itemId : undefined,
            filename
          )
      finish('success')
      const warningParts = [
        result.imageWarnings > 0 ? `${result.imageWarnings} 张图片未加载` : null,
        result.diagramWarnings > 0 ? `${result.diagramWarnings} 个图表未渲染` : null,
      ].filter((value): value is string => Boolean(value))
      if (warningParts.length > 0) toast.warning(`PDF 已导出，${warningParts.join('，')}`, { id: toastId })
      else toast.success('PDF 已导出', { id: toastId })
    } catch (error) {
      finish('failure')
      toast.error(pdfExportErrorMessage(error, input.snapshot.context === 'share'), { id: toastId })
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }, [available, input.context, input.hasUnsavedChanges, input.snapshot])

  return {
    available,
    exporting,
    disabledReason: input.hasUnsavedChanges ? '请先保存再导出' : null,
    exportPdf,
  }
}

export function pdfFilename(name: string): string {
  const extensionStart = name.lastIndexOf('.')
  const stem = (extensionStart > 0 ? name.slice(0, extensionStart) : name) || '文档'
  return `${stem}.pdf`
}

function pdfExportErrorMessage(error: unknown, shared: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return shared
      ? '分享尚未解锁，请重新输入密码。'
      : '登录已失效，请重新登录。'
    if (error.status === 413) return '文件或图片过大，无法导出。'
    if (error.status === 429) return '导出请求较多，请稍后重试。'
    if (error.status === 502) return 'PDF 导出服务暂不可用，请稍后重试。'
    if (error.status === 504) return 'PDF 导出超时，请稍后重试。'
    if (error.message) return error.message
  }
  return 'PDF 导出失败，请重试。'
}
