import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DriveBrowserSnapshotDto, DriveFileVersionDto } from '@synapse/shared'
import { driveBrowserApi, driveFileVersionsApi } from '@/lib/api'
import { DriveChangeHistoryPage } from './drive-change-history-page'

afterEach(() => {
  vi.restoreAllMocks()
  window.scrollTo(0, 0)
})

function makeVersion(
  versionNumber: number,
  overrides: Partial<DriveFileVersionDto> = {}
): DriveFileVersionDto {
  return {
    id: `v${versionNumber}`,
    itemId: 'item-1',
    versionNumber,
    size: String(120 + versionNumber * 35),
    mimeType: 'text/markdown',
    source: versionNumber === 1 ? 'upload' : 'online_edit',
    isCurrent: false,
    deletePending: false,
    restoredFromVersionId: null,
    createdAt: `2026-11-${String(Math.min(26, 10 + versionNumber)).padStart(2, '0')}T10:00:00+08:00`,
    createdBy: 'user-1',
    ...overrides,
  }
}

function makeSnapshot(name: string): DriveBrowserSnapshotDto {
  return {
    context: 'owner',
    surface: 'standalone',
    current: {
      id: 'item-1',
      name,
      type: 'file',
      size: '512',
      mimeType: 'text/markdown',
      updatedAt: '2026-11-26T10:00:00+08:00',
      previewKind: 'markdown',
      browserUrl: '/drive/items/item-1',
      downloadUrl: '/drive/items/item-1/download',
    },
    breadcrumbs: [],
    children: [],
    childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
    preview: null,
    edit: {
      canEdit: true,
      editorKind: 'text',
      currentVersionId: 'v12',
      reason: null,
    },
    canDownload: true,
    canZip: false,
  }
}

async function renderChangeHistory(options: {
  readonly fileName?: string
  readonly versionCount?: number
} = {}) {
  const versionCount = options.versionCount ?? 3
  const versions = Array.from({ length: versionCount }, (_, index) => {
    const num = versionCount - index
    return makeVersion(num, { isCurrent: index === 0 })
  })

  vi.spyOn(driveBrowserApi, 'getOwnerItem').mockResolvedValue(
    makeSnapshot(options.fileName ?? 'architecture-specification.md')
  )
  vi.spyOn(driveFileVersionsApi, 'list').mockResolvedValue({
    items: versions,
    total: versions.length,
    page: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
  })
  vi.spyOn(driveFileVersionsApi, 'getContent').mockImplementation(
    async (_itemId, versionId) => {
      const num = Number(versionId.replace('v', ''))
      return {
        itemId: 'item-1',
        versionId,
        versionNumber: num,
        size: '256',
        mimeType: 'text/markdown',
        text: [
          '# Synapse 变更历史规格文档',
          `当前文档迭代版本：release-v${num}，用于验证行内高亮与分栏排版。`,
          '保持上下文行稳定以验证折叠块行为。',
          `第 ${num} 次修订补充说明。`,
        ].join('\n'),
      }
    }
  )

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  await render(
    <QueryClientProvider client={client}>
      <DriveChangeHistoryPage itemId='item-1' />
    </QueryClientProvider>
  )

  await expect
    .element(page.getByText(`v${versionCount - 1} → v${versionCount}`))
    .toBeVisible()
  await expect
    .element(page.getByText('保持上下文行稳定以验证折叠块行为。'))
    .toBeVisible()
}

