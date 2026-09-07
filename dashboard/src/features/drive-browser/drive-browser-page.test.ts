import { describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import {
  DriveBrowserView,
  DriveSingleFileReaderView,
} from './drive-browser-page'
import { AdminDriveStorageSummary } from './admin-drive-storage-summary'
import { AccessLogTable, AdminPublicAssets } from './admin-public-assets'
import { DriveFinder } from './finder/drive-finder'
import {
  findDriveRendererOption,
  getDriveRendererOptions,
  selectDefaultDriveRenderer,
} from './renderers/drive-renderer-registry'
import {
  clampDriveFloatingMenuPosition,
  DriveRendererContent,
  getDriveFloatingMenuDriveBrowserUrl,
  getDriveFloatingMenuNewWindowUrl,
  shouldSuppressDriveFloatingMenuOpen,
} from './renderers/drive-renderer-shell'
import {
  getDrivePreviewFileIdentity,
  getDrivePreviewSystemActions,
  getDrivePreviewSystemMenuSections,
} from './renderers/drive-preview-actions'
import { DrivePreviewFloatingMenu } from './renderers/drive-preview-floating-menu'
import { DrivePreviewHeader } from './renderers/drive-preview-header'
import { DriveRendererToolbarProvider } from './renderers/drive-renderer-toolbar-context'
import { driveBrowserKindLabel, formatDriveBrowserSize } from './shared/drive-format'
import {
  getDriveBrowserActions,
  getDriveBrowserChildUrls,
  getDriveFileVersionItemId,
  getDriveFinderActions,
  shouldRenderDriveBodyRenderer,
  shouldRenderDriveSingleFileReader,
} from './shared/drive-view-model'
import { getDriveFinderBreadcrumbs } from './finder/drive-finder-breadcrumbs'

vi.mock('@mdxeditor/editor', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    MDXEditor: React.forwardRef(({
      markdown,
      readOnly,
    }: {
      readonly markdown: string
      readonly readOnly?: boolean
    }, ref: React.Ref<{ setMarkdown: (value: string) => void }>) => {
      const [value, setValue] = React.useState(markdown)
      React.useImperativeHandle(ref, () => ({
        setMarkdown: (nextValue: string) => setValue(nextValue),
      }), [])

      return React.createElement('textarea', {
        'data-mdxeditor': 'true',
        readOnly,
        value,
      })
    }),
    BlockTypeSelect: () => null,
    BoldItalicUnderlineToggles: () => null,
    CreateLink: () => null,
    GenericJsxEditor: () => null,
    InsertTable: () => null,
    InsertThematicBreak: () => null,
    ListsToggle: () => null,
    UndoRedo: () => null,
    codeBlockPlugin: () => null,
    codeMirrorPlugin: () => null,
    diffSourcePlugin: () => null,
    headingsPlugin: () => null,
    imagePlugin: () => null,
    linkDialogPlugin: () => null,
    linkPlugin: () => null,
    listsPlugin: () => null,
    markdownShortcutPlugin: () => null,
    quotePlugin: () => null,
    realmPlugin: () => () => ({ name: 'realmPlugin' }),
    createActiveEditorSubscription$: Symbol('createActiveEditorSubscription$'),
    createRootEditorSubscription$: Symbol('createRootEditorSubscription$'),
    lexical: { LineBreakNode: class {} },
    $createGenericHTMLNode: () => null,
    $isImageNode: () => false,
    tablePlugin: () => null,
    thematicBreakPlugin: () => null,
    toolbarPlugin: () => null,
  }
})

vi.mock('./use-drive-annotations', () => ({
  useDriveAnnotations: () => ({
    threads: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    createThread: vi.fn(async () => undefined),
    creatingThread: false,
    reply: vi.fn(async () => undefined),
    replying: false,
    updateComment: vi.fn(async () => undefined),
    updatingComment: false,
    deleteComment: vi.fn(async () => undefined),
    deletingComment: false,
  }),
}))

