import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Download } from 'lucide-react'
import { dashboardApi } from '@/lib/api'
import { WebhookFormDialog, type WebhookFormState } from '@/features/webhooks'
import { TeamNameDialog } from '@/features/teams/team-dialogs'
import { ApiKeysSettings } from '@/features/settings/api-keys-settings'
import { WebhookDeliveryHistoryDetailSheet } from '@/features/webhook-deliveries/webhook-delivery-history-detail-sheet'
import { FilePreviewToolbarItemView } from '@/features/file-browser/preview/file-preview-toolbar'
import { DriveDownloadRenderer } from '@/features/drive-browser/renderers/download-renderer'
import { ConfirmDialog } from './confirm-dialog'

afterEach(() => vi.restoreAllMocks())

function separation(bodySlot: string, footerSlot: string, minimum = 16) {
  const body = document.querySelector(`[data-slot="${bodySlot}"]`)!
  const footer = document.querySelector(`[data-slot="${footerSlot}"]`)!
  expect(body).not.toBeNull()
  expect(footer.getBoundingClientRect().top - body.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(minimum)
}

function WebhookFixture({ onSubmit }: { onSubmit: () => void }) {
  const [form, setForm] = useState<WebhookFormState | null>({ mode: 'create', webhook: null, name: '' })
  return <WebhookFormDialog form={form} isSaving={false} onFormChange={setForm} onSubmit={(event) => { event.preventDefault(); onSubmit() }} />
}

describe('overlay spacing and icon sizing', () => {
  it('sizes custom download icons inside native link slots', async () => {
    await render(<>
      <DriveDownloadRenderer current={{ id: 'fixture-file', name: 'file.zip', type: 'file', size: '1024', mimeType: 'application/zip', updatedAt: '2026-11-01T00:00:00Z', previewKind: 'download', browserUrl: '/drive/items/fixture-file', downloadUrl: '/fixture/download' }} />
      <FilePreviewToolbarItemView item={{ id: 'download', kind: 'button', label: '下载', href: '/fixture/download', icon: Download }} />
      <FilePreviewToolbarItemView item={{ id: 'loading', kind: 'button', label: '下载中', href: '/fixture/download', icon: Download, loading: true }} />
    </>)
    const links = document.querySelectorAll('[data-slot="link"]')
    expect(links.length).toBe(3)
    for (const link of links) {
      const icon = link.querySelector('svg')!
      const slot = link.querySelector('[data-slot="link-icon"]')!
      expect(slot).not.toBeNull()
      expect(icon.getBoundingClientRect().width).toBeLessThanOrEqual(slot.getBoundingClientRect().width + 1)
      expect(icon.getBoundingClientRect().height).toBeLessThanOrEqual(slot.getBoundingClientRect().height + 1)
    }
  })

  for (const width of [390, 1280]) {
    it(`separates webhook content and actions while retaining form submission at ${width}px`, async () => {
      await page.viewport(width, 800)
      const submit = vi.fn()
      await render(<WebhookFixture onSubmit={submit} />)
      await page.getByRole('textbox', { name: '名称' }).fill('布局回归')
      const input = page.getByRole('textbox', { name: '名称' }).element().getBoundingClientRect()
      const save = page.getByRole('button', { name: '保存', exact: true })
      expect(save.element().getBoundingClientRect().top - input.bottom).toBeGreaterThanOrEqual(16)
      await save.click()
      expect(submit).toHaveBeenCalledOnce()
    })

    it(`separates standard dialog sections at ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<TeamNameDialog open title='创建团队' initialName='团队' submitText='创建' isPending={false} error={null} onOpenChange={() => undefined} onSubmit={() => undefined} />)
      separation('modal-body', 'modal-footer')
    })

    it(`separates confirmation text and actions at ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<ConfirmDialog open title='删除项目' desc='删除后无法恢复。' onOpenChange={() => undefined} handleConfirm={() => undefined} />)
      separation('alert-dialog-body', 'alert-dialog-footer')
    })

    it(`separates drawer headings from scrollable details at ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<WebhookDeliveryHistoryDetailSheet open onOpenChange={() => undefined} delivery={{
        id: 'delivery', webhookId: 'webhook', method: 'POST', path: '/fixture', query: {}, headers: {}, bodyKind: 'json', bodySize: 2, bodyPreview: '{}',
        receivedAt: '2026-11-01T00:00:00Z', onlineClientCount: 0, sentClientCount: 0, failedClientCount: 0, acknowledgedClientCount: 0, clientReceipts: [], status: 'delivered',
        webhook: { id: 'webhook', publicId: 'fixture', name: '布局回归', currentName: '布局回归', deletedAt: null },
      }} />)
      separation('drawer-header', 'drawer-body', 8)
      expect(document.querySelectorAll('[data-slot="drawer-body"]').length).toBe(1)
    })

    it(`keeps permission icons proportional and long content scrollable at ${width}px`, async () => {
      await page.viewport(width, 600)
      vi.spyOn(dashboardApi, 'listApiKeys').mockResolvedValue([])
      vi.spyOn(dashboardApi, 'listApiKeyCapabilities').mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
        scope: `fixture.${index}`, name: `权限 ${index}`, description: '用于检查长权限列表的滚动与操作区域。', documentationUrl: 'https://example.invalid/docs',
      })))
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      await render(<QueryClientProvider client={client}><ApiKeysSettings /></QueryClientProvider>)
      await page.getByRole('button', { name: '创建密钥' }).click()
      const link = page.getByRole('link', { name: '权限 0 API 文档', exact: true })
      await expect.element(link).toBeVisible()
      const svg = link.element().querySelector('svg')!
      expect(svg.getBoundingClientRect().width).toBeLessThanOrEqual(parseFloat(getComputedStyle(link.element()).fontSize))
      separation('modal-body', 'modal-footer')
      const body = document.querySelector('[data-slot="modal-body"]')!
      const permissionList = body.querySelector('.overflow-y-auto')!
      expect(body.scrollHeight > body.clientHeight || permissionList.scrollHeight > permissionList.clientHeight).toBe(true)
      const create = page.getByRole('button', { name: '创建', exact: true }).element().getBoundingClientRect()
      expect(create.bottom).toBeLessThanOrEqual(600)
      expect(create.right).toBeLessThanOrEqual(width)
    })
  }
})

for (const width of [390, 1280]) {
  it(`keeps an 80-character API key usage title inside the dialog at ${width}px`, async () => {
    await page.viewport(width, 800)
    const name = 'A'.repeat(80)
    vi.spyOn(dashboardApi, 'listApiKeys').mockResolvedValue([{
      id: 'long-title-key', name, prefix: 'fixture', scopes: [], lastUsedAt: null, createdAt: '2026-11-01T00:00:00Z',
    }])
    vi.spyOn(dashboardApi, 'listApiKeyCapabilities').mockResolvedValue([])
    vi.spyOn(dashboardApi, 'listApiKeyUsageLogs').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await render(<QueryClientProvider client={client}><ApiKeysSettings /></QueryClientProvider>)
    await page.getByRole('button', { name: '使用记录', exact: true }).click()
    const heading = page.getByRole('heading', { name: `${name} 使用记录`, exact: true }).element()
    const dialog = page.getByRole('dialog').element()
    await expect.poll(() => dialog.closest('[data-slot="modal-backdrop"]')!.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')).toBe(false)
    const bounds = dialog.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(heading)
    for (const rect of range.getClientRects()) {
      expect(rect.left).toBeGreaterThanOrEqual(bounds.left + 20)
      expect(rect.right).toBeLessThanOrEqual(bounds.right - 20)
    }
  })
}
