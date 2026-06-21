import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export type DriveRendererId = 'mdxeditor' | 'markdown' | 'code' | 'image' | 'iframe' | 'download'
export type DriveRendererContainer = 'reading' | 'media' | 'full'

export type DriveRendererOption = {
  readonly id: DriveRendererId
  readonly label: string
  readonly container: DriveRendererContainer
}

const RENDERERS: Record<DriveRendererId, DriveRendererOption> = {
  mdxeditor: { id: 'mdxeditor', label: 'MDXeditor', container: 'full' },
  markdown: { id: 'markdown', label: '预览', container: 'reading' },
  code: { id: 'code', label: '代码', container: 'full' },
  image: { id: 'image', label: '图片', container: 'media' },
  iframe: { id: 'iframe', label: '网页', container: 'full' },
  download: { id: 'download', label: '下载', container: 'reading' },
}

export function getDriveRendererOptions(snapshot: DriveBrowserSnapshotDto): readonly DriveRendererOption[] {
  if (snapshot.current.type === 'folder') return []
  const preview = snapshot.preview
  if (!preview || preview.kind === 'download-only') return [RENDERERS.download]
  if (preview.kind === 'markdown') return [RENDERERS.markdown, RENDERERS.mdxeditor, RENDERERS.code]
  if (preview.kind === 'image') return [RENDERERS.image]
  if (preview.kind === 'html-source') {
    return preview.visitUrl
      ? [RENDERERS.iframe, RENDERERS.code]
      : [RENDERERS.code]
  }
  return [RENDERERS.code]
}

export function selectDefaultDriveRenderer(snapshot: DriveBrowserSnapshotDto): DriveRendererOption | null {
  return getDriveRendererOptions(snapshot)[0] ?? null
}

export function findDriveRendererOption(
  snapshot: DriveBrowserSnapshotDto,
  rendererId: DriveRendererId | null
): DriveRendererOption | null {
  const options = getDriveRendererOptions(snapshot)
  if (!rendererId) return options[0] ?? null
  return options.find((option) => option.id === rendererId) ?? options[0] ?? null
}
