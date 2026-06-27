import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  type DriveBrowserSnapshotDto,
  type DriveFileContentUpdateResult,
} from '@synapse/shared'
import { cn } from '@/lib/utils'
import { DriveFileVersionsDialog } from '../drive-file-versions-dialog'
import { getDriveFileVersionItemId } from '../shared/drive-view-model'
import type { DriveAnnotationContext } from '../use-drive-annotations'
import { DriveCodeRenderer } from './code-renderer'
import { getDrivePreviewDriveBrowserUrl } from './drive-preview-actions'
import { DrivePreviewFloatingMenu, clampDriveFloatingMenuPosition, shouldSuppressDriveFloatingMenuOpen } from './drive-preview-floating-menu'
import { DrivePreviewHeader } from './drive-preview-header'
import { DriveRendererToolbarProvider, useDriveRendererToolbar } from './drive-renderer-toolbar-context'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  type DriveRendererId,
  type DriveRendererOption,
} from './drive-renderer-registry'
import { DriveDownloadRenderer } from './download-renderer'
import { DriveIframeRenderer } from './iframe-renderer'
import { DriveImageRenderer } from './image-renderer'
import type { DriveMarkdownImageSourceContext } from './drive-markdown-image-sources'
import { DriveMarkdownRenderer } from './markdown-renderer'
import { DriveMDXeditorRenderer } from './mdxeditor-renderer'

const READING_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-4xl px-4 md:px-6'
const MEDIA_CONTAINER_CLASSNAME = 'mx-auto w-full max-w-6xl px-4 md:px-6'
const FULL_CONTAINER_CLASSNAME = 'h-full min-h-0 w-full'

export { clampDriveFloatingMenuPosition, shouldSuppressDriveFloatingMenuOpen }

export type DriveRendererEditContext = {
  readonly reload: () => Promise<DriveBrowserSnapshotDto>
  readonly reloading: boolean
  readonly saveText: (input: { readonly text: string; readonly baseVersionId: string }) => Promise<DriveFileContentUpdateResult>
  readonly savingText: boolean
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
  const activeRendererId = rendererId === undefined ? internalRendererId : rendererId
  const selected = findDriveRendererOption(snapshot, activeRendererId)
  const setRenderer = (id: DriveRendererId) => {
    if (onRendererChange) {
      onRendererChange(id)
      return
    }
    setInternalRendererId(id)
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
}: {
  readonly snapshot: DriveBrowserSnapshotDto
  readonly body: boolean
  readonly options: readonly DriveRendererOption[]
  readonly selected: DriveRendererOption
  readonly onSelect: (id: DriveRendererId) => void
  readonly editContext?: DriveRendererEditContext
  readonly annotationContext?: DriveAnnotationContext
}) {
  const { items } = useDriveRendererToolbar()
  const [versionsOpen, setVersionsOpen] = useState(false)
  const versionItemId = getDriveFileVersionItemId(snapshot)
  const useFloatingChrome = body && selected.id === 'iframe'

  return (
    <section className='h-full min-h-0 bg-background flex flex-col'>
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
          onChanged={editContext?.reload}
          onOpenChange={setVersionsOpen}
        />
      ) : null}
    </section>
  )
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
  const imageSourceContext = getDriveMarkdownImageSourceContext(snapshot, annotationContext)
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
        imageSourceContext={imageSourceContext}
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
        imageSourceContext={imageSourceContext}
      />
    )
  }
  if (selected.id === 'code') {
    return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} />)
  }
  if (selected.id === 'image') {
    return renderContent(<DriveImageRenderer current={snapshot.current} preview={preview} />)
  }
  if (selected.id === 'iframe' && preview.visitUrl) {
    return renderContent(<DriveIframeRenderer current={snapshot.current} visitUrl={preview.visitUrl} />)
  }
  return renderContent(<DriveCodeRenderer current={snapshot.current} preview={preview} edit={snapshot.edit} editContext={editContext} />)
}

function getDriveMarkdownImageSourceContext(
  snapshot: DriveBrowserSnapshotDto,
  annotationContext?: DriveAnnotationContext
): DriveMarkdownImageSourceContext | undefined {
  if (snapshot.current.type !== 'file' || snapshot.preview?.kind !== 'markdown') return undefined
  if (annotationContext?.context === 'share') {
    const rootItemId = snapshot.breadcrumbs[0]?.id ?? snapshot.current.id
    return {
      context: 'share',
      shareId: annotationContext.shareId,
      itemId: snapshot.current.id === rootItemId ? null : snapshot.current.id,
    }
  }
  return { context: 'owner', itemId: snapshot.current.id }
}
