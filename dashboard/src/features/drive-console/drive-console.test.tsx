// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { DriveBrowserSnapshotDto, DrivePublicAssetDto, DrivePublicAssetListPageDto, DriveUsageDto } from '@synapse/shared'
import { SidebarProvider } from '@/components/ui/sidebar'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { useDriveBrowser } from '@/features/drive-browser/use-drive-browser'
import { driveApi } from '@/lib/api'
import { DriveConsoleItemPage, DriveConsolePage } from './drive-console-page'
import { uploadDriveFiles } from './drive-upload'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/features/drive-browser/use-drive-browser', () => ({
  useDriveBrowser: vi.fn(),
}))

vi.mock('@/features/drive-browser/renderers/drive-renderer-shell', () => ({
  DriveRendererShell: vi.fn(({ annotationContext, snapshot }) => (
    <div data-testid='drive-renderer-shell' data-annotation-context={JSON.stringify(annotationContext ?? null)}>
      {snapshot.current.name}
    </div>
  )),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    driveApi: {
      ...actual.driveApi,
      getUsage: vi.fn(),
      createFolder: vi.fn(),
      renameItem: vi.fn(),
      moveItem: vi.fn(),
      listTree: vi.fn(),
      deleteItem: vi.fn(),
      createShare: vi.fn(),
      listShares: vi.fn(),
      disableShare: vi.fn(),
      listPublicAssets: vi.fn(),
      listTrash: vi.fn(),
      preflightSite: vi.fn(),
      createSite: vi.fn(),
      listSites: vi.fn(),
      updateSiteAccess: vi.fn(),
      disableSite: vi.fn(),
      enableSite: vi.fn(),
      republishSite: vi.fn(),
      deleteSite: vi.fn(),
    },
  }
})

vi.mock('./drive-upload', () => ({
  uploadDriveFiles: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: vi.fn(),
}))