describe('DriveChangeHistoryPage real browser layout & interaction', () => {
  it('keeps header single-row without overlapping sticky timeline at 1024px and renders distinct inline diff marks', async () => {
    await page.viewport(1024, 800)
    await renderChangeHistory({
      fileName:
        'ultra-long-enterprise-architecture-and-migration-design-specification-final-v2026-11-26.md',
      versionCount: 3,
    })

    const header = document.querySelector<HTMLElement>('header')!
    const aside = document.querySelector<HTMLElement>('aside[aria-label="版本时间线"]')!
    const headerRect = header.getBoundingClientRect()
    const asideRect = aside.getBoundingClientRect()

    // Header stays single-row (64px) and never overlaps sticky timeline rail.
    expect(headerRect.height).toBeLessThanOrEqual(68)
    expect(asideRect.top).toBeGreaterThanOrEqual(headerRect.bottom)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1024)

    // Inline word-level diff highlight has a visibly distinct background from its row cell.
    const mark = document.querySelector<HTMLElement>('mark')
    expect(mark).not.toBeNull()
    const markBg = getComputedStyle(mark!).backgroundColor
    const rowCell = mark!.closest('td')!
    const rowBg = getComputedStyle(rowCell.parentElement!).backgroundColor
    expect(markBg).not.toBe(rowBg)
    expect(markBg).not.toBe('rgba(0, 0, 0, 0)')

    await page.screenshot({ path: '/tmp/synapse-change-history-1024-single.png' })
  })

  it('supports range endpoint chips, swap, reversed indicator, and feed expansion beyond 10 items at 1280px', async () => {
    await page.viewport(1280, 860)
    await renderChangeHistory({ versionCount: 12 })

    // Switch to Range mode
    await page.getByRole('tab', { name: '范围对比' }).click()
    await expect.element(page.getByText('点选基准')).toBeVisible()
    await expect.element(page.getByText('互换')).toBeVisible()

    // Swap v11 -> v12 into reversed v12 -> v11
    await page.getByRole('button', { name: '互换' }).click()
    await expect.element(page.getByText('逆向对比')).toBeVisible()
    await expect.element(page.getByText('调换顺序')).toBeVisible()
    expect(document.body.textContent).not.toContain('v$')
    await page.screenshot({ path: '/tmp/synapse-change-history-1280-range.png' })

    // Swap back
    await page.getByRole('button', { name: '调换顺序' }).click()
    await expect.element(page.getByText('v11 → v12')).toBeVisible()

    // Switch to Feed mode and click v1 (beyond initial 10-item feed limit)
    await page.getByRole('tab', { name: '按次总览' }).click()
    await expect
      .element(page.getByText('当前展示 10 / 12 次变更', { exact: true }))
      .toBeVisible()
    await page.getByRole('button', { name: /v1\b/ }).click()
    await expect
      .element(page.getByText('当前展示 12 / 12 次变更', { exact: true }))
      .toBeVisible()
    await expect.element(page.getByText('初始创建 · v1')).toBeVisible()
  })

  it('avoids horizontal overflow, header collision, and diff clipping on narrow 390px viewports', async () => {
    await page.viewport(390, 844)
    await renderChangeHistory({ versionCount: 3 })

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)

    // Header sits at top of viewport; title and mode tabs stack cleanly without colliding.
    const header = document.querySelector<HTMLElement>('header')!
    const title = document.querySelector<HTMLElement>('header h1')!
    const tabList = document.querySelector<HTMLElement>('header [role="tablist"]')!
    expect(header.getBoundingClientRect().top).toBe(0)
    expect(title.getBoundingClientRect().width).toBeGreaterThan(80)
    expect(tabList.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      title.getBoundingClientRect().bottom
    )

    // All 5 time presets sit cleanly below the header and fit within the 390px container without clipping.
    const timeGroup = document.querySelector<HTMLElement>(
      '[aria-label="时间段筛选"]'
    )!
    const timeGroupWrapper = timeGroup.parentElement!
    expect(timeGroup.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().bottom
    )
    expect(timeGroupWrapper.scrollWidth).toBeLessThanOrEqual(
      timeGroupWrapper.clientWidth
    )
    expect(timeGroup.getBoundingClientRect().right).toBeLessThanOrEqual(
      timeGroupWrapper.getBoundingClientRect().right
    )

    // Unified diff table wraps inside 390px card without horizontal clipping.
    const diffRegion = document.querySelector<HTMLElement>(
      '[role="region"][aria-label="统一差异对比内容"]'
    )!
    expect(diffRegion.scrollWidth).toBeLessThanOrEqual(diffRegion.clientWidth)

    await page.screenshot({ path: '/tmp/synapse-change-history-390.png' })
  })
})
