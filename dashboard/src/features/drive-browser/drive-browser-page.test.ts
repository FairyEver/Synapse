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
import { DriveRendererContent } from './renderers/drive-renderer-shell'
import { driveBrowserKindLabel, formatDriveBrowserSize } from './shared/drive-format'
import {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  getDriveFinderActions,
  shouldRenderDriveBodyRenderer,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'
import { getDriveFinderBreadcrumbs } from './finder/drive-finder-breadcrumbs'

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

  it('opens console files in standalone reader mode from finder actions', () => {
    const file = createSnapshot({
      surface: 'console',
      current: {
        ...baseCurrent(),
        id: 'file',
        type: 'file',
        browserUrl: '/drive/items/folder/items/file',
        downloadUrl: '/drive/items/folder/items/file/download',
      },
    })

    expect(getDriveFinderActions(file).fileOpenUrl).toBe('/drive/items/folder/items/file?surface=standalone')
  })

  it('prepends the console home breadcrumb for drive item pages', () => {
    const snapshot = createSnapshot({
      surface: 'console',
      breadcrumbs: [
        { id: 'folder', name: '文档', browserUrl: '/drive/items/folder' },
        { id: 'file', name: '记录.md', browserUrl: '/drive/items/folder/items/file' },
      ],
    })

    expect(getDriveFinderBreadcrumbs(snapshot).map((item) => item.name)).toEqual(['我的空间', '文档', '记录.md'])
    expect(getDriveFinderBreadcrumbs(snapshot)[0]?.browserUrl).toBe('/drive')
  })

  it('renames the console root breadcrumb without changing standalone pages', () => {
    const consoleRoot = createSnapshot({
      surface: 'console',
      breadcrumbs: [{ id: 'root', name: '网盘', browserUrl: '/drive' }],
    })
    const standalone = createSnapshot({
      surface: 'standalone',
      breadcrumbs: [{ id: 'folder', name: '文档', browserUrl: '/drive/items/folder' }],
    })

    expect(getDriveFinderBreadcrumbs(consoleRoot).map((item) => item.name)).toEqual(['我的空间'])
    expect(getDriveFinderBreadcrumbs(standalone).map((item) => item.name)).toEqual(['文档'])
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

  it('returns markdown preview and code renderer options with rendered preview as default', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
      preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
    })

    const options = getDriveRendererOptions(snapshot)

    expect(options.map((option) => option.id)).toEqual(['markdown', 'code'])
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

    expect(getDriveRendererOptions(owner).map((option) => option.id)).toEqual(['code', 'iframe'])
    expect(getDriveRendererOptions(shared).map((option) => option.id)).toEqual(['code'])
    expect(getDriveRendererOptions(shared)[0]?.container).toBe('full')
  })

  it('renders code previews with the shared code editor shell', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', text: '<h1>Notes</h1>' },
    })

    const html = renderToStaticMarkup(
      createElement(DriveRendererContent, {
        snapshot,
        selected: { id: 'code', label: '代码', container: 'full' },
        body: true,
      })
    )

    expect(html).toContain('data-drive-code-renderer="true"')
    expect(html).toContain('data-drive-code-language="html"')
    expect(html).not.toContain('rounded-lg')
    expect(html).not.toContain('border')
    expect(html).not.toContain('bg-card')
    expect(html).not.toContain('min-h-96')
    expect(html).toContain('class="flex h-full min-h-0 w-full flex-col overflow-hidden"')
    expect(html).not.toContain('h-svh')
    expect(html).not.toContain('min-h-svh')
  })

  it('uses a fullscreen host without reader container classes in standalone renderer mode', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'standalone',
      current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
      preview: { ...basePreview(), kind: 'markdown', text: '# Notes', html: '<h1>Notes</h1>' },
    })

    const html = renderToStaticMarkup(
      createElement(DriveSingleFileReaderView, { snapshot, initialRendererId: 'code' })
    )

    expect(html).toContain('data-drive-code-renderer="true"')
    expect(html).toContain('class="h-svh min-h-0 overflow-hidden bg-background"')
    expect(html).toContain('class="h-full min-h-0 bg-background"')
    expect(html).not.toContain('max-w-4xl')
    expect(html).not.toContain('max-w-6xl')
    expect(html).not.toContain('px-4')
    expect(html).not.toContain('md:px-6')
    expect(html).toContain('class="flex h-full min-h-0 w-full flex-col overflow-hidden"')
    expect(html).not.toContain('class="flex min-h-0 w-full flex-col overflow-hidden h-svh"')
    expect(html).not.toContain('min-h-svh')
  })

  it('keeps iframe renderers sized by the external host', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', text: '<h1>Notes</h1>', visitUrl: '/drive/render/page' },
    })

    const html = renderToStaticMarkup(
      createElement(DriveRendererContent, {
        snapshot,
        selected: { id: 'iframe', label: '网页', container: 'full' },
      })
    )

    expect(html).toContain('class="h-full min-h-0 w-full border-0 bg-background"')
    expect(html).not.toContain('h-svh')
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

  it('renders markdown html without source controls', () => {
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
    expect(html).not.toContain('源码')
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
    expect(html).toContain('新标签页打开')
    expect(html).toContain('/drive/items/folder/items/file?surface=standalone')
    expect(html).toContain('打开方式')
    expect(html).not.toContain('切换显示')
    expect(html).not.toContain('当前：')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).toContain('class="min-h-0 flex-1 overflow-hidden"')
    expect(html).not.toContain('class="min-h-0 flex-1 overflow-auto"')
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

  it('DriveBrowserView delegates folder pages to full finder layout', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder', type: 'folder', downloadUrl: '/drive/items/folder/zip' },
      preview: null,
      children: [{ ...baseCurrent(), id: 'file', name: 'notes.md' }],
    })

    const html = renderToStaticMarkup(createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' }))

    expect(html).toContain('data-drive-finder="full"')
    expect(html).toContain('下载整个目录')
    expect(html).not.toContain('data-slot="resizable-panel-group"')
  })

  it('DriveSingleFileReaderView delegates to body renderer and floating menu', () => {
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

    expect(html).toContain('文件操作')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).not.toContain('data-reader-toolbar="true"')
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

    expect(html).toContain('文件操作')
    expect(html).not.toContain('预览')
    expect(html).not.toContain('源码')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).not.toContain('data-slot="resizable-panel-group"')
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