let root: Root | null = null
let host: HTMLDivElement | null = null
let queryClient: QueryClient | null = null

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  queryClient?.clear()
  queryClient = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveConsolePage', () => {
  it('renders cloud management toolbar without sync', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsolePage />)

    expect(document.body.textContent).toContain('上传文件')
    expect(document.body.textContent).toContain('上传文件夹')
    expect(document.body.textContent).toContain('新建文件夹')
    expect(document.body.textContent).toContain('我的分享')
    expect(document.body.textContent).toContain('站点')
    expect(document.body.textContent).toContain('刷新')
    expect(document.body.textContent).toContain('公开素材')
    expect(document.body.textContent).toContain('回收站')
    expect(document.body.textContent).not.toContain('同步')
  })

  it('uses existing single file reader for file item routes', async () => {
    mockReadySnapshot(fileSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsoleItemPage itemId='file-1' surface='console' />)

    expect(document.body.textContent).toContain('notes.md')
    expect(document.body.textContent).not.toContain('公开素材')
  })

  it('passes owner annotation context to console file readers', async () => {
    mockReadySnapshot(fileSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsoleItemPage itemId='file-1' surface='console' />)

    expect(document.querySelector('[data-testid="drive-renderer-shell"]')?.getAttribute('data-annotation-context'))
      .toBe(JSON.stringify({ context: 'owner', itemId: 'file-1' }))
  })

  it('renders console file readers as embedded full-bleed content', async () => {
    mockReadySnapshot(fileSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsoleItemPage itemId='file-1' surface='console' />)

    const main = document.querySelector('main')
    const reader = main?.firstElementChild

    expect(main?.className).toContain('p-0')
    expect(main?.className).not.toContain('px-4')
    expect(reader?.className).toContain('h-full')
    expect(reader?.className).not.toContain('h-svh')
  })

  it('uses injected client navigation for file rows and preview actions', async () => {
    const onNavigate = vi.fn()
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsolePage onNavigate={onNavigate} />)

    await click(rowWithText('文档'))
    expect(onNavigate).toHaveBeenCalledWith('/console/drive/folders/folder-1')

    await click(button('预览'))
    expect(onNavigate).toHaveBeenCalledWith('/console/drive/folders/folder-1')
  })

  it('creates folders in the root folder and refreshes', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.createFolder).mockResolvedValue({} as never)
    await render(<DriveConsolePage />)

    await click(button('新建文件夹'))
    await input('文件夹名称', '资料')
    await click(button('新建'))

    expect(driveApi.createFolder).toHaveBeenCalledWith({ parentId: null, name: '资料' })
    expect(reload).toHaveBeenCalled()
  })

  it('keeps the folder dialog open and shows feedback when creating a folder fails', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.createFolder).mockRejectedValue(new Error('创建失败'))
    await render(<DriveConsolePage />)

    await click(button('新建文件夹'))
    await input('文件夹名称', '资料')
    await click(button('新建'))
    await act(async () => undefined)

    expect(toast).toHaveBeenCalledWith('创建失败')
    expect(reload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('新建文件夹')
  })

  it('creates folders in the current non-root folder and refreshes', async () => {
    const snapshot = nestedFolderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.createFolder).mockResolvedValue({} as never)
    await render(<DriveConsoleItemPage itemId='folder-1' surface='console' />)

    await click(button('新建文件夹'))
    await input('文件夹名称', '资料')
    await click(button('新建'))

    expect(driveApi.createFolder).toHaveBeenCalledWith({ parentId: 'folder-1', name: '资料' })
    expect(reload).toHaveBeenCalled()
  })

  it('does not render sync in row actions', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())

    await render(<DriveConsolePage />)

    await openMoreActions()
    expect(document.body.textContent).toContain('重命名')
    expect(document.body.textContent).not.toContain('同步')
  })

  it('uploads selected files to the current folder and refreshes', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(uploadDriveFiles).mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
    await render(<DriveConsolePage />)

    const fileInput = document.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('missing file input')
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(uploadDriveFiles).toHaveBeenCalledWith({ parentId: null, files: [file] })
    expect(reload).toHaveBeenCalled()
  })

  it('uploads selected folders to the current folder and refreshes', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(uploadDriveFiles).mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
    await render(<DriveConsolePage />)

    const inputs = document.querySelectorAll('input[type="file"]')
    const folderInput = inputs.item(1)
    if (!(folderInput instanceof HTMLInputElement)) throw new Error('missing folder input')
    expect(folderInput.hasAttribute('webkitdirectory')).toBe(true)
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Project/notes.md' })
    Object.defineProperty(folderInput, 'files', { value: [file], configurable: true })
    await act(async () => {
      folderInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(uploadDriveFiles).toHaveBeenCalledWith({ parentId: null, files: [file] })
    expect(reload).toHaveBeenCalled()
  })

  it('passes dropped loose files to upload helper', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(uploadDriveFiles).mockResolvedValue({ completed: 1, failed: 0, skipped: 0 })
    await render(<DriveConsolePage />)

    const dropzone = document.querySelector('[data-testid="drive-console-dropzone"]')
    if (!(dropzone instanceof HTMLElement)) throw new Error('missing dropzone')
    const file = new File(['hello'], 'drop.md')
    const event = new Event('drop', { bubbles: true }) as DragEvent
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [file], items: [], types: ['Files'], dropEffect: 'copy' },
    })
    await act(async () => {
      dropzone.dispatchEvent(event)
    })

    expect(uploadDriveFiles).toHaveBeenCalledWith({ parentId: null, files: [file] })
  })

  it('shares a row with default web settings and refreshes', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.createShare).mockResolvedValue({} as never)
    await render(<DriveConsolePage />)

    await click(button('分享'))
    await click(button('创建分享'))

    expect(driveApi.createShare).toHaveBeenCalledWith('folder-1', {
      passwordEnabled: true,
      expiresIn: '3d',
      accessMode: 'link_read',
      editorEmails: [],
    })
    expect(reload).toHaveBeenCalled()
  })

  it('moves a row into a selected folder target', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listTree).mockResolvedValue({
      items: [treeFolder({ id: 'target-1', name: '目标', path: '目标' })],
      total: 1,
      fileCount: 0,
      folderCount: 1,
      hasMore: false,
      nextOffset: null,
    })
    vi.mocked(driveApi.moveItem).mockResolvedValue({} as never)
    await render(<DriveConsolePage />)

    await openMoreActions()
    await click(menuItem('移动'))
    await act(async () => undefined)
    await click(button('目标'))
    await click(lastButton('移动'))

    expect(driveApi.listTree).toHaveBeenCalledWith({ parentId: null, offset: 0, limit: 200 })
    expect(driveApi.moveItem).toHaveBeenCalledWith('folder-1', 'target-1')
    expect(reload).toHaveBeenCalled()
  })

  it('loads more move targets before moving a row', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listTree)
      .mockResolvedValueOnce(treePage([treeFolder({ id: 'target-1', name: '第一页目标', path: '第一页目标' })], {
        hasMore: true,
        nextOffset: 200,
        total: 201,
      }))
      .mockResolvedValueOnce(treePage([treeFolder({ id: 'target-201', name: '后续目标', path: '后续目标' })], {
        hasMore: false,
        nextOffset: null,
        total: 201,
      }))
    vi.mocked(driveApi.moveItem).mockResolvedValue({} as never)
    await render(<DriveConsolePage />)

    await openMoreActions()
    await click(menuItem('移动'))
    await act(async () => undefined)
    await click(button('加载更多'))
    await act(async () => undefined)
    await click(button('后续目标'))
    await click(lastButton('移动'))

    expect(driveApi.listTree).toHaveBeenNthCalledWith(1, { parentId: null, offset: 0, limit: 200 })
    expect(driveApi.listTree).toHaveBeenNthCalledWith(2, { parentId: null, offset: 200, limit: 200 })
    expect(driveApi.moveItem).toHaveBeenCalledWith('folder-1', 'target-201')
    expect(reload).toHaveBeenCalled()
  })

  it('opens my shares from the toolbar', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listShares).mockResolvedValue({
      items: [{
        id: 'share-db-id',
        shareId: 'shr_1',
        itemId: 'item-1',
        itemName: 'notes.md',
        itemType: 'file',
        sourceDeleted: false,
        url: 'https://example.com/share/shr_1',
        urlWithPassword: 'https://example.com/share/shr_1?p=abc',
        passwordEnabled: true,
        password: 'abc',
        expiresAt: null,
        accessMode: 'link_read',
        editorEmails: [],
        createdAt: '2026-06-29T00:00:00.000Z',
      }],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    await render(<DriveConsolePage />)

    await click(button('我的分享'))
    await act(async () => undefined)

    expect(driveApi.listShares).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain('notes.md')
  })

  it('opens the root public assets subview', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [],
      total: 0,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    await render(<DriveConsolePage />)

    await click(tabTrigger('公开素材'))
    await act(async () => undefined)
    expect(driveApi.listPublicAssets).toHaveBeenCalledWith({ offset: 0, limit: 50 })
  })

  it('loads more public assets from the next page', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listPublicAssets)
      .mockResolvedValueOnce(publicAssetPage(
        [publicAsset({ assetId: 'asset_first', name: 'first.png' })],
        { hasMore: true, nextOffset: 50, total: 51 },
      ))
      .mockResolvedValueOnce(publicAssetPage(
        [publicAsset({ assetId: 'asset_second', name: 'second.png' })],
        { offset: 50, hasMore: false, nextOffset: null, total: 51 },
      ))
    await render(<DriveConsolePage />)

    await click(tabTrigger('公开素材'))
    await act(async () => undefined)
    expect(document.body.textContent).toContain('first.png')
    expect(document.body.textContent).not.toContain('second.png')

    await click(button('加载更多'))

    expect(driveApi.listPublicAssets).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    expect(document.body.textContent).toContain('first.png')
    expect(document.body.textContent).toContain('second.png')
  })

  it('returns from root system subviews to files', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listPublicAssets).mockResolvedValue({
      items: [],
      total: 0,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    await render(<DriveConsolePage />)

    await click(tabTrigger('公开素材'))
    await act(async () => undefined)
    expect(document.body.textContent).toContain('暂无公开素材')

    await click(button('文件'))

    expect(document.body.textContent).toContain('文档')
  })

  it('opens the root trash subview', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listTrash).mockResolvedValue({
      items: [],
      total: 0,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    await render(<DriveConsolePage />)

    await click(tabTrigger('回收站'))
    await act(async () => undefined)
    expect(driveApi.listTrash).toHaveBeenCalledWith({ offset: 0, limit: 50 })
  })

  it('opens site management from the toolbar', async () => {
    mockReadySnapshot(folderSnapshot())
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.listSites).mockResolvedValue({
      items: [{ id: 'db-1', siteId: 'site-1', name: 'Docs', status: 'active', accessMode: 'public', url: '/sites/site-1', urlWithPassword: '/sites/site-1', passwordEnabled: false, password: null, expiresAt: null, sourceFolderItemId: 'folder-1', sourceFolderName: '文档', entryPath: 'index.html', fileCount: 1, totalBytes: '10', createdAt: '2026-06-29T00:00:00.000Z', updatedAt: '2026-06-29T00:00:00.000Z', lastPublishedAt: '2026-06-29T00:00:00.000Z' }],
      total: 1,
      page: { offset: 0, limit: 50, hasMore: false, nextOffset: null },
    })
    await render(<DriveConsolePage />)

    await click(button('站点'))
    await act(async () => undefined)

    expect(driveApi.listSites).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    expect(document.body.textContent).toContain('Docs')
  })

  it('publishes a folder row as a site', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.preflightSite).mockResolvedValue({
      sourceFolderItemId: 'folder-1',
      sourceFolderName: '文档',
      htmlFiles: ['index.html'],
      defaultEntryPath: 'index.html',
      fileCount: 1,
      totalBytes: '10',
      includesJavaScript: false,
    })
    vi.mocked(driveApi.createSite).mockResolvedValue({} as never)
    await render(<DriveConsolePage />)

    await openMoreActions()
    await click(menuItem('发布站点'))
    await act(async () => undefined)
    await click(button('发布'))

    expect(driveApi.createSite).toHaveBeenCalledWith({
      sourceFolderItemId: 'folder-1',
      name: '文档',
      entryPath: 'index.html',
      accessMode: 'public',
      expiresIn: 'forever',
    })
    expect(reload).toHaveBeenCalled()
  })

  it('confirms before deleting a row', async () => {
    const snapshot = folderSnapshot()
    const reload = vi.fn(async () => snapshot)
    vi.mocked(useDriveBrowser).mockReturnValue({
      status: 'ready',
      snapshot,
      loadingMoreChildren: false,
      loadMoreChildrenError: null,
      reload,
      reloading: false,
      saveText: vi.fn(),
      savingText: false,
    })
    vi.mocked(driveApi.getUsage).mockResolvedValue(usage())
    vi.mocked(driveApi.deleteItem).mockResolvedValue({ ok: true })
    await render(<DriveConsolePage />)

    await click(button('删除'))

    expect(driveApi.deleteItem).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除文档')

    await click(lastButton('删除'))

    expect(driveApi.deleteItem).toHaveBeenCalledWith('folder-1')
    expect(reload).toHaveBeenCalled()
  })
})

