// @vitest-environment jsdom

import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto, DriveUsageDto } from '@synapse/shared'
import { SidebarProvider } from '@/components/ui/sidebar'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { useDriveBrowser } from '@/features/drive-browser/use-drive-browser'
import { driveApi } from '@/lib/api'
import { DriveConsoleItemPage, DriveConsolePage } from './drive-console-page'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/features/drive-browser/use-drive-browser', () => ({
  useDriveBrowser: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    driveApi: {
      ...actual.driveApi,
      getUsage: vi.fn(),
    },
  }
})

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

function usage(): DriveUsageDto {
  return {
    usedBytes: '1048576',
    reservedBytes: '0',
    quotaBytes: '5368709120',
  }
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
