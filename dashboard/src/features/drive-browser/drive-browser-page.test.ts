import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import {
  DriveBrowserView,
  DriveSingleFileReaderView,
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  shouldRenderDriveSingleFileReader,
} from './drive-browser-page'

describe('drive browser view model', () => {
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

  it('uses the single file reader for shared files only', () => {
    const sharedFile = createSnapshot({ context: 'share' })
    const sharedFolder = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), type: 'folder' },
    })
    const ownerFile = createSnapshot({ context: 'owner' })

    expect(shouldRenderDriveSingleFileReader(sharedFile)).toBe(true)
    expect(shouldRenderDriveSingleFileReader(sharedFolder)).toBe(false)
    expect(shouldRenderDriveSingleFileReader(ownerFile)).toBe(false)
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
    expect(html).not.toContain('Markdown</span>')
    expect(html).not.toContain('7.2 KB')
  })

  it('renders the resizable panel group in fixed layout mode', () => {
    const snapshot = createSnapshot()

    const html = renderToStaticMarkup(
      createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' })
    )

    expect(html).toContain('data-slot="resizable-panel-group"')
    expect(html).toContain('data-slot="resizable-handle"')
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