function mockReadySnapshot(snapshot: DriveBrowserSnapshotDto) {
  vi.mocked(useDriveBrowser).mockReturnValue({
    status: 'ready',
    snapshot,
    loadingMoreChildren: false,
    loadMoreChildrenError: null,
    reload: vi.fn(async () => snapshot),
    reloading: false,
    saveText: vi.fn(),
    savingText: false,
  })
}

async function render(element: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <DirectionProvider>
          <LayoutProvider>
            <SidebarProvider>{element}</SidebarProvider>
          </LayoutProvider>
        </DirectionProvider>
      </QueryClientProvider>
    )
  })
}

async function click(element: HTMLElement | null) {
  if (!element) throw new Error('missing element')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    element.click()
    await Promise.resolve()
  })
}

function button(text: string) {
  const buttons = Array.from(document.querySelectorAll('button'))
  return buttons.find((item) => item.textContent?.trim() === text)
    ?? buttons.find((item) => item.textContent?.includes(text))
    ?? null
}

function lastButton(text: string) {
  const buttons = Array.from(document.querySelectorAll('button')).filter((item) => item.textContent?.trim() === text)
  return buttons.at(-1) ?? null
}

function tabTrigger(text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-slot="tabs-trigger"]'))
    .find((item) => item.textContent?.trim() === text)
    ?? null
}

