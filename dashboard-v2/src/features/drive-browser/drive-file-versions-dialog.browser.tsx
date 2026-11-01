import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DriveFileVersionDto } from '@synapse/shared'
import { driveFileVersionsApi } from '@/lib/api'
import { DriveFileVersionsDialog } from './drive-file-versions-dialog'

afterEach(() => vi.restoreAllMocks())

async function renderHistory(count: number) {
  const versions: DriveFileVersionDto[] = Array.from({ length: count }, (_, index) => ({
    id: `version-${index + 1}`, itemId: 'item-1', versionNumber: count - index,
    size: '7372', mimeType: 'text/markdown', source: 'upload', isCurrent: index === 0,
    isPinned: false, deletePending: false, restoredFromVersionId: null,
    createdAt: '2026-06-17T12:01:33.000Z', createdBy: null,
  }))
  vi.spyOn(driveFileVersionsApi, 'list').mockResolvedValue({
    items: versions,
    page: { limit: 100, offset: 0, nextOffset: null, hasMore: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(<QueryClientProvider client={client}><DriveFileVersionsDialog itemId='item-1' open onOpenChange={() => undefined} /></QueryClientProvider>)
  if (count) await expect.element(page.getByText(`v${count}`, { exact: true })).toBeVisible()
  else await expect.element(page.getByText('暂无历史版本')).toBeVisible()
  await expect.poll(() => document.getAnimations().some(animation => animation.playState === 'running')).toBe(false)
  return {
    dialog: document.querySelector<HTMLElement>('[data-slot="modal-dialog"]')!,
    heading: page.getByRole('heading', { name: '历史版本' }).element(),
    body: document.querySelector<HTMLElement>('[data-slot="modal-body"]')!,
  }
}

describe('version history dialog geometry', () => {
  for (const width of [390, 1280]) {
    for (const count of [0, 1]) {
      it(`keeps ${count} versions naturally sized with an inset heading at ${width}px`, async () => {
        await page.viewport(width, 800)
        const { dialog, heading } = await renderHistory(count)
        const bounds = dialog.getBoundingClientRect()
        const title = heading.getBoundingClientRect()
        expect(title.left - bounds.left).toBeGreaterThanOrEqual(20)
        expect(title.top - bounds.top).toBeGreaterThanOrEqual(20)
        expect(bounds.height).toBeLessThan(400)
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        expect(bounds.right).toBeLessThanOrEqual(width)
        await page.screenshot({ path: `/tmp/synapse-version-history-${width}-${count}.png` })
      })
    }

    it(`scrolls long history inside the body within a short viewport at ${width}px`, async () => {
      await page.viewport(width, 360)
      const { dialog, body, heading } = await renderHistory(30)
      const bounds = dialog.getBoundingClientRect()
      expect(bounds.top).toBeGreaterThanOrEqual(0)
      expect(bounds.bottom).toBeLessThanOrEqual(360)
      expect(body.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.bottom)
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
      body.scrollTop = body.scrollHeight
      expect(body.scrollTop).toBeGreaterThan(0)
      expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(bounds.top)
      await page.screenshot({ path: `/tmp/synapse-version-history-${width}-long.png` })
    })
  }
})
