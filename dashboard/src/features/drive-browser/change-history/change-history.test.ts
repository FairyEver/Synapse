// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveBrowserSnapshotDto, DriveFileVersionDto } from '@synapse/shared'
import { driveBrowserApi, driveFileVersionsApi } from '@/lib/api'
import {
  buildCollapsedDiffBlocks,
  buildSplitDiffRows,
  computeLineDiff,
  getDiffStats,
} from './change-history-diff'
import {
  EMPTY_BASE_VERSION_ID,
  filterChangeHistoryVersions,
  resolveRangeCumulativeBounds,
} from './change-history-model'
import { DriveChangeHistoryPage } from './drive-change-history-page'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    driveBrowserApi: {
      ...actual.driveBrowserApi,
      getOwnerItem: vi.fn(),
    },
    driveFileVersionsApi: {
      list: vi.fn(),
      getContent: vi.fn(),
      restore: vi.fn(),
      delete: vi.fn(),
      downloadUrl: vi.fn(
        (itemId: string, versionId: string) =>
          `/api/drive/items/${itemId}/versions/${versionId}/download`
      ),
    },
  }
})

vi.mock('@heroui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@heroui/react')>()),
  toast: {
    success: vi.fn(),
    danger: vi.fn(),
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

describe('change-history diff engine', () => {
  it('computes line diffs and inline word highlights', () => {
    const ops = computeLineDiff('# Title\nhello world\nkeep', '# Title\nhello synapse\nkeep\nextra')
    const stats = getDiffStats(ops)

    expect(stats).toEqual({ additions: 2, deletions: 1 })
    const delOp = ops.find((op) => op.type === 'del')
    const addOp = ops.find((op) => op.type === 'add' && op.text === 'hello synapse')
    expect(delOp?.segments?.some((segment) => segment.changed && segment.text === 'world')).toBe(true)
    expect(addOp?.segments?.some((segment) => segment.changed && segment.text === 'synapse')).toBe(true)
  })

  it('folds long unchanged runs and supports expanding individual gaps', () => {
    const base = Array.from({ length: 15 }, (_, index) => `line-${index + 1}`).join('\n')
    const next = base.replace('line-15', 'line-15-updated')
    const ops = computeLineDiff(base, next)

    const collapsed = buildCollapsedDiffBlocks(ops, {
      showFull: false,
      contextLines: 2,
      expandedGapKeys: new Set(),
      keyPrefix: 'test',
    })
    const gap = collapsed.find((block) => block.kind === 'gap')
    expect(gap).toEqual({ kind: 'gap', key: 'test:gap:0', count: 12 })

    const expanded = buildCollapsedDiffBlocks(ops, {
      showFull: false,
      contextLines: 2,
      expandedGapKeys: new Set(['test:gap:0']),
      keyPrefix: 'test',
    })
    expect(expanded.some((block) => block.kind === 'gap')).toBe(false)
  })

  it('pairs additions and deletions into side-by-side split rows', () => {
    const ops = computeLineDiff('a\nb\nc', 'a\nb2\nc')
    const rows = buildSplitDiffRows(ops)
    expect(rows).toHaveLength(3)
    expect(rows[1]?.left?.text).toBe('b')
    expect(rows[1]?.right?.text).toBe('b2')
  })

  it('normalizes CR/CRLF line endings and handles single newline without double counting', () => {
    expect(getDiffStats(computeLineDiff('a\r\nb\rc', 'a\nb\nc'))).toEqual({
      additions: 0,
      deletions: 0,
    })
    expect(getDiffStats(computeLineDiff('', '\n'))).toEqual({
      additions: 1,
      deletions: 0,
    })
  })
})

describe('change-history filtering and range bounds', () => {
  const now = new Date('2026-11-26T12:00:00+08:00')
  const versions: DriveFileVersionDto[] = [
    makeVersion({ id: 'v3', versionNumber: 3, source: 'online_edit', createdAt: '2026-11-25T10:00:00+08:00', isCurrent: true }),
    makeVersion({ id: 'v2', versionNumber: 2, source: 'collaboration', createdAt: '2026-11-19T10:00:00+08:00' }),
    makeVersion({ id: 'v1', versionNumber: 1, source: 'upload', createdAt: '2026-10-20T10:00:00+08:00' }),
  ]

  it('filters by inclusive time preset, custom date range, and source', () => {
    // 7d on 2026-11-26 covers 2026-11-20..2026-11-26 (7 calendar days, excluding 2026-11-19).
    expect(
      filterChangeHistoryVersions(versions, { preset: '7d', dateFrom: '', dateTo: '', source: 'all' }, now).map((v) => v.id)
    ).toEqual(['v3'])

    expect(
      filterChangeHistoryVersions(
        versions,
        { preset: 'custom', dateFrom: '2026-11-26', dateTo: '2026-11-15', source: 'all' },
        now
      ).map((v) => v.id)
    ).toEqual(['v3', 'v2'])

    expect(
      filterChangeHistoryVersions(versions, { preset: 'all', dateFrom: '', dateTo: '', source: 'upload' }, now).map((v) => v.id)
    ).toEqual(['v1'])
  })

  it('resolves cumulative range bounds and avoids fake empty base when older pages remain unloaded', () => {
    const recent = filterChangeHistoryVersions(versions, { preset: '14d', dateFrom: '', dateTo: '', source: 'all' }, now)
    expect(resolveRangeCumulativeBounds(versions, recent)).toEqual({
      baseVersionId: 'v1',
      targetVersionId: 'v3',
      incompleteBase: false,
    })
    expect(resolveRangeCumulativeBounds(versions, versions)).toEqual({
      baseVersionId: EMPTY_BASE_VERSION_ID,
      targetVersionId: 'v3',
      incompleteBase: false,
    })
    expect(
      resolveRangeCumulativeBounds(versions, versions, { hasMoreOlder: true })
    ).toEqual({
      baseVersionId: 'v1',
      targetVersionId: 'v3',
      incompleteBase: true,
    })
  })
})

describe('DriveChangeHistoryPage', () => {
  it('renders document diff without a back-to-document button and supports cumulative range view', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockResolvedValue(ownerSnapshot('notes.md', 'markdown'))
    vi.mocked(driveFileVersionsApi.list).mockResolvedValue({
      items: [
        makeVersion({ id: 'v2', versionNumber: 2, source: 'online_edit', createdAt: '2026-11-26T10:00:00+08:00', isCurrent: true }),
        makeVersion({ id: 'v1', versionNumber: 1, source: 'upload', createdAt: '2026-11-20T10:00:00+08:00' }),
      ],
      total: 2,
      page: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveFileVersionsApi.getContent).mockImplementation(async (_itemId, versionId) => ({
      itemId: 'item-1',
      versionId,
      versionNumber: versionId === 'v2' ? 2 : 1,
      size: '20',
      mimeType: 'text/markdown',
      text: versionId === 'v2' ? '# Doc\nline one\nline two' : '# Doc\nline one',
    }))

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('notes.md')
      expect(document.body.textContent).toContain('v1 → v2')
      expect(document.body.textContent).toContain('line two')
    })
    expect(document.body.textContent).not.toContain('返回文档')

    const cumulativeButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('查看该时段累计变更')
    )
    expect(cumulativeButton).toBeTruthy()
    await act(async () => {
      cumulativeButton?.click()
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('创建前 → v2')
      expect(document.body.textContent).toContain('累计跨 2 次变更')
    })
  })

  it('shows an unsupported notice for non-text files without querying versions', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockResolvedValue(ownerSnapshot('archive.zip', 'download-only'))

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('该文件类型不支持文本变更对比')
    })
    expect(driveFileVersionsApi.list).not.toHaveBeenCalled()
    expect(driveFileVersionsApi.getContent).not.toHaveBeenCalled()
  })

  it('keeps aria-live on a dedicated sr-only status node instead of the diff container', async () => {
    vi.mocked(driveBrowserApi.getOwnerItem).mockResolvedValue(ownerSnapshot('notes.md', 'markdown'))
    vi.mocked(driveFileVersionsApi.list).mockResolvedValue({
      items: [
        makeVersion({ id: 'v2', versionNumber: 2, source: 'online_edit', createdAt: '2026-11-26T10:00:00+08:00', isCurrent: true }),
        makeVersion({ id: 'v1', versionNumber: 1, source: 'upload', createdAt: '2026-11-20T10:00:00+08:00' }),
      ],
      total: 2,
      page: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
    })
    vi.mocked(driveFileVersionsApi.getContent).mockResolvedValue({
      itemId: 'item-1',
      versionId: 'v2',
      versionNumber: 2,
      size: '10',
      mimeType: 'text/markdown',
      text: 'hello',
    })

    renderPage()

    await waitFor(() => {
      expect(document.body.textContent).toContain('v1 → v2')
    })
    const liveNodes = document.querySelectorAll('[aria-live]')
    expect(liveNodes).toHaveLength(1)
    expect(liveNodes[0]?.getAttribute('role')).toBe('status')
    expect(liveNodes[0]?.className).toContain('sr-only')
  })
})

