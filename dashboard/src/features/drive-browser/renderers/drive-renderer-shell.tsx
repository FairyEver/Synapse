import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  type DriveCollaborationJoinContext,
  type DriveBrowserEditUnavailableReason,
  type DriveBrowserSnapshotDto,
  type DriveFileContentUpdateResult,
} from '@synapse/shared'
import { FilePreviewLayout } from '@/features/file-browser/preview/file-preview-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { DriveDocumentImageUploadContext } from '@/lib/api'
import { DriveFileVersionsDialog } from '../drive-file-versions-dialog'
import { getDriveFileVersionItemId } from '../shared/drive-view-model'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { trackDriveEvent } from '../shared/drive-telemetry'
import { DriveCodeRenderer } from './code-renderer'
import { getDrivePreviewDriveBrowserUrl } from './drive-preview-actions'
import { DrivePreviewFloatingMenu, clampDriveFloatingMenuPosition, shouldSuppressDriveFloatingMenuOpen } from './drive-preview-floating-menu'
import { DrivePreviewHeader } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar, useRegisterDriveRendererToolbarItems } from './drive-renderer-toolbar-context'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
  type DriveRendererOption,
} from './drive-renderer-registry'
import { DriveDownloadRenderer } from './download-renderer'
import { DriveIframeRenderer } from './iframe-renderer'
import { DriveImageRenderer } from './image-renderer'
import { DriveMarkdownRenderer } from './markdown-renderer'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'

const READING_CONTAINER_CLASSNAME = 'mx-auto h-full w-full max-w-4xl px-4 md:px-6'
const MEDIA_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-6xl px-4 md:px-6'
const FULL_CONTAINER_CLASSNAME = 'h-full min-h-0 w-full'
const DRIVE_EDIT_UNAVAILABLE_LABELS: Record<DriveBrowserEditUnavailableReason, string> = {
  login_required: '需要登录才能编辑',
  permission_denied: '没有编辑权限',
  quota: '云盘空间不足，无法编辑',
  truncated: '文件过大，无法在线编辑',
  unsupported: '不支持编辑此文件类型',
}

export { clampDriveFloatingMenuPosition, shouldSuppressDriveFloatingMenuOpen }

export type DriveRendererEditContext = {
  readonly reload: () => Promise<DriveBrowserSnapshotDto>
  readonly reloading: boolean
  readonly saveText: (input: { readonly text: string; readonly baseVersionId: string }) => Promise<DriveFileContentUpdateResult>
  readonly savingText: boolean
}

function getDriveCollaborationContext(
  snapshot: DriveBrowserSnapshotDto,
  annotationContext?: DriveAnnotationContext
): DriveCollaborationJoinContext {
  if (annotationContext?.context === 'share') {
    return { kind: 'share', shareId: annotationContext.shareId, itemId: snapshot.current.id }
  }
  return { kind: 'owner', itemId: snapshot.current.id }
}

export function getDriveFloatingMenuNewWindowUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.surface === 'standalone' || snapshot.context === 'share') return null
  return snapshot.preview?.visitUrl ?? null
}

export function getDriveFloatingMenuDriveBrowserUrl(snapshot: DriveBrowserSnapshotDto): string | null {
  return getDrivePreviewDriveBrowserUrl(snapshot)
}

