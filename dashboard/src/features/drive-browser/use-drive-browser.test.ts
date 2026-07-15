// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto, DriveFileContentUpdateResult } from '@synapse/shared'
import { ApiError, driveBrowserApi } from '@/lib/api'

import { loadDriveBrowser, toDriveBrowserQueryKey, useDriveBrowser, type DriveBrowserInput } from './use-drive-browser'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  },
  driveBrowserApi: {
    getConsoleRoot: vi.fn(),
    getOwnerItem: vi.fn(),
    getShareItem: vi.fn(),
    getShareRoot: vi.fn(),
    updateOwnerText: vi.fn(),
    updateShareText: vi.fn(),
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

  it('maps share browser 404 responses to invalid share state', async () => {
    vi.mocked(driveBrowserApi.getShareRoot).mockRejectedValue(new ApiError('文件未找到', 404))
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, {
      context: 'share',
      shareId: 'share-1',
    })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('invalidShare')
    })
  })

  it('retries the initial browser load from the error state', async () => {
    const snapshot = createSnapshot()
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce(snapshot)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, 'item-1')

    await waitFor(() => {
      expect(hook.result.current.status).toBe('error')
    })

    await act(async () => {
      if (hook.result.current.status !== 'error') throw new Error('browser is not in error state')
      hook.result.current.retry()
    })
    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })

    expect(driveBrowserApi.getOwnerItem).toHaveBeenCalledTimes(2)
    expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot : null).toBe(snapshot)
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

  it('ignores duplicate load-more requests for the same child page', async () => {
    const firstSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('file-1')],
      childrenPage: { hasMore: true, limit: 50, nextOffset: 50 },
    })
    const nextSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('file-2')],
      childrenPage: { hasMore: false, limit: 50, nextOffset: null },
    })
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(nextSnapshot)
      .mockResolvedValueOnce(nextSnapshot)
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
    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      hook.result.current.loadMoreChildren?.()
      hook.result.current.loadMoreChildren?.()
    })
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.children.map((child) => child.id) : [])
        .toEqual(['file-1', 'file-2'])
    })

    expect(driveBrowserApi.getOwnerItem).toHaveBeenCalledTimes(2)
    expect(driveBrowserApi.getOwnerItem).toHaveBeenLastCalledWith('folder-1', 'console', {
      childrenOffset: 50,
      childrenLimit: 50,
    })
  })

  it('deduplicates overlapping children when loading the next page', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockReset()
    const firstSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('file-1'), createChild('file-2')],
      childrenPage: { hasMore: true, limit: 50, nextOffset: 50 },
    })
    const nextSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('file-2'), createChild('file-3')],
      childrenPage: { hasMore: false, limit: 50, nextOffset: null },
    })
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(nextSnapshot)
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
    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      hook.result.current.loadMoreChildren?.()
    })
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.children.map((child) => child.id) : [])
        .toEqual(['file-1', 'file-2', 'file-3'])
    })
  })

  it('ignores stale successful load-more responses after the browser target changes', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockReset()
    const staleLoadMore = createDeferred<DriveBrowserSnapshotDto>()
    const firstSnapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('folder-1-file-1')],
      childrenPage: { hasMore: true, limit: 50, nextOffset: 50 },
    })
    const secondSnapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: { ...baseCurrent(), id: 'folder-2', type: 'folder' },
      children: [createChild('folder-2-file-1')],
      childrenPage: { hasMore: false, limit: 50, nextOffset: null },
    })
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(firstSnapshot)
      .mockReturnValueOnce(staleLoadMore.promise)
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
    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      if (!hook.result.current.loadMoreChildren) throw new Error('load more is not available')
      hook.result.current.loadMoreChildren()
    })
    await waitFor(() => {
      expect(driveBrowserApi.getOwnerItem).toHaveBeenCalledTimes(2)
    })

    hook.rerender('folder-2')
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.current.id : null)
        .toBe('folder-2')
    })

    await act(async () => {
      staleLoadMore.resolve(createSnapshot({
        context: 'owner',
        surface: 'console',
        current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
        children: [createChild('stale-file')],
        childrenPage: { hasMore: false, limit: 50, nextOffset: null },
      }))
      await staleLoadMore.promise
    })

    expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.children.map((child) => child.id) : [])
      .toEqual(['folder-2-file-1'])
  })

  it('treats text save as successful when the follow-up reload fails', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockReset()
    vi.mocked(driveBrowserApi.updateOwnerText).mockReset()
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      edit: {
        canEdit: true,
        editorKind: 'text',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '1024',
        reason: null,
      },
    })
    const updateResult = createTextUpdateResult()
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('刷新失败'))
    vi.mocked(driveBrowserApi.updateOwnerText).mockResolvedValueOnce(updateResult)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, 'item-1')

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })

    await expect(act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      await expect(hook.result.current.saveText({
        text: 'updated',
        baseVersionId: 'version-1',
      })).resolves.toBe(updateResult)
    })).resolves.toBeUndefined()

    expect(driveBrowserApi.updateOwnerText).toHaveBeenCalledWith('item-1', {
      contentType: 'text',
      text: 'updated',
      baseVersionId: 'version-1',
    })
    expect(driveBrowserApi.getOwnerItem).toHaveBeenCalledTimes(2)
    expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.edit?.currentVersionId : null)
      .toBe('version-2')
  })

  it('uses saved HTML source text when the follow-up reload fails', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockReset()
    vi.mocked(driveBrowserApi.updateOwnerText).mockReset()
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: {
        ...baseCurrent(),
        name: 'page.html',
        mimeType: 'text/html',
        previewKind: 'html-source',
      },
      preview: {
        kind: 'html-source',
        text: '<p>old</p>',
        html: null,
        outline: null,
        truncated: false,
        imageUrl: null,
        visitUrl: '/files/page.html',
      },
      edit: {
        canEdit: true,
        editorKind: 'text',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '1024',
        reason: null,
      },
    })
    const updateResult = createTextUpdateResult()
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('刷新失败'))
    vi.mocked(driveBrowserApi.updateOwnerText).mockResolvedValueOnce(updateResult)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, 'item-1')

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })

    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      await hook.result.current.saveText({
        text: '<p>updated</p>',
        baseVersionId: 'version-1',
      })
    })

    const readySnapshot = hook.result.current.status === 'ready' ? hook.result.current.snapshot : null
    expect(readySnapshot?.edit?.currentVersionId).toBe('version-2')
    expect(readySnapshot?.preview?.text).toBe('<p>updated</p>')
  })

  it('invalidates stale rendered markdown when the follow-up reload fails', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockReset()
    vi.mocked(driveBrowserApi.updateOwnerText).mockReset()
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: {
        ...baseCurrent(),
        name: 'notes.md',
        mimeType: 'text/markdown',
        previewKind: 'markdown',
      },
      preview: {
        kind: 'markdown',
        text: '# Old',
        html: '<h1 id="old">Old</h1>',
        outline: [
          {
            id: 'old',
            text: 'Old',
            depth: 1,
            children: [],
          },
        ],
        truncated: false,
        imageUrl: null,
        visitUrl: null,
      },
      edit: {
        canEdit: true,
        editorKind: 'mdxeditor',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '1024',
        reason: null,
      },
    })
    const updateResult = createTextUpdateResult({
      item: {
        name: 'notes.md',
        size: '7',
        mimeType: 'text/markdown',
      },
      version: {
        size: '7',
        mimeType: 'text/markdown',
      },
    })
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('刷新失败'))
    vi.mocked(driveBrowserApi.updateOwnerText).mockResolvedValueOnce(updateResult)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, 'item-1')

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })

    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      await hook.result.current.saveText({
        text: '# New',
        baseVersionId: 'version-1',
      })
    })

    const readySnapshot = hook.result.current.status === 'ready' ? hook.result.current.snapshot : null
    expect(readySnapshot?.edit?.currentVersionId).toBe('version-2')
    expect(readySnapshot?.preview?.text).toBe('# New')
    expect(readySnapshot?.preview?.html).toBeNull()
    expect(readySnapshot?.preview?.outline).toBeNull()
  })

  it('invalidates owner annotations after saving text', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockReset()
    vi.mocked(driveBrowserApi.updateOwnerText).mockReset()
    const snapshot = createSnapshot({
      context: 'owner',
      surface: 'console',
      current: { ...baseCurrent(), id: 'item-1', name: 'notes.md', mimeType: 'text/markdown', previewKind: 'markdown' },
      edit: {
        canEdit: true,
        editorKind: 'mdxeditor',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '1024',
        reason: null,
      },
    })
    const updateResult = createTextUpdateResult()
    vi.mocked(driveBrowserApi.getOwnerItem)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(createSnapshot({ ...snapshot, edit: { ...snapshot.edit!, currentVersionId: 'version-2' } }))
    vi.mocked(driveBrowserApi.updateOwnerText).mockResolvedValueOnce(updateResult)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const hook = createDriveBrowserHookRenderer(queryClient, 'item-1')

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })
    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      await hook.result.current.saveText({
        text: '# New',
        baseVersionId: 'version-1',
      })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['drive-annotations', 'owner', 'item-1'] })
  })

  it('invalidates share annotations after saving text', async () => {
    vi.mocked(driveBrowserApi.getShareItem).mockReset()
    vi.mocked(driveBrowserApi.updateShareText).mockReset()
    const snapshot = createSnapshot({
      context: 'share',
      current: { ...baseCurrent(), id: 'share-file', name: 'notes.md', mimeType: 'text/markdown', previewKind: 'markdown' },
      breadcrumbs: [{ id: 'share-root', name: 'Root' }, { id: 'share-file', name: 'notes.md' }],
      edit: {
        canEdit: true,
        editorKind: 'mdxeditor',
        currentVersionId: 'version-1',
        maxInlineEditBytes: '1024',
        reason: null,
      },
    })
    const updateResult = createTextUpdateResult()
    vi.mocked(driveBrowserApi.getShareItem)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(createSnapshot({ ...snapshot, edit: { ...snapshot.edit!, currentVersionId: 'version-2' } }))
    vi.mocked(driveBrowserApi.updateShareText).mockResolvedValueOnce(updateResult)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const hook = createDriveBrowserHookRenderer(queryClient, {
      context: 'share',
      shareId: 'share-1',
      itemId: 'share-file',
    })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })
    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      await hook.result.current.saveText({
        text: '# New',
        baseVersionId: 'version-1',
      })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['drive-annotations', 'share', 'share-1', 'share-file'] })
  })

  it('does not reuse unlocked share snapshots after share route changes', async () => {
    const unlockedSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'share-a-file', name: 'first.txt' },
    })
    vi.mocked(driveBrowserApi.getShareRoot)
      .mockResolvedValueOnce({ passwordRequired: true, message: '请输入密码。' })
      .mockImplementationOnce(() => new Promise(() => {}))
    vi.mocked(driveBrowserApi.unlockShare).mockResolvedValueOnce(unlockedSnapshot)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, { context: 'share', shareId: 'share-a' })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('passwordRequired')
    })
    await act(async () => {
      if (hook.result.current.status !== 'passwordRequired') throw new Error('browser is not password protected')
      hook.result.current.unlock('letmein')
    })
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.current.id : null)
        .toBe('share-a-file')
    })

    hook.rerender({ context: 'share', shareId: 'share-b' })

    expect(hook.history.some((entry) => (
      entry.input.context === 'share'
      && entry.input.shareId === 'share-b'
      && entry.state.status === 'ready'
      && entry.state.snapshot.current.id === 'share-a-file'
    ))).toBe(false)
  })

  it('ignores stale manual unlock responses after the share route changes', async () => {
    const staleUnlock = createDeferred<DriveBrowserSnapshotDto>()
    vi.mocked(driveBrowserApi.getShareRoot)
      .mockResolvedValueOnce({ passwordRequired: true, message: '请输入密码。' })
      .mockResolvedValueOnce({ passwordRequired: true, message: '请输入密码。' })
    vi.mocked(driveBrowserApi.unlockShare).mockReturnValueOnce(staleUnlock.promise)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, { context: 'share', shareId: 'share-a' })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('passwordRequired')
    })
    await act(async () => {
      if (hook.result.current.status !== 'passwordRequired') throw new Error('browser is not password protected')
      hook.result.current.unlock('letmein')
    })
    await waitFor(() => {
      expect(driveBrowserApi.unlockShare).toHaveBeenCalledWith('share-a', 'letmein', undefined)
    })

    hook.rerender({ context: 'share', shareId: 'share-b' })
    await waitFor(() => {
      expect(hook.result.current.status).toBe('passwordRequired')
    })

    await act(async () => {
      staleUnlock.resolve(createSnapshot({
        current: { ...baseCurrent(), id: 'share-a-file', name: 'first.txt' },
      }))
      await staleUnlock.promise
    })

    expect(hook.result.current.status).toBe('passwordRequired')
    expect(hook.history.some((entry) => (
      entry.input.context === 'share'
      && entry.input.shareId === 'share-b'
      && entry.state.status === 'ready'
      && entry.state.snapshot.current.id === 'share-a-file'
    ))).toBe(false)
  })

  it('keeps an initially unlocked share ready after the password is removed from the URL', async () => {
    const unlockedSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'share-file', name: 'unlocked.txt' },
    })
    vi.mocked(driveBrowserApi.unlockShare).mockResolvedValueOnce(unlockedSnapshot)
    vi.mocked(driveBrowserApi.getShareRoot).mockResolvedValue({ passwordRequired: true, message: '请输入密码。' })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, {
      context: 'share',
      shareId: 'share-1',
      initialPassword: 'link-password',
    })

    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.current.id : null)
        .toBe('share-file')
    })

    hook.rerender({ context: 'share', shareId: 'share-1' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.current.name : null)
      .toBe('unlocked.txt')
    expect(driveBrowserApi.unlockShare).toHaveBeenCalledWith('share-1', 'link-password', undefined, {})
    expect(driveBrowserApi.getShareRoot).not.toHaveBeenCalled()
  })

  it('revalidates a new initial password for an already unlocked share', async () => {
    const unlockedSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'share-file', name: 'unlocked.txt' },
    })
    vi.mocked(driveBrowserApi.unlockShare)
      .mockResolvedValueOnce(unlockedSnapshot)
      .mockResolvedValueOnce({ passwordRequired: true, message: '密码错误。' })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, {
      context: 'share',
      shareId: 'share-1',
      initialPassword: 'old-password',
    })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })
    hook.rerender({ context: 'share', shareId: 'share-1' })
    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready')
    })

    hook.rerender({
      context: 'share',
      shareId: 'share-1',
      initialPassword: 'new-password',
    })
    await waitFor(() => {
      expect(hook.result.current.status).toBe('passwordRequired')
    })

    expect(driveBrowserApi.unlockShare).toHaveBeenCalledTimes(2)
    expect(driveBrowserApi.unlockShare).toHaveBeenLastCalledWith('share-1', 'new-password', undefined, {})
    expect(hook.result.current.status === 'passwordRequired' ? hook.result.current.unlockError : null).toBe('密码错误。')
  })

  it('reports initial share password rejection after the query password is consumed', async () => {
    vi.mocked(driveBrowserApi.unlockShare).mockResolvedValueOnce({ passwordRequired: true, message: '请输入密码。' })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, {
      context: 'share',
      shareId: 'share-1',
      initialPassword: 'expired-password',
    })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('passwordRequired')
    })

    expect(hook.result.current.status === 'passwordRequired' ? hook.result.current.unlockError : null)
      .toBe('请输入密码。')
    expect(driveBrowserApi.unlockShare).toHaveBeenCalledWith('share-1', 'expired-password', undefined, {})
  })

  it('keeps a password-unlocked share ready after loading more children', async () => {
    const unlockedSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('file-1')],
      childrenPage: { hasMore: true, limit: 50, nextOffset: 50 },
    })
    const nextSnapshot = createSnapshot({
      current: { ...baseCurrent(), id: 'folder-1', type: 'folder' },
      children: [createChild('file-2')],
      childrenPage: { hasMore: false, limit: 50, nextOffset: null },
    })
    vi.mocked(driveBrowserApi.getShareRoot)
      .mockResolvedValueOnce({ passwordRequired: true, message: '请输入密码。' })
      .mockResolvedValueOnce(nextSnapshot)
    vi.mocked(driveBrowserApi.unlockShare).mockResolvedValueOnce(unlockedSnapshot)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const hook = createDriveBrowserHookRenderer(queryClient, { context: 'share', shareId: 'share-1' })

    await waitFor(() => {
      expect(hook.result.current.status).toBe('passwordRequired')
    })
    await act(async () => {
      if (hook.result.current.status !== 'passwordRequired') throw new Error('browser is not password protected')
      hook.result.current.unlock('letmein')
    })
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.children.map((child) => child.id) : [])
        .toEqual(['file-1'])
    })

    await act(async () => {
      if (hook.result.current.status !== 'ready') throw new Error('browser is not ready')
      hook.result.current.loadMoreChildren?.()
    })
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' ? hook.result.current.snapshot.children.map((child) => child.id) : [])
        .toEqual(['file-1', 'file-2'])
    })

    expect(hook.result.current.status).toBe('ready')
    expect(driveBrowserApi.getShareRoot).toHaveBeenLastCalledWith('share-1', {
      childrenOffset: 50,
      childrenLimit: 50,
    })
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

