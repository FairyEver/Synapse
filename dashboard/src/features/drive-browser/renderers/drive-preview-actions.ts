import {
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveItemBrowserUrl,
  buildOwnerDriveBrowserUrl,
  type DriveBrowserSnapshotDto,
} from '@synapse/shared'
import { Copy, Download, ExternalLink, History, ListFilter, type LucideIcon } from 'lucide-react'
import { driveBrowserKindLabel, formatDriveBrowserSize } from '../shared/drive-format'
import { getDriveFileVersionItemId } from '../shared/drive-view-model'
import { getDriveRendererOptions, type DriveRendererId, type DriveRendererOption } from './drive-renderer-registry'

export type DrivePreviewSystemActionId =
  | 'download'
  | 'copy-share-link'
  | 'open-in-drive'
  | 'open-new-window'
  | 'versions'
  | 'renderer-select'

export type DrivePreviewFileIdentity = {
  readonly name: string
  readonly sizeLabel: string
  readonly kindLabel: string
  readonly updatedAt: string
}

export type DrivePreviewShareKind = 'file' | 'folder' | 'webpage'

export type DrivePreviewLinkAction = {
  readonly kind: 'link'
  readonly id: Exclude<DrivePreviewSystemActionId, 'copy-share-link' | 'versions' | 'renderer-select'>
  readonly label: string
  readonly href: string
  readonly external?: boolean
  readonly icon: LucideIcon
}

export type DrivePreviewVersionsAction = {
  readonly kind: 'versions'
  readonly id: 'versions'
  readonly label: string
  readonly itemId: string
  readonly icon: LucideIcon
}

export type DrivePreviewCopyShareLinkAction = {
  readonly kind: 'copy-share-link'
  readonly id: 'copy-share-link'
  readonly label: string
  readonly itemName: string
  readonly shareKind: DrivePreviewShareKind
  readonly shareUrl: string
  readonly icon: LucideIcon
}

export type DrivePreviewRendererSelectAction = {
  readonly kind: 'renderer-select'
  readonly id: 'renderer-select'
  readonly label: string
  readonly options: readonly DriveRendererOption[]
  readonly selectedId: DriveRendererId | null
  readonly icon: LucideIcon
}

export type DrivePreviewSystemAction =
  | DrivePreviewLinkAction
  | DrivePreviewCopyShareLinkAction
  | DrivePreviewVersionsAction
  | DrivePreviewRendererSelectAction

export type DrivePreviewSystemMenuSection = {
  readonly id: 'file' | 'renderer'
  readonly items: readonly DrivePreviewSystemAction[]
}

export function getDrivePreviewFileIdentity(snapshot: DriveBrowserSnapshotDto): DrivePreviewFileIdentity {
  return {
    name: snapshot.current.name,
    sizeLabel: formatDriveBrowserSize(snapshot.current),
    kindLabel: driveBrowserKindLabel(snapshot.current.previewKind),
    updatedAt: snapshot.current.updatedAt,
  }
}

export function getDrivePreviewSystemActions(
  snapshot: DriveBrowserSnapshotDto,
  selectedRendererId: DriveRendererId | null = null,
): readonly DrivePreviewSystemAction[] {
  if (snapshot.current.type !== 'file') return []
  const actions: DrivePreviewSystemAction[] = []
  if (snapshot.current.downloadUrl) {
    actions.push({
      kind: 'link',
      id: 'download',
      label: '下载',
      href: snapshot.current.downloadUrl,
      icon: Download,
    })
  }

  const copyShareLinkAction = getDriveCopyShareLinkAction(snapshot)
  if (copyShareLinkAction) actions.push(copyShareLinkAction)

  const driveBrowserUrl = getDrivePreviewDriveBrowserUrl(snapshot)
  if (driveBrowserUrl) {
    actions.push({
      kind: 'link',
      id: 'open-in-drive',
      label: '在云盘中查看',
      href: driveBrowserUrl,
      icon: ExternalLink,
    })
  }

  const newWindowUrl = getDrivePreviewNewWindowUrl(snapshot)
  if (newWindowUrl) {
    actions.push({
      kind: 'link',
      id: 'open-new-window',
      label: '新窗口打开',
      href: newWindowUrl,
      external: true,
      icon: ExternalLink,
    })
  }

  const versionItemId = getDriveFileVersionItemId(snapshot)
  if (versionItemId) {
    actions.push({
      kind: 'versions',
      id: 'versions',
      label: '历史版本',
      itemId: versionItemId,
      icon: History,
    })
  }

  const rendererOptions = getDriveRendererOptions(snapshot)
  if (rendererOptions.length > 1) {
    actions.push({
      kind: 'renderer-select',
      id: 'renderer-select',
      label: '打开方式',
      options: rendererOptions,
      selectedId: selectedRendererId,
      icon: ListFilter,
    })
  }
  return actions
}

export function getDriveCopyShareLinkAction(snapshot: DriveBrowserSnapshotDto): DrivePreviewCopyShareLinkAction | null {
  if (!snapshot.current.shareUrl) return null
  return {
    kind: 'copy-share-link',
    id: 'copy-share-link',
    label: '复制分享链接',
    itemName: snapshot.current.name,
    shareKind: snapshot.current.type === 'folder'
      ? 'folder'
      : snapshot.current.previewKind === 'html-source' ? 'webpage' : 'file',
    shareUrl: snapshot.current.shareUrl,
    icon: Copy,
  }
}

export function buildDriveShareClipboardText(
  itemName: string,
  shareKind: DrivePreviewShareKind,
  shareUrl: string,
  origin: string,
): string {
  const extensionIndex = itemName.lastIndexOf('.')
  const displayName = shareKind !== 'folder' && extensionIndex > 0 ? itemName.slice(0, extensionIndex) : itemName
  const label = shareKind === 'folder' ? '文件夹分享' : shareKind === 'webpage' ? '网页分享' : '文件分享'
  return `${label}：${displayName}\n${new URL(shareUrl, origin).href}`
}

export function getDrivePreviewSystemMenuSections(
  snapshot: DriveBrowserSnapshotDto,
  selectedRendererId: DriveRendererId | null = null,
): readonly DrivePreviewSystemMenuSection[] {
  const actions = getDrivePreviewSystemActions(snapshot, selectedRendererId)
  const fileItems = actions.filter((action) => action.kind !== 'renderer-select')
  const rendererItems = actions.filter((action) => action.kind === 'renderer-select')
  const sections: DrivePreviewSystemMenuSection[] = []
  if (fileItems.length > 0) {
    sections.push({ id: 'file', items: fileItems })
  }
  if (rendererItems.length > 0) {
    sections.push({ id: 'renderer', items: rendererItems })
  }
  return sections
}

export function getDrivePreviewNewWindowUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.current.type !== 'file') return null
  if (snapshot.context !== 'owner' || snapshot.surface !== 'console') return null
  const url = new URL(buildOwnerDriveBrowserUrl(snapshot.current.id), 'http://synapse.local')
  url.searchParams.set('surface', 'standalone')
  return `${url.pathname}${url.search}${url.hash}`
}

export function getDrivePreviewDriveBrowserUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.context !== 'owner' || snapshot.surface !== 'standalone') return null
  return snapshot.current.type === 'folder'
    ? buildConsoleDriveBrowserUrl(snapshot.current.id)
    : buildConsoleDriveItemBrowserUrl(snapshot.current.id)
}