export function DriveRendererShell({
  snapshot,
  body = false,
  initialRendererId = null,
  rendererId,
  onRendererChange,
  editContext,
  annotationContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body?: boolean
  readonly initialRendererId?: DriveRendererId | null
  readonly rendererId?: DriveRendererId | null
  readonly onRendererChange?: (id: DriveRendererId) => void
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
}) {
  const options = useMemo(() => getDriveRendererOptions(snapshot), [snapshot])
  const initialRenderer = findDriveRendererOption(snapshot, initialRendererId)
  const [internalRendererId, setInternalRendererId] = useState<DriveRendererId | null>(
    initialRenderer?.id ?? options[0]?.id ?? null
  )
  const [rendererChangeError, setRendererChangeError] = useState<string | null>(null)
  const activeRendererId = rendererId === undefined ? internalRendererId : rendererId
  const selected = findDriveRendererOption(snapshot, activeRendererId)
  const applyRenderer = (id: DriveRendererId) => {
    if (onRendererChange) {
      onRendererChange(id)
      return
    }
    setInternalRendererId(id)
  }
  const setRenderer = (id: DriveRendererId) => {
    setRendererChangeError(null)
    trackDriveEvent({
      eventKey: 'web.drive.renderer.select',
      component: 'drive-renderer',
      action: 'select',
    })
    void refreshBeforeDriveRendererSwitch({
      id,
      collaborationEnabled: Boolean(snapshot.collaboration?.enabled),
      reload: editContext?.reload,
    }).then(() => applyRenderer(id)).catch(() => {
      setRendererChangeError('无法加载最新版本。')
    })
  }

  useEffect(() => {
    if (rendererId !== undefined) return
    setInternalRendererId((current) =>
      findDriveRendererOption(snapshot, current)?.id ?? findDriveRendererOption(snapshot, initialRendererId)?.id ?? null
    )
  }, [initialRendererId, rendererId, snapshot])

  if (!selected) return null

  return (
    <DriveRendererToolbarProvider key={selected.id}>
      <DriveRendererShellChrome
        snapshot={snapshot}
        body={body}
        options={options}
        selected={selected}
        onSelect={setRenderer}
        editContext={editContext}
        annotationContext={annotationContext}
        rendererChangeError={rendererChangeError}
      />
    </DriveRendererToolbarProvider>
  )
}

function DriveRendererShellChrome({
  snapshot,
  body,
  options,
  selected,
  onSelect,
  editContext,
  annotationContext,
  rendererChangeError,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body: boolean
  readonly options: readonly DriveRendererOption[]
  readonly selected: DriveRendererOption
  readonly onSelect: (id: DriveRendererId) => void
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
  readonly rendererChangeError: string | null
}) {
  const { hasUnsavedChanges, items } = useDriveRendererToolbar()
  const [versionsOpen, setVersionsOpen] = useState(false)
  const versionItemId = getDriveFileVersionItemId(snapshot)
  const useFloatingChrome = body && selected.id === 'iframe'

  return (
    <FilePreviewLayout className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-background'>
      {useFloatingChrome ? (
        <DrivePreviewFloatingMenu
          snapshot={snapshot}
          rendererItems={items}
          rendererOptions={options}
          selectedRendererId={selected.id}
          onRendererChange={onSelect}
          onOpenVersions={() => setVersionsOpen(true)}
        />
      ) : (
        <DrivePreviewHeader
          snapshot={snapshot}
          rendererItems={items}
          rendererOptions={options}
          selectedRendererId={selected.id}
          onRendererChange={onSelect}
          onOpenVersions={() => setVersionsOpen(true)}
        />
      )}
      {rendererChangeError ? (
        <Alert variant='destructive' className='rounded-none border-x-0 border-t-0'>
          <AlertDescription>{rendererChangeError}</AlertDescription>
        </Alert>
      ) : null}
      <div className='min-h-0 flex-1 overflow-hidden'>
        <DriveRendererContent
          snapshot={snapshot}
          selected={selected}
          body={body}
          editContext={editContext}
          annotationContext={annotationContext}
        />
      </div>
      {versionsOpen && versionItemId ? (
        <DriveFileVersionsDialog
          itemId={versionItemId}
          open={versionsOpen}
          hasUnsavedChanges={hasUnsavedChanges}
          onChanged={editContext?.reload}
          onOpenChange={setVersionsOpen}
        />
      ) : null}
    </FilePreviewLayout>
  )
}

export async function refreshBeforeDriveRendererSwitch(input: {
  readonly id: DriveRendererId
  readonly collaborationEnabled: boolean
  readonly reload?: () => Promise<DriveBrowserSnapshotDto>
}): Promise<void> {
  if (input.id !== 'mdxeditor' || !input.collaborationEnabled || !input.reload) return
  await input.reload()
}