function rowWithText(text: string) {
  return Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
    .find((row) => row.textContent?.includes(text))
    ?? null
}

async function openMoreActions() {
  const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label$="更多操作"]')).at(0) ?? null
  await click(trigger)
}

function menuItem(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.trim() === text)
    ?? null
}

async function input(labelText: string, value: string) {
  const label = Array.from(document.querySelectorAll('label')).find((item) => item.textContent?.includes(labelText))
  const id = label?.getAttribute('for')
  const field = id ? document.getElementById(id) : null
  if (!(field instanceof HTMLInputElement)) throw new Error(`missing input ${labelText}`)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function usage(): DriveUsageDto {
  return {
    usedBytes: '1048576',
    reservedBytes: '0',
    quotaBytes: '5368709120',
  }
}

function publicAsset(overrides: Partial<DrivePublicAssetDto> = {}): DrivePublicAssetDto {
  return {
    assetId: 'asset_1',
    itemId: 'item-1',
    name: 'logo.png',
    size: '1024',
    mimeType: 'image/png',
    url: 'https://synapse.test/files/asset_1',
    lifecycleStatus: 'active',
    storageStatus: 'active',
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    ...overrides,
  }
}

function publicAssetPage(
  items: readonly DrivePublicAssetDto[],
  page: Partial<DrivePublicAssetListPageDto['page']> & { readonly total?: number } = {},
): DrivePublicAssetListPageDto {
  return {
    items,
    total: page.total ?? items.length,
    page: {
      offset: page.offset ?? 0,
      limit: page.limit ?? 50,
      hasMore: page.hasMore ?? false,
      nextOffset: page.nextOffset ?? null,
    },
  }
}

function treePage(
  items: readonly ReturnType<typeof treeFolder>[],
  page: { readonly hasMore?: boolean; readonly nextOffset?: number | null; readonly total?: number } = {},
) {
  return {
    items,
    total: page.total ?? items.length,
    fileCount: 0,
    folderCount: items.length,
    hasMore: page.hasMore ?? false,
    nextOffset: page.nextOffset ?? null,
  }
}

function treeFolder(input: { readonly id: string; readonly name: string; readonly path: string }) {
  return {
    id: input.id,
    parentId: null,
    type: 'folder',
    name: input.name,
    size: '0',
    mimeType: null,
    storageStatus: 'active',
    shared: false,
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    path: input.path,
    depth: 0,
  } as const
}

function folderSnapshot(): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'console',
    current: {
      id: 'root',
      name: '根目录',
      type: 'folder',
      size: '0',
      mimeType: null,
      updatedAt: '2026-06-29T00:00:00.000Z',
      previewKind: 'download-only',
      browserUrl: '/console/drive',
      downloadUrl: '/drive/items/root/download',
    },
    breadcrumbs: [{ id: 'root', name: '我的空间', browserUrl: '/console/drive' }],
    children: [
      {
        id: 'folder-1',
        name: '文档',
        type: 'folder',
        size: '0',
        mimeType: null,
        updatedAt: '2026-06-28T00:00:00.000Z',
        previewKind: 'download-only',
        browserUrl: '/console/drive/folders/folder-1',
        downloadUrl: '/drive/items/folder-1/download',
      },
    ],
    preview: null,
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: true,
  }
}