function renderPage() {
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
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(DriveChangeHistoryPage, { itemId: 'item-1' })
      )
    )
  })
}

async function waitFor(read: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
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

function makeVersion(
  overrides: Partial<DriveFileVersionDto> = {}
): DriveFileVersionDto {
  return {
    id: 'v1',
    itemId: 'item-1',
    versionNumber: 1,
    size: '100',
    mimeType: 'text/markdown',
    source: 'upload',
    isCurrent: false,
    deletePending: false,
    restoredFromVersionId: null,
    createdAt: '2026-11-20T10:00:00+08:00',
    createdBy: 'user-1',
    ...overrides,
  }
}

function ownerSnapshot(
  name: string,
  previewKind: DriveBrowserSnapshotDto['current']['previewKind']
): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: {
      id: 'item-1',
      name,
      type: 'file',
      size: '100',
      mimeType: previewKind === 'markdown' ? 'text/markdown' : 'application/zip',
      updatedAt: '2026-11-26T10:00:00+08:00',
      previewKind,
      browserUrl: '/drive/items/item-1',
      downloadUrl: '/drive/items/item-1/download',
    },
    breadcrumbs: [],
    children: [],
    childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
    preview: null,
    edit: { canEdit: previewKind === 'markdown', editorKind: previewKind === 'markdown' ? 'text' : 'none', currentVersionId: 'v2', reason: null },
    canDownload: true,
    canZip: false,
  }
}