export function DriveRendererContent({
  snapshot,
  selected,
  body = false,
  editContext,
  annotationContext,
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly selected: DriveRendererOption
  readonly body?: boolean
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
}) {
  const preview = snapshot.preview
  const editUnavailableLabel = getDriveEditUnavailableLabel(snapshot)
  const editUnavailableItems = useMemo(
    () => editUnavailableLabel
      ? [{ kind: 'status' as const, id: 'drive-edit-unavailable-reason', label: editUnavailableLabel }]
      : [],
    [editUnavailableLabel]
  )
  useRegisterDriveRendererToolbarItems('drive-edit-unavailable', editUnavailableItems)
  const imageUploadContext = useMemo(
    () => getDriveDocumentImageUploadContext(snapshot, annotationContext),
    [annotationContext, snapshot]
  )
  const collaborationContext = useMemo(
    () => getDriveCollaborationContext(snapshot, annotationContext),
    [annotationContext, snapshot]
  )
  const containerClassName = selected.container === 'media'
    ? MEDIA_CONTAINER_CLASSNAME
    : selected.container === 'reading'
      ? READING_CONTAINER_CLASSNAME
      : FULL_CONTAINER_CLASSNAME
  const contentHostClassName = cn(
    'h-full min-h-0',
    selected.container === 'full' || selected.id === 'markdown' ? 'overflow-hidden' : 'overflow-auto'
  )
  const renderContent = (content: ReactNode) => (
    <div className={contentHostClassName}>
      {body || selected.id === 'markdown' ? content : <div className={containerClassName}>{content}</div>}
    </div>
  )

  if (!preview || selected.id === 'download') {
    return renderContent(<DriveDownloadRenderer current={snapshot.current} />)
  }
  if (selected.id === 'markdown') {
    return renderContent(
      <DriveMarkdownRenderer
        current={snapshot.current}
        preview={preview}
        edit={snapshot.edit}
        editContext={editContext}
        annotationContext={annotationContext}
        collaboration={snapshot.collaboration}
        collaborationContext={collaborationContext}
      />
    )
  }
  if (selected.id === 'mdxeditor') {
    return renderContent(
      <DriveMDXeditorRenderer
        current={snapshot.current}
        preview={preview}
        edit={snapshot.edit}
        editContext={editContext}
        annotationContext={annotationContext}
        imageUploadContext={imageUploadContext}
      />
    )
  }
  if (selected.id === 'code') {
    return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} collaboration={snapshot.collaboration} collaborationContext={collaborationContext} />)
  }
  if (selected.id === 'image') {
    return renderContent(<DriveImageRenderer current={snapshot.current} preview={preview} />)
  }
  if (selected.id === 'iframe' && preview.visitUrl) {
    return renderContent(<DriveIframeRenderer current={snapshot.current} visitUrl={preview.visitUrl} />)
  }
  return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} collaboration={snapshot.collaboration} collaborationContext={collaborationContext} />)
}

function getDriveEditUnavailableLabel(snapshot: DriveBrowserSnapshotDto): string | null {
  const reason = snapshot.edit?.canEdit === false ? snapshot.edit.reason : null
  return reason ? DRIVE_EDIT_UNAVAILABLE_LABELS[reason] : null
}

function getDriveDocumentImageUploadContext(
  snapshot: DriveBrowserSnapshotDto,
  annotationContext?: DriveAnnotationContext
): DriveDocumentImageUploadContext | undefined {
  if (snapshot.current.type !== 'file' || snapshot.preview?.kind !== 'markdown') return undefined
  if (annotationContext?.context === 'share') {
    const rootItemId = snapshot.breadcrumbs[0]?.id ?? snapshot.current.id
    return {
      kind: 'share',
      shareId: annotationContext.shareId,
      itemId: snapshot.current.id === rootItemId ? null : snapshot.current.id,
    }
  }
  return { kind: 'owner', itemId: snapshot.current.id }
}
