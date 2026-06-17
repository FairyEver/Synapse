import type { DriveBrowserItemDto, DriveBrowserPreviewKind } from '@synapse/shared'

export function driveBrowserKindLabel(kind: DriveBrowserPreviewKind) {
  const labels: Record<DriveBrowserPreviewKind, string> = {
    image: '图片',
    text: '文本',
    'html-source': 'HTML',
    markdown: 'Markdown',
    'download-only': '下载',
  }
  return labels[kind]
}

export function formatDriveBrowserSize(item: DriveBrowserItemDto) {
  if (item.type === 'folder') return '-'
  return formatDriveBrowserBytes(item.size)
}

export function formatDriveBrowserBytes(value: string) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function formatDriveBrowserDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN')
}
