// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto } from '@synapse/shared'
import { driveBrowserApi } from '@/lib/api'

import { loadDriveBrowser, toDriveBrowserQueryKey, useDriveBrowser } from './use-drive-browser'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  driveBrowserApi: {
    getConsoleRoot: vi.fn(),
    getOwnerItem: vi.fn(),
    getShareItem: vi.fn(),
    getShareRoot: vi.fn(),
    unlockShare: vi.fn(),
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

describe('toDriveBrowserQueryKey', () => {
  it('separates share browser cache entries by initial password value without storing plaintext passwords', () => {
    const first = toDriveBrowserQueryKey({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'old-password',
    })
    const second = toDriveBrowserQueryKey({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'new-password',
    })

    expect(first).not.toEqual(second)
    expect(JSON.stringify(first)).not.toContain('old-password')
    expect(JSON.stringify(second)).not.toContain('new-password')
  })

  it('uses the unlock endpoint for initial share passwords', async () => {
    const snapshot = createSnapshot()
    vi.mocked(driveBrowserApi.unlockShare).mockResolvedValue(snapshot)

    await expect(loadDriveBrowser({
      context: 'share',
      shareId: 'share-1',
      itemId: 'item-1',
      initialPassword: 'link-password',
    })).resolves.toBe(snapshot)

    expect(driveBrowserApi.unlockShare).toHaveBeenCalledWith('share-1', 'link-password', 'item-1', {})
    expect(driveBrowserApi.getShareItem).not.toHaveBeenCalled()
    expect(driveBrowserApi.getShareRoot).not.toHaveBeenCalled()
  })

  it('passes child pagination options to owner browser requests', async () => {
    const snapshot = createSnapshot()
    vi.mocked(driveBrowserApi.getOwnerItem).mockResolvedValue(snapshot)

    await expect(loadDriveBrowser({
      context: 'owner',
      surface: 'console',
      itemId: 'folder-1',
    }, { childrenOffset: 100, childrenLimit: 50 })).resolves.toBe(snapshot)

    expect(driveBrowserApi.getOwnerItem).toHaveBeenCalledWith(
      'folder-1',
      'console',
      { childrenOffset: 100, childrenLimit: 50 }
    )
  })

  it('clears stale load-more errors when the browser target changes', async () => {
    const firstSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1' },
      childrenPage: { hasMore: true, limit: 50, nextOffset: 50 },
    })
    const secondSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-2' },
      childrenPage: { hasMore: false, limit: 50, nextOffset: null },
    })
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(firstSnapshot)
      .mockRejectedValueOnce(new Error('旧目录加载失败'))
      .mockResolvedValueOnce(secondSnapshot)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, 'folder-1')

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })
    expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.current.id : null).toBe('folder-1')

    await act(() => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      hook.result.current.loadMoreChildren?.()
    })
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.loadMoreChildrenError : null)
        .toBe('旧目录加载失败')
    })

    hook.rerender('folder-2')
    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })

    expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.current.id : null).toBe('folder-2')
    expect(hook.result.current.status === 'ready' ? hook.result.current.loadMoreChildrenError : null).toBeNull()
  })
})

function baseCurrent(): DriveBrowserSnapshotDto['current'] {
  return {
    id: 'item-1',
    name: 'file.txt',
    type: 'file',
    size: '1',
    mimeType: 'text/plain',
    updatedAt: '2026-06-13T00:00:00.000Z',
    browserUrl: '/share/share-1/items/item-1',
    downloadUrl: '/share/share-1/items/item-1/download',
    previewKind: 'text',
  }
}

function createSnapshot(overrides: Partial<DriveBrowserSnapshotDto> = {}): DriveBrowserSnapshotDto {
  return {
    context: 'share',
    surface: 'standalone',
    current: baseCurrent(),
    breadcrumbs: [],
    children: [],
    preview: null,
    edit: null,
    canDownload: true,
    canZip: false,
    ...overrides,
  }
}

function createDriveBrowserHookRenderer(queryClient: QueryClient, initialItemId: string) {
  host ??= document.createElement('div')
  if (!host.parentElement) document.body.append(host)
  root ??= createRoot(host)
  const result: { current: ReturnType<typeof useDriveBrowser> } = { current: { status: 'loading' } }
  let currentItemId = initialItemId

  function Harness() {
    result.current = useDriveBrowser({ context: 'owner', surface: 'console', itemId: currentItemId })
    return null
  }

  function render() {
    root?.render(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Harness)
    ))
  }

  act(() => {
    render()
  })

  return {
    result,
    rerender: (itemId: string) => {
      currentItemId = itemId
      act(() => {
        render()
      })
    },
  }
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
