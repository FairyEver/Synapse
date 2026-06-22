import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export type DriveRendererId = 'mdxeditor' | 'markdown' | 'code' | 'image' | 'iframe' | 'download'
export type DriveRendererContainer = 'reading' | 'media' | 'full'
export const DRIVE_MDXEDITOR_MAX_MARKDOWN_BYTES = 64 * 1024

export type DriveRendererOption = {
  readonly id: DriveRendererId
  readonly label: string
  readonly container: DriveRendererContainer
  readonly disabledReason?: string
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
  if (preview.kind === 'markdown') return [
    RENDERERS.markdown,
    driveMdxEditorRendererOption(snapshot),
    RENDERERS.code,
  ]
  if (preview.kind === 'image') return [RENDERERS.image]
  if (preview.kind === 'html-source') {
    return preview.visitUrl
      ? [RENDERERS.iframe, RENDERERS.code]
      : [RENDERERS.code]
  }
  return [RENDERERS.code]
}

export function selectDefaultDriveRenderer(snapshot: DriveBrowserSnapshotDto): DriveRendererOption | null {
  return firstEnabledDriveRendererOption(getDriveRendererOptions(snapshot))
}

export function findDriveRendererOption(
  snapshot: DriveBrowserSnapshotDto,
  rendererId: DriveRendererId | null
): DriveRendererOption | null {
  const options = getDriveRendererOptions(snapshot)
  const fallback = firstEnabledDriveRendererOption(options)
  if (!rendererId) return fallback
  const selected = options.find((option) => option.id === rendererId)
  if (selected && !selected.disabledReason) return selected
  return fallback
}

function firstEnabledDriveRendererOption(options: readonly DriveRendererOption[]): DriveRendererOption | null {
  return options.find((option) => !option.disabledReason) ?? null
}

function driveMdxEditorRendererOption(snapshot: DriveBrowserSnapshotDto): DriveRendererOption {
  const disabledReason = canRenderDriveMdxEditor(snapshot) ? undefined : '文件过大'
  return disabledReason ? { ...RENDERERS.mdxeditor, disabledReason } : RENDERERS.mdxeditor
}

function canRenderDriveMdxEditor(snapshot: DriveBrowserSnapshotDto): boolean {
  const preview = snapshot.preview
  if (!preview || preview.kind !== 'markdown' || preview.truncated || preview.text === null) return false
  const size = parseDriveItemSize(snapshot.current.size) ?? markdownByteLength(preview.text)
  if (size === null) return false
  return size <= BigInt(DRIVE_MDXEDITOR_MAX_MARKDOWN_BYTES)
}

function parseDriveItemSize(value: string): bigint | null {
  try {
    const size = BigInt(value)
    return size >= 0n ? size : null
  } catch {
    return null
  }
}

function markdownByteLength(value: string): bigint | null {
  if (typeof TextEncoder === 'undefined') return BigInt(value.length)
  return BigInt(new TextEncoder().encode(value).byteLength)
}