function createTextUpdateResult(overrides: {
  readonly item?: Partial<DriveFileContentUpdateResult['item']>
  readonly version?: Partial<DriveFileContentUpdateResult['version']>
} = {}): DriveFileContentUpdateResult {
  const now = '2026-06-13T00:00:00.000Z'
  return {
    item: {
      id: 'item-1',
      parentId: null,
      type: 'file',
      name: 'file.txt',
      size: '7',
      mimeType: 'text/plain',
      storageStatus: 'active',
      shared: false,
      createdAt: now,
      updatedAt: now,
      ...overrides.item,
    },
    version: {
      id: 'version-2',
      itemId: 'item-1',
      versionNumber: 2,
      size: '7',
      mimeType: 'text/plain',
      source: 'online_edit',
      isCurrent: true,
      isPinned: false,
      deletePending: false,
      restoredFromVersionId: null,
      createdAt: now,
      createdBy: null,
      ...overrides.version,
    },
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
    annotation: null,
    canDownload: true,
    canZip: false,
    ...overrides,
  }
}

function createChild(id: string): DriveBrowserSnapshotDto['children'][number] {
  return {
    id,
    name: `${id}.txt`,
    type: 'file',
    size: '1',
    mimeType: 'text/plain',
    updatedAt: '2026-06-13T00:00:00.000Z',
    browserUrl: `/drive/items/${id}`,
    downloadUrl: `/drive/items/${id}/download`,
    previewKind: 'text',
  }
}

function createDriveBrowserHookRenderer(queryClient: QueryClient, initialInput: string | DriveBrowserInput) {
  host ??= document.createElement('div')
  if (!host.parentElement) document.body.append(host)
  root ??= createRoot(host)
  const result: { current: ReturnType<typeof useDriveBrowser> } = { current: { status: 'loading' } }
  const history: Array<{
    readonly input: DriveBrowserInput
    readonly state: ReturnType<typeof useDriveBrowser>
  }> = []
  let currentInput = normalizeDriveBrowserInput(initialInput)

  function Harness() {
    result.current = useDriveBrowser(currentInput)
    history.push({ input: currentInput, state: result.current })
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
    history,
    result,
    rerender: (input: string | DriveBrowserInput) => {
      currentInput = normalizeDriveBrowserInput(input)
      act(() => {
        render()
      })
    },
  }
}

function normalizeDriveBrowserInput(input: string | DriveBrowserInput): DriveBrowserInput {
  return typeof input === 'string'
    ? { context: 'owner', surface: 'console', itemId: input }
    : input
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
