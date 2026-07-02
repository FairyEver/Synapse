// @vitest-environment jsdom

import { createElement, type ComponentProps } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveFileVersionDto } from '@synapse/shared'
import { driveFileVersionsApi } from '@/lib/api'
import { DriveFileVersionContent, DriveFileVersionsDialog } from './drive-file-versions-dialog'

vi.mock('@/lib/api', () => ({
  driveFileVersionsApi: {
    list: vi.fn(),
    restore: vi.fn(),
    updatePin: vi.fn(),
    delete: vi.fn(),
    downloadUrl: vi.fn((itemId: string, versionId: string) => `/drive/items/${itemId}/versions/${versionId}/download`),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('DriveFileVersionContent', () => {
  it('uses the shared frame structure for the scrollable dialog body', () => {
    const source = readDialogSource()

    expect(source).toContain('DialogFrame')
    expect(source).toContain('DialogFrameHeader')
    expect(source).toContain('DialogFrameBody')
    expect(source).toContain("showCloseButton={false}")
    expect(source).toContain("aria-describedby={undefined}")
    expect(source).toContain("title='历史版本'")
    expect(source).toContain("className='h-105 w-[calc(100%+0.75rem)] overflow-y-auto py-1 pe-3'")
    expect(source).not.toContain("DialogTitle className='pr-8'")
    expect(source).not.toContain("DialogHeader className='text-start'")
    expect(source).not.toContain("from '@/components/ui/scroll-area'")
  })

  it('uses the version page cursor for additional history pages', () => {
    const source = readDialogSource()

    expect(source).toContain('useInfiniteQuery')
    expect(source).toContain('getNextPageParam')
    expect(source).toContain('lastPage.page.nextOffset')
    expect(source).toContain('fetchNextPage')
    expect(source).toContain('maxPages: versionWindowPageCount')
  })

  it('keeps version rows inside a bounded table frame', () => {
    const html = renderVersions([
      version({ id: 'version-4', versionNumber: 4, isCurrent: true }),
      version({ id: 'version-3', versionNumber: 3 }),
      version({ id: 'version-2', versionNumber: 2 }),
      version({ id: 'version-1', versionNumber: 1 }),
    ])

    expect(html).toContain('class="rounded-md border"')
    expect(html).not.toContain('data-slot="scroll-area"')
    expect(html).toContain('data-slot="table"')
    expect(html).toContain('版本')
    expect(html).toContain('来源')
    expect(html).toContain('大小')
    expect(html).toContain('创建时间')
    expect(html).toContain('v4')
    expect(html).toContain('v1')
  })

  it('limits current version actions to download', () => {
    const html = renderVersions([
      version({ id: 'version-current', versionNumber: 4, isCurrent: true }),
    ])

    expect(html).toContain('当前')
    expect(html).toContain('下载')
    expect(html).not.toContain('恢复')
    expect(html).not.toContain('保留')
    expect(html).not.toContain('删除')
  })

  it('shows restore, pin, and delete actions for older versions', () => {
    const html = renderVersions([
      version({ id: 'version-old', versionNumber: 3 }),
    ])

    expect(html).toContain('下载')
    expect(html).toContain('恢复')
    expect(html).toContain('保留')
    expect(html).toContain('删除')
  })

  it('hides delete for pinned older versions', () => {
    const html = renderVersions([
      version({ id: 'version-pinned', versionNumber: 3, isPinned: true }),
    ])

    expect(html).toContain('保留')
    expect(html).toContain('取消保留')
    expect(html).not.toContain('删除')
  })

  it('hides actions for versions pending cleanup', () => {
    const html = renderVersions([
      version({ id: 'version-pending', versionNumber: 3, deletePending: true }),
    ])

    expect(html).toContain('待清理')
    expect(html).not.toContain('下载')
    expect(html).not.toContain('恢复')
    expect(html).not.toContain('保留')
    expect(html).not.toContain('删除')
  })

  it('shows a load more action when more version pages are available', () => {
    const html = renderVersionContent({
      versions: [version({ id: 'version-100', versionNumber: 100 })],
      hasMore: true,
      loadingMore: false,
    })

    expect(html).toContain('加载更多')
  })

  it('shows load-more failures while keeping existing version rows visible', () => {
    const html = renderVersionContent({
      versions: [version({ id: 'version-100', versionNumber: 100 })],
      hasMore: true,
      loadMoreError: '第二页失败',
    })

    expect(html).toContain('v100')
    expect(html).toContain('加载更多失败：第二页失败')
    expect(html).toContain('加载更多')
    expect(html).not.toContain('读取失败')
  })

  it('renders loading, empty, and error states in the same bounded area', () => {
    const loadingHtml = renderVersionContent({ loading: true })
    const emptyHtml = renderVersions([])
    const errorHtml = renderVersionContent({ error: '版本加载失败。' })

    expect(loadingHtml).toContain('data-slot="table"')
    expect(loadingHtml).toContain('data-slot="skeleton"')
    expect(emptyHtml).toContain('暂无历史版本')
    expect(emptyHtml).toContain('min-h-48')
    expect(errorHtml).toContain('读取失败')
    expect(errorHtml).toContain('版本加载失败。')
    expect(errorHtml).toContain('重试')
  })

  it('notifies the active browser after restoring a version', async () => {
    const onChanged = vi.fn(async () => undefined)
    vi.mocked(driveFileVersionsApi.list).mockResolvedValue({
      items: [version({ id: 'version-old', versionNumber: 1 })],
      page: { limit: 100, offset: 0, nextOffset: null, hasMore: false },
    })
    vi.mocked(driveFileVersionsApi.restore).mockResolvedValue(undefined)
    renderVersionDialog({ onChanged })

    await waitFor(() => {
      expect(buttonByLabel('恢复 v1')).toBeTruthy()
    })

    await act(async () => {
      buttonByLabel('恢复 v1')?.click()
    })
    await waitFor(() => {
      expect(buttonByText('恢复')).toBeTruthy()
    })
    await act(async () => {
      buttonByText('恢复')?.click()
    })

    await waitFor(() => {
      expect(driveFileVersionsApi.restore).toHaveBeenCalledWith('item-1', 'version-old')
      expect(onChanged).toHaveBeenCalledTimes(1)
    })
  })

  it('shows a next-page error after version load-more fails', async () => {
    vi.mocked(driveFileVersionsApi.list)
      .mockResolvedValueOnce({
        items: [version({ id: 'version-first', versionNumber: 2 })],
        page: { limit: 100, offset: 0, nextOffset: 100, hasMore: true },
      })
      .mockRejectedValueOnce(new Error('分页失败'))
    renderVersionDialog()

    await waitFor(() => {
      expect(buttonByText('加载更多')).toBeTruthy()
    })
    await act(async () => {
      buttonByText('加载更多')?.click()
    })
    await waitFor(() => {
      expect(document.body.textContent).toContain('加载更多失败：分页失败')
    })

    expect(document.body.textContent).toContain('v2')
  })

  it('caps loaded version rows after multiple history pages', async () => {
    vi.mocked(driveFileVersionsApi.list)
      .mockResolvedValueOnce(versionPage(300, 201, 100))
      .mockResolvedValueOnce(versionPage(200, 101, 200))
      .mockResolvedValueOnce(versionPage(100, 1, null))
    renderVersionDialog()

    await waitFor(() => {
      expect(buttonByText('加载更多')).toBeTruthy()
    })
    await act(async () => {
      buttonByText('加载更多')?.click()
    })
    await waitFor(() => {
      expect(document.body.textContent).toContain('v200')
    })
    await act(async () => {
      buttonByText('加载更多')?.click()
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('v99')
      expect(document.querySelectorAll('tbody tr')).toHaveLength(200)
    })
    expect(document.body.textContent).not.toContain('v300')
  })
})

function renderVersions(versions: readonly DriveFileVersionDto[]) {
  return renderVersionContent({ versions })
}

function renderVersionContent(overrides: Partial<ComponentProps<typeof DriveFileVersionContent>> = {}) {
  return renderToStaticMarkup(
    createElement(DriveFileVersionContent, {
      itemId: 'item-1',
      versions: [],
      loading: false,
      error: null,
      loadMoreError: null,
      pinningVersionId: null,
      pinning: false,
      hasMore: false,
      loadingMore: false,
      onRetry: vi.fn(),
      onLoadMore: vi.fn(),
      onPin: vi.fn(),
      onRestore: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    })
  )
}

function readDialogSource() {
  return readFileSync('src/features/drive-browser/drive-file-versions-dialog.tsx', 'utf8')
}

function renderVersionDialog(overrides: Partial<ComponentProps<typeof DriveFileVersionsDialog>> = {}) {
  host ??= document.createElement('div')
  if (!host.parentElement) document.body.append(host)
  root ??= createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  act(() => {
    root?.render(
      createElement(QueryClientProvider, { client: queryClient },
        createElement(DriveFileVersionsDialog, {
          itemId: 'item-1',
          open: true,
          onOpenChange: vi.fn(),
          ...overrides,
        })
      )
    )
  })
}

async function waitFor(read: () => void): Promise<void> {
  let lastError: unknown
  for (let index = 0; index < 20; index += 1) {
    try {
      read()
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
  }
  throw lastError
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return document.querySelector(`button[aria-label="${label}"]`)
}

function buttonByText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll('button')]
    .find((button) => button.textContent?.trim() === text) ?? null
}

function version(overrides: Partial<DriveFileVersionDto> = {}): DriveFileVersionDto {
  return {
    id: 'version-1',
    itemId: 'item-1',
    versionNumber: 1,
    size: '7372',
    mimeType: 'text/markdown',
    source: 'upload',
    isCurrent: false,
    isPinned: false,
    deletePending: false,
    restoredFromVersionId: null,
    createdAt: '2026-06-17T12:01:33.000Z',
    createdBy: null,
    ...overrides,
  }
}

function versionPage(fromVersionNumber: number, toVersionNumber: number, nextOffset: number | null) {
  const count = fromVersionNumber - toVersionNumber + 1
  return {
    items: Array.from({ length: count }, (_, index) => {
      const versionNumber = fromVersionNumber - index
      return version({
        id: `version-${versionNumber}`,
        versionNumber,
        isCurrent: versionNumber === 300,
      })
    }),
    page: {
      limit: 100,
      offset: 300 - fromVersionNumber,
      nextOffset,
      hasMore: nextOffset !== null,
    },
  }
}