function nestedFolderSnapshot(): DriveBrowserSnapshotDto {
  return {
    ...folderSnapshot(),
    current: {
      id: 'folder-1',
      name: '文档',
      type: 'folder',
      size: '0',
      mimeType: null,
      updatedAt: '2026-06-29T00:00:00.000Z',
      previewKind: 'download-only',
      browserUrl: '/console/drive/folders/folder-1',
      downloadUrl: '/drive/items/folder-1/download',
    },
    breadcrumbs: [
      { id: 'root', name: '我的空间', browserUrl: '/console/drive' },
      { id: 'folder-1', name: '文档', browserUrl: '/console/drive/folders/folder-1' },
    ],
    children: [],
  }
}

function fileSnapshot(): DriveBrowserSnapshotDto {
  return {
    ...folderSnapshot(),
    current: {
      id: 'file-1',
      name: 'notes.md',
      type: 'file',
      size: '10',
      mimeType: 'text/markdown',
      updatedAt: '2026-06-28T00:00:00.000Z',
      previewKind: 'markdown',
      browserUrl: '/console/drive/items/file-1?surface=console',
      downloadUrl: '/drive/items/file-1/download',
    },
    children: [],
    preview: { kind: 'markdown', text: '# Notes', html: '<h1>Notes</h1>', outline: [], truncated: false, imageUrl: null, visitUrl: null },
    canZip: false,
  }
}
