import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import {
  DriveBrowserView,
  DriveSingleFileReaderView,
} from './drive-browser-page'
import { DriveFinder } from './finder/drive-finder'
import {
  getDriveRendererOptions,
  selectDefaultDriveRenderer,
} from './renderers/drive-renderer-registry'
import { driveBrowserKindLabel, formatDriveBrowserSize } from './shared/drive-format'
import {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  getDriveFinderActions,
  shouldRenderDriveBodyRenderer,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'

describe('drive browser view model', () => {
  it('formats drive file metadata from shared helpers', () => {
    expect(formatDriveBrowserSize({ ...baseCurrent(), size: '7372' })).toBe('7.2 KB')
    expect(formatDriveBrowserSize({ ...baseCurrent(), type: 'folder' })).toBe('-')
    expect(driveBrowserKindLabel('markdown')).toBe('Markdown')
  })

  it('keeps finder actions limited to browser actions', () => {
    const folder = createSnapshot({
      current: {
        ...baseCurrent(),
        id: 'folder',
        type: 'folder',
        browserUrl: '/drive/items/folder',
        downloadUrl: '/drive/items/folder/zip',
      },
    })
    const file = createSnapshot({
      current: {
        ...baseCurrent(),
        id: 'file',
        type: 'file',
        browserUrl: '/drive/items/folder/items/file',
        downloadUrl: '/drive/items/folder/items/file/download',
      },
    })

    expect(getDriveFinderActions(folder)).toEqual({
      directoryDownloadUrl: '/drive/items/folder/zip',
      fileDownloadUrl: null,
      fileOpenUrl: null,
      visitUrl: null,
    })
    expect(getDriveFinderActions(file)).toEqual({
      directoryDownloadUrl: null,
      fileDownloadUrl: '/drive/items/folder/items/file/download',
      fileOpenUrl: '/drive/items/folder/items/file',
      visitUrl: '/drive/items/root/items/file/render',
    })
  })

  it('uses body renderer for standalone and shared files but not console files or folders', () => {
    expect(shouldRenderDriveBodyRenderer(createSnapshot({ context: 'share' }))).toBe(true)
    expect(shouldRenderDriveBodyRenderer(createSnapshot({ context: 'owner', surface: 'standalone' }))).toBe(true)
    expect(shouldRenderDriveBodyRenderer(createSnapshot({ context: 'owner', surface: 'console' }))).toBe(false)
    expect(shouldRenderDriveBodyRenderer(createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), type: 'folder' },
    }))).toBe(false)
  })

  it('returns markdown renderer options with rendered preview as default', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
      preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
    })

    const options = getDriveRendererOptions(snapshot)

    expect(options.map((option) => option.id)).toEqual(['markdown', 'source'])
    expect(selectDefaultDriveRenderer(snapshot)?.id).toBe('markdown')
  })

  it('only exposes iframe renderer for owner html files with visit urls', () => {
    const owner = createSnapshot({
      context: 'owner',
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/root/items/file/render' },
    })
    const shared = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: null },
    })

    expect(getDriveRendererOptions(owner).map((option) => option.id)).toEqual(['source', 'iframe'])
    expect(getDriveRendererOptions(shared).map((option) => option.id)).toEqual(['source'])
  })

  it('shows visit for owner html previews', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/root/items/file/render' },
    })

    expect(getDriveBrowserActions(snapshot)).toMatchObject({
      downloadUrl: '/drive/items/root/items/file/download',
      visitUrl: '/drive/items/root/items/file/render',
    })
  })

  it('does not show visit for share html previews', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        browserUrl: '/files/shr_public/items/file',
        downloadUrl: '/files/shr_public/items/file/download',
      },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: null },
    })

    expect(getDriveBrowserActions(snapshot).visitUrl).toBeNull()
  })

  it('does not show visit for owner markdown previews', () => {
    const snapshot = createSnapshot({
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    expect(getDriveBrowserActions(snapshot)).toMatchObject({
      downloadUrl: '/drive/items/root/items/file/download',
      visitUrl: null,
    })
  })

  it('does not show visit for share markdown previews', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
        browserUrl: '/files/shr_public/items/file',
        downloadUrl: '/files/shr_public/items/file/download',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    expect(getDriveBrowserActions(snapshot).visitUrl).toBeNull()
  })

  it('renders markdown html by default while keeping source hidden', () => {
    const snapshot = createSnapshot({
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    const html = renderToStaticMarkup(createElement(DriveBrowserView, { snapshot }))

    expect(html).toContain('<h1>Notes</h1>')
    expect(html).toContain('源码')
    expect(html).not.toContain('# Notes')
  })

  it('renders console folders as full-width finder without renderer chrome', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: {
        ...baseCurrent(),
        id: 'folder',
        type: 'folder',
        browserUrl: '/drive/items/folder',
        downloadUrl: '/drive/items/folder/zip',
      },
      children: [
        { ...baseCurrent(), id: 'file', name: 'notes.md', browserUrl: '/drive/items/folder/items/file' },
      ],
      preview: null,
    })

    const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'console' }))

    expect(html).toContain('data-drive-finder="full"')
    expect(html).toContain('下载整个目录')
    expect(html).toContain('notes.md')
    expect(html).not.toContain('data-drive-renderer-region="true"')
  })

  it('renders console files as split finder and renderer layout', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: {
        ...baseCurrent(),
        id: 'file',
        name: 'notes.md',
        browserUrl: '/drive/items/folder/items/file',
        downloadUrl: '/drive/items/folder/items/file/download',
        previewKind: 'markdown',
      },
      children: [
        { ...baseCurrent(), id: 'file', name: 'notes.md', browserUrl: '/drive/items/folder/items/file', previewKind: 'markdown' },
      ],
      preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
    })

    const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'console' }))

    expect(html).toContain('data-drive-finder="split"')
    expect(html).toContain('data-drive-renderer-region="true"')
    expect(html).toContain('新窗口打开')
    expect(html).toContain('切换显示')
    expect(html).toContain('<h1>Notes</h1>')
  })

  it('uses the single file reader for owner and shared files', () => {
    const sharedFile = createSnapshot({ context: 'share' })
    const sharedFolder = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), type: 'folder' },
    })
    const ownerFile = createSnapshot({ context: 'owner' })
    const ownerFolder = createSnapshot({
      context: 'owner',
      current: { ...baseCurrent(), type: 'folder' },
    })

    expect(shouldRenderDriveSingleFileReader(sharedFile)).toBe(true)
    expect(shouldRenderDriveSingleFileReader(sharedFolder)).toBe(false)
    expect(shouldRenderDriveSingleFileReader(ownerFile)).toBe(true)
    expect(shouldRenderDriveSingleFileReader(ownerFolder)).toBe(false)
  })

  it('renders owner markdown files as a reader with header metadata', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        size: '7372',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('data-reader-toolbar="true"')
    expect(html).toContain('notes.md')
    expect(html).toContain('7.2 KB')
    expect(html).toContain('Markdown')
    expect(html).toContain('href="/drive/items/root/items/file/download"')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).not.toContain('data-slot="resizable-panel-group"')
  })

  it('renders shared markdown files as a reader without browser chrome', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        size: '7372',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
        browserUrl: '/files/shr_public',
        downloadUrl: '/files/shr_public/download',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('data-reader-toolbar="true"')
    expect(html).toContain('notes.md')
    expect(html).toContain('href="/files/shr_public/download"')
    expect(html).toContain('data-renderer-toolbar="markdown"')
    expect(html).toContain('预览')
    expect(html).toContain('源码')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).not.toContain('data-slot="resizable-panel-group"')
  })

  it('uses browser toolbar layout for the file header while keeping renderer content aligned', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
        browserUrl: '/files/shr_public',
        downloadUrl: '/files/shr_public/download',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('data-reader-toolbar="true" class="flex shrink-0 flex-col gap-3 border-b bg-background px-4 py-3 md:flex-row md:items-center md:justify-between"')
    expect(html).not.toContain('data-reader-toolbar="true" class="border-b bg-background sticky top-0 z-10"')
    expect(html).toContain('min-h-0 gap-0 mx-auto w-full max-w-4xl px-4 md:px-6 py-6')
    expect(html).toContain('data-renderer-toolbar="markdown" class="shrink-0 flex justify-end pb-4"')
  })

  it('renders the resizable panel group in fixed layout mode', () => {
    const snapshot = createSnapshot()

    const html = renderToStaticMarkup(
      createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' })
    )

    expect(html).toContain('data-slot="resizable-panel-group"')
    expect(html).toContain('data-slot="resizable-handle"')
  })

  it('uses a one-third detail panel and two-thirds preview panel by default', () => {
    const snapshot = createSnapshot()

    const html = renderToStaticMarkup(
      createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' })
    )

    expect(html).toContain('flex-basis:33%')
    expect(html).toContain('flex-basis:67%')
  })

  it('keeps auto layout mode free of the resizable panel group', () => {
    const snapshot = createSnapshot()

    const html = renderToStaticMarkup(createElement(DriveBrowserView, { snapshot }))

    expect(html).not.toContain('data-slot="resizable-panel-group"')
    expect(html).not.toContain('data-slot="resizable-handle"')
  })

  it('does not render the old fixed preview heights in fixed layout mode', () => {
    const snapshot = createSnapshot({
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Notes',
        html: '<h1>Notes</h1>',
        visitUrl: null,
      },
    })

    const html = renderToStaticMarkup(
      createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' })
    )

    expect(html).not.toContain('520px')
    expect(html).not.toContain('468px')
  })

  it('keeps download actions for download-only files', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), previewKind: 'download-only' },
      preview: { ...basePreview(), kind: 'download-only', text: null },
    })

    expect(getDriveBrowserActions(snapshot).downloadUrl).toBe('/drive/items/root/items/file/download')
  })

  it('keeps owner and share child urls in the same drilldown shape', () => {
    const owner = createSnapshot({
      current: { ...baseCurrent(), id: 'root', type: 'folder', browserUrl: '/drive/items/root', downloadUrl: '/drive/items/root/zip' },
      children: [
        { ...baseCurrent(), id: 'child', browserUrl: '/drive/items/root/items/child' },
      ],
    })
    const share = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), id: 'root', type: 'folder', browserUrl: '/files/shr_public', downloadUrl: '/files/shr_public/zip' },
      children: [
        { ...baseCurrent(), id: 'child', browserUrl: '/files/shr_public/items/child' },
      ],
    })

    expect(getDriveBrowserChildUrls(owner)).toEqual(['/drive/items/root/items/child'])
    expect(getDriveBrowserChildUrls(share)).toEqual(['/files/shr_public/items/child'])
  })

  it('shows a load more action when folder children have another page', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'root', type: 'folder', browserUrl: '/drive/items/root', downloadUrl: '/drive/items/root/zip' },
      children: [
        { ...baseCurrent(), id: 'child', browserUrl: '/drive/items/root/items/child' },
      ],
      childrenPage: {
        offset: 0,
        limit: 1,
        hasMore: true,
        nextOffset: 1,
      },
    })

    const html = renderToStaticMarkup(createElement(DriveBrowserView, {
      snapshot,
      onLoadMoreChildren: () => undefined,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
    }))

    expect(html).toContain('加载更多')
  })
})

function createSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: baseCurrent(),
    breadcrumbs: [{ id: 'root', name: 'root', browserUrl: '/drive/items/root' }],
    children: [],
    preview: basePreview(),
    canDownload: true,
    canZip: false,
    ...input,
  }
}

function baseCurrent(): DriveBrowserSnapshotDto['current'] {
  return {
    id: 'file',
    name: 'index.html',
    type: 'file',
    size: '11',
    mimeType: 'text/html',
    updatedAt: '2026-06-09T00:00:00.000Z',
    previewKind: 'html-source',
    browserUrl: '/drive/items/root/items/file',
    downloadUrl: '/drive/items/root/items/file/download',
  }
}

function basePreview(): NonNullable<DriveBrowserSnapshotDto['preview']> {
  return {
    kind: 'html-source',
    text: '<html></html>',
    truncated: false,
    imageUrl: null,
    visitUrl: '/drive/items/root/items/file/render',
    html: null,
  }
}
