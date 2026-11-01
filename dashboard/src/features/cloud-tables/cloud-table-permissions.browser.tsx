import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CloudTableDto } from '@synapse/shared'
import { CloudTableDialogs } from './cloud-table-dialogs'
import { cloudTableApi } from './cloud-table-api'
import type { CloudTablesModel } from './use-cloud-tables'

afterEach(() => vi.restoreAllMocks())
const table: CloudTableDto = { id: 'table', ownerId: 'owner', name: '报名', schemaVersion: 1, fields: [], members: [], anonymous: {}, deletedAt: null, createdAt: '', permissions: { read: 'all', create: 'all', update: 'all', delete: 'all', manage: 'all' } }
async function mount() {
  const mutateAsync = vi.fn().mockResolvedValue({})
  const model = { table, dialog: { kind: 'permissions' }, setDialog: vi.fn(), mutation: { mutateAsync, isPending: false } } as unknown as CloudTablesModel
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(<QueryClientProvider client={client}><CloudTableDialogs model={model} /></QueryClientProvider>)
  await finishAnimations()
  return mutateAsync
}
async function finishAnimations() {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  await Promise.all(document.getAnimations().map(animation => animation.finished))
}
function fits(element: Element, width: number) {
  const rect = element.getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(0)
  expect(rect.right).toBeLessThanOrEqual(width + 1)
  expect(rect.bottom).toBeLessThanOrEqual(851)
}
for (const width of [320, 1280]) describe(`cloud table permissions ${width}px`, () => {
  it('searches by account email, selects with the keyboard, and keeps long candidates within the viewport', async () => {
    await page.viewport(width, 850)
    const handle = 'long_username_'.repeat(4)
    vi.spyOn(cloudTableApi, 'searchCollaborators').mockResolvedValue({ data: [{ id: 'u1', handle, nickname: '同名协作者' }], hasMore: false })
    const save = await mount()
    await page.getByRole('combobox', { name: '搜索用户' }).fill('alice@example.test')
    await expect.element(page.getByRole('option')).toBeVisible()
    await expect.element(page.getByText('同名协作者', { exact: true })).toBeVisible()
    const menu = page.getByRole('listbox').element()
    fits(menu, width)
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth + 1)
    await userEvent.keyboard('{ArrowDown}')
    await page.screenshot({ path: `/tmp/synapse-cloud-collaborators-menu-${width}.png` })
    await userEvent.keyboard('{Enter}')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    const dialog = page.getByRole('dialog').element()
    fits(dialog, width)
    const header = dialog.querySelector('[data-slot="modal-header"]')!.getBoundingClientRect()
    expect(header.left - dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(20)
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1)
    await page.screenshot({ path: `/tmp/synapse-cloud-collaborator-added-${width}.png` })
    await page.getByRole('button', { name: '保存', exact: true }).click()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ members: [{ userId: 'u1', permissions: { read: 'all', create: 'none', update: 'none', delete: 'none' } }] }) }))
  })
  it('confirms public destructive access on save and preserves the draft on cancel', async () => {
    await page.viewport(width, 850)
    const save = await mount()
    await page.getByText('删除全部记录', { exact: true }).click()
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(4)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const alert = page.getByRole('alertdialog')
    await expect.element(alert).toBeVisible()
    await finishAnimations()
    await expect.poll(() => alert.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(850)
    await expect.element(page.getByText('保存后，任何人无需登录即可删除全部记录。', { exact: true })).toBeVisible()
    fits(alert.element(), width)
    await page.screenshot({ path: `/tmp/synapse-cloud-permission-confirm-${width}.png` })
    expect(save).not.toHaveBeenCalled()
    await page.getByRole('button', { name: '返回修改', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '允许并保存', exact: true }).click()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ anonymous: { delete: true } }) }))
  })
})