describe('drive browser view model', () => {
  it('renders admin public asset controls without marketing copy', () => {
    const queryClient = new QueryClient()
    const assetsHtml = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: queryClient },
        createElement(AdminPublicAssets)
      )
    )
    const summaryHtml = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: queryClient },
        createElement(AdminDriveStorageSummary)
      )
    )

    expect(assetsHtml).toContain('搜索')
    expect(assetsHtml).toContain('访问')
    expect(assetsHtml).not.toContain('让您的')
    expect(summaryHtml).toContain('普通文件')
    expect(summaryHtml).toContain('公开素材')
    expect(summaryHtml).toContain('隐藏')
    const adminPublicAssetsSource = readFileSync(
      new URL('./admin-public-assets.tsx', import.meta.url),
      'utf8'
    )
    expect(adminPublicAssetsSource).toContain('访问日志')
    expect(adminPublicAssetsSource).toContain('历史版本')
  })

  it('renders admin storage totals outside lifecycle bucket columns', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['admin-drive-storage-summary'], {
      normalDrive: {
        active: { count: 1, bytes: '1024' },
        trashed: { count: 2, bytes: '2048' },
        hidden: { count: 3, bytes: '4096' },
      },
      publicAssets: {
        active: { count: 4, bytes: '8192' },
        trashed: { count: 5, bytes: '16384' },
        hidden: { count: 6, bytes: '32768' },
      },
      publicAssetRevisions: { count: 7, bytes: '65536' },
      documentImages: { count: 8, bytes: '131072' },
      total: {
        quotaBytes: '131072',
        adminVisibleBytes: '262144',
      },
    })

    const summaryHtml = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: queryClient },
        createElement(AdminDriveStorageSummary)
      )
    )

    expect(summaryHtml).toContain('配额计入')
    expect(summaryHtml).toContain('后台留存')
    expect(summaryHtml).toContain('文档图片')
    expect(summaryHtml).not.toContain('>合计<')
  })

  it('renders access log pagination controls when more pages exist', () => {
    const html = renderToStaticMarkup(
      createElement(AccessLogTable, {
        data: [],
        isLoading: false,
        page: 1,
        pageSize: 20,
        total: 41,
        onPageChange: () => undefined,
      })
    )

    expect(html).toContain('下一页')
    expect(html).toContain('1 / 3')
  })

  it('formats drive file metadata from shared helpers', () => {
    expect(formatDriveBrowserSize({ ...baseCurrent(), size: '7372' })).toBe('7.2 KB')
    expect(formatDriveBrowserSize({ ...baseCurrent(), type: 'folder' })).toBe('-')
    expect(driveBrowserKindLabel('markdown')).toBe('Markdown')
  })

  it('builds shared preview identity and system actions for owner files', () => {
    const consoleFile = createSnapshot({
      surface: 'console',
      current: {
        ...baseCurrent(),
        id: 'file',
        name: 'notes.md',
        size: '2048',
        previewKind: 'markdown',
        browserUrl: '/console/drive/items/file?surface=console',
        downloadUrl: '/drive/items/file/download',
      },
    })
    const standaloneFile = createSnapshot({
      surface: 'standalone',
      current: {
        ...baseCurrent(),
        id: 'file',
        name: 'notes.md',
        size: '2048',
        previewKind: 'markdown',
        browserUrl: '/drive/items/file?surface=standalone',
        downloadUrl: '/drive/items/file/download',
      },
    })

    expect(getDrivePreviewFileIdentity(consoleFile)).toMatchObject({
      name: 'notes.md',
      sizeLabel: '2.0 KB',
      kindLabel: 'Markdown',
    })
    expect(getDrivePreviewSystemActions(consoleFile).map((action) => action.id)).toEqual([
      'download',
      'open-new-window',
      'versions',
      'renderer-select',
    ])
    expect(getDrivePreviewSystemActions(standaloneFile).map((action) => action.id)).toEqual([
      'download',
      'open-in-drive',
      'versions',
      'renderer-select',
    ])
    expect(getDrivePreviewSystemMenuSections(standaloneFile).flatMap((section) => section.items.map((item) => item.id))).toContain('open-in-drive')
  })

  it('keeps renderer selection primary and file actions in the shared overflow menu', () => {
    const snapshot = createSnapshot({
      surface: 'standalone',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        previewKind: 'markdown',
        downloadUrl: '/drive/items/file/download',
      },
    })
    const rendererOptions = getDriveRendererOptions(snapshot)
    const headerHtml = renderToStaticMarkup(createElement(DrivePreviewHeader, {
      snapshot,
      rendererItems: [{ kind: 'status', id: 'sync', label: '已同步' }],
      rendererOptions,
      selectedRendererId: 'markdown',
      onRendererChange: vi.fn(),
      onOpenVersions: vi.fn(),
    }))
    const floatingHtml = renderToStaticMarkup(createElement(DrivePreviewFloatingMenu, {
      snapshot,
      rendererItems: [{ kind: 'status', id: 'sync', label: '已同步' }],
      rendererOptions,
      selectedRendererId: 'markdown',
      onRendererChange: vi.fn(),
      onOpenVersions: vi.fn(),
    }))

    expect(headerHtml).toContain('notes.md')
    expect(headerHtml).toContain('已同步')
    expect(headerHtml).toContain('data-drive-preview-action-separator="true"')
    expect(headerHtml).not.toContain('下载')
    expect(headerHtml).not.toContain('在云盘中查看')
    expect(headerHtml).not.toContain('历史版本')
    expect(headerHtml).toContain('打开方式')
    expect(headerHtml).toContain('aria-label="更多操作"')
    expect(headerHtml.indexOf('打开方式')).toBeLessThan(headerHtml.indexOf('aria-label="更多操作"'))
    expect(getDrivePreviewSystemMenuSections(snapshot, 'markdown')[0]?.items.map((item) => item.id)).toEqual([
      'download',
      'open-in-drive',
      'versions',
    ])
    expect(floatingHtml).toContain('文件操作')
    expect(floatingHtml).not.toContain('data-drive-preview-header')
  })

  it('renders compact login status in shared preview headers', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        browserUrl: '/share/share-1',
      },
    })
    const rendererOptions = getDriveRendererOptions(snapshot)

    const headerHtml = renderToStaticMarkup(createElement(DrivePreviewHeader, {
      snapshot,
      rendererItems: [],
      rendererOptions,
      selectedRendererId: 'html-source',
      onRendererChange: vi.fn(),
      onOpenVersions: vi.fn(),
    }))

    expect(headerHtml).toContain('登录')
    expect(headerHtml).toContain('/console/sign-in?redirect=%2Fshare%2Fshare-1')
    expect(headerHtml).toContain('data-drive-preview-viewer-separator="true"')
    expect(headerHtml.indexOf('打开方式')).toBeLessThan(headerHtml.indexOf('登录'))
  })

  it('keeps finder actions limited to browser actions', () => {
    const folder = createSnapshot({
      current: {
        ...baseCurrent(),
        id: 'folder',
        type: 'folder',
        browserUrl: '/drive/items/folder',
        downloadUrl: '/drive/items/folder/download',
      },
    })
    const file = createSnapshot({
      current: {
        ...baseCurrent(),
        id: 'file',
        type: 'file',
        browserUrl: '/drive/items/file',
        downloadUrl: '/drive/items/file/download',
      },
    })

    expect(getDriveFinderActions(folder)).toEqual({
      directoryDownloadUrl: '/drive/items/folder/download',
      fileDownloadUrl: null,
      fileOpenUrl: null,
      fileVersionItemId: null,
      visitUrl: null,
    })
    expect(getDriveFinderActions(file)).toEqual({
      directoryDownloadUrl: null,
      fileDownloadUrl: '/drive/items/file/download',
      fileOpenUrl: '/drive/items/file',
      fileVersionItemId: 'file',
      visitUrl: '/drive/items/file/render',
    })
  })

  it('only exposes file version management for owner files', () => {
    expect(getDriveFileVersionItemId(createSnapshot({ context: 'owner' }))).toBe('file')
    expect(getDriveFileVersionItemId(createSnapshot({ context: 'share' }))).toBeNull()
    expect(getDriveFileVersionItemId(createSnapshot({
      context: 'owner',
      current: { ...baseCurrent(), type: 'folder' },
    }))).toBeNull()
  })

  it('opens console files in standalone reader mode from finder actions', () => {
    const file = createSnapshot({
      surface: 'console',
      current: {
        ...baseCurrent(),
        id: 'file',
        type: 'file',
        browserUrl: '/drive/items/file',
        downloadUrl: '/drive/items/file/download',
      },
    })

    expect(getDriveFinderActions(file).fileOpenUrl).toBe('/drive/items/file?surface=standalone')
  })

  it('describes empty folder children without sibling wording', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder', type: 'folder' },
      children: [],
    })

    const html = renderToStaticMarkup(createElement(DriveBrowserView, { snapshot }))

    expect(html).toContain('暂无文件')
    expect(html).not.toContain('暂无同级文件')
  })

  it('prepends the console home breadcrumb for drive item pages', () => {
    const snapshot = createSnapshot({
      surface: 'console',
      breadcrumbs: [
        { id: 'folder', name: '文档', browserUrl: '/console/drive/folders/folder' },
        { id: 'file', name: '记录.md', browserUrl: '/drive/items/file' },
      ],
    })

    expect(getDriveFinderBreadcrumbs(snapshot).map((item) => item.name)).toEqual(['我的空间', '文档', '记录.md'])
    expect(getDriveFinderBreadcrumbs(snapshot)[0]?.browserUrl).toBe('/console/drive')
  })

  it('renames the console root breadcrumb without changing standalone pages', () => {
    const consoleRoot = createSnapshot({
      surface: 'console',
      breadcrumbs: [{ id: 'root', name: '网盘', browserUrl: '/console/drive' }],
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

  it('returns markdown preview, MDXeditor, and code renderer options with preview as default', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.md', previewKind: 'markdown' },
      preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
    })

    const options = getDriveRendererOptions(snapshot)

    expect(options.map((option) => option.id)).toEqual(['markdown', 'mdxeditor', 'code'])
    expect(options.map((option) => option.label)).toEqual(['预览', 'MDXeditor', '代码'])
    expect(selectDefaultDriveRenderer(snapshot)?.id).toBe('markdown')
  })

  it('does not offer MDXeditor for non-markdown previews', () => {
    const text = createSnapshot({
      current: { ...baseCurrent(), name: 'notes.txt', previewKind: 'text' },
      preview: { ...basePreview(), kind: 'text', text: 'plain text' },
    })
    const image = createSnapshot({
      current: { ...baseCurrent(), name: 'image.png', previewKind: 'image' },
      preview: { ...basePreview(), kind: 'image', imageUrl: '/drive/items/file/download' },
    })

    expect(getDriveRendererOptions(text).map((option) => option.id)).toEqual(['code'])
    expect(getDriveRendererOptions(image).map((option) => option.id)).toEqual(['image'])
  })

  it('allows MDXeditor for markdown above the former rich-text size limit', () => {
    const snapshot = createSnapshot({
      current: {
        ...baseCurrent(),
        name: 'large.md',
        size: String(100 * 1024),
        mimeType: 'text/markdown',
        previewKind: 'markdown',
      },
      preview: {
        ...basePreview(),
        kind: 'markdown',
        text: '# Large\n\n'.repeat(8 * 1024),
        html: '<h1>Large</h1>',
        visitUrl: null,
      },
    })

    const options = getDriveRendererOptions(snapshot)
    const mdxeditor = options.find((option) => option.id === 'mdxeditor')

    expect(options.map((option) => option.id)).toEqual(['markdown', 'mdxeditor', 'code'])
    expect(mdxeditor?.disabledReason).toBeUndefined()
    expect(findDriveRendererOption(snapshot, 'mdxeditor')?.id).toBe('mdxeditor')

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, {
      snapshot,
      initialRendererId: 'mdxeditor',
    }))

    expect(html).toContain('data-mdxeditor="true"')
  })

  it('uses iframe as the default renderer for html files with visit urls', () => {
    const owner = createSnapshot({
      context: 'owner',
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/file/render' },
    })
    const shared = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/share/shr_public/items/file/render' },
    })

    expect(getDriveRendererOptions(owner).map((option) => option.id)).toEqual(['iframe', 'code'])
    expect(getDriveRendererOptions(shared).map((option) => option.id)).toEqual(['iframe', 'code'])
    expect(selectDefaultDriveRenderer(owner)?.id).toBe('iframe')
    expect(selectDefaultDriveRenderer(shared)?.id).toBe('iframe')
  })

  it('renders code previews with the shared code editor shell', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', text: '<h1>Notes</h1>' },
    })

    const html = renderDriveRendererContent({
      snapshot,
      selected: { id: 'code', label: '代码', container: 'full' },
      body: true,
    })

    expect(html).toContain('data-drive-code-renderer="true"')
    expect(html).toContain('data-drive-code-language="html"')
    expect(html).not.toContain('只读')
    expect(html).not.toContain('rounded-lg')
    expect(html).not.toContain('border')
    expect(html).not.toContain('bg-card')
    expect(html).not.toContain('min-h-96')
    expect(html).toContain('class="flex h-full min-h-0 w-full flex-col overflow-hidden"')
    expect(html).not.toContain('h-svh')
    expect(html).not.toContain('min-h-svh')
  })

  it('renders shared read-only code previews through the shared renderer shell', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), browserUrl: '/share/shr_public' },
      edit: { canEdit: false, reason: 'login_required', currentVersionId: null },
    })

    const html = renderDriveRendererContent({
      snapshot,
      selected: { id: 'code', label: '代码', container: 'full' },
      body: true,
    })

    expect(html).toContain('data-drive-code-renderer="true"')
    expect(html).not.toContain('data-drive-preview-header="true"')
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
    expect(html).toContain('class="h-screen supports-[height:100svh]:h-svh min-h-0 overflow-hidden bg-background"')
    expect(html).toContain('data-file-preview-layout="regular"')
    expect(html).toContain('class="min-w-0 flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"')
    expect(html).toContain('data-drive-preview-header="true"')
    expect(html).not.toContain('max-w-4xl')
    expect(html).not.toContain('max-w-6xl')
    expect(html).not.toContain('class="mx-auto w-full max-w-4xl px-4 md:px-6"')
    expect(html).not.toContain('class="mx-auto w-full max-w-6xl px-4 md:px-6"')
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

    const html = renderDriveRendererContent({
      snapshot,
      selected: { id: 'iframe', label: '网页', container: 'full' },
    })

    expect(html).toContain('class="h-full min-h-0 w-full border-0 bg-background"')
    expect(html).toContain('allow="clipboard-write *"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock"')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).not.toContain('h-svh')
  })

  it('shows visit for owner html previews', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/file/render' },
    })

    expect(getDriveBrowserActions(snapshot)).toMatchObject({
      downloadUrl: '/drive/items/file/download',
      visitUrl: '/drive/items/file/render',
    })
  })

  it('shows visit for share html previews', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        browserUrl: '/share/shr_public/items/file',
        downloadUrl: '/share/shr_public/items/file/download',
      },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/share/shr_public/items/file/render' },
    })

    expect(getDriveBrowserActions(snapshot).visitUrl).toBe('/share/shr_public/items/file/render')
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
      downloadUrl: '/drive/items/file/download',
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
        browserUrl: '/share/shr_public/items/file',
        downloadUrl: '/share/shr_public/items/file/download',
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

    const html = renderToStaticMarkup(
      createElement(DriveSingleFileReaderView, { snapshot, initialRendererId: 'markdown' })
    )

    expect(html).toContain('<h1>Notes</h1>')
    expect(html).toContain('max-w-3xl')
    expect(html).not.toContain('源码')
    expect(html).not.toContain('# Notes')
    expect(html).not.toContain('data-drive-finder="split"')
    expect(html).not.toContain('data-drive-renderer-region="true"')
    expect(html).not.toContain('暂无同级文件')
  })

  it('uses markdown preview for markdown files when no initial renderer is provided', () => {
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

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('data-testid="markdown-body"')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).not.toContain('data-mdxeditor="true"')
    expect(html).not.toContain('data-drive-code-renderer="true"')
  })

  it('renders MDXeditor content without falling back to code renderer', () => {
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

    const html = renderDriveRendererContent({
      snapshot,
      selected: { id: 'mdxeditor', label: 'MDXeditor', container: 'full' },
      body: true,
    })

    expect(html).toContain('data-mdxeditor="true"')
    expect(html).not.toContain('data-drive-code-renderer="true"')
  })

  it('renders markdown outline links when preview contains headings', () => {
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
        text: '# Notes\n\n## Details',
        html: '<h1 id="notes">Notes</h1><h2 id="details">Details</h2>',
        outline: [
          {
            id: 'notes',
            text: 'Notes',
            depth: 1,
            children: [
              {
                id: 'details',
                text: 'Details',
                depth: 2,
                children: [],
              },
            ],
          },
        ],
        visitUrl: null,
      },
    })

    const html = renderToStaticMarkup(
      createElement(DriveSingleFileReaderView, { snapshot, initialRendererId: 'markdown' })
    )

    expect(html).toContain('aria-label="目录"')
    expect(html).toContain('class="h-full overflow-hidden px-4 py-6 md:px-6"')
    expect(html).toContain('max-h-[calc(100vh-3rem)] overflow-auto')
    expect(html).not.toContain('overflow-auto border-l')
    expect(html).toContain('href="#notes"')
    expect(html).toContain('href="#details"')
    expect(html).toContain('<h1 id="notes">Notes</h1>')
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
        downloadUrl: '/drive/items/folder/download',
      },
      children: [
        { ...baseCurrent(), id: 'file', name: 'notes.md', browserUrl: '/drive/items/file' },
      ],
      preview: null,
    })

    const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'console' }))

    expect(html).toContain('data-drive-finder="full"')
    expect(html).toContain('下载整个目录')
    expect(html).toContain('notes.md')
    expect(html).not.toContain('data-drive-renderer-region="true"')
  })

  it('renders compact login status in shared finder toolbars', () => {
    const snapshot = createSnapshot({
      context: 'share',
      current: {
        ...baseCurrent(),
        id: 'folder',
        type: 'folder',
        browserUrl: '/share/share-1',
      },
      preview: null,
    })

    const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'share' }))

    expect(html).toContain('登录')
    expect(html).toContain('/console/sign-in?redirect=%2Fshare%2Fshare-1')
  })

  it('renders console files as a full renderer layout without sibling list', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: {
        ...baseCurrent(),
        id: 'file',
        name: 'notes.md',
        browserUrl: '/console/drive/items/file?surface=console',
        downloadUrl: '/drive/items/file/download',
        previewKind: 'markdown',
      },
      children: [
        {
          ...baseCurrent(),
          id: 'file',
          name: 'notes.md',
          browserUrl: '/console/drive/items/file?surface=console',
          previewKind: 'markdown',
        },
      ],
      preview: { ...basePreview(), kind: 'markdown', html: '<h1>Notes</h1>', text: '# Notes' },
    })

    const html = renderToStaticMarkup(createElement(DriveFinder, { snapshot, mode: 'console' }))

    expect(html).toContain('data-drive-finder="file"')
    expect(html).toContain('data-drive-renderer-region="true"')
    expect(html).toContain('data-drive-preview-header="true"')
    expect(html).toContain('aria-label="更多操作"')
    expect(html).toContain('打开方式')
    expect(html).not.toContain('data-drive-finder="split"')
    expect(html).not.toContain('data-slot="table"')
    expect(html).not.toContain('<th')
    expect(html).not.toContain('文件操作')
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
      current: { ...baseCurrent(), id: 'folder', type: 'folder', downloadUrl: '/drive/items/folder/download' },
      preview: null,
      children: [{ ...baseCurrent(), id: 'file', name: 'notes.md' }],
    })

    const html = renderToStaticMarkup(createElement(DriveBrowserView, { snapshot, layoutMode: 'fixed' }))

    expect(html).toContain('data-drive-finder="full"')
    expect(html).toContain('下载整个目录')
    expect(html).not.toContain('data-slot="resizable-panel-group"')
  })

  it('DriveSingleFileReaderView delegates markdown files to the shared preview header', () => {
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

    const html = renderToStaticMarkup(
      createElement(DriveSingleFileReaderView, { snapshot, initialRendererId: 'markdown' })
    )

    expect(html).toContain('data-drive-preview-header="true"')
    expect(html).not.toContain('文件操作')
    expect(html).not.toContain('在云盘中查看')
    expect(html).toContain('aria-label="更多操作"')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).toContain('max-w-3xl')
    expect(html).not.toContain('data-reader-toolbar="true"')
  })

  it('uses floating chrome for iframe html previews', () => {
    const snapshot = createSnapshot({
      surface: 'standalone',
      current: { ...baseCurrent(), name: 'page.html', previewKind: 'html-source' },
      preview: { ...basePreview(), kind: 'html-source', visitUrl: '/drive/items/file/render' },
    })

    const html = renderToStaticMarkup(createElement(DriveSingleFileReaderView, { snapshot }))

    expect(html).toContain('文件操作')
    expect(html).not.toContain('data-drive-preview-header="true"')
  })

  it('does not offer opening a standalone file reader in another new window', () => {
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'standalone',
      preview: {
        ...basePreview(),
        visitUrl: '/drive/items/root/items/file/render',
      },
    })

    expect(getDriveFloatingMenuNewWindowUrl(snapshot)).toBeNull()
  })

  it('links standalone owner files back to their console drive location', () => {
    const owner = createSnapshot({
      context: 'owner',
      surface: 'standalone',
      current: {
        ...baseCurrent(),
        id: 'file/a',
        type: 'file',
        browserUrl: '/drive/items/file%2Fa',
      },
    })
    const shared = createSnapshot({ context: 'share' })

    expect(getDriveFloatingMenuDriveBrowserUrl(owner)).toBe('/console/drive/items/file%2Fa?surface=console')
    expect(getDriveFloatingMenuDriveBrowserUrl(shared)).toBeNull()
  })

  it('clamps the floating file menu inside the viewport', () => {
    expect(clampDriveFloatingMenuPosition(
      { left: -50, top: -10 },
      { width: 320, height: 240 },
      { width: 36, height: 36 }
    )).toEqual({ left: 20, top: 20 })

    expect(clampDriveFloatingMenuPosition(
      { left: 400, top: 300 },
      { width: 320, height: 240 },
      { width: 36, height: 36 }
    )).toEqual({ left: 264, top: 184 })
  })

  it('suppresses menu opening only after a real floating menu drag', () => {
    expect(shouldSuppressDriveFloatingMenuOpen({ left: 20, top: 20 }, { left: 22, top: 23 })).toBe(false)
    expect(shouldSuppressDriveFloatingMenuOpen({ left: 20, top: 20 }, { left: 25, top: 20 })).toBe(true)
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
        browserUrl: '/share/shr_public',
        downloadUrl: '/share/shr_public/download',
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
      createElement(DriveSingleFileReaderView, { snapshot, initialRendererId: 'markdown' })
    )

    expect(html).toContain('data-drive-preview-header="true"')
    expect(html).not.toContain('文件操作')
    expect(html).not.toContain('在云盘中查看')
    expect(html).not.toContain('预览')
    expect(html).not.toContain('源码')
    expect(html).toContain('<h1>Notes</h1>')
    expect(html).toContain('data-testid="markdown-layout"')
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

    expect(getDriveBrowserActions(snapshot).downloadUrl).toBe('/drive/items/file/download')
  })

  it('keeps owner and share child urls in their canonical shapes', () => {
    const owner = createSnapshot({
      current: { ...baseCurrent(), id: 'root', type: 'folder', browserUrl: '/drive/items/root', downloadUrl: '/drive/items/root/download' },
      children: [
        { ...baseCurrent(), id: 'child', browserUrl: '/drive/items/child' },
      ],
    })
    const share = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), id: 'root', type: 'folder', browserUrl: '/share/shr_public', downloadUrl: '/share/shr_public/download' },
      children: [
        { ...baseCurrent(), id: 'child', browserUrl: '/share/shr_public/items/child' },
      ],
    })

    expect(getDriveBrowserChildUrls(owner)).toEqual(['/drive/items/child'])
    expect(getDriveBrowserChildUrls(share)).toEqual(['/share/shr_public/items/child'])
  })

  it('shows a load more action when folder children have another page', () => {
    const snapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'root', type: 'folder', browserUrl: '/drive/items/root', downloadUrl: '/drive/items/root/download' },
      children: [
        { ...baseCurrent(), id: 'child', browserUrl: '/drive/items/child' },
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

function renderDriveRendererContent(props: ComponentProps<typeof DriveRendererContent>): string {
  return renderToStaticMarkup(
    createElement(
      DriveRendererToolbarProvider,
      null,
      createElement(DriveRendererContent, props),
    ),
  )
}

function createSnapshot(input: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: baseCurrent(),
    breadcrumbs: [{ id: 'root', name: 'root', browserUrl: '/drive/items/root' }],
    children: [],
    preview: basePreview(),
    edit: null,
    annotation: null,
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
    browserUrl: '/drive/items/file',
    downloadUrl: '/drive/items/file/download',
  }
}

function basePreview(): NonNullable<DriveBrowserSnapshotDto['preview']> {
  return {
    kind: 'html-source',
    text: '<html></html>',
    truncated: false,
    imageUrl: null,
    visitUrl: '/drive/items/file/render',
    html: null,
    outline: null,
  }
}
