import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { DriveFileVersionDto } from '@synapse/shared'
import { DriveFileVersionContent } from './drive-file-versions-dialog'

describe('DriveFileVersionContent', () => {
  it('uses the shadcn-admin scrollable dialog body pattern', () => {
    const source = readFileSync(new URL('./drive-file-versions-dialog.tsx', import.meta.url), 'utf8')
    const contentClass = source.match(/<DialogContent className='([^']+)'/)?.[1]?.split(/\s+/u) ?? []

    expect(contentClass).toEqual(['sm:max-w-3xl'])
    expect(source).toContain("className='h-105 w-[calc(100%+0.75rem)] overflow-y-auto py-1 pe-3'")
    expect(source).not.toContain("from '@/components/ui/scroll-area'")
    expect(contentClass).not.toContain('flex')
    expect(contentClass).not.toContain('overflow-hidden')
    expect(contentClass).not.toContain('sm:max-w-2xl')
  })

  it('uses the version page cursor for additional history pages', () => {
    const source = readFileSync(new URL('./drive-file-versions-dialog.tsx', import.meta.url), 'utf8')

    expect(source).toContain('useInfiniteQuery')
    expect(source).toContain('getNextPageParam')
    expect(source).toContain('lastPage.page.nextOffset')
    expect(source).toContain('fetchNextPage')
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

  it('shows a load more action when more version pages are available', () => {
    const html = renderVersionContent({
      versions: [version({ id: 'version-100', versionNumber: 100 })],
      hasMore: true,
      loadingMore: false,
    })

    expect(html).toContain('加载更多')
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
